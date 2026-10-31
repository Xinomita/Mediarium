import type { HomeResponse } from "./api";
let cache: { userId: number; data: HomeResponse } | null = null;
export function readHomeCache(userId: number): HomeResponse | null {
  return cache?.userId === userId ? cache.data : null;
}
export function writeHomeCache(userId: number, data: HomeResponse) {
  cache = { userId, data };
}
export function invalidateHome() {
  cache = null;
}
