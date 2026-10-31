package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
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

type householdRail struct {
	ID    string            `json:"id"`
	Title string            `json:"title"`
	Items []household.Title `json:"items"`
}
type householdHome struct {
	Rails       []householdRail       `json:"rails"`
	Hero        *household.Title      `json:"hero,omitempty"`
	Preferences household.Preferences `json:"preferences"`
	Warnings    []string              `json:"warnings"`
}
type householdCatalogEntry struct {
	items   []household.Title
	warning string
	expires time.Time
	ready   chan struct{}
}
type householdCatalog struct {
	mu      sync.Mutex
	entries map[string]*householdCatalogEntry
}

func (s *Server) householdPreferences(ctx context.Context, userID int64) (household.Preferences, error) {
	p := household.Defaults()
	var raw string
	err := s.db.QueryRowContext(ctx, "SELECT preferences FROM household_preferences WHERE user_id=?", userID).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return p, nil
	}
	if err != nil {
		return p, err
	}
	if err = json.Unmarshal([]byte(raw), &p); err != nil {
		return p, err
	}
	return p, p.Validate()
}
func (s *Server) handleHouseholdPreferences(w http.ResponseWriter, r *http.Request) {
	p, err := s.householdPreferences(r.Context(), auth.UserFromContext(r.Context()).ID)
	if err != nil {
		writeError(w, 500, "Could not load your preferences.")
		return
	}
	writeJSON(w, 200, p)
}
func (s *Server) handleHouseholdSavePreferences(w http.ResponseWriter, r *http.Request) {
	var p household.Preferences
	if err := decodeJSON(r, &p); err != nil {
		writeError(w, 400, "Could not read your preferences.")
		return
	}
	if err := p.Validate(); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	raw, _ := json.Marshal(p)
	_, err := s.db.ExecContext(r.Context(), `INSERT INTO household_preferences(user_id,preferences) VALUES(?,?)
 ON CONFLICT(user_id) DO UPDATE SET preferences=excluded.preferences,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`, auth.UserFromContext(r.Context()).ID, string(raw))
	if err != nil {
		writeError(w, 500, "Could not save your preferences. Please retry.")
		return
	}
	writeJSON(w, 200, p)
}
func (s *Server) householdMovie(ctx context.Context, m metadata.Movie) household.Title {
	ids := m.GenreIDs
	if len(ids) == 0 {
		for _, g := range m.Genres {
			ids = append(ids, g.ID)
		}
	}
	return household.Title{Kind: "movie", TMDBID: m.TMDBID, Title: m.Title, Year: m.Year(), Overview: m.Overview,
		PosterURL: metadata.PosterURL(m.PosterPath), BackdropURL: metadata.BackdropURL(m.BackdropPath), Genres: s.displayTMDB().MovieGenres(ctx, m),
		GenreIDs: ids, Rating: m.VoteAverage, VoteCount: m.VoteCount, Language: m.OriginalLanguage, Popularity: m.Popularity, ReleaseDate: m.ReleaseDate}
}
func (s *Server) householdShow(ctx context.Context, sh metadata.Show) household.Title {
	ids := sh.GenreIDs
	if len(ids) == 0 {
		for _, g := range sh.Genres {
			ids = append(ids, g.ID)
		}
	}
	return household.Title{Kind: "tv", TMDBID: sh.TMDBID, Title: sh.Name, Year: sh.Year(), Overview: sh.Overview,
		PosterURL: metadata.PosterURL(sh.PosterPath), BackdropURL: metadata.BackdropURL(sh.BackdropPath), Genres: s.displayTMDB().ShowGenres(ctx, sh),
		GenreIDs: ids, Rating: sh.VoteAverage, VoteCount: sh.VoteCount, Language: sh.OriginalLanguage, Popularity: sh.Popularity, ReleaseDate: sh.FirstAirDate}
}
func (s *Server) householdLookup(ctx context.Context, key string) (household.Title, error) {
	kind, id, ok := household.ParseKey(key)
	if !ok {
		return household.Title{}, fmt.Errorf("invalid title")
	}
	if kind == "movie" {
		m, e := s.displayTMDB().GetMovie(ctx, id)
		if e != nil {
			return household.Title{}, e
		}
		return s.householdMovie(ctx, *m), nil
	}
	sh, e := s.displayTMDB().GetShow(ctx, id)
	if e != nil {
		return household.Title{}, e
	}
	return s.householdShow(ctx, sh.Show), nil
}

