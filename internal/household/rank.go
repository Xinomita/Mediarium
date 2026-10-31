// Package household owns the household discovery policy, independently of transport.
package household

import (
	"fmt"
	"math"
	"slices"
	"sort"
	"strconv"
	"strings"
	"time"
)

type Preferences struct {
	Languages             []string `json:"languages"`
	IncludeOtherLanguages bool     `json:"includeOtherLanguages"`
	MinRating             float64  `json:"minRating"`
	PreferredGenres       []int    `json:"preferredGenres"`
	BlockedGenres         []int    `json:"blockedGenres"`
	Hidden                []string `json:"hidden"`
	Watchlist             []string `json:"watchlist"`
	Liked                 []string `json:"liked"`
}

func Defaults() Preferences {
	return Preferences{Languages: []string{"en"}, MinRating: 6, PreferredGenres: []int{},
		BlockedGenres: []int{10763, 10764, 10767}, Hidden: []string{}, Watchlist: []string{}, Liked: []string{}}
}

func ParseKey(key string) (string, int, bool) {
	parts := strings.Split(key, ":")
	if len(parts) != 2 || (parts[0] != "movie" && parts[0] != "tv") {
		return "", 0, false
	}
	id, err := strconv.Atoi(parts[1])
	return parts[0], id, err == nil && id > 0 && id < 2147483647
}

func (p *Preferences) Validate() error {
	if len(p.Languages) == 0 || len(p.Languages) > 4 {
		return fmt.Errorf("Choose between one and four original languages.")
	}
	for _, lang := range p.Languages {
		if len(lang) < 2 || len(lang) > 3 {
			return fmt.Errorf("Use two or three letter language codes.")
		}
		for _, c := range lang {
			if c < 'a' || c > 'z' {
				return fmt.Errorf("Use lowercase language codes.")
			}
		}
	}
	if math.IsNaN(p.MinRating) || math.IsInf(p.MinRating, 0) || p.MinRating < 0 || p.MinRating > 9 {
		return fmt.Errorf("Minimum audience rating must be between 0 and 9.")
	}
	for _, ids := range [][]int{p.PreferredGenres, p.BlockedGenres} {
		if len(ids) > 30 {
			return fmt.Errorf("Too many genres selected.")
		}
		for _, id := range ids {
			if id <= 0 || id > 20000 {
				return fmt.Errorf("Invalid genre.")
			}
		}
	}
	for _, keys := range [][]string{p.Hidden, p.Watchlist, p.Liked} {
		if len(keys) > 500 {
			return fmt.Errorf("Each personal list can hold up to 500 titles.")
		}
		for _, k := range keys {
			if _, _, ok := ParseKey(k); !ok {
				return fmt.Errorf("Invalid title in personal list.")
			}
		}
	}
	// Stable, non-null arrays simplify clients and cache keys.
	p.Languages = unique(p.Languages)
	p.Hidden = unique(p.Hidden)
	p.Watchlist = unique(p.Watchlist)
	p.Liked = unique(p.Liked)
	p.PreferredGenres = uniqueInts(p.PreferredGenres)
	p.BlockedGenres = uniqueInts(p.BlockedGenres)
	return nil
}
func unique(in []string) []string {
	out := []string{}
	for _, s := range in {
		if !slices.Contains(out, s) {
			out = append(out, s)
		}
	}
	return out
}
func uniqueInts(in []int) []int {
	out := []int{}
	for _, s := range in {
		if !slices.Contains(out, s) {
			out = append(out, s)
		}
	}
	return out
}

type Progress struct {
	Path      string  `json:"path"`
	Position  float64 `json:"position"`
	Duration  float64 `json:"duration"`
	UpdatedAt string  `json:"updatedAt"`
}
type Title struct {
	Kind        string    `json:"kind"`
	TMDBID      int       `json:"tmdbId"`
	LibraryID   int64     `json:"libraryId,omitempty"`
	Title       string    `json:"title"`
	Year        int       `json:"year"`
	Overview    string    `json:"overview,omitempty"`
	PosterURL   string    `json:"posterUrl,omitempty"`
	BackdropURL string    `json:"backdropUrl,omitempty"`
	Genres      []string  `json:"genres"`
	GenreIDs    []int     `json:"-"`
	Rating      float64   `json:"rating,omitempty"`
	VoteCount   int       `json:"voteCount,omitempty"`
	Language    string    `json:"language,omitempty"`
	Available   bool      `json:"available"`
	Status      string    `json:"status,omitempty"`
	Reason      string    `json:"reason,omitempty"`
	Progress    *Progress `json:"progress,omitempty"`
	Affinity    float64   `json:"-"`
	SeedKey     string    `json:"-"`
	SeedLabel   string    `json:"-"`
	Popularity  float64   `json:"-"`
	ReleaseDate string    `json:"-"`
}

