package api

import (
	"context"
	"crypto/sha256"
	"fmt"
	"github.com/rdborg/mediarium/internal/household"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Title's public JSON intentionally omits ranking fields. Preserve those
// fields explicitly in disk snapshots so restarts retain eligibility and seeds.
type householdCatalogTitle struct {
	household.Title
	GenreIDs    []int   `json:"genreIds"`
	Affinity    float64 `json:"affinity"`
	SeedKey     string  `json:"seedKey"`
	SeedLabel   string  `json:"seedLabel"`
	Popularity  float64 `json:"popularity"`
	ReleaseDate string  `json:"releaseDate"`
}

func catalogTitles(items []household.Title) []householdCatalogTitle {
	out := make([]householdCatalogTitle, len(items))
	for i, t := range items {
		out[i] = householdCatalogTitle{t, t.GenreIDs, t.Affinity, t.SeedKey, t.SeedLabel, t.Popularity, t.ReleaseDate}
	}
	return out
}
func (disk householdCatalogSnapshot) titles() []household.Title {
	out := make([]household.Title, len(disk.Items))
	for i, t := range disk.Items {
		out[i] = t.Title
		out[i].GenreIDs = t.GenreIDs
		out[i].Affinity = t.Affinity
		out[i].SeedKey = t.SeedKey
		out[i].SeedLabel = t.SeedLabel
		out[i].Popularity = t.Popularity
		out[i].ReleaseDate = t.ReleaseDate
	}
	return out
}

type householdCatalogSnapshot struct {
	Items []householdCatalogTitle `json:"items"`
	More  bool                    `json:"more"`
	Saved time.Time               `json:"saved"`
}
type householdCatalogFetch func(context.Context) ([]household.Title, string, bool)

// Cache only the recommendation pool. Account lists, playback progress and
// library availability are applied fresh by the request handler. A matching
// preferences/seed/language key is mandatory; snapshots expire after one day.
func (cache *householdCatalog) load(ctx context.Context, key, dir string, fetch householdCatalogFetch) ([]household.Title, string, bool) {
	path := filepath.Join(dir, "household-catalog", fmt.Sprintf("%x.json", sha256.Sum256([]byte(key))))
	cache.mu.Lock()
	if cache.entries == nil {
		cache.entries = map[string]*householdCatalogEntry{}
	}
	entry := cache.entries[key]
	if entry == nil {
		if len(cache.entries) >= 32 {
			for k, v := range cache.entries {
				if v.ready == nil {
					delete(cache.entries, k)
					break
				}
			}
		}
		entry = &householdCatalogEntry{}
		var disk householdCatalogSnapshot
		if have, _ := readHouseholdMetadata(path, &disk); have && len(disk.Items) > 0 && time.Since(disk.Saved) < 24*time.Hour && !disk.Saved.After(time.Now()) {
			entry.items, entry.more, entry.saved = disk.titles(), disk.More, disk.Saved
			entry.expires = disk.Saved.Add(10 * time.Minute)
		}
		cache.entries[key] = entry
	}
	usable := len(entry.items) > 0 && time.Since(entry.saved) < 24*time.Hour
	if entry.ready == nil && time.Now().Before(entry.expires) {
		items, warning, more := entry.items, entry.warning, entry.more
		cache.mu.Unlock()
		return items, warning, more
	}
	if entry.ready != nil {
		if usable {
			items, warning, more := entry.items, entry.warning, entry.more
			cache.mu.Unlock()
			return items, warning, more
		}
		ready := entry.ready
		cache.mu.Unlock()
		select {
		case <-ready:
			return cache.load(ctx, key, dir, fetch)
		case <-ctx.Done():
			return nil, "Discovery is taking too long. Try again shortly.", false
		}
	}
	entry.ready = make(chan struct{})
	items, warning, more := entry.items, entry.warning, entry.more
	cache.mu.Unlock()
	refresh := func(loadCtx context.Context) ([]household.Title, string, bool) {
		fresh, note, next := fetch(loadCtx)
		now := time.Now()
		snapshot := householdCatalogSnapshot{catalogTitles(fresh), next, now}
		// Persist before releasing waiters so restarts cannot miss a completed fill.
		if note == "" && len(fresh) > 0 {
			saveHouseholdMetadata(path, snapshot)
			pruneHouseholdCatalog(filepath.Dir(path))
		}
		cache.mu.Lock()
		if !usable || note == "" {
			entry.items, entry.more, entry.saved = fresh, next, now
		}
		entry.warning = note
		entry.expires = now.Add(10 * time.Minute)
		if note != "" {
			entry.expires = now.Add(30 * time.Second)
		}
		ready := entry.ready
		entry.ready = nil
		close(ready)
		result, resultNote, resultMore := entry.items, entry.warning, entry.more
		cache.mu.Unlock()
		return result, resultNote, resultMore
	}
	if usable {
		go func() {
			background, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			refresh(background)
		}()
		return items, warning, more
	}
	return refresh(ctx)
}

func pruneHouseholdCatalog(dir string) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	type file struct {
		name     string
		modified time.Time
	}
	files := []file{}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".json") && len(e.Name()) == 69 {
			if st, err := e.Info(); err == nil {
				files = append(files, file{e.Name(), st.ModTime()})
			}
		}
	}
	sort.Slice(files, func(i, j int) bool { return files[i].modified.After(files[j].modified) })
	for _, f := range files[min(32, len(files)):] {
		_ = os.Remove(filepath.Join(dir, f.name))
	}
}