// Candidate fetches are bounded, shared between users with the same catalogue
// preferences, and cached separately from personal/library state.
func (s *Server) householdCandidates(ctx context.Context, p household.Preferences) ([]household.Title, string) {
	if !s.TMDB().HasAPIKey() {
		return []household.Title{}, "Discovery needs a movie database connection. Your library is still available."
	}
	keyBytes, _ := json.Marshal(struct {
		Languages []string
		Other     bool
		Min       float64
		Genres    []int
	}{p.Languages, p.IncludeOtherLanguages, p.MinRating, p.PreferredGenres})
	key := string(keyBytes)
	cache := &s.householdCatalog
	cache.mu.Lock()
	if entry := cache.entries[key]; entry != nil {
		if entry.ready != nil {
			ready := entry.ready
			cache.mu.Unlock()
			select {
			case <-ready:
				return s.householdCandidates(ctx, p)
			case <-ctx.Done():
				return []household.Title{}, "Discovery is taking too long. Try again shortly."
			}
		}
		if time.Now().Before(entry.expires) {
			items, warning := entry.items, entry.warning
			cache.mu.Unlock()
			return items, warning
		}
	}
	if cache.entries == nil || len(cache.entries) > 32 {
		cache.entries = map[string]*householdCatalogEntry{}
	}
	entry := &householdCatalogEntry{ready: make(chan struct{})}
	cache.entries[key] = entry
	cache.mu.Unlock()
	items, warning := s.fetchHouseholdCandidates(ctx, p)
	cache.mu.Lock()
	entry.items = items
	entry.warning = warning
	entry.expires = time.Now().Add(10 * time.Minute)
	if warning != "" {
		entry.expires = time.Now().Add(30 * time.Second)
	}
	ready := entry.ready
	entry.ready = nil
	close(ready)
	cache.mu.Unlock()
	return items, warning
}
func (s *Server) fetchHouseholdCandidates(ctx context.Context, p household.Preferences) ([]household.Title, string) {
	ctx, cancel := context.WithTimeout(ctx, 12*time.Second)
	defer cancel()
	type job struct {
		kind string
		q    metadata.DiscoverQuery
	}
	jobs := []job{}
	langs := append([]string{}, p.Languages...)
	if p.IncludeOtherLanguages {
		langs = append(langs, "")
	}
	minRating := int(p.MinRating)
	if minRating < 6 {
		minRating = 0
	}
	for _, lang := range langs {
		for _, kind := range []string{"movie", "tv"} {
			for _, order := range []string{metadata.SortPopular, metadata.SortRating, metadata.SortNewest} {
				q := metadata.DiscoverQuery{Language: lang, Sort: order, MinRating: minRating, Page: 1}
				if order == metadata.SortNewest {
					q.YearFrom = time.Now().Year() - 2
				}
				jobs = append(jobs, job{kind, q})
			}
			// Taste-specific candidates must be fetched, not just reranked out of a global top 20.
			for i, g := range p.PreferredGenres {
				if i >= 2 {
					break
				}
				jobs = append(jobs, job{kind, metadata.DiscoverQuery{Language: lang, Genre: g, Sort: metadata.SortRating, MinRating: minRating, Page: 1}})
			}
		}
	}
	var mu sync.Mutex
	var wg sync.WaitGroup
	items := []household.Title{}
	failed := 0
	sem := make(chan struct{}, 4)
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
			found := []household.Title{}
			var err error
			if j.kind == "movie" {
				var page *metadata.MoviePage
				page, err = s.displayTMDB().DiscoverMovies(ctx, j.q)
				if err == nil {
					for _, m := range page.Results {
						if !m.Adult {
							found = append(found, s.householdMovie(ctx, m))
						}
					}
				}
			} else {
				var page *metadata.ShowPage
				page, err = s.displayTMDB().DiscoverTV(ctx, j.q)
				if err == nil {
					for _, sh := range page.Results {
						if !sh.Adult {
							found = append(found, s.householdShow(ctx, sh))
						}
					}
				}
			}
			mu.Lock()
			items = append(items, found...)
			if err != nil {
				failed++
			}
			mu.Unlock()
		}(j)
	}
	wg.Wait()
	warning := ""
	if failed > 0 {
		warning = "Some discovery sources could not be refreshed. Showing the titles that loaded."
	}
	return items, warning
}

