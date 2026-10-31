import { api, type MovieDetail, type TVDetail } from "../api";
import type { Kind } from "./api";
import { HOME_INVALIDATED } from "./cache";
const details = new Map<string, { expires: number; value: Promise<MovieDetail | TVDetail> }>();
if (typeof window !== "undefined") window.addEventListener(HOME_INVALIDATED, () => details.clear());
export function titleMetadata(userId: number, kind: Kind, id: number) {
  const key = `${userId}:${kind}:${id}`;
  const old = details.get(key);
  if (old && old.expires > Date.now()) return old.value;
  const value = (kind === "movie" ? api.tmdbMovieDetail(id) : api.tmdbTVDetail(id)).catch((error: unknown) => { details.delete(key); throw error; });
  if (details.size > 100) details.clear();
  details.set(key, { expires: Date.now() + 300_000, value });
  return value;
}
