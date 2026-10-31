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
import type { HomeResponse } from "./api.ts";
import type { QueueItem } from "../api.ts";

test("cached household information never crosses accounts", () => {
  const page = {
    rails: [],
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
