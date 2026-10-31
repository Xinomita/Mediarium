package api

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/rdborg/mediarium/internal/auth"
	"github.com/rdborg/mediarium/internal/household"
	"github.com/rdborg/mediarium/internal/metadata"
)

type householdSeed struct {
	Key, Label string
	Weight     float64
}

// Explicit feedback outranks saves and viewing. A shared library is only a
// cold-start source, labelled as such; possession does not mean this user liked it.
func householdSeeds(p household.Preferences, lib []household.Title, kind string) []householdSeed {
	out := []householdSeed{}
	seen := map[string]bool{}
	add := func(key, label string, weight float64) {
		k, _, ok := household.ParseKey(key)
		if !ok || (kind != "" && k != kind) || seen[key] || slices.Contains(p.Hidden, key) || len(out) >= 6 {
			return
		}
		seen[key] = true
		out = append(out, householdSeed{key, label, weight})
	}
	for i := len(p.Liked) - 1; i >= 0; i-- {
		add(p.Liked[i], "Because you like ", 1)
	}
	for i := len(p.Watchlist) - 1; i >= 0; i-- {
		add(p.Watchlist[i], "From your list: ", .7)
	}
	watched := append([]household.Title{}, lib...)
	sort.SliceStable(watched, func(i, j int) bool {
		if watched[i].Progress == nil {
			return false
		}
		if watched[j].Progress == nil {
			return true
		}
		return watched[i].Progress.UpdatedAt > watched[j].Progress.UpdatedAt
	})
	for _, t := range watched {
		if t.Progress != nil && t.PosterURL != "" && t.Progress.Position >= 300 {
			add(t.Key(), "More like ", .5)
		}
	}
	for _, t := range lib {
		if t.Available && t.PosterURL != "" {
			add(t.Key(), "More like ", .45)
		}
	}
	return out
}

// Each cache key includes the seeds and all selection settings. Personal lists
// and library availability are applied fresh after cache lookup.
func (s *Server) householdCandidates(ctx context.Context, p household.Preferences, kind string, page int, seeds []householdSeed) ([]household.Title, string, bool) {
	if !s.TMDB().HasAPIKey() {
		return []household.Title{}, "Discovery needs a movie database connection. Your library is still available.", false
	}
	raw, _ := json.Marshal(struct {
		P     household.Preferences
		Kind  string
		Page  int
		Seeds []householdSeed
	}{p, kind, page, seeds})
	key := fmt.Sprintf("imdb-v2:%t:%s:%s", s.householdIMDb != nil, s.infoLanguage(), raw)
	return s.householdCatalog.load(ctx, key, s.cfg.ConfigDir, func(loadCtx context.Context) ([]household.Title, string, bool) {
		return s.fetchHouseholdCandidates(loadCtx, p, kind, page, seeds)
	})
}

func householdDiscoveryEligible(t household.Title, p household.Preferences, now time.Time) bool {
	// The browse surface is a selection, while Search remains the full catalogue.
	// Shrink small samples, require a meaningful audience, and fail closed on dates.
	minimumVotes := 100
	if t.Kind == "tv" {
		minimumVotes = 75
	}
	d, e := time.Parse("2006-01-02", t.ReleaseDate)
	return household.Eligible(t, p, now) && e == nil && !d.After(now) && t.PosterURL != "" &&
		t.VoteCount >= minimumVotes && household.BayesianRating(t.Rating, t.VoteCount) >= 6.8
}