func (s *Server) householdLibrary(ctx context.Context) ([]household.Title, error) {
	movies, err := s.MovieRepo.List()
	if err != nil {
		return nil, err
	}
	shows, err := s.MovieRepo.ListSeries()
	if err != nil {
		return nil, err
	}
	items := []household.Title{}
	seen := map[string]int{}
	add := func(t household.Title) {
		if t.TMDBID <= 0 {
			return
		}
		key := t.Key()
		if at, ok := seen[key]; ok {
			if !items[at].Available && t.Available {
				items[at] = t
			}
			return
		}
		seen[key] = len(items)
		items = append(items, t)
	}
	for _, m := range movies {
		add(household.Title{Kind: "movie", TMDBID: m.TMDBID, LibraryID: m.ID, Title: m.Title, Year: m.Year, Overview: m.Overview, PosterURL: s.householdArtURL("movie", m.TMDBID, "poster", metadata.PosterURL(m.PosterPath)), BackdropURL: s.householdArtURL("movie", m.TMDBID, "backdrop", ""), Genres: m.Genres, Available: string(m.Status) == "downloaded" && m.FilePath != "", Status: string(m.Status), ReleaseDate: m.ReleaseDate})
	}
	for _, sh := range shows {
		status := "missing"
		if sh.DownloadedCount > 0 {
			status = "downloaded"
		}
		add(household.Title{Kind: "tv", TMDBID: sh.TMDBID, LibraryID: sh.ID, Title: sh.Title, Year: sh.Year, Overview: sh.Overview, PosterURL: s.householdArtURL("tv", sh.TMDBID, "poster", metadata.PosterURL(sh.PosterPath)), BackdropURL: s.householdArtURL("tv", sh.TMDBID, "backdrop", ""), Genres: sh.Genres, Available: sh.DownloadedCount > 0, Status: status, ReleaseDate: sh.FirstAirDate})
	}
	sort.SliceStable(items, func(i, j int) bool { return items[i].LibraryID > items[j].LibraryID })
	return items, nil
}
func (s *Server) handleHouseholdHome(w http.ResponseWriter, r *http.Request) {
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
	out := householdHome{Rails: []householdRail{}, Preferences: p, Warnings: []string{}}
	ctx, cancel := context.WithTimeout(r.Context(), 18*time.Second)
	defer cancel()
	candidates, warning := s.householdCandidates(ctx, p)
	if warning != "" {
		out.Warnings = append(out.Warnings, warning)
	}
	all := map[string]household.Title{}
	for _, t := range candidates {
		all[t.Key()] = t
	}
	libByID := map[string]int{}
	for i, t := range lib {
		if c, ok := all[t.Key()]; ok {
			c.LibraryID = t.LibraryID
			c.Available = t.Available
			c.Status = t.Status
			lib[i] = c
		}
		all[t.Key()] = lib[i]
		libByID[t.Kind+":"+strconv.FormatInt(t.LibraryID, 10)] = i
	}
	// Progress belongs to one account and one file. The newest unfinished file
	// per show becomes Continue Watching; completed episodes do not hide it.
	rows, err := s.db.QueryContext(ctx, `SELECT kind,library_id,file_path,position,duration,updated_at FROM household_progress
 WHERE user_id=? AND position>=10 AND (duration=0 OR position<duration*0.95) ORDER BY updated_at DESC LIMIT 100`, user.ID)
	continued := []household.Title{}
	continuedKeys := map[string]bool{}
	if err != nil {
		out.Warnings = append(out.Warnings, "Your watch progress could not be loaded.")
	}
	if err == nil {
		for rows.Next() {
			var kind string
			var id int64
			var pr household.Progress
			if e := rows.Scan(&kind, &id, &pr.Path, &pr.Position, &pr.Duration, &pr.UpdatedAt); e != nil {
				continue
			}
			i, ok := libByID[kind+":"+strconv.FormatInt(id, 10)]
			if !ok || !lib[i].Available || continuedKeys[lib[i].Key()] {
				continue
			}
			t := lib[i]
			t.Progress = &pr
			continued = append(continued, t)
			continuedKeys[t.Key()] = true
			all[t.Key()] = t
		}
		rows.Close()
	}
	addRail := func(id, title string, items []household.Title) {
		if len(items) > 0 {
			out.Rails = append(out.Rails, householdRail{id, title, items})
		}
	}
	addRail("continue", "Continue watching", continued)
	ready := []household.Title{}
	for _, t := range lib {
		if t.Available && !continuedKeys[t.Key()] {
			ready = append(ready, t)
		}
	}
	addRail("ready", "Ready to watch", ready)
	// Resolve explicit saved titles even when they are not in today's discovery pool.
	watchlist := []household.Title{}
	for _, key := range p.Watchlist {
		t, ok := all[key]
		if !ok && ctx.Err() == nil {
			t, err = s.householdLookup(ctx, key)
			ok = err == nil
			if ok {
				all[key] = t
			}
		}
		if ok {
			watchlist = append(watchlist, t)
		}
	}
	if len(watchlist) < len(p.Watchlist) {
		out.Warnings = append(out.Warnings, "Some saved titles could not be loaded. They are still in your watchlist.")
	}
	addRail("watchlist", "Your watchlist", watchlist)
	// Explicit likes influence genre affinity, without interpreting a partial
	// viewing as a dislike. They never override excluded languages or genres.
	taste := p
	taste.PreferredGenres = append([]int{}, p.PreferredGenres...)
	for i, key := range p.Liked {
		if i >= 8 {
			break
		}
		t, ok := all[key]
		if !ok && ctx.Err() == nil {
			t, err = s.householdLookup(ctx, key)
			ok = err == nil
		}
		if ok {
			for _, g := range t.GenreIDs {
				if !slices.Contains(taste.PreferredGenres, g) {
					taste.PreferredGenres = append(taste.PreferredGenres, g)
				}
			}
		}
	}
	pool := []household.Title{}
	for _, t := range candidates {
		if own, ok := all[t.Key()]; ok {
			t = own
		}
		pool = append(pool, t)
	}
	ranked := household.Rank(pool, taste, time.Now(), len(pool))
	used := map[string]bool{}
	for _, t := range lib {
		if t.Available {
			used[t.Key()] = true
		}
	}
	for _, t := range watchlist {
		used[t.Key()] = true
	}
	take := func(id, title string, predicate func(household.Title) bool, limit int) {
		picked := []household.Title{}
		for _, t := range ranked {
			if used[t.Key()] || !predicate(t) {
				continue
			}
			used[t.Key()] = true
			picked = append(picked, t)
			if len(picked) >= limit {
				break
			}
		}
		addRail(id, title, picked)
	}
	take("picks", "Worth your time", func(t household.Title) bool { return true }, 10)
	take("recent", "Recent releases", func(t household.Title) bool { return t.Year >= time.Now().Year()-1 }, 12)
	take("films", "A good night for a film", func(t household.Title) bool { return t.Kind == "movie" }, 16)
	take("series", "Find your next series", func(t household.Title) bool { return t.Kind == "tv" }, 16)
	// Library titles stay reachable regardless of taste settings or metadata outages.
	if len(ready) == 0 && len(continued) == 0 && len(lib) > 0 {
		addRail("library", "In your library", lib)
	}
	for _, rail := range out.Rails {
		if rail.ID == "picks" || rail.ID == "ready" {
			for _, t := range rail.Items {
				if t.BackdropURL != "" {
					hero := t
					out.Hero = &hero
					break
				}
			}
		}
		if out.Hero != nil {
			break
		}
	}
	if out.Hero == nil {
		for _, t := range ranked {
			if t.BackdropURL != "" {
				hero := t
				out.Hero = &hero
				break
			}
		}
	}
	writeJSON(w, 200, out)
}

