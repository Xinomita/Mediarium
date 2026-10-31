import { useCallback, useEffect, useRef, useState } from "react";
import Hls from "hls.js";
import type { TitleFile } from "../api";
import Icon from "../components/Icon";
import { household, type Kind, type Playback } from "./api";
import { errorText, timeLabel } from "./utils";

export default function HouseholdPlayer({
  kind,
  id,
  file,
  title,
  onClose,
}: {
  kind: Kind;
  id: number;
  file: TitleFile;
  title: string;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const infoRef = useRef<Playback | null>(null);
  const generation = useRef(0);
  const alive = useRef(true);
  const saving = useRef(false);
  const lastSaved = useRef(0);
  const [info, setInfo] = useState<Playback | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(0);
  const [seekDraft, setSeekDraft] = useState<number | null>(null);
  const clock = useRef({ position: 0, duration: 0 });
  const save = useCallback(
    async (force = false) => {
      const value = clock.current;
      if (
        !value.duration ||
        saving.current ||
        (!force && Date.now() - lastSaved.current < 10000)
      )
        return;
      saving.current = true;
      lastSaved.current = Date.now();
      try {
        await household.progress({
          kind,
          id,
          path: file.path,
          position: value.position,
          duration: value.duration,
        });
        if (alive.current) setSaveError("");
      } catch (e) {
        if (alive.current)
          setSaveError(`Your position could not be saved: ${errorText(e)}`);
      } finally {
        saving.current = false;
      }
    },
    [kind, id, file.path],
  );
  const start = useCallback(
    async (transcode = false, offset?: number) => {
      const gen = ++generation.current;
      setLoading(true);
      setError("");
      const previous = infoRef.current;
      infoRef.current = null;
      setInfo(null);
      if (previous?.sessionId)
        await household.stop(previous.sessionId).catch(() => undefined);
      try {
        const next = await household.play({
          kind,
          id,
          path: file.path,
          transcode,
          ...(offset !== undefined ? { start: offset } : {}),
        });
        if (gen !== generation.current || !alive.current) {
          if (next.sessionId)
            void household.stop(next.sessionId).catch(() => undefined);
          return;
        }
        infoRef.current = next;
        clock.current = { position: next.position, duration: next.duration };
        setPosition(next.position);
        setDuration(next.duration);
        setInfo(next);
      } catch (e) {
        if (gen === generation.current && alive.current) {
          setError(errorText(e));
          setLoading(false);
        }
      }
    },
    [kind, id, file.path],
  );
  useEffect(() => {
    alive.current = true;
    dialog.current?.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    void start();
    return () => {
      alive.current = false;
      generation.current++;
      void save(true);
      const current = infoRef.current;
      if (current?.sessionId)
        void household.stop(current.sessionId).catch(() => undefined);
      infoRef.current = null;
      document.body.style.overflow = oldOverflow;
    };
  }, [start, save]);
  useEffect(() => {
    const el = video.current;
    if (!el || !info) return;
    let hls: Hls | null = null;
    let active = true;
    let recovering = false;
    const play = () => {
      if (!active) return;
      if (
        info.mode === "direct" &&
        info.position > 0 &&
        Number.isFinite(el.duration)
      )
        el.currentTime = Math.min(info.position, Math.max(0, el.duration - 1));
      if (
        info.mode === "direct" &&
        Number.isFinite(el.duration) &&
        el.duration > 0
      ) {
        setDuration(el.duration);
        clock.current.duration = el.duration;
      }
      setLoading(false);
      void el.play().catch(() => {
        /* Autoplay can require pressing Play in the browser. */
      });
    };
    const failed = () => {
      if (!active || recovering) return;
      recovering = true;
      if (info.mode === "direct") void start(true, clock.current.position);
      else {
        setError(
          "This stream could not be played. Try again, or return to the title.",
        );
        setLoading(false);
      }
    };
    el.addEventListener("loadedmetadata", play);
    el.addEventListener("error", failed);
    if (
      info.mode === "hls" &&
      (Hls.isSupported() || !el.canPlayType("application/vnd.apple.mpegurl"))
    ) {
      if (Hls.isSupported()) {
        hls = new Hls({
          startPosition: 0,
          maxBufferLength: 30,
          maxMaxBufferLength: 90,
        });
        hls.loadSource(info.url);
        hls.attachMedia(el);
        hls.on(Hls.Events.ERROR, (_event, detail) => {
          if (detail.fatal) failed();
        });
      } else {
        setError(
          "This browser cannot play this stream. Try a current version of Safari, Chrome, Firefox or Edge.",
        );
        setLoading(false);
      }
    } else el.src = info.url;
    return () => {
      active = false;
      el.removeEventListener("loadedmetadata", play);
      el.removeEventListener("error", failed);
      hls?.destroy();
      el.pause();
      el.removeAttribute("src");
      el.load();
    };
  }, [info, start]);
  const timeUpdate = () => {
    const el = video.current;
    const now = infoRef.current;
    if (!el || !now) return;
    const p = (now.mode === "hls" ? now.position : 0) + el.currentTime;
    const total =
      now.mode === "direct" && Number.isFinite(el.duration)
        ? el.duration
        : now.duration;
    clock.current = { position: p, duration: total };
    setPosition(p);
    if (total > 0) setDuration(total);
    void save();
  };
  const seek = (value: number) => {
    const offset = Math.max(0, Math.min(value, Math.max(0, duration - 1)));
    setSeekDraft(null);
    if (info?.mode === "hls") void start(true, offset);
    else if (video.current) video.current.currentTime = offset;
  };
  const close = () => {
    void save(true);
    onClose();
  };
  return (
    <dialog
      ref={dialog}
      className="hh-player"
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
      aria-label={`Playing ${title}`}
    >
      <header className="hh-player-head">
        <div>
          <h2>{title}</h2>
          <p>{file.path.split("/").at(-1)}</p>
        </div>
        <button className="hh-round" aria-label="Close player" onClick={close}>
          <Icon name="x" size={24} />
        </button>
      </header>
      <div className="hh-video-wrap">
        <video
          ref={video}
          controls
          playsInline
          autoPlay
          onTimeUpdate={timeUpdate}
          onPause={() => void save(true)}
          onEnded={() => void save(true)}
          aria-label={title}
        >
          {info?.subtitles.map((s, i) => (
            <track
              key={s.url}
              kind="subtitles"
              src={s.url}
              srcLang={s.language || "en"}
              label={s.label || s.language || `Subtitles ${i + 1}`}
            />
          ))}
        </video>
        {loading && (
          <div className="hh-player-status" role="status">
            <div className="hh-skeleton hh-player-skeleton" />
            <p>Preparing your film…</p>
          </div>
        )}
        {error && (
          <div className="hh-player-status" role="alert">
            <Icon name="warning" size={30} />
            <p>{error}</p>
            <div className="hh-actions">
              <button
                className="hh-button hh-primary"
                onClick={() => void start(true, clock.current.position)}
              >
                Try again
              </button>
              <button className="hh-button hh-secondary" onClick={close}>
                Back to title
              </button>
            </div>
          </div>
        )}
      </div>
      {info?.mode === "hls" && duration > 0 && (
        <div className="hh-player-timeline">
          <label htmlFor="playback-position">Playback position</label>
          <span>{timeLabel(seekDraft ?? position)}</span>
          <input
            id="playback-position"
            type="range"
            min="0"
            max={duration}
            step="1"
            value={seekDraft ?? Math.min(position, duration)}
            onChange={(e) => setSeekDraft(Number(e.target.value))}
            onPointerUp={(e) => seek(Number(e.currentTarget.value))}
            onKeyUp={(e) => {
              if (
                [
                  "ArrowLeft",
                  "ArrowRight",
                  "Home",
                  "End",
                  "PageUp",
                  "PageDown",
                  "Enter",
                ].includes(e.key)
              )
                seek(Number(e.currentTarget.value));
            }}
          />
          <span>{timeLabel(duration)}</span>
        </div>
      )}
      {saveError && (
        <p className="hh-player-save-error" role="status">
          {saveError}
        </p>
      )}
    </dialog>
  );
}