func (t Title) Key() string { return t.Kind + ":" + strconv.Itoa(t.TMDBID) }

// BayesianRating shrinks small voting samples toward a conservative prior.
// These are TMDB audience votes, not critic scores.
func BayesianRating(rating float64, votes int) float64 {
	v := math.Max(0, float64(votes))
	r := math.Max(0, math.Min(10, rating))
	return (v*r + 250*6.2) / (v + 250)
}
func Eligible(t Title, p Preferences, now time.Time) bool {
	if t.TMDBID <= 0 || t.Title == "" || slices.Contains(p.Hidden, t.Key()) {
		return false
	}
	if !p.IncludeOtherLanguages && !slices.Contains(p.Languages, t.Language) {
		return false
	}
	for _, g := range t.GenreIDs {
		if slices.Contains(p.BlockedGenres, g) {
			return false
		}
	}
	if p.MinRating > 0 && (t.Rating < p.MinRating || t.VoteCount < 50) {
		return false
	}
	if d, err := time.Parse("2006-01-02", t.ReleaseDate); err == nil && d.After(now) {
		return false
	}
	return true
}
func Score(t Title, p Preferences, now time.Time) float64 {
	quality := BayesianRating(t.Rating, t.VoteCount) / 10
	popularity := math.Min(1, math.Log1p(math.Max(0, t.Popularity))/math.Log1p(500))
	relevance := 0.0
	for _, g := range t.GenreIDs {
		if slices.Contains(p.PreferredGenres, g) {
			relevance = 1
			break
		}
	}
	if slices.Contains(p.Languages, t.Language) {
		relevance = math.Max(relevance, 0.4)
	}
	// Quality and title-level affinity dominate. Freshness belongs to a
	// dedicated shelf, so it cannot promote a mediocre new release everywhere.
	return .64*quality + .30*math.Min(1, t.Affinity) + .05*relevance + .01*popularity
}
func Reason(t Title, p Preferences) string {
	if t.SeedLabel != "" {
		return t.SeedLabel
	}
	for i, g := range t.GenreIDs {
		if slices.Contains(p.PreferredGenres, g) {
			if i < len(t.Genres) {
				return "Matches your " + strings.ToLower(t.Genres[i]) + " preference"
			}
			return "Matches your preferred genres"
		}
	}
	if t.VoteCount >= 250 && t.Rating >= 7 {
		return fmt.Sprintf("Based on %s audience votes", comma(t.VoteCount))
	}
	if t.Year >= time.Now().Year()-1 {
		return "A well-rated recent release"
	}
	return "Selected from TMDB audience ratings"
}
func comma(n int) string {
	s := strconv.Itoa(n)
	for i := len(s) - 3; i > 0; i -= 3 {
		s = s[:i] + "," + s[i:]
	}
	return s
}

// Rank bounds popularity, deduplicates IDs, and diversifies primary genres.
// Its input pool is a union of popular, top-rated and recent catalogue pages.
func Rank(in []Title, p Preferences, now time.Time, limit int) []Title {
	if limit <= 0 {
		return []Title{}
	}
	seen := map[string]bool{}
	items := []Title{}
	for _, t := range in {
		if seen[t.Key()] || !Eligible(t, p, now) {
			continue
		}
		seen[t.Key()] = true
		t.Reason = Reason(t, p)
		items = append(items, t)
	}
	sort.SliceStable(items, func(i, j int) bool {
		a, b := Score(items[i], p, now), Score(items[j], p, now)
		if a == b {
			return items[i].Key() < items[j].Key()
		}
		return a > b
	})
	out := []Title{}
	counts := map[int]int{}
	deferred := []Title{}
	for _, t := range items {
		g := 0
		if len(t.GenreIDs) > 0 {
			g = t.GenreIDs[0]
		}
		if g != 0 && counts[g] >= 3 {
			deferred = append(deferred, t)
			continue
		}
		out = append(out, t)
		counts[g]++
		if len(out) == limit {
			return out
		}
	}
	for _, t := range deferred {
		if len(out) >= limit {
			break
		}
		out = append(out, t)
	}
	return out
}
