import type { HouseholdTitle, Kind } from "./api";
import type { Movie, QueueItem, Series, TitleResult } from "../api";

export function titleKey(kind: Kind, id: number) {
  return `${kind}:${id}`;
}
export function titleLink(kind: Kind, id: number) {
  return `/watch/title/${kind}/${id}`;
}
export function statusAvailable(status?: string) {
  if (status === "downloaded") return true;
  return /^\d+\/\d+$/.test(status || "") && Number(status?.split("/")[0]) > 0;
}
export function searchTitle(t: TitleResult): HouseholdTitle {
  return { ...t, available: statusAvailable(t.status) };
}
export function movieTitle(m: Movie): HouseholdTitle {
  return {
    ...m,
    kind: "movie",
    libraryId: m.id,
    available: m.status === "downloaded",
  };
}
export function seriesTitle(s: Series): HouseholdTitle {
  return {
    ...s,
    kind: "tv",
    libraryId: s.id,
    available: s.downloadedCount > 0,
    status: `${s.downloadedCount}/${s.episodeCount}`,
  };
}
export function errorText(e: unknown) {
  return e instanceof Error
    ? e.message
    : "Could not complete that action. Please try again.";
}
export function timeLabel(s: number) {
  if (!Number.isFinite(s) || s < 0) return "0:00";
  const n = Math.floor(s);
  return n >= 3600
    ? `${Math.floor(n / 3600)}:${String(Math.floor(n / 60) % 60).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`
    : `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}`;
}
export function bytes(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "Size unknown";
  return n >= 1024 ** 3
    ? `${(n / 1024 ** 3).toFixed(1)} GB`
    : `${Math.round(n / 1024 ** 2)} MB`;
}
export function queueLabel(q: QueueItem) {
  if (q.pending === "pausing") return "Pausing";
  if (q.pending === "stopping") return "Stopping";
  if (q.waiting) return "Waiting to import";
  switch (q.status) {
    case "queued":
      return q.queuePosition ? `Queued · ${q.queuePosition} in line` : "Queued";
    case "downloading":
      return "Downloading";
    case "importing":
      return "Adding to library";
    case "completed":
      return q.keptFile ? "Finished · existing file kept" : "Ready to watch";
    case "failed":
      return "Download failed";
    case "conflict":
      return "Needs an administrator";
    case "paused":
      return q.interrupted ? "Paused after restart" : "Paused";
    case "stopped":
      return "Stopped";
  }
}
export function clampProgress(n: number) {
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}