func (s *Server) fetchHouseholdCandidates(ctx context.Context, p household.Preferences, kind string, page int, seeds []householdSeed) ([]household.Title, string, bool) {
	ctx, cancel := context.WithTimeout(ctx, 28*time.Second)
	defer cancel()
	now := time.Now().UTC()
	type job struct {
		kind string
		q    metadata.DiscoverQuery
		seed *householdSeed
	}
	jobs := []job{}
	langs := append([]string{}, p.Languages...)
	if p.IncludeOtherLanguages {
		langs = append(langs, "")
	}
	kinds := []string{"movie", "tv"}
	if kind != "" {
		kinds = []string{kind}
	}
	for _, lang := range langs {
		for _, k := range kinds {
			base := metadata.DiscoverQuery{Language: lang, MinRating: 0, MinVotes: 0, HomeReleased: k == "movie", ReleasedBefore: now.Format("2006-01-02")}
			for _, order := range []string{metadata.SortPopular, metadata.SortRating, metadata.SortNewest} {
				for n := 0; n < 3; n++ {
					q := base
					q.Sort = order
					q.Page = (page-1)*3 + n + 1
					if order == metadata.SortNewest {
						q.YearFrom = now.Year() - 2
					}
					jobs = append(jobs, job{k, q, nil})
				}
			}
			genres := append([]int{}, p.PreferredGenres...)
			if k == "movie" {
				genres = append(genres, 18, 53, 878, 35, 80, 99)
			} else {
				genres = append(genres, 18, 80, 9648, 10765, 35, 99)
			}
			seen := map[int]bool{}
			for _, g := range genres {
				if seen[g] || slices.Contains(p.BlockedGenres, g) {
					continue
				}
				seen[g] = true
				q := base
				q.Genre = g
				q.Sort = metadata.SortPopular
				q.Page = page
				jobs = append(jobs, job{k, q, nil})
				if len(seen) >= 6 {
					break
				}
			}
		}
	}
	// Related lists are already paged/cached by the metadata client. On later
	// catalogue pages omit them, so exploration does not repeat the same seeds.
	if page == 1 {
		for i := range seeds {
			k, _, _ := household.ParseKey(seeds[i].Key)
			for relatedPage := 1; relatedPage <= 3; relatedPage++ {
				jobs = append(jobs, job{kind: k, q: metadata.DiscoverQuery{Page: relatedPage}, seed: &seeds[i]})
			}
		}
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	sem := make(chan struct{}, 6)
	found := map[string]household.Title{}
	seedWeights := map[string]map[string]float64{}
	strongest := map[string]float64{}
	failed := 0
	more := false
	for _, j := range jobs {
		wg.Add(1)
		go func(j job) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				mu.Lock()
				failed++
				mu.Unlock()
				return
			}
			defer func() { <-sem }()
			items := []household.Title{}
			var err error
			hasMore := false
			if j.seed != nil {
				_, id, _ := household.ParseKey(j.seed.Key)
				seed, lookupErr := s.householdLookup(ctx, j.seed.Key)
				if lookupErr != nil {
					err = lookupErr
				} else if j.kind == "movie" {
					var ms []metadata.Movie
					ms, err = s.displayTMDB().RelatedMoviesPage(ctx, id, metadata.RelatedRecommended, j.q.Page)
					for _, m := range ms {
						if !m.Adult {
							items = append(items, s.householdMovie(ctx, m))
						}
					}
				} else {
					var ms []metadata.Show
					ms, err = s.displayTMDB().RelatedShowsPage(ctx, id, metadata.RelatedRecommended, j.q.Page)
					for _, m := range ms {
						if !m.Adult {
							items = append(items, s.householdShow(ctx, m))
						}
					}
				}
				for i := range items {
					items[i].Affinity = j.seed.Weight
					items[i].SeedKey = j.seed.Key
					items[i].SeedLabel = j.seed.Label + seed.Title
				}
			} else if j.kind == "movie" {
				var pg *metadata.MoviePage
				pg, err = s.displayTMDB().DiscoverMovies(ctx, j.q)
				if err == nil {
					hasMore = pg.TotalPages > j.q.Page
					for _, m := range pg.Results {
						if !m.Adult {
							items = append(items, s.householdMovie(ctx, m))
						}
					}
				}
			} else {
				var pg *metadata.ShowPage
				pg, err = s.displayTMDB().DiscoverTV(ctx, j.q)
				if err == nil {
					hasMore = pg.TotalPages > j.q.Page
					for _, m := range pg.Results {
						if !m.Adult {
							items = append(items, s.householdShow(ctx, m))
						}
					}
				}
			}
			mu.Lock()
			defer mu.Unlock()
			if err != nil && j.seed == nil {
				failed++
			}
			more = more || hasMore
			for _, t := range items {
				check := p
				if s.householdIMDb != nil {
					check.MinRating = 0
					t.Rating = 0
					t.VoteCount = 0
				}
				if (s.householdIMDb == nil && !householdDiscoveryEligible(t, p, now)) || (s.householdIMDb != nil && (!household.Eligible(t, check, now) || t.PosterURL == "")) {
					continue
				}
				old, ok := found[t.Key()]
				if !ok {
					old = t
				}
				if t.SeedKey != "" {
					if seedWeights[t.Key()] == nil {
						seedWeights[t.Key()] = map[string]float64{}
					}
					seedWeights[t.Key()][t.SeedKey] = t.Affinity
					if t.Affinity > strongest[t.Key()] || (t.Affinity == strongest[t.Key()] && t.SeedKey < old.SeedKey) {
						old.SeedKey = t.SeedKey
						old.SeedLabel = t.SeedLabel
						strongest[t.Key()] = t.Affinity
					}
				}
				found[t.Key()] = old
			}
		}(j)
	}
	wg.Wait()
	pool := make([]household.Title, 0, len(found))
	for _, t := range found {
		t.Affinity = 0
		for _, weight := range seedWeights[t.Key()] {
			t.Affinity += .55 * weight
		}
		t.Affinity = min(1, t.Affinity)
		pool = append(pool, t)
	}
	if s.householdIMDb == nil {
		pool = household.Rank(pool, p, now, len(pool))
	} else {
		// Select a bounded provider pool on relevance/popularity, never TMDB scores.
		sort.SliceStable(pool, func(i, j int) bool {
			a, b := pool[i], pool[j]
			if a.Affinity != b.Affinity {
				return a.Affinity > b.Affinity
			}
			if a.Popularity == b.Popularity {
				return a.Key() < b.Key()
			}
			return a.Popularity > b.Popularity
		})
	}
	// Validate actual release dates, not torrent labels or a guessed cinema window.
	// Bounded top candidates keep cold-start latency and provider requests finite.
	if len(pool) > 320 {
		pool = pool[:320]
	}
	eligible := make([]bool, len(pool))
	for i, t := range pool {
		if t.Kind != "movie" && s.householdIMDb == nil {
			eligible[i] = true
			continue
		}
		wg.Add(1)
		go func(i int, t household.Title) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()
			var imdbID string
			if t.Kind == "movie" {
				d, e := s.householdMovieDetail(ctx, t.TMDBID)
				if e != nil {
					mu.Lock()
					failed++
					mu.Unlock()
					return
				}
				_, home := d.ReleaseWindow()
				if home.IsZero() || home.After(now) {
					return
				}
				imdbID = d.IMDBID
			} else {
				d, e := s.householdShowDetail(ctx, t.TMDBID)
				if e != nil {
					mu.Lock()
					failed++
					mu.Unlock()
					return
				}
				imdbID = d.ExternalIDs.IMDBID
			}
			if s.householdIMDb != nil {
				rating, ok := s.householdIMDb.Lookup(imdbID)
				if !ok {
					return
				}
				t.Rating = rating.Score
				t.VoteCount = rating.Votes
				t.IMDbID = imdbID
				t.RatingSource = "IMDb"
				if !householdDiscoveryEligible(t, p, now) {
					return
				}
				pool[i] = t
			}
			eligible[i] = true
		}(i, t)
	}
	wg.Wait()
	out := []household.Title{}
	for i, t := range pool {
		if eligible[i] {
			out = append(out, t)
		}
	}
	warning := ""
	if s.householdIMDb != nil && !s.householdIMDb.Ready() {
		warning = "IMDb ratings are loading. Your library and search remain available."
	}
	if failed > 0 {
		warning = "Some discovery sources could not be refreshed. Unverified film releases are withheld; retry to refresh."
	}
	return out, warning, more && page < 20
}

