package api

import (
	"context"
	"github.com/rdborg/mediarium/internal/household"
	"sync/atomic"
	"testing"
	"time"
)

func TestHouseholdCatalogPersistentAndNonblockingRefresh(t *testing.T) {
	dir := t.TempDir()
	var calls atomic.Int32
	fetch := func(context.Context) ([]household.Title, string, bool) {
		calls.Add(1)
		return []household.Title{{TMDBID: 42, Kind: "movie", Title: "Old", GenreIDs: []int{18}, ReleaseDate: "2020-01-01", Affinity: .7, SeedKey: "movie:9", SeedLabel: "More like Seed", Popularity: 200}}, "", true
	}
	cache := &householdCatalog{}
	cache.load(context.Background(), "alice-en", dir, fetch)
	restarted := &householdCatalog{}
	got, _, more := restarted.load(context.Background(), "alice-en", dir, fetch)
	if calls.Load() != 1 || len(got) != 1 || got[0].TMDBID != 42 || !more {
		t.Fatal("restart refetched or lost snapshot")
	}
	if len(got[0].GenreIDs) != 1 || got[0].GenreIDs[0] != 18 || got[0].ReleaseDate != "2020-01-01" || got[0].Affinity != .7 || got[0].SeedKey != "movie:9" || got[0].SeedLabel != "More like Seed" || got[0].Popularity != 200 {
		t.Fatalf("ranking fields lost on restart: %+v", got[0])
	}
	started, release := make(chan struct{}), make(chan struct{})
	defer close(release)
	restarted.mu.Lock()
	restarted.entries["alice-en"].expires = time.Now().Add(-time.Second)
	restarted.mu.Unlock()
	slow := func(context.Context) ([]household.Title, string, bool) {
		close(started)
		<-release
		return nil, "provider offline", false
	}
	returned := make(chan []household.Title, 1)
	go func() { items, _, _ := restarted.load(context.Background(), "alice-en", dir, slow); returned <- items }()
	select {
	case items := <-returned:
		if len(items) != 1 {
			t.Fatal("stale pool lost")
		}
	case <-time.After(time.Second):
		t.Fatal("stale read blocked on provider")
	}
	<-started
	again, _, _ := restarted.load(context.Background(), "alice-en", dir, slow)
	if len(again) != 1 {
		t.Fatal("concurrent reader did not get stale pool")
	}
	// A different language/preferences key must never reuse another pool.
	restarted.load(context.Background(), "bob-fr", dir, fetch)
	if calls.Load() != 2 {
		t.Fatal("unrelated cache keys shared")
	}
}
