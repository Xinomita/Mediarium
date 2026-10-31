import { withBase } from "../base";
export type Kind = "movie" | "tv";
export interface WatchProgress {
  path: string;
  position: number;
  duration: number;
  updatedAt: string;
}
export interface HouseholdTitle {
  kind: Kind;
  tmdbId: number;
  libraryId?: number;
  title: string;
  year: number;
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  genres?: string[];
  rating?: number;
  voteCount?: number;
  language?: string;
  available: boolean;
  status?: string;
  reason?: string;
  progress?: WatchProgress;
}
export interface Preferences {
  languages: string[];
  includeOtherLanguages: boolean;
  minRating: number;
  preferredGenres: number[];
  blockedGenres: number[];
  hidden: string[];
  watchlist: string[];
  liked: string[];
}
export interface HomeResponse {
  rails: { id: string; title: string; items: HouseholdTitle[] }[];
  hero?: HouseholdTitle;
  preferences: Preferences;
  warnings: string[];
}
export interface Playback {
  mode: "direct" | "hls";
  url: string;
  sessionId?: string;
  position: number;
  duration: number;
  subtitles: { url: string; language: string; label: string }[];
}
export interface PlayRequest {
  kind: Kind;
  id: number;
  path: string;
  transcode?: boolean;
  start?: number;
}
async function req<T>(
  path: string,
  body?: unknown,
  method = body === undefined ? "GET" : "POST",
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch(withBase("/api/household" + path), {
    method,
    credentials: "include",
    signal,
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await r.json();
  if (!r.ok)
    throw new Error(data.error || "The server could not complete that action.");
  return data as T;
}
export const household = {
  library: () => req<HouseholdTitle[]>("/library"),
  home: (signal?: AbortSignal) =>
    req<HomeResponse>("/home", undefined, "GET", signal),
  preferences: () => req<Preferences>("/preferences"),
  savePreferences: (p: Preferences) =>
    req<Preferences>("/preferences", p, "PUT"),
  play: (p: PlayRequest) => req<Playback>("/playback", p),
  stop: (id: string) =>
    req<{ ok: boolean }>(
      "/playback/" + encodeURIComponent(id),
      undefined,
      "DELETE",
    ),
  progress: (p: {
    kind: Kind;
    id: number;
    path: string;
    position: number;
    duration: number;
  }) => req<{ ok: boolean }>("/progress", p, "PUT"),
};