func (s *Server) householdAttachProgress(ctx context.Context, userID int64, lib []household.Title, includeCompleted bool) {
	filter := " AND (duration=0 OR position<duration*0.95)"
	if includeCompleted {
		filter = ""
	}
	rows, err := s.db.QueryContext(ctx, `SELECT kind,library_id,file_path,position,duration,updated_at FROM household_progress WHERE user_id=? AND position>=10`+filter+` ORDER BY updated_at DESC LIMIT 100`, userID)
	if err != nil {
		return
	}
	defer rows.Close()
	byID := map[string]int{}
	for i, t := range lib {
		byID[householdLibraryKey(t.Kind, t.LibraryID)] = i
	}
	for rows.Next() {
		var kind string
		var id int64
		var pr household.Progress
		if rows.Scan(&kind, &id, &pr.Path, &pr.Position, &pr.Duration, &pr.UpdatedAt) != nil {
			continue
		}
		if i, ok := byID[householdLibraryKey(kind, id)]; ok && lib[i].Available && lib[i].Progress == nil {
			lib[i].Progress = &pr
		}
	}
}

func householdDiscoveryRails(pool []household.Title, p household.Preferences, lib []household.Title, now time.Time) []householdRail {
	owned := map[string]bool{}
	for _, t := range lib {
		owned[t.Key()] = true
	}
	candidates := []household.Title{}
	for _, t := range pool {
		if !owned[t.Key()] && !slices.Contains(p.Hidden, t.Key()) {
			candidates = append(candidates, t)
		}
	}
	ranked := household.Rank(candidates, p, now, len(candidates))
	rails := []householdRail{}
	appearances := map[string]int{}
	add := func(id, title, subtitle string, predicate func(household.Title) bool, score func(household.Title) float64) {
		items := []household.Title{}
		for _, t := range ranked {
			if predicate(t) {
				items = append(items, t)
			}
		}
		sort.SliceStable(items, func(i, j int) bool {
			// Penalize repetition without starving whole rows via destructive allocation.
			a, b := score(items[i])-.08*float64(appearances[items[i].Key()]), score(items[j])-.08*float64(appearances[items[j].Key()])
			if a == b {
				return items[i].Key() < items[j].Key()
			}
			return a > b
		})
		if id == "picks" || id == "underseen" {
			// Greedy relevance/diversity rerank (MMR-style): avoid filling the
			// beginning of a shelf with near-identical genre combinations.
			selected := []household.Title{}
			for len(items) > 0 && len(selected) < 24 {
				best, bestScore := 0, -1e9
				for i, t := range items {
					similarity := 0.0
					for _, picked := range selected {
						shared := 0
						for _, g := range t.GenreIDs {
							if slices.Contains(picked.GenreIDs, g) {
								shared++
							}
						}
						union := len(t.GenreIDs) + len(picked.GenreIDs) - shared
						if union > 0 {
							similarity = max(similarity, float64(shared)/float64(union))
						}
					}
					value := score(t) - .08*float64(appearances[t.Key()]) - .035*similarity
					if value > bestScore {
						best, bestScore = i, value
					}
				}
				selected = append(selected, items[best])
				items = append(items[:best], items[best+1:]...)
			}
			items = selected
		} else if len(items) > 24 {
			items = items[:24]
		}
		if len(items) < 4 {
			return
		}
		for _, t := range items {
			appearances[t.Key()]++
		}
		rails = append(rails, householdRail{ID: id, Title: title, Subtitle: subtitle, Items: items})
	}
	score := func(t household.Title) float64 { return household.Score(t, p, now) }
	add("picks", "For you", "", func(t household.Title) bool { return true }, score)
	seedOrder := []string{}
	seedNames := map[string]string{}
	seedCounts := map[string]int{}
	seedAffinity := map[string]float64{}
	for _, t := range ranked {
		if t.SeedKey != "" {
			seedCounts[t.SeedKey]++
			seedAffinity[t.SeedKey] = max(seedAffinity[t.SeedKey], t.Affinity)
		}
		if t.SeedKey != "" && !slices.Contains(seedOrder, t.SeedKey) {
			seedOrder = append(seedOrder, t.SeedKey)
			seedNames[t.SeedKey] = t.SeedLabel
		}
	}
	sort.SliceStable(seedOrder, func(i, j int) bool { return seedAffinity[seedOrder[i]] > seedAffinity[seedOrder[j]] })
	seedRows := 0
	for _, key := range seedOrder {
		if seedCounts[key] < 4 {
			continue
		}
		if seedRows >= 3 {
			break
		}
		seedRows++
		add("because-"+key, seedNames[key], "", func(t household.Title) bool { return t.SeedKey == key }, score)
	}
	add("recent", "New releases", "", func(t household.Title) bool { return t.Year >= now.Year()-1 }, score)
	add("acclaimed", "Highly rated", "", func(t household.Title) bool {
		return t.VoteCount >= 1000 && household.BayesianRating(t.Rating, t.VoteCount) >= 7.4
	}, func(t household.Title) float64 { return household.BayesianRating(t.Rating, t.VoteCount) / 10 })
	add("underseen", "Hidden gems", "", func(t household.Title) bool { return t.VoteCount < 4000 && t.Year < now.Year() }, score)
	type genre struct {
		id   int
		name string
	}
	genres := []genre{{53, "Tension & twists"}, {878, "Science fiction"}, {18, "Character-driven drama"}, {80, "Crime stories"}, {35, "A lighter evening"}, {99, "Documentary"}, {10765, "Beyond the ordinary"}, {9648, "Mysteries"}, {16, "Animation"}}
	sort.SliceStable(genres, func(i, j int) bool {
		return slices.Contains(p.PreferredGenres, genres[i].id) && !slices.Contains(p.PreferredGenres, genres[j].id)
	})
	for _, g := range genres {
		add(fmt.Sprintf("genre-%d", g.id), g.name, "", func(t household.Title) bool { return slices.Contains(t.GenreIDs, g.id) }, score)
	}
	return rails
}

