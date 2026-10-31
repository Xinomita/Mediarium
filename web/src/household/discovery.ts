import type { HomeResponse, HouseholdTitle, Kind } from "./api";
const key = (t: HouseholdTitle) => `${t.kind}:${t.tmdbId}`;
export function discoveryRails(data: HomeResponse, kind?: Kind) {
  return data.rails
    .filter((r) => !["continue", "continue-watching", "ready", "library", "watchlist"].includes(r.id))
    .map((r) => ({ ...r, items: r.items.filter((t) => !t.libraryId && !t.available && (!kind || t.kind === kind)) }))
    .filter((r) => r.items.length > 0);
}
export function genreTitles(rails: HomeResponse["rails"], genre: string): HouseholdTitle[] {
  const seen = new Set<string>();
  return rails.flatMap((r) => r.items).filter((t) => {
    if (!t.genres?.includes(genre) || seen.has(key(t))) return false;
    seen.add(key(t));
    return true;
  });
}
// A title may belong to different shelves; only dedupe within its own shelf.
export function mergeHomePages(previous: HomeResponse, next: HomeResponse): HomeResponse {
  const rails = previous.rails.map((r) => ({ ...r, items: [...r.items] }));
  for (const incoming of next.rails) {
    const existing = rails.find((r) => r.id === incoming.id);
    if (!existing) {
      rails.push({ ...incoming, items: [...new Map(incoming.items.map((t) => [key(t), t])).values()] });
      continue;
    }
    const seen = new Set(existing.items.map(key));
    for (const title of incoming.items) {
      if (!seen.has(key(title))) { existing.items.push(title); seen.add(key(title)); }
    }
  }
  return { ...next, hero: previous.hero || next.hero, rails,
    warnings: [...new Set([...previous.warnings, ...next.warnings])] };
}
export function continueWatching(titles: HouseholdTitle[]) {
  return titles.filter((t) => t.available && t.progress && t.progress.position > 0 &&
    (t.progress.duration <= 0 || t.progress.position / t.progress.duration < .95))
    .sort((a, b) => (b.progress?.updatedAt || "").localeCompare(a.progress?.updatedAt || ""));
}
