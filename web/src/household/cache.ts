import type { HomeResponse, Kind } from "./api";
const cache = new Map<string, HomeResponse>();
export const HOME_INVALIDATED = "household:preferences-changed";
export function readHomeCache(userId: number, kind?: Kind): HomeResponse | null {
  return cache.get(`${userId}:${kind || "all"}`) ?? null;
}
export function writeHomeCache(userId: number, data: HomeResponse, kind?: Kind) {
  cache.set(`${userId}:${kind || "all"}`, data);
}
export function invalidateHome() {
  cache.clear();
  if (typeof window !== "undefined") window.dispatchEvent(new Event(HOME_INVALIDATED));
}
