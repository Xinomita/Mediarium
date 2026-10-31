package api_test

import (
	"compress/gzip"
	"encoding/json"
	"fmt"
	"github.com/rdborg/mediarium/internal/imdb"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"
)

func TestHouseholdIMDbQualityAndPersistentMetadata(t *testing.T) {
	server, base, admin, _, _ := familyServer(t)
	dir := t.TempDir()
	if e := os.MkdirAll(filepath.Join(dir, "imdb"), 0750); e != nil {
		t.Fatal(e)
	}
	f, e := os.Create(filepath.Join(dir, "imdb", "title.ratings.tsv.gz"))
	if e != nil {
		t.Fatal(e)
	}
	z := gzip.NewWriter(f)
	fmt.Fprint(z, "tconst\taverageRating\tnumVotes\n")
	for i := 1; i <= 6; i++ {
		score := 8.0
		if i == 6 {
			score = 4
		}
		fmt.Fprintf(z, "tt%07d\t%.1f\t5000\n", i, score)
	}
	z.Close()
	f.Close()
	server.TestUseHouseholdIMDb(imdb.New(dir))
	var details atomic.Int32
	fixture := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		title := func(i int) map[string]any {
			return map[string]any{"id": i, "title": fmt.Sprint("Title ", i), "original_language": "en", "release_date": "2020-01-01", "poster_path": "/p.jpg", "backdrop_path": "/b.jpg", "vote_average": 9.9, "vote_count": 99999, "genre_ids": []int{18}}
		}
		switch {
		case r.URL.Path == "/discover/movie":
			if r.URL.Query().Get("vote_average.gte") != "" && r.URL.Query().Get("vote_average.gte") != "0" {
				t.Error("TMDB quality gate remains")
			}
			items := []any{}
			for i := 1; i <= 7; i++ {
				m := title(i)
				if i <= 5 {
					m["vote_average"] = 2
				}
				items = append(items, m)
			}
			json.NewEncoder(w).Encode(map[string]any{"page": 1, "total_pages": 1, "results": items})
		case strings.HasPrefix(r.URL.Path, "/movie/"):
			details.Add(1)
			id, _ := strconv.Atoi(strings.TrimPrefix(r.URL.Path, "/movie/"))
			m := title(id)
			m["imdb_id"] = fmt.Sprintf("tt%07d", id)
			m["release_dates"] = map[string]any{"results": []any{map[string]any{"iso_3166_1": "US", "release_dates": []any{map[string]any{"type": 4, "release_date": "2020-01-01T00:00:00.000Z"}}}}}
			json.NewEncoder(w).Encode(m)
		default:
			fmt.Fprint(w, `{"results":[],"genres":[{"id":18,"name":"Drama"}]}`)
		}
	}))
	defer fixture.Close()
	server.TestSetTMDBBaseURL("fixture", fixture.URL)
	type response struct {
		Rails []struct {
			Items []struct {
				TMDBID       int
				Rating       float64
				RatingSource string
			}
		}
	}
	home := getJSON[response](t, admin, base+"/api/household/home?kind=movie")
	if len(home.Rails) == 0 {
		t.Fatal("IMDb-approved titles lost to TMDB gate")
	}
	for _, rail := range home.Rails {
		for _, v := range rail.Items {
			if v.TMDBID > 5 || v.Rating != 8 || v.RatingSource != "IMDb" {
				t.Fatalf("wrong provider/missing/poor rating admitted: %+v", v)
			}
		}
	}
	before := details.Load()
	server.TestSetTMDBBaseURL("fixture", fixture.URL)
	d := getJSON[map[string]any](t, admin, base+"/api/tmdb/movies/1")
	if d["imdbRating"] != float64(8) || d["imdbVotes"] != float64(5000) {
		t.Fatalf("IMDb missing in detail: %+v", d)
	}
	if details.Load() != before {
		t.Fatal("persistent detail cache refetched provider")
	}
	d = getJSON[map[string]any](t, admin, base+"/api/tmdb/movies/7")
	if _, ok := d["imdbRating"]; ok {
		t.Fatal("TMDB substituted for missing IMDb")
	}
}
