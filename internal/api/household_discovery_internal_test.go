package api

import (
	"fmt"
	"github.com/rdborg/mediarium/internal/household"
	"testing"
	"time"
)

func TestHouseholdDiscoveryExcludesLowConfidenceAndFuture(t *testing.T) {
	now := time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC)
	p := household.Defaults()
	good := household.Title{Kind: "movie", TMDBID: 1, Title: "Good", PosterURL: "poster", Language: "en", Rating: 8, VoteCount: 1000, ReleaseDate: "2020-01-01"}
	if !householdDiscoveryEligible(good, p, now) {
		t.Fatal("Good candidate excluded")
	}
	for _, change := range []func(*household.Title){func(t *household.Title) { t.Rating = 6.2 }, func(t *household.Title) { t.VoteCount = 5 }, func(t *household.Title) { t.ReleaseDate = "2027-01-01" }, func(t *household.Title) { t.ReleaseDate = "" }} {
		bad := good
		change(&bad)
		if householdDiscoveryEligible(bad, p, now) {
			t.Fatalf("Bad candidate admitted: %+v", bad)
		}
	}
}
func TestHouseholdSeedsRespectFeedbackAndKind(t *testing.T) {
	p := household.Defaults()
	p.Liked = []string{"movie:1", "tv:2", "movie:3"}
	p.Hidden = []string{"movie:3"}
	p.Watchlist = []string{"movie:4"}
	lib := []household.Title{{Kind: "movie", TMDBID: 5, Available: true, PosterURL: "poster"}}
	seeds := householdSeeds(p, lib, "movie")
	if len(seeds) != 3 || seeds[0].Key != "movie:1" || seeds[0].Weight <= seeds[1].Weight || seeds[2].Label != "Inspired by your library: " {
		t.Fatal(seeds)
	}
}
func TestHouseholdShelvesDoNotStarveOrLeakOwned(t *testing.T) {
	p := household.Defaults()
	pool := []household.Title{}
	for i := 1; i <= 80; i++ {
		pool = append(pool, household.Title{Kind: "movie", TMDBID: i, Title: fmt.Sprint(i), Language: "en", Rating: 8, VoteCount: 1200, ReleaseDate: "2025-01-01", Year: 2025, GenreIDs: []int{18}})
	}
	lib := []household.Title{pool[0]}
	p.Hidden = []string{"movie:2"}
	rails := householdDiscoveryRails(pool, p, lib, time.Now())
	if len(rails) < 3 {
		t.Fatal("Starved shelves", len(rails))
	}
	for _, rail := range rails {
		if len(rail.Items) != 24 {
			t.Fatalf("Short shelf %s: %d", rail.ID, len(rail.Items))
		}
		for _, title := range rail.Items {
			if title.TMDBID == 1 || title.TMDBID == 2 {
				t.Fatal("Owned or hidden title leaked")
			}
		}
	}
}

func TestHouseholdSeedSkipsPreviewAndUncataloguedTestVideo(t *testing.T) {
	lib := []household.Title{
		{Kind: "movie", TMDBID: 1, Available: true, Progress: &household.Progress{Position: 600}},
		{Kind: "movie", TMDBID: 2, Available: true, PosterURL: "poster", Progress: &household.Progress{Position: 10}},
		{Kind: "movie", TMDBID: 3, Available: true, PosterURL: "poster", Progress: &household.Progress{Position: 600}},
	}
	seeds := householdSeeds(household.Defaults(), lib, "movie")
	if len(seeds) != 2 || seeds[0].Key != "movie:3" || seeds[0].Label != "More like " || seeds[1].Label != "Inspired by your library: " {
		t.Fatal(seeds)
	}
}
