package api

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
)

// Local artwork is a copy of the household's existing catalogue art. No
// provider token or Jellyfin dependency is sent to a viewer's browser.
func householdArtName(kind string, id int, variant string) string {
	if (kind != "movie" && kind != "tv") || id <= 0 || (variant != "poster" && variant != "backdrop") {
		return ""
	}
	return fmt.Sprintf("%s-%d-%s.jpg", kind, id, variant)
}
func (s *Server) householdArtURL(kind string, id int, variant, fallback string) string {
	name := householdArtName(kind, id, variant)
	if name == "" {
		return fallback
	}
	if st, err := os.Stat(filepath.Join(s.cfg.ConfigDir, "household-art", name)); err == nil && st.Mode().IsRegular() {
		return fmt.Sprintf("%s/api/household/art/%s/%d/%s", s.cfg.URLBase, kind, id, variant)
	}
	return fallback
}
func (s *Server) handleHouseholdArt(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.Atoi(r.PathValue("id"))
	name := householdArtName(r.PathValue("kind"), id, r.PathValue("variant"))
	if err != nil || name == "" {
		http.NotFound(w, r)
		return
	}
	root, err := os.OpenRoot(filepath.Join(s.cfg.ConfigDir, "household-art"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer root.Close()
	f, err := root.Open(name)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer f.Close()
	st, err := f.Stat()
	if err != nil || !st.Mode().IsRegular() || st.Size() > 10<<20 {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "image/jpeg")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, max-age=3600")
	http.ServeContent(w, r, name, st.ModTime(), f)
}
