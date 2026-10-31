import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import Icon from "../components/Icon";
import type { Trailer as Video } from "../api";
const origin = "https://www.youtube-nocookie.com";

// One iframe at a time. Preview unmounts when it leaves the viewport or a dialog opens.
export function TrailerVideo({ video, preview = false, onUnavailable, onEnded }: { video: Video; preview?: boolean; onUnavailable?: () => void; onEnded?: () => void }) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState("loading");
  const [muted, setMuted] = useState(preview);
  const [paused, setPaused] = useState(false);
  const callbacks = useRef({ onUnavailable, onEnded });
  const pausedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
  useEffect(() => { callbacks.current = { onUnavailable, onEnded }; }, [onUnavailable, onEnded]);
  const command = useCallback((func: string, args: unknown[] = []) => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "command", func, args }), origin), []);
  useEffect(() => {
    let settled = false;
    const timer = window.setTimeout(() => { if (!settled) { setState("error"); callbacks.current.onUnavailable?.(); } }, 15000);
    const receive = (event: MessageEvent) => {
      if (event.origin !== origin || event.source !== frame.current?.contentWindow || typeof event.data !== "string") return;
      let message: { event?: string; info?: number | { playerState?: number } };
      try { message = JSON.parse(event.data); } catch { return; }
      const playing = message.event === "onStateChange" ? message.info : typeof message.info === "object" ? message.info?.playerState : undefined;
      if (message.event === "onReady") { if (preview) command("mute"); command("playVideo"); }
      if (message.event === "onError") { settled = true; window.clearTimeout(timer); setState("error"); callbacks.current.onUnavailable?.(); }
      if (playing === 1) { settled = true; window.clearTimeout(timer); setState("playing"); setPaused(false); }
      if (playing === 2) setPaused(true);
      if (playing === 0) { setState("ended"); callbacks.current.onEnded?.(); }
    };
    const pause = () => { command("pauseVideo"); setPaused(true); };
    const visibility = () => { if (document.hidden) pause(); };
    const media = (event: Event) => { const key = (event as CustomEvent<string>).detail; const stop = key === "pause" || (key === "playpause" && !pausedRef.current); command(stop ? "pauseVideo" : "playVideo"); setPaused(stop); };
    if (!preview) document.addEventListener("mediarium-trailer-media", media);
    document.addEventListener("visibilitychange", visibility);
    document.addEventListener("mediarium-pause", pause);
    window.addEventListener("message", receive);
    return () => { window.clearTimeout(timer); window.removeEventListener("message", receive); document.removeEventListener("visibilitychange", visibility); document.removeEventListener("mediarium-pause", pause); document.removeEventListener("mediarium-trailer-media", media); };
  }, [video.key, preview, command]);
  const params = new URLSearchParams({ autoplay: "1", mute: preview ? "1" : "0", controls: "0", playsinline: "1", rel: "0", enablejsapi: "1", disablekb: "1", origin: location.origin });
  return <div className={`hh-trailer-video ${preview ? "hh-trailer-preview" : ""}`} data-state={state}>
    {state !== "error" && <iframe ref={frame} src={`${origin}/embed/${encodeURIComponent(video.key)}?${params}`} title={video.name} tabIndex={-1} allow="autoplay; encrypted-media; fullscreen" referrerPolicy="strict-origin-when-cross-origin" onLoad={() => frame.current?.contentWindow?.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), origin)} />}
    {!preview && <>
      {state === "loading" && <p className="hh-trailer-status" role="status">Loading trailer…</p>}
      {state === "error" && <p className="hh-trailer-status" role="alert">This trailer could not play here. Try another trailer.</p>}
      {state !== "error" && <div className="hh-trailer-controls" data-tv-row="trailer-controls">
        <button className="hh-button hh-glass" onClick={() => { command(paused ? "playVideo" : "pauseVideo"); setPaused(!paused); }}><Icon name={paused ? "play" : "pause"} size={18} />{paused ? "Play" : "Pause"}</button>
        <button className="hh-button hh-glass" onClick={() => { command(muted ? "unMute" : "mute"); setMuted(!muted); }}>{muted ? "Sound on" : "Mute"}</button>
        <button className="hh-button hh-glass" onClick={() => { command("seekTo", [0, true]); command("playVideo"); }}>Restart</button>
      </div>}
    </>}
  </div>;
}

export function TrailerDialog({ title, trailers, onClose }: { title: string; trailers: Video[]; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [index, setIndex] = useState(0);
  const videos = trailers.filter(v => v.site === "YouTube" && /^[a-zA-Z0-9_-]{6,32}$/.test(v.key));
  useEffect(() => {
    const box = dialog.current;
    const previous = document.activeElement;
    box?.showModal();
    return () => { box?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog className="hh-trailer-dialog" ref={dialog} onCancel={(e) => { e.preventDefault(); onClose(); }} aria-label={`${title} trailer`}>
    <header><h2>{title}</h2><button className="hh-button hh-glass" data-tv-primary onClick={onClose} aria-label="Close trailer"><Icon name="x" size={20} /></button></header>
    {videos[index] ? <TrailerVideo key={videos[index].key} video={videos[index]} /> : <p>No trailer is available for this title.</p>}
    {videos.length > 1 && <div className="hh-trailer-options" data-tv-row="trailers">{videos.slice(0, 5).map((v, i) => <button key={v.key} className="hh-button hh-glass" aria-pressed={index === i} onClick={() => setIndex(i)}>{v.name}</button>)}</div>}
  </dialog>, document.body);
}
