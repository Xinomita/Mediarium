import test from "node:test";
import assert from "node:assert/strict";
import { readHomeCache, writeHomeCache, invalidateHome } from "./cache.ts";
import {
  statusAvailable,
  queueLabel,
  clampProgress,
  titleKey,
  titleLink,
  timeLabel,
} from "./utils.ts";
import { continueWatching, discoveryRails, genreTitles, mergeHomePages } from "./discovery.ts";
import type { HouseholdTitle, HomeResponse } from "./api.ts";
import type { QueueItem } from "../api.ts";

test("cached household information never crosses accounts", () => {
  const page = {
    rails: [],
    page: 1,
    hasMore: true,
    warnings: [],
    preferences: {
      languages: ["en"],
      includeOtherLanguages: false,
      minRating: 6,
      preferredGenres: [],
      blockedGenres: [],
      hidden: [],
      watchlist: ["movie:1"],
      liked: [],
    },
  } satisfies HomeResponse;
  writeHomeCache(17, page);
  assert.equal(readHomeCache(17), page);
  assert.equal(readHomeCache(18), null);
  invalidateHome();
  assert.equal(readHomeCache(17), null);
});
test("availability requires a downloaded movie or at least one downloaded episode", () => {
  assert.equal(statusAvailable("downloaded"), true);
  assert.equal(statusAvailable("2/24"), true);
  for (const status of [
    "missing",
    "downloading",
    "0/24",
    "24/0bad",
    "",
    undefined,
  ])
    assert.equal(statusAvailable(status), false);
});
test("download states distinguish importing, interruption, and failure from ready", () => {
  const item = { status: "importing" } as QueueItem;
  assert.equal(queueLabel(item), "Adding to library");
  assert.equal(
    queueLabel({ ...item, status: "paused", interrupted: true }),
    "Paused after restart",
  );
  assert.equal(queueLabel({ ...item, status: "failed" }), "Download failed");
  assert.equal(
    queueLabel({ ...item, status: "completed", keptFile: "old.mp4" }),
    "Finished · existing file kept",
  );
  assert.equal(queueLabel({ ...item, status: "completed" }), "Ready to watch");
});
test("progress never renders invalid or out of range values", () => {
  assert.equal(clampProgress(Number.NaN), 0);
  assert.equal(clampProgress(Infinity), 0);
  assert.equal(clampProgress(-20), 0);
  assert.equal(clampProgress(125), 100);
  assert.equal(clampProgress(27.4), 27.4);
});
test("movie and series identities remain distinct", () => {
  assert.notEqual(titleKey("movie", 123), titleKey("tv", 123));
  assert.equal(titleLink("tv", 123), "/watch/title/tv/123");
  assert.equal(timeLabel(3725), "1:02:05");
});

const title = (id: number, extra: Partial<HouseholdTitle> = {}): HouseholdTitle => ({ kind: "movie", tmdbId: id, title: `Film ${id}`, year: 2025, available: false, ...extra });
const home = (items: HouseholdTitle[], page = 1): HomeResponse => ({
  page, hasMore: page < 3, warnings: [], rails: [{ id: "quality", title: "Highly rated", items }],
  preferences: { languages: ["en"], includeOtherLanguages: false, minRating: 6, preferredGenres: [], blockedGenres: [], hidden: [], watchlist: [], liked: [] },
});
test("home caches isolate all, films and series and preference edits invalidate every key", () => {
  const films = home([title(1)]);
  const series = home([title(2, { kind: "tv" })]);
  writeHomeCache(17, films, "movie"); writeHomeCache(17, series, "tv");
  assert.equal(readHomeCache(17, "movie"), films);
  assert.equal(readHomeCache(17, "tv"), series);
  assert.equal(readHomeCache(17), null);
  assert.equal(readHomeCache(18, "movie"), null);
  invalidateHome();
  assert.equal(readHomeCache(17, "tv"), null);
  assert.equal(readHomeCache(17, "movie"), null);
});
test("discovery excludes owned titles and personal library shelves while respecting type", () => {
  const response = home([title(1), title(2, { available: true }), title(3, { libraryId: 5 }), title(4, { kind: "tv" })]);
  response.rails.push({ id: "watchlist", title: "My list", items: [title(5)] });
  assert.deepEqual(discoveryRails(response, "movie").flatMap((r) => r.items.map((t) => t.tmdbId)), [1]);
  assert.deepEqual(discoveryRails(response, "tv").flatMap((r) => r.items.map((t) => t.tmdbId)), [4]);
});
test("more pages append per-shelf, preserve hero, and do not confuse movie and TV identities", () => {
  const first = home([title(1)]); first.hero = title(1);
  const second = home([title(1), title(2), title(2), title(1, { kind: "tv" })], 2);
  second.rails.push({ id: "genre", title: "Drama", items: [title(1), title(1)] });
  const merged = mergeHomePages(first, second);
  assert.deepEqual(merged.rails[0].items.map((t) => `${t.kind}:${t.tmdbId}`), ["movie:1", "movie:2", "tv:1"]);
  assert.equal(merged.rails[1].items.length, 1);
  assert.equal(merged.hero, first.hero);
  assert.equal(merged.page, 2);
  assert.equal(first.rails[0].items.length, 1);
});
test("library resume uses recent available incomplete titles", () => {
  const progress = { path: "film.mp4", position: 50, duration: 100, updatedAt: "2026-10-30" };
  const items = [title(1, { available: true, progress }), title(2, { progress }), title(3, { available: true, progress: { ...progress, position: 96 } }), title(4, { available: true, progress: { ...progress, updatedAt: "2026-10-31" } })];
  assert.deepEqual(continueWatching(items).map((t) => t.tmdbId), [4, 1]);
});

test("genre browsing dedupes across shelves and loaded pages, retaining distinct film and series IDs", () => {
  const thriller = title(1, { genres: ["Thriller"] });
  const first = home([thriller, title(2, { genres: ["Drama"] })]);
  first.rails.push({ id: "drama", title: "Drama", items: [thriller, title(3, { genres: ["Drama", "Thriller"] })] });
  const next = home([thriller, title(4, { genres: ["Thriller"] }), title(1, { kind: "tv", genres: ["Thriller"] })], 2);
  const merged = mergeHomePages(first, next);
  assert.deepEqual(genreTitles(discoveryRails(merged), "Thriller").map((t) => `${t.kind}:${t.tmdbId}`), ["movie:1", "movie:4", "tv:1", "movie:3"]);
  assert.deepEqual(genreTitles(discoveryRails(merged), "Comedy"), []);
});
