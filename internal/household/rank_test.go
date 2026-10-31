package household

import (
	"testing"
	"time"
)

func candidate(id int, rating float64, votes int, pop float64, language string) Title {
	return Title{Kind: "movie", TMDBID: id, Title: "Example", Rating: rating, VoteCount: votes, Popularity: pop, Language: language, ReleaseDate: "2024-01-01"}
}
func TestRatingConfidenceAndPopularityCap(t *testing.T) {
	p := Defaults()
	now := time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC)
	established := candidate(1, 8.3, 12000, 80, "en")
	hyped := candidate(2, 6.1, 12000, 1e12, "en")
	tiny := candidate(3, 10, 3, 100, "en")
	r := Rank([]Title{hyped, tiny, established}, p, now, 12)
	if len(r) != 2 || r[0].TMDBID != 1 {
		t.Fatalf("Quality must outrank hype and tiny samples: %+v", r)
	}
	if Score(hyped, p, now) != Score(candidate(2, 6.1, 12000, 500, "en"), p, now) {
		t.Fatal("Popularity must be bounded")
	}
}
func TestPreferencesHiddenAndLanguage(t *testing.T) {
	p := Defaults()
	now := time.Now()
	en := candidate(1, 8, 500, 30, "en")
	ja := candidate(2, 8, 500, 30, "ja")
	news := candidate(3, 8, 500, 30, "en")
	news.GenreIDs = []int{10763}
	r := Rank([]Title{en, ja, news, en}, p, now, 12)
	if len(r) != 1 || r[0].TMDBID != 1 {
		t.Fatal(r)
	}
	p.IncludeOtherLanguages = true
	p.Hidden = []string{"movie:1"}
	r = Rank([]Title{en, ja, news}, p, now, 12)
	if len(r) != 1 || r[0].TMDBID != 2 {
		t.Fatal(r)
	}
}
func TestGenreDiversityAndDeterminism(t *testing.T) {
	p := Defaults()
	in := []Title{}
	for i := 1; i < 9; i++ {
		c := candidate(i, 9, 1000, 100, "en")
		c.GenreIDs = []int{28}
		if i > 6 {
			c.GenreIDs = []int{18}
		}
		in = append(in, c)
	}
	r := Rank(in, p, time.Now(), 5)
	drama := 0
	for _, c := range r {
		if c.GenreIDs[0] == 18 {
			drama++
		}
	}
	if len(r) != 5 || drama != 2 {
		t.Fatalf("Expected 3 action + 2 drama, got %+v", r)
	}
}
func TestValidation(t *testing.T) {
	p := Defaults()
	p.Languages = []string{"EN"}
	if p.Validate() == nil {
		t.Fatal("Uppercase accepted")
	}
	p = Defaults()
	p.Watchlist = []string{"movie:42", "tv:42", "movie:42"}
	if e := p.Validate(); e != nil || len(p.Watchlist) != 2 {
		t.Fatal(p, e)
	}
	p.Watchlist = []string{"../../x"}
	if p.Validate() == nil {
		t.Fatal("Invalid key accepted")
	}
}
