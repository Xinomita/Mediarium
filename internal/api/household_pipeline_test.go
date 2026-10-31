package api_test

import (
	"bytes"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/rdborg/mediarium/internal/household"
	"github.com/rdborg/mediarium/internal/library"
)

// Real local torrent transfer and FFmpeg playback; only catalogue/indexer data
// are fixtures. No public tracker, purchased media or external credential is used.
func TestHouseholdDownloadImportAndPlayback(t *testing.T) {
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Skip("ffmpeg required")
	}
	server, base, client := newControlServer(t, false)
	t.Cleanup(func() { server.TestStopTorrents() })
	putJSON(t, client, base+"/api/downloads/torrent-options", map[string]any{"portMapping": false}, 200)
	putJSON(t, client, base+"/api/settings", map[string]any{"checkDuration": false}, 200)
	file := filepath.Join(t.TempDir(), "Household.Fixture.2026.720p.WEB-DL.mkv")
	out, err := exec.Command("ffmpeg", "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=12", "-f", "lavfi", "-i", "sine=frequency=440", "-t", "65", "-c:v", "libx264", "-preset", "ultrafast", "-c:a", "aac", "-y", file).CombinedOutput()
	if err != nil {
		t.Fatalf("fixture: %v %s", err, out)
	}
	video, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	magnet := seedRelease(t, map[string][]byte{filepath.Base(file): video}, 0)
	indexer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/xml")
		fmt.Fprintf(w, `<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed"><channel><item><title>Household.Fixture.2026.720p.WEB-DL</title><guid>household-fixture</guid><link>%s</link><size>%d</size><torznab:attr name="seeders" value="1"/><torznab:attr name="category" value="2000"/></item></channel></rss>`, html.EscapeString(magnet), len(video))
	}))
	defer indexer.Close()
	postJSON[map[string]any](t, client, base+"/api/indexers", map[string]any{"name": "Legal fixture", "kind": "torznab", "baseUrl": indexer.URL, "protocol": "torrent", "enabled": true}, 201)
	m, err := server.MovieRepo.Add(library.Movie{TMDBID: 999998, Title: "Household Fixture", Year: 2026})
	if err != nil {
		t.Fatal(err)
	}
	results := getJSON[[]map[string]any](t, client, base+"/api/search?q=Household%20Fixture")
	if len(results) != 1 {
		t.Fatalf("search: %+v", results)
	}
	result := results[0]
	postJSON[map[string]any](t, client, fmt.Sprintf("%s/api/movies/%d/grab", base, m.ID), map[string]any{"releaseTitle": result["title"], "downloadUrl": result["downloadUrl"], "sizeBytes": len(video), "protocol": "torrent"}, 202)
	waitForQueueStatus(t, client, base, "completed")
	imported, err := server.MovieRepo.Get(m.ID)
	if err != nil || imported.Status != library.StatusDownloaded {
		t.Fatalf("import: %+v %v", imported, err)
	}
	got, err := os.ReadFile(imported.FilePath)
	if err != nil || !bytes.Equal(got, video) {
		t.Fatal("import changed the downloaded video", err)
	}
	rel := filepath.Base(imported.FilePath)
	writeBody(t, strings.TrimSuffix(imported.FilePath, filepath.Ext(imported.FilePath))+".en.srt", "1\n00:00:31,000 --> 00:00:34,000\nDownloaded fixture subtitle\n")
	home := getJSON[struct {
		Rails []struct {
			ID    string
			Items []household.Title
		}
	}](t, client, base+"/api/household/home")
	ready := false
	for _, rail := range home.Rails {
		for _, item := range rail.Items {
			if item.LibraryID == m.ID && item.Available {
				ready = true
			}
		}
	}
	if !ready {
		t.Fatal("download did not appear ready on household home")
	}
	playReq := map[string]any{"kind": "movie", "id": m.ID, "path": rel}
	play := postJSON[map[string]any](t, client, base+"/api/household/playback", playReq, 200)
	if play["mode"] != "hls" {
		t.Fatal("MKV should use HLS", play)
	}
	resp, err := client.Get(base + play["url"].(string))
	if err != nil {
		t.Fatal(err)
	}
	manifest, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !bytes.Contains(manifest, []byte("#EXTINF")) {
		t.Fatalf("manifest: %d %s", resp.StatusCode, manifest)
	}
	for _, line := range strings.Split(string(manifest), "\n") {
		if strings.HasSuffix(strings.TrimSpace(line), ".ts") {
			segmentURL := base + play["url"].(string)
			segmentURL = segmentURL[:strings.LastIndex(segmentURL, "/")+1] + strings.TrimSpace(line)
			res, e := client.Get(segmentURL)
			if e != nil {
				t.Fatal(e)
			}
			b, _ := io.ReadAll(res.Body)
			res.Body.Close()
			if res.StatusCode != 200 || len(b) < 188 {
				t.Fatal("no playable media segment")
			}
			break
		}
	}
	putJSON(t, client, base+"/api/household/progress", map[string]any{"kind": "movie", "id": m.ID, "path": rel, "position": 30, "duration": 65}, 200)
	doStatus(t, client, http.MethodDelete, base+"/api/household/playback/"+play["sessionId"].(string))
	resumed := postJSON[map[string]any](t, client, base+"/api/household/playback", playReq, 200)
	if resumed["position"] != float64(30) {
		t.Fatal("resume lost", resumed)
	}
	track := resumed["subtitles"].([]any)[0].(map[string]any)["url"].(string)
	resp, err = client.Get(base + track)
	if err != nil {
		t.Fatal(err)
	}
	vtt, _ := io.ReadAll(resp.Body)
	resp.Body.Close()
	if resp.StatusCode != 200 || !bytes.Contains(vtt, []byte("Downloaded fixture subtitle")) {
		t.Fatalf("subtitle: %s", vtt)
	}
	doStatus(t, client, http.MethodDelete, base+"/api/household/playback/"+resumed["sessionId"].(string))
	playReq["start"] = 45
	sought := postJSON[map[string]any](t, client, base+"/api/household/playback", playReq, 200)
	if sought["position"] != float64(45) {
		t.Fatal("seek lost", sought)
	}
	doStatus(t, client, http.MethodDelete, base+"/api/household/playback/"+sought["sessionId"].(string))
}
