package api

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"sort"
	"strconv"
	"sync"
	"time"

	"github.com/rdborg/mediarium/internal/auth"
	"github.com/rdborg/mediarium/internal/household"
	"github.com/rdborg/mediarium/internal/metadata"
)

type householdRail struct {
	ID       string            `json:"id"`
	Title    string            `json:"title"`
	Subtitle string            `json:"subtitle,omitempty"`
	Items    []household.Title `json:"items"`
}
type householdHome struct {
	Page        int                   `json:"page"`
	HasMore     bool                  `json:"hasMore"`
	Rails       []householdRail       `json:"rails"`
	Hero        *household.Title      `json:"hero,omitempty"`
	Preferences household.Preferences `json:"preferences"`
	Warnings    []string              `json:"warnings"`
}
type householdCatalogEntry struct {
	items   []household.Title
	warning string
	more    bool
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
	s.householdAttachProgress(r.Context(), auth.UserFromContext(r.Context()).ID, items, false)
	writeJSON(w, 200, items)
}