// Keep errors safe for household accounts: file paths and upstream credentials
// are never included in these responses.
func householdLibraryKey(kind string, id int64) string { return kind + ":" + strconv.FormatInt(id, 10) }

// Watching a local file must not depend on the metadata provider being up.
func (s *Server) writeHouseholdLibraryMovie(w http.ResponseWriter, r *http.Request, tmdbID int) bool {
	m, ok, err := s.MovieRepo.GetByTMDBID(tmdbID)
	if err != nil || !ok {
		return false
	}
	payload := movieDetailPayload{TMDBID: m.TMDBID, Title: m.Title, Year: m.Year, Overview: m.Overview,
		PosterURL: s.householdArtURL("movie", m.TMDBID, "poster", metadata.PosterURL(m.PosterPath)), BackdropURL: s.householdArtURL("movie", m.TMDBID, "backdrop", ""), LibraryID: m.ID, Status: string(m.Status), Quality: m.Quality,
		FilePath: fileLabel(r, m.FilePath), Genres: m.Genres, ReleaseDate: m.ReleaseDate,
		Directors: []string{}, Crew: []crewPayload{}, Cast: []castPayload{}, Trailers: []metadata.Trailer{}}
	w.Header().Set("X-Metadata-Source", "library")
	writeJSON(w, 200, payload)
	return true
}
func (s *Server) writeHouseholdLibraryShow(w http.ResponseWriter, r *http.Request, tmdbID int) bool {
	sh, ok, err := s.MovieRepo.GetSeriesByTMDBID(tmdbID)
	if err != nil || !ok {
		return false
	}
	eps, err := s.MovieRepo.ListEpisodes(sh.ID)
	if err != nil {
		return false
	}
	counts := map[int]int{}
	for _, ep := range eps {
		counts[ep.Season]++
	}
	seasons := []seasonPayload{}
	for n, count := range counts {
		seasons = append(seasons, seasonPayload{Number: n, Name: fmt.Sprintf("Season %d", n), Episodes: count})
	}
	sort.Slice(seasons, func(i, j int) bool { return seasons[i].Number < seasons[j].Number })
	payload := tvDetailPayload{TMDBID: sh.TMDBID, Title: sh.Title, Year: sh.Year, Overview: sh.Overview,
		PosterURL: s.householdArtURL("tv", sh.TMDBID, "poster", metadata.PosterURL(sh.PosterPath)), BackdropURL: s.householdArtURL("tv", sh.TMDBID, "backdrop", ""), LibraryID: sh.ID, Status: s.seriesLibraryState(sh), Genres: sh.Genres,
		FirstAirDate: sh.FirstAirDate, Seasons: len(seasons), Episodes: len(eps), SeasonList: seasons,
		Creators: []string{}, Crew: []crewPayload{}, Cast: []castPayload{}, Trailers: []metadata.Trailer{}, Networks: []string{}}
	w.Header().Set("X-Metadata-Source", "library")
	writeJSON(w, 200, payload)
	return true
}

func (s *Server) handleHouseholdLibrary(w http.ResponseWriter, r *http.Request) {
	items, err := s.householdLibrary(r.Context())
	if err != nil {
		writeError(w, 500, "Could not load your library.")
		return
	}
	writeJSON(w, 200, items)
}
