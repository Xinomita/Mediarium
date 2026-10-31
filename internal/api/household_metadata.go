package api

import (
	"context"
	"encoding/json"
	"fmt"
	"github.com/rdborg/mediarium/internal/metadata"
	"os"
	"path/filepath"
	"time"
)

// Cache provider-only metadata, never account state or library availability.
// Language participates in the filename. Old files remain useful during outages.
func (s *Server) householdMetadataPath(kind string, id int) string {
	return filepath.Join(s.cfg.ConfigDir, "household-metadata", fmt.Sprintf("%s-%s-%d.json", s.infoLanguage(), kind, id))
}
func readHouseholdMetadata(path string, out any) (bool, bool) {
	st, e := os.Stat(path)
	if e != nil || st.Size() > 4<<20 {
		return false, false
	}
	b, e := os.ReadFile(path)
	if e != nil || json.Unmarshal(b, out) != nil {
		return false, false
	}
	return true, time.Since(st.ModTime()) < 24*time.Hour
}
func saveHouseholdMetadata(path string, v any) {
	b, e := json.Marshal(v)
	if e != nil {
		return
	}
	if os.MkdirAll(filepath.Dir(path), 0750) != nil {
		return
	}
	f, e := os.CreateTemp(filepath.Dir(path), "meta-*.tmp")
	if e != nil {
		return
	}
	defer os.Remove(f.Name())
	_, e = f.Write(b)
	ce := f.Close()
	if e == nil && ce == nil {
		_ = os.Rename(f.Name(), path)
	}
}
func (s *Server) householdMovieDetail(ctx context.Context, id int) (*metadata.MovieDetail, error) {
	path := s.householdMetadataPath("movie", id)
	var cached metadata.MovieDetail
	have, fresh := readHouseholdMetadata(path, &cached)
	if fresh {
		return &cached, nil
	}
	d, e := s.displayTMDB().GetMovieDetail(ctx, id)
	if e != nil && have {
		return &cached, nil
	}
	if e == nil {
		saveHouseholdMetadata(path, d)
	}
	return d, e
}
func (s *Server) householdShowDetail(ctx context.Context, id int) (*metadata.ShowFull, error) {
	path := s.householdMetadataPath("tv", id)
	var cached metadata.ShowFull
	have, fresh := readHouseholdMetadata(path, &cached)
	if fresh {
		return &cached, nil
	}
	d, e := s.displayTMDB().GetShowFull(ctx, id)
	if e != nil && have {
		return &cached, nil
	}
	if e == nil {
		saveHouseholdMetadata(path, d)
	}
	return d, e
}
