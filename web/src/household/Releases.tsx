import { useEffect, useRef, useState } from "react";
import { api, type SearchAnswer, type SearchResult } from "../api";
import Icon from "../components/Icon";
import type { Kind } from "./api";
import { Empty, Loading, Problem } from "./Shared";
import { bytes, errorText } from "./utils";

export default function Releases({
  kind,
  id,
  title,
  season,
  episode,
  onClose,
  onGrab,
}: {
  kind: Kind;
  id: number;
  title: string;
  season: number;
  episode?: number;
  onClose: () => void;
  onGrab: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [answer, setAnswer] = useState<SearchAnswer<SearchResult> | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  useEffect(() => {
    let live = true;
    setAnswer(null);
    setError("");
    void (
      kind === "movie"
        ? api.movieSearch(id)
        : api.seriesSearch(id, season, episode)
    )
      .then((a) => {
        if (live) setAnswer(a);
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, [kind, id, season, episode, revision]);
  const grab = async (release: SearchResult) => {
    setBusy(release.downloadUrl);
    setError("");
    try {
      const data = {
        releaseTitle: release.title,
        downloadUrl: release.downloadUrl,
        sizeBytes: release.sizeBytes,
        protocol: release.protocol,
      };
      if (kind === "movie") await api.grab(id, data);
      else await api.grabSeries(id, { ...data, season, episode });
      onGrab();
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="hh-modal hh-releases"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === dialog.current) onClose();
      }}
      aria-labelledby="release-title"
    >
      <div className="hh-modal-head">
        <div>
          <p className="hh-eyebrow">Choose a download</p>
          <h2 id="release-title">
            {title}
            {kind === "tv"
              ? ` · Season ${season}${episode ? `, episode ${episode}` : ""}`
              : ""}
          </h2>
        </div>
        <button
          className="hh-round"
          aria-label="Close releases"
          onClick={onClose}
        >
          <Icon name="x" size={21} />
        </button>
      </div>
      <div className="hh-modal-body">
        {error && (
          <Problem message={error} retry={() => setRevision((n) => n + 1)} />
        )}
        {!answer && !error && <Loading />}
        {answer && (
          <>
            {answer.unanswered.map((s) => (
              <Problem key={s.name} message={`${s.name}: ${s.message}`} />
            ))}
            {answer.warnings?.map((w) => (
              <Problem key={w} message={w} />
            ))}
            {!answer.results.length ? (
              <Empty title="No releases found">
                {answer.sources
                  ? "Try again later, or choose a different season or episode."
                  : "No search sources are configured for this title. An administrator can add them in server settings."}
              </Empty>
            ) : (
              <div className="hh-release-list">
                {answer.results.map((r, i) => {
                  const reasons = [
                    ...new Set([
                      ...(r.rejections || []),
                      ...(r.reasons || []).map((x) => x.text),
                      ...(r.blocklisted
                        ? ["This release is on the server’s blocklist."]
                        : []),
                      ...(r.belowMinSeeders
                        ? [
                            `Fewer than ${r.minSeeders ?? "the required"} seeders.`,
                          ]
                        : []),
                    ]),
                  ];
                  return (
                    <article className="hh-release" key={r.downloadUrl + i}>
                      <div className="hh-release-top">
                        <div>
                          <h3>{r.title}</h3>
                          <p className="hh-release-meta">
                            {r.best && (
                              <span className="hh-best">
                                Recommended release
                              </span>
                            )}
                            <span>
                              {r.resolution || r.protocol.toUpperCase()}
                            </span>
                            <span>{bytes(r.sizeBytes)}</span>
                            {r.seeders !== undefined && (
                              <span>{r.seeders} seeders</span>
                            )}
                            <span>{r.indexerName}</span>
                            {r.language && <span>{r.language}</span>}
                          </p>
                        </div>
                        {!reasons.length && (
                          <button
                            className="hh-button hh-primary hh-small"
                            disabled={busy !== null}
                            onClick={() => void grab(r)}
                          >
                            {busy === r.downloadUrl ? (
                              "Starting…"
                            ) : (
                              <>
                                <Icon name="download" size={16} />
                                Download
                              </>
                            )}
                          </button>
                        )}
                      </div>
                      {reasons.length > 0 && (
                        <details className="hh-release-warning">
                          <summary>
                            <Icon name="info" size={16} />
                            Not selected automatically · review{" "}
                            {reasons.length === 1 ? "reason" : "reasons"}
                          </summary>
                          <ul>
                            {reasons.map((reason) => (
                              <li key={reason}>{reason}</li>
                            ))}
                          </ul>
                          <button
                            className="hh-button hh-secondary hh-small"
                            disabled={busy !== null}
                            onClick={() => void grab(r)}
                          >
                            {busy === r.downloadUrl
                              ? "Starting…"
                              : "Download this release anyway"}
                          </button>
                        </details>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </dialog>
  );
}