func (s *Server) handleHouseholdHome(w http.ResponseWriter, r *http.Request) {
	kind := r.URL.Query().Get("kind")
	if kind != "" && kind != "movie" && kind != "tv" {
		writeError(w, 400, "Choose films or series.")
		return
	}
	page := 1
	if raw := r.URL.Query().Get("page"); raw != "" {
		n, e := strconv.Atoi(raw)
		if e != nil || n < 1 || n > 20 {
			writeError(w, 400, "Invalid discovery page.")
			return
		}
		page = n
	}
	user := auth.UserFromContext(r.Context())
	p, err := s.householdPreferences(r.Context(), user.ID)
	if err != nil {
		writeError(w, 500, "Could not load your preferences.")
		return
	}
	lib, err := s.householdLibrary(r.Context())
	if err != nil {
		writeError(w, 500, "Could not load your library.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 32*time.Second)
	defer cancel()
	s.householdAttachProgress(ctx, user.ID, lib, true)
	candidates, warning, more := s.householdCandidates(ctx, p, kind, page, householdSeeds(p, lib, kind))
	out := householdHome{Page: page, HasMore: more, Preferences: p, Warnings: []string{}, Rails: householdDiscoveryRails(candidates, p, lib, time.Now().UTC())}
	if warning != "" {
		out.Warnings = append(out.Warnings, warning)
	}
	for _, rail := range out.Rails {
		for _, t := range rail.Items {
			if t.BackdropURL != "" {
				hero := t
				out.Hero = &hero
				break
			}
		}
		if out.Hero != nil {
			break
		}
	}
	writeJSON(w, 200, out)
}

func (s *Server) handleHouseholdWatchlist(w http.ResponseWriter, r *http.Request) {
	user := auth.UserFromContext(r.Context())
	p, err := s.householdPreferences(r.Context(), user.ID)
	if err != nil {
		writeError(w, 500, "Could not load your list.")
		return
	}
	lib, err := s.householdLibrary(r.Context())
	if err != nil {
		writeError(w, 500, "Could not load your library.")
		return
	}
	s.householdAttachProgress(r.Context(), user.ID, lib, false)
	local := map[string]household.Title{}
	for _, t := range lib {
		local[t.Key()] = t
	}
	ctx, cancel := context.WithTimeout(r.Context(), 18*time.Second)
	defer cancel()
	items := make([]household.Title, len(p.Watchlist))
	var wg sync.WaitGroup
	sem := make(chan struct{}, 4)
	for i, key := range p.Watchlist {
		if t, ok := local[key]; ok {
			items[i] = t
			continue
		}
		wg.Add(1)
		go func(i int, key string) {
			defer wg.Done()
			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()
			t, e := s.householdLookup(ctx, key)
			if e == nil {
				items[i] = t
			}
		}(i, key)
	}
	wg.Wait()
	out := []household.Title{}
	for _, t := range items {
		if t.TMDBID > 0 {
			out = append(out, t)
		}
	}
	// Report partial resolution; saved keys are never removed on provider errors.
	if len(out) < len(p.Watchlist) {
		w.Header().Set("X-Watchlist-Partial", "true")
	}
	writeJSON(w, 200, out)
}
