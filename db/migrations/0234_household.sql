-- Fork-specific household preferences and watch progress; never modifies media.
CREATE TABLE household_preferences (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 preferences TEXT NOT NULL,
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE household_progress (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 kind TEXT NOT NULL CHECK(kind IN ('movie','tv')),
 library_id INTEGER NOT NULL,
 file_path TEXT NOT NULL,
 position REAL NOT NULL DEFAULT 0 CHECK(position >= 0),
 duration REAL NOT NULL DEFAULT 0 CHECK(duration >= 0),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 PRIMARY KEY(user_id,kind,library_id,file_path)
);
CREATE INDEX household_progress_recent ON household_progress(user_id,updated_at DESC);
