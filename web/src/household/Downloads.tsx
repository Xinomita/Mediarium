import { useState } from "react";
import { Link } from "react-router-dom";
import { api, can, isAdmin, isViewer, type QueueItem } from "../api";
import { useAuth } from "../AuthContext";
import Icon from "../components/Icon";
import { Empty, Loading, Problem } from "./Shared";
import {
  bytes,
  clampProgress,
  errorText,
  queueLabel,
  titleLink,
} from "./utils";
import { usePoll } from "./usePoll";

export default function HouseholdDownloads() {
  const { user } = useAuth();
  const state = usePoll(api.listQueue, 2000);
  const [busy, setBusy] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [showFinished, setShowFinished] = useState(true);
  const items = state.data || [];
  const active = items
    .filter((q) => q.status !== "completed" && q.status !== "stopped")
    .sort((a, b) => b.id - a.id);
  const finished = items
    .filter((q) => q.status === "completed" || q.status === "stopped")
    .sort((a, b) => b.id - a.id);
  const act = async (
    q: QueueItem,
    action: "retry" | "pause" | "resume" | "stop",
  ) => {
    setBusy(q.id);
    setError("");
    try {
      if (action === "retry") await api.retryQueueItem(q.id);
      if (action === "pause") await api.pauseQueueItem(q.id);
      if (action === "resume") await api.resumeQueueItem(q.id);
      if (action === "stop") await api.stopQueueItem(q.id, false);
      state.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };
  const row = (q: QueueItem) => {
    const link =
      q.tmdbId && (q.movieId || q.seriesId)
        ? titleLink(q.seriesId ? "tv" : "movie", q.tmdbId)
        : null;
    const progress = clampProgress(q.progressPct);
    return (
      <article
        className={`hh-download ${q.status === "failed" || q.status === "conflict" ? "hh-download-problem" : ""}`}
        key={q.id}
      >
        <div className="hh-download-art">
          {q.posterUrl ? (
            <img src={q.posterUrl} alt="" />
          ) : (
            <Icon name="film" size={28} />
          )}
        </div>
        <div className="hh-download-body">
          <div className="hh-download-title">
            <h2>{link ? <Link to={link}>{q.title}</Link> : q.title}</h2>
            {q.status === "downloading" && (
              <span className="hh-download-percent">
                {progress.toFixed(1)}%
              </span>
            )}
          </div>
          {q.subtitle && <p className="hh-muted">{q.subtitle}</p>}
          <p className="hh-download-status">
            <span>{queueLabel(q)}</span>
            <span>{bytes(q.sizeBytes)}</span>
            {q.resolution && <span>{q.resolution}</span>}
            {q.peers !== undefined && q.status === "downloading" && (
              <span>{q.peers} peers</span>
            )}
          </p>
          {!["completed", "failed", "stopped", "conflict"].includes(
            q.status,
          ) && (
            <div
              className={`hh-progress ${q.status === "importing" ? "hh-progress-importing" : ""}`}
              role="progressbar"
              aria-label={`${q.title}: ${queueLabel(q)}`}
              aria-valuenow={q.status === "importing" ? undefined : progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span
                style={{
                  width: `${q.status === "importing" ? 100 : progress}%`,
                }}
              />
            </div>
          )}
          {(q.error || q.note) && (
            <p className={q.error ? "hh-error-text" : "hh-muted"}>
              {q.error || q.note}
            </p>
          )}
          <details className="hh-download-details">
            <summary>Release details</summary>
            <p>{q.releaseTitle}</p>
            {q.indexerName && <p>Source: {q.indexerName}</p>}
            {q.addedAt && <p>Added {new Date(q.addedAt).toLocaleString()}</p>}
          </details>
        </div>
        <div className="hh-download-actions">
          {q.status === "completed" && link && (
            <Link to={link} className="hh-button hh-primary hh-small">
              <Icon name="play" size={16} />
              Watch
            </Link>
          )}
          {["failed", "stopped"].includes(q.status) &&
            can(user, "retry") &&
            !isViewer(user) && (
              <button
                className="hh-button hh-secondary hh-small"
                disabled={busy !== null}
                onClick={() => void act(q, "retry")}
              >
                {busy === q.id ? "Retrying…" : "Retry"}
              </button>
            )}
          {isAdmin(user) && q.status === "paused" && (
            <button
              className="hh-button hh-secondary hh-small"
              disabled={busy !== null}
              onClick={() => void act(q, "resume")}
            >
              <Icon name="play" size={16} />
              Resume
            </button>
          )}
          {isAdmin(user) && q.status === "downloading" && (
            <button
              className="hh-round"
              aria-label={`Pause ${q.title}`}
              disabled={busy !== null || !!q.pending}
              onClick={() => void act(q, "pause")}
            >
              <Icon name="pause" size={17} />
            </button>
          )}
          {isAdmin(user) &&
            ["queued", "paused", "downloading"].includes(q.status) && (
              <button
                className="hh-round"
                aria-label={`Stop ${q.title}, keeping downloaded files`}
                disabled={busy !== null || !!q.pending}
                onClick={() => void act(q, "stop")}
              >
                <Icon name="stop" size={17} />
              </button>
            )}
          {q.status === "conflict" && isAdmin(user) && (
            <Link to="/queue" className="hh-text-button">
              Resolve
            </Link>
          )}
          {q.status === "failed" && link && (
            <Link to={link} className="hh-text-button">
              Try another release
            </Link>
          )}
        </div>
      </article>
    );
  };
  return (
    <div className="hh-page hh-downloads-page">
      <div className="hh-page-heading">
        <p className="hh-eyebrow">On your server</p>
        <h1>Downloads</h1>
        <p>Everything continues here when you close your browser.</p>
      </div>
      {state.error && (
        <Problem
          message={`${state.error}${state.data ? " Showing the last successful update." : ""}`}
          retry={state.refresh}
        />
      )}
      {error && <Problem message={error} />}
      {state.loading ? (
        <Loading />
      ) : (
        <>
          {active.length ? (
            <div className="hh-download-list">{active.map(row)}</div>
          ) : (
            !state.error && finished.length === 0 && (
              <Empty title="All caught up.">
                <Link to="/watch">Find something good to watch</Link>
              </Empty>
            )
          )}
          {finished.length > 0 && (
            <section className="hh-download-history">
              <button
                className="hh-section-toggle"
                aria-expanded={showFinished}
                onClick={() => setShowFinished((v) => !v)}
              >
                <h2>Recent downloads</h2>
                <span>{finished.length}</span>
                <Icon
                  name={showFinished ? "chevron-up" : "chevron-down"}
                  size={20}
                />
              </button>
              {showFinished && (
                <div className="hh-download-list">
                  {finished.slice(0, 30).map(row)}
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
