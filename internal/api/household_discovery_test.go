package api_test

import (
	"encoding/json"
	"fmt"
	"github.com/rdborg/mediarium/internal/household"
	"github.com/rdborg/mediarium/internal/library"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
)

func TestHouseholdDiscoveryReleaseGatePagingAndPersonalSeeds(t *testing.T) {
	server, base, admin, member, _ := familyServer(t)
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		w.Header().Set("Content-Type", "application/json")
		title := func(id int) map[string]any {
			return map[string]any{"id": id, "title": fmt.Sprintf("Film %d", id), "original_language": "en", "release_date": "2020-01-01", "poster_path": "/p.jpg", "backdrop_path": "/b.jpg", "vote_average": 8.2, "vote_count": 3000, "genre_ids": []int{18}}
		}
		switch {
		case path == "/discover/movie":
			if r.URL.Query().Get("with_release_type") != "4|5" || r.URL.Query().Get("release_date.lte") == "" {
				t.Error("Missing release filters")
			}
			page, _ := strconv.Atoi(r.URL.Query().Get("page"))
			items := []any{}
			for i := 1; i <= 16; i++ {
				items = append(items, title((page-1)*16+i))
			}
			json.NewEncoder(w).Encode(map[string]any{"page": page, "total_pages": 20, "results": items})
		case path == "/discover/tv":
			json.NewEncoder(w).Encode(map[string]any{"page": 1, "total_pages": 1, "results": []any{}})
		case path == "/genre/movie/list":
			fmt.Fprint(w, `{"genres":[{"id":18,"name":"Drama"}]}`)
		case strings.HasSuffix(path, "/recommendations"):
			items := []any{}
			for i := 300; i < 308; i++ {
				items = append(items, title(i))
			}
			json.NewEncoder(w).Encode(map[string]any{"page": 1, "results": items})
		case strings.HasPrefix(path, "/movie/"):
			id, _ := strconv.Atoi(strings.TrimPrefix(path, "/movie/"))
			if id == 4 {
				w.WriteHeader(503)
				return
			}
			m := title(id)
			date := "2020-02-01T00:00:00.000Z"
			releaseType := 4
			if id == 2 {
				date = "2099-01-01T00:00:00.000Z"
			}
			if id == 3 {
				releaseType = 3
			}
			m["release_dates"] = map[string]any{"results": []any{map[string]any{"iso_3166_1": "US", "release_dates": []any{map[string]any{"type": releaseType, "release_date": date}}}}}
			json.NewEncoder(w).Encode(m)
		default:
			fmt.Fprint(w, `{"results":[],"genres":[]}`)
		}
	}))
	defer fixture.Close()
	server.TestSetTMDBBaseURL("fixture", fixture.URL)
	_, e := server.MovieRepo.Add(library.Movie{TMDBID: 1, Title: "Owned", Year: 2020})
	if e != nil {
		t.Fatal(e)
	}
	p := household.Defaults()
	p.Liked = []string{"movie:200"}
	putJSONStatus(t, member, base+"/api/household/preferences", p, 200)
	type response struct {
		Rails []struct {
			ID    string
			Items []household.Title
		}
		HasMore  bool
		Page     int
		Warnings []string
	}
	home := getJSON[response](t, member, base+"/api/household/home?kind=movie")
	if !home.HasMore || home.Page != 1 || len(home.Rails) == 0 || len(home.Warnings) == 0 {
		t.Fatalf("Bad response %+v", home)
	}
	related := false
	for _, rail := range home.Rails {
		for _, title := range rail.Items {
			if title.TMDBID <= 4 || title.Kind != "movie" {
				t.Fatal("Owned, unreleased, or failed-release-check title leaked", title)
			}
			if title.TMDBID == 300 {
				related = true
			}
		}
	}
	if !related {
		t.Fatal("Like-based candidates absent")
	}
	other := getJSON[response](t, admin, base+"/api/household/home?kind=movie")
	for _, rail := range other.Rails {
		for _, title := range rail.Items {
			if title.TMDBID >= 300 {
				t.Fatal("Personal recommendations leaked")
			}
		}
	}
	page2 := getJSON[response](t, member, base+"/api/household/home?kind=movie&page=2")
	if page2.Page != 2 || len(page2.Rails) == 0 {
		t.Fatal("Missing continuation")
	}
	for _, query := range []string{"?kind=invalid", "?page=0", "?page=21"} {
		if status, _ := doStatus(t, member, http.MethodGet, base+"/api/household/home"+query); status != 400 {
			t.Fatal("Invalid query accepted")
		}
	}
}
