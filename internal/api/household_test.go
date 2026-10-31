package api_test

import (
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rdborg/mediarium/internal/household"
	"github.com/rdborg/mediarium/internal/library"
	"github.com/rdborg/mediarium/internal/settings"
)

func TestHouseholdPreferencesArePersonal(t *testing.T) {
	_, base, admin, member, _ := familyServer(t)
	p := getJSON[household.Preferences](t, member, base+"/api/household/preferences")
	if len(p.Languages) != 1 || p.Languages[0] != "en" || p.MinRating != 6 {
		t.Fatalf("defaults: %+v", p)
	}
	p.Languages = []string{"ja"}
	p.Watchlist = []string{"movie:603"}
	putJSONStatus(t, member, base+"/api/household/preferences", p, 200)
	saved := getJSON[household.Preferences](t, member, base+"/api/household/preferences")
	other := getJSON[household.Preferences](t, admin, base+"/api/household/preferences")
	if saved.Languages[0] != "ja" || other.Languages[0] != "en" || len(other.Watchlist) != 0 {
		t.Fatal("Preferences leaked between accounts")
	}
	p.Watchlist = []string{"../../private"}
	putJSONStatus(t, member, base+"/api/household/preferences", p, 400)
	if status, _ := doStatus(t, http.DefaultClient, http.MethodGet, base+"/api/household/home"); status != 401 {
		t.Fatalf("Anonymous home: %d", status)
	}
}

func TestHouseholdProgressAndPathConfinement(t *testing.T) {
	server, base, admin, member, _ := familyServer(t)
	root := t.TempDir()
	movies := filepath.Join(root, "movies")
	if err := server.Settings.Set(settings.KeyMoviesPath, movies, false); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(movies, "Example", "Example.mp4")
	writeBody(t, file, "0123456789")
	m, err := server.MovieRepo.Add(library.Movie{TMDBID: 603, Title: "Example", Year: 1999})
	if err != nil {
		t.Fatal(err)
	}
	if err = server.MovieRepo.SetStatus(m.ID, library.StatusDownloaded, "", file); err != nil {
		t.Fatal(err)
	}
	detail := getJSON[map[string]any](t, member, base+"/api/tmdb/movies/603")
	if detail["libraryId"] != float64(m.ID) {
		t.Fatal("Library details must work without TMDB")
	}
	progress := map[string]any{"kind": "movie", "id": m.ID, "path": "Example.mp4", "position": 30, "duration": 120}
	putJSONStatus(t, member, base+"/api/household/progress", progress, 200)
	type response struct {
		Rails []struct {
			ID    string
			Items []household.Title
		}
	}
	home := getJSON[response](t, member, base+"/api/household/home")
	if len(home.Rails) == 0 || home.Rails[0].ID != "continue" || home.Rails[0].Items[0].Progress.Position != 30 {
		t.Fatalf("Resume missing: %+v", home)
	}
	other := getJSON[response](t, admin, base+"/api/household/home")
	for _, rail := range other.Rails {
		if rail.ID == "continue" {
			t.Fatal("Watch history leaked")
		}
	}
	// A new playback reads the saved position and streams through the original
	// confined range-serving route. An unsupported probe never exposes paths.
	play := postJSON[map[string]any](t, member, base+"/api/household/playback", map[string]any{"kind": "movie", "id": m.ID, "path": "Example.mp4"}, 200)
	if play["position"] != float64(30) || play["mode"] != "direct" {
		t.Fatal(play)
	}
	if strings.Contains(anyString(play), root) {
		t.Fatal("Server path disclosed")
	}
	progress["path"] = "../../config/secret.mp4"
	putJSONStatus(t, member, base+"/api/household/progress", progress, 400)
	progress["path"] = "Example.mp4"
	progress["position"] = -1
	putJSONStatus(t, member, base+"/api/household/progress", progress, 400)
	// Finishing removes the title from Continue Watching, not the library.
	progress["position"] = 120
	putJSONStatus(t, member, base+"/api/household/progress", progress, 200)
	home = getJSON[response](t, member, base+"/api/household/home")
	for _, rail := range home.Rails {
		if rail.ID == "continue" {
			t.Fatal("Completed title should not be in Continue Watching")
		}
	}
}

func TestHouseholdFFmpegPlaybackLifecycle(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg not installed")
	}
	server, base, admin, member, _ := familyServer(t)
	root := t.TempDir()
	movies := filepath.Join(root, "movies")
	dir := filepath.Join(movies, "Fixture")
	if err := os.MkdirAll(dir, 0755); err != nil {
		t.Fatal(err)
	}
	file := filepath.Join(dir, "Fixture.mkv")
	cmd := exec.Command("ffmpeg", "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=24", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100", "-t", "8", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file)
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("Make legal test media: %v: %s", err, out)
	}
	writeBody(t, filepath.Join(dir, "Fixture.en.srt"), "1\n00:00:01,000 --> 00:00:03,000\nSubtitle check\n")
	if err := server.Settings.Set(settings.KeyMoviesPath, movies, false); err != nil {
		t.Fatal(err)
	}
	m, err := server.MovieRepo.Add(library.Movie{TMDBID: 603, Title: "Fixture", Year: 1999})
	if err != nil {
		t.Fatal(err)
	}
	if err = server.MovieRepo.SetStatus(m.ID, library.StatusDownloaded, "", file); err != nil {
		t.Fatal(err)
	}
	play := postJSON[map[string]any](t, member, base+"/api/household/playback", map[string]any{"kind": "movie", "id": m.ID, "path": "Fixture.mkv", "transcode": true, "start": 2}, 200)
	if play["mode"] != "hls" || play["position"] != float64(2) || play["duration"].(float64) < 7 {
		t.Fatal(play)
	}
	session := play["sessionId"].(string)
	playlist := play["url"].(string)
	resp, err := member.Get(base + playlist)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 {
		t.Fatal("No playable manifest", resp.StatusCode)
	}
	if status, _ := doStatus(t, admin, http.MethodGet, base+playlist); status != 404 {
		t.Fatal("Another account accessed the stream", status)
	}
	track := play["subtitles"].([]any)[0].(map[string]any)["url"].(string)
	resp, err = member.Get(base + track)
	if err != nil {
		t.Fatal(err)
	}
	resp.Body.Close()
	if resp.StatusCode != 200 || !strings.HasPrefix(resp.Header.Get("Content-Type"), "text/vtt") {
		t.Fatal("Subtitles failed", resp.StatusCode)
	}
	if status, _ := doStatus(t, member, http.MethodDelete, base+"/api/household/playback/"+url.PathEscape(session)); status != 200 {
		t.Fatal(status)
	}
	if status, _ := doStatus(t, member, http.MethodGet, base+playlist); status != 404 {
		t.Fatal("Closed session still accessible", status)
	}
}
