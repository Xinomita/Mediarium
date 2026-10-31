package api

import (
	"bytes"
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/rdborg/mediarium/internal/auth"
	"github.com/rdborg/mediarium/internal/mediafiles"
)

type householdPlaybackState struct {
	mu       sync.Mutex
	sessions map[string]*householdPlaybackSession
}
type householdPlaybackSession struct {
	userID   int64
	dir      string
	cancel   context.CancelFunc
	done     chan struct{}
	lastSeen time.Time
}
type householdPlayRequest struct {
	Kind      string   `json:"kind"`
	ID        int64    `json:"id"`
	Path      string   `json:"path"`
	Transcode bool     `json:"transcode"`
	Start     *float64 `json:"start,omitempty"`
}
type householdSubtitle struct {
	URL      string `json:"url"`
	Language string `json:"language"`
	Label    string `json:"label"`
}
type householdPlaybackAnswer struct {
	Mode      string              `json:"mode"`
	URL       string              `json:"url"`
	SessionID string              `json:"sessionId,omitempty"`
	Position  float64             `json:"position"`
	Duration  float64             `json:"duration"`
	Subtitles []householdSubtitle `json:"subtitles"`
}
type householdProbe struct {
	Format struct {
		Duration string `json:"duration"`
	} `json:"format"`
	Streams []struct {
		Index         int    `json:"index"`
		CodecType     string `json:"codec_type"`
		CodecName     string `json:"codec_name"`
		ColorTransfer string `json:"color_transfer"`
		Tags          struct {
			Language string `json:"language"`
			Title    string `json:"title"`
		} `json:"tags"`
	} `json:"streams"`
}

func (s *Server) householdFolder(kind string, id int64) (mediafiles.Folder, error) {
	if id <= 0 {
		return mediafiles.Folder{}, mediafiles.ErrInvalidPath
	}
	switch kind {
	case "movie":
		m, err := s.MovieRepo.Get(id)
		if err != nil {
			return mediafiles.Folder{}, err
		}
		return s.movieFolder(m)
	case "tv":
		if _, err := s.MovieRepo.GetSeries(id); err != nil {
			return mediafiles.Folder{}, err
		}
		folder, _, err := s.seriesFolder(id)
		return folder, err
	default:
		return mediafiles.Folder{}, mediafiles.ErrInvalidPath
	}
}
func (s *Server) householdVideo(p householdPlayRequest) (*os.File, mediafiles.Folder, error) {
	folder, err := s.householdFolder(p.Kind, p.ID)
	if err != nil {
		return nil, folder, err
	}
	if mediafiles.KindOf(p.Path) != mediafiles.KindVideo {
		return nil, folder, mediafiles.ErrInvalidPath
	}
	f, _, err := folder.Open(p.Path)
	return f, folder, err
}

// Probe an already-confined descriptor rather than reopening an untrusted path.
// Demuxers/protocols that could follow remote URLs or playlists are excluded.
var householdInputOptions = []string{"-protocol_whitelist", "file,pipe", "-format_whitelist", "matroska,webm,mov,mp4,mpegts,avi,mpeg,asf"}

func probeHouseholdVideo(ctx context.Context, file *os.File) (householdProbe, error) {
	var p householdProbe
	ctx, cancel := context.WithTimeout(ctx, 8*time.Second)
	defer cancel()
	args := append([]string{"-v", "error"}, householdInputOptions...)
	args = append(args, "-i", "/proc/self/fd/3", "-show_format", "-show_streams", "-of", "json")
	cmd := exec.CommandContext(ctx, "ffprobe", args...)
	cmd.ExtraFiles = []*os.File{file}
	var b boundedHouseholdBuffer
	b.limit = 2 << 20
	cmd.Stdout = &b
	err := cmd.Run()
	_, _ = file.Seek(0, 0)
	if err != nil {
		return p, err
	}
	err = json.Unmarshal(b.Bytes(), &p)
	return p, err
}

type boundedHouseholdBuffer struct {
	bytes.Buffer
	limit int
}

func (b *boundedHouseholdBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.limit {
		return 0, fmt.Errorf("media metadata exceeded its limit")
	}
	return b.Buffer.Write(p)
}
func householdDuration(probe householdProbe) float64 {
	d, _ := strconv.ParseFloat(probe.Format.Duration, 64)
	if math.IsNaN(d) || math.IsInf(d, 0) || d < 0 {
		return 0
	}
	return d
}
func validHouseholdSeconds(v float64) bool {
	return !math.IsNaN(v) && !math.IsInf(v, 0) && v >= 0 && v <= 7*24*3600
}

func (s *Server) handleHouseholdPlay(w http.ResponseWriter, r *http.Request) {
	var p householdPlayRequest
	if decodeJSON(r, &p) != nil || p.Path == "" || len(p.Path) > 4096 || (p.Start != nil && !validHouseholdSeconds(*p.Start)) {
		writeError(w, 400, "Choose a valid video and playback position.")
		return
	}
	file, folder, err := s.householdVideo(p)
	if err != nil {
		writeHouseholdFileError(w, err)
		return
	}
	defer file.Close()
	userID := auth.UserFromContext(r.Context()).ID
	start := 0.0
	if p.Start != nil {
		start = *p.Start
	} else {
		var duration float64
		_ = s.db.QueryRowContext(r.Context(), "SELECT position,duration FROM household_progress WHERE user_id=? AND kind=? AND library_id=? AND file_path=?", userID, p.Kind, p.ID, p.Path).Scan(&start, &duration)
		if duration > 0 && start >= duration*.95 {
			start = 0
		}
	}
	probe, probeErr := probeHouseholdVideo(r.Context(), file)
	duration := householdDuration(probe)
	if duration > 0 && start >= duration {
		start = 0
	}
	kind := "movie"
	if p.Kind == "tv" {
		kind = "series"
	}
	q := url.Values{kind: {strconv.FormatInt(p.ID, 10)}, "path": {p.Path}}
	answer := householdPlaybackAnswer{Mode: "direct", URL: s.cfg.URLBase + "/api/files/stream?" + q.Encode(), Position: start, Duration: duration, Subtitles: []householdSubtitle{}}
	// MP4/WebM can go directly to the browser. The caller requests HLS if its
	// codec support rejects that file; other containers start in compatibility mode.
	ext := strings.ToLower(filepath.Ext(p.Path))
	transcode := p.Transcode || (ext != ".mp4" && ext != ".m4v" && ext != ".webm")
	if transcode && probeErr != nil {
		writeError(w, 503, "The server could not inspect this video. Check that FFmpeg is installed and the file is readable.")
		return
	}
	offset := 0.0
	if transcode {
		offset = start
	}
	answer.Subtitles = s.householdSubtitleList(p, folder, probe, offset)
	if !transcode {
		writeJSON(w, 200, answer)
		return
	}
	state := &s.householdPlayback
	state.mu.Lock()
	if state.sessions == nil {
		state.sessions = map[string]*householdPlaybackSession{}
	}
	count := 0
	for _, ss := range state.sessions {
		if ss.userID == userID {
			count++
		}
	}
	if len(state.sessions) >= 4 || count >= 2 {
		state.mu.Unlock()
		writeError(w, 429, "Too many videos are converting. Close another player and try again.")
		return
	}
	var random [16]byte
	if _, err = rand.Read(random[:]); err != nil {
		state.mu.Unlock()
		writeError(w, 500, "Could not start playback.")
		return
	}
	id := hex.EncodeToString(random[:])
	root := filepath.Join(s.cfg.ConfigDir, "household-playback")
	if err = os.MkdirAll(root, 0700); err != nil {
		state.mu.Unlock()
		writeError(w, 500, "Could not create the playback cache.")
		return
	}
	dir, err := os.MkdirTemp(root, "session-")
	if err != nil {
		state.mu.Unlock()
		writeError(w, 500, "Could not create the playback cache.")
		return
	}
	processCtx, cancel := context.WithTimeout(context.Background(), 6*time.Hour)
	session := &householdPlaybackSession{userID: userID, dir: dir, cancel: cancel, done: make(chan struct{}), lastSeen: time.Now()}
	state.sessions[id] = session
	state.mu.Unlock()
	fail := func() { s.closeHouseholdPlayback(id, userID) }
	args := []string{"-nostdin", "-hide_banner", "-loglevel", "error"}
	args = append(args, householdInputOptions...)
	if start > 0 {
		args = append(args, "-ss", strconv.FormatFloat(start, 'f', 3, 64))
	}
	args = append(args, "-readrate", "1.2", "-readrate_initial_burst", "12", "-i", "/proc/self/fd/3", "-map", "0:v:0", "-map", "0:a:0?", "-sn")
	filter := "scale=w='min(1920,iw)':h='min(1080,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
	for _, stream := range probe.Streams {
		if stream.CodecType == "video" && (stream.ColorTransfer == "smpte2084" || stream.ColorTransfer == "arib-std-b67") {
			filter += ",zscale=t=linear:npl=100,format=gbrpf32le,tonemap=hable,zscale=p=bt709:t=bt709:m=bt709:r=tv"
			break
		}
	}
	args = append(args, "-vf", filter, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-maxrate", "4500k", "-bufsize", "9000k", "-pix_fmt", "yuv420p", "-threads", "2",
		"-force_key_frames", "expr:gte(t,n_forced*4)", "-c:a", "aac", "-b:a", "160k", "-ac", "2",
		"-f", "hls", "-hls_time", "4", "-hls_playlist_type", "event", "-hls_flags", "independent_segments+temp_file", "-hls_segment_filename", filepath.Join(dir, "segment%06d.ts"), filepath.Join(dir, "stream.m3u8"))
	cmd := exec.CommandContext(processCtx, "ffmpeg", args...)
	cmd.ExtraFiles = []*os.File{file}
	var log boundedHouseholdBuffer
	log.limit = 65536
	cmd.Stderr = &log
	if err = cmd.Start(); err != nil {
		close(session.done)
		fail()
		writeError(w, 503, "The server could not start video conversion. Check that FFmpeg is installed.")
		return
	}
	go func() { _ = cmd.Wait(); close(session.done) }()
	go s.expireHouseholdPlayback(id, session)
	// A successful response means the first playable segment exists, not just
	// that ffmpeg started. The original file remains untouched.
	timeout := time.NewTimer(25 * time.Second)
	defer timeout.Stop()
	tick := time.NewTicker(100 * time.Millisecond)
	defer tick.Stop()
	for {
		if data, e := os.ReadFile(filepath.Join(dir, "stream.m3u8")); e == nil && bytes.Contains(data, []byte("#EXTINF")) {
			break
		}
		select {
		case <-r.Context().Done():
			fail()
			return
		case <-timeout.C:
			fail()
			writeError(w, 504, "Video conversion took too long to start. Try direct playback or a smaller version.")
			return
		case <-session.done:
			if data, e := os.ReadFile(filepath.Join(dir, "stream.m3u8")); e == nil && bytes.Contains(data, []byte("#EXTINF")) {
				continue
			}
			fail()
			writeError(w, 422, "This video could not be converted. Try another version of the title.")
			return
		case <-tick.C:
		}
	}
	answer.Mode = "hls"
	answer.SessionID = id
	answer.URL = s.cfg.URLBase + "/api/household/playback/" + id + "/stream.m3u8"
	writeJSON(w, 200, answer)
}
func (s *Server) closeHouseholdPlayback(id string, userID int64) bool {
	state := &s.householdPlayback
	state.mu.Lock()
	ss := state.sessions[id]
	if ss == nil || ss.userID != userID {
		state.mu.Unlock()
		return false
	}
	delete(state.sessions, id)
	ss.cancel()
	state.mu.Unlock()
	go func() { <-ss.done; _ = os.RemoveAll(ss.dir) }()
	return true
}
func (s *Server) expireHouseholdPlayback(id string, ss *householdPlaybackSession) {
	ticker := time.NewTicker(time.Minute)
	defer ticker.Stop()
	for range ticker.C {
		state := &s.householdPlayback
		state.mu.Lock()
		current := state.sessions[id]
		if current == nil {
			state.mu.Unlock()
			return
		}
		expired := time.Since(current.lastSeen) > 3*time.Minute
		state.mu.Unlock()
		if expired {
			s.closeHouseholdPlayback(id, ss.userID)
			return
		}
	}
}
func (s *Server) handleHouseholdStop(w http.ResponseWriter, r *http.Request) {
	if !s.closeHouseholdPlayback(r.PathValue("session"), auth.UserFromContext(r.Context()).ID) {
		writeError(w, 404, "Playback session not found.")
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

var householdSegmentName = regexp.MustCompile(`^segment[0-9]{6}\.ts$`)

func (s *Server) handleHouseholdSegment(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("file")
	if name != "stream.m3u8" && !householdSegmentName.MatchString(name) {
		writeError(w, 404, "Playback file not found.")
		return
	}
	state := &s.householdPlayback
	state.mu.Lock()
	ss := state.sessions[r.PathValue("session")]
	if ss == nil || ss.userID != auth.UserFromContext(r.Context()).ID {
		state.mu.Unlock()
		writeError(w, 404, "Playback session expired. Press Play to resume.")
		return
	}
	ss.lastSeen = time.Now()
	dir := ss.dir
	state.mu.Unlock()
	f, err := os.Open(filepath.Join(dir, name))
	if err != nil {
		writeError(w, 404, "This part of the video is not ready.")
		return
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil {
		writeError(w, 500, "Could not read this part of the video.")
		return
	}
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if name == "stream.m3u8" {
		w.Header().Set("Content-Type", "application/vnd.apple.mpegurl")
	} else {
		w.Header().Set("Content-Type", "video/mp2t")
	}
	http.ServeContent(w, r, name, info.ModTime(), f)
}
func (s *Server) handleHouseholdProgress(w http.ResponseWriter, r *http.Request) {
	var p struct {
		Kind     string  `json:"kind"`
		ID       int64   `json:"id"`
		Path     string  `json:"path"`
		Position float64 `json:"position"`
		Duration float64 `json:"duration"`
	}
	if decodeJSON(r, &p) != nil || !validHouseholdSeconds(p.Position) || !validHouseholdSeconds(p.Duration) || len(p.Path) > 4096 {
		writeError(w, 400, "Invalid playback progress.")
		return
	}
	f, _, err := s.householdVideo(householdPlayRequest{Kind: p.Kind, ID: p.ID, Path: p.Path})
	if err != nil {
		writeHouseholdFileError(w, err)
		return
	}
	f.Close()
	if p.Duration > 0 {
		p.Position = math.Min(p.Position, p.Duration)
	}
	_, err = s.db.ExecContext(r.Context(), `INSERT INTO household_progress(user_id,kind,library_id,file_path,position,duration)VALUES(?,?,?,?,?,?)
 ON CONFLICT(user_id,kind,library_id,file_path)DO UPDATE SET position=excluded.position,duration=excluded.duration,updated_at=strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
		auth.UserFromContext(r.Context()).ID, p.Kind, p.ID, p.Path, p.Position, p.Duration)
	if err != nil {
		writeError(w, 500, "Could not save your watch progress.")
		return
	}
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) householdSubtitleList(p householdPlayRequest, folder mediafiles.Folder, probe householdProbe, offset float64) []householdSubtitle {
	out := []householdSubtitle{}
	link := func(path string, stream int) string {
		q := url.Values{"kind": {p.Kind}, "id": {strconv.FormatInt(p.ID, 10)}, "path": {path}, "offset": {strconv.FormatFloat(offset, 'f', 3, 64)}}
		if stream >= 0 {
			q.Set("stream", strconv.Itoa(stream))
		}
		return s.cfg.URLBase + "/api/household/subtitles?" + q.Encode()
	}
	base := strings.TrimSuffix(p.Path, filepath.Ext(p.Path))
	if files, err := folder.List(); err == nil {
		for _, f := range files {
			ext := strings.ToLower(filepath.Ext(f.Path))
			if ext != ".srt" && ext != ".vtt" && ext != ".ass" {
				continue
			}
			if !strings.HasPrefix(strings.ToLower(f.Path), strings.ToLower(base)+".") {
				continue
			}
			suffix := strings.TrimSuffix(strings.TrimPrefix(f.Path, base+"."), ext)
			lang := strings.Split(suffix, ".")[0]
			if lang == "" || lang == "srt" || lang == "vtt" {
				lang = "und"
			}
			out = append(out, householdSubtitle{link(f.Path, -1), lang, lang + " · subtitles"})
		}
	}
	for _, st := range probe.Streams {
		if st.CodecType != "subtitle" {
			continue
		}
		switch st.CodecName {
		case "subrip", "ass", "ssa", "webvtt", "mov_text":
			label := st.Tags.Title
			if label == "" {
				label = st.Tags.Language + " · embedded"
			}
			out = append(out, householdSubtitle{link(p.Path, st.Index), st.Tags.Language, label})
		}
	}
	return out
}
func (s *Server) handleHouseholdSubtitles(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	id, e := strconv.ParseInt(q.Get("id"), 10, 64)
	offset, _ := strconv.ParseFloat(q.Get("offset"), 64)
	if e != nil || !validHouseholdSeconds(offset) {
		writeError(w, 400, "Invalid subtitle request.")
		return
	}
	folder, e := s.householdFolder(q.Get("kind"), id)
	if e != nil {
		writeHouseholdFileError(w, e)
		return
	}
	path := q.Get("path")
	ext := strings.ToLower(filepath.Ext(path))
	stream := -1
	if raw := q.Get("stream"); raw != "" {
		stream, e = strconv.Atoi(raw)
		if e != nil || stream < 0 || stream > 64 || mediafiles.KindOf(path) != mediafiles.KindVideo {
			writeError(w, 400, "Invalid subtitle track.")
			return
		}
	}
	if stream < 0 && ext != ".srt" && ext != ".vtt" && ext != ".ass" {
		writeError(w, 400, "Unsupported subtitle format.")
		return
	}
	file, info, e := folder.Open(path)
	if e != nil {
		writeHouseholdFileError(w, e)
		return
	}
	defer file.Close()
	if stream < 0 && info.Size() > 2<<20 {
		writeError(w, 413, "Subtitle file is too large.")
		return
	}
	ctx, cancel := context.WithTimeout(r.Context(), 20*time.Second)
	defer cancel()
	args := []string{"-nostdin", "-hide_banner", "-loglevel", "error", "-protocol_whitelist", "file,pipe"}
	if stream >= 0 {
		probe, err := probeHouseholdVideo(ctx, file)
		if err != nil {
			writeError(w, 422, "Could not read this subtitle track.")
			return
		}
		ok := false
		for _, st := range probe.Streams {
			if st.Index == stream && st.CodecType == "subtitle" {
				switch st.CodecName {
				case "subrip", "ass", "ssa", "webvtt", "mov_text":
					ok = true
				}
			}
		}
		if !ok {
			writeError(w, 400, "That subtitle track is not supported.")
			return
		}
		args = append(args, "-format_whitelist", "matroska,webm,mov,mp4,mpegts,avi,mpeg,asf")
	}
	if offset > 0 {
		args = append(args, "-ss", strconv.FormatFloat(offset, 'f', 3, 64))
	}
	args = append(args, "-i", "/proc/self/fd/3")
	if stream >= 0 {
		args = append(args, "-map", "0:"+strconv.Itoa(stream))
	}
	args = append(args, "-f", "webvtt", "pipe:1")
	cmd := exec.CommandContext(ctx, "ffmpeg", args...)
	cmd.ExtraFiles = []*os.File{file}
	var output boundedHouseholdBuffer
	output.limit = 2 << 20
	cmd.Stdout = &output
	if err := cmd.Run(); err != nil {
		writeError(w, 422, "Could not load this subtitle track.")
		return
	}
	w.Header().Set("Content-Type", "text/vtt; charset=utf-8")
	w.Header().Set("Cache-Control", "private, max-age=120")
	_, _ = io.Copy(w, &output)
}

// All file failures pass through this boundary; never return host paths.
func writeHouseholdFileError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, mediafiles.ErrInvalidPath):
		writeError(w, http.StatusBadRequest, "Choose a valid file inside this title's folder.")
	case errors.Is(err, sql.ErrNoRows), errors.Is(err, os.ErrNotExist):
		writeError(w, http.StatusNotFound, "This video is no longer available. Refresh the library and try again.")
	case errors.Is(err, mediafiles.ErrOutside):
		writeError(w, http.StatusForbidden, "This file is outside the media library.")
	default:
		writeFileReadError(w, err)
	}
}

func (s *Server) stopHouseholdPlaybacks() {
	state := &s.householdPlayback
	state.mu.Lock()
	owners := map[string]int64{}
	for id, ss := range state.sessions {
		owners[id] = ss.userID
	}
	state.mu.Unlock()
	for id, uid := range owners {
		s.closeHouseholdPlayback(id, uid)
	}
}

func (s *Server) clearHouseholdPlaybackCache() {
	root := filepath.Join(s.cfg.ConfigDir, "household-playback")
	entries, err := os.ReadDir(root)
	if err != nil {
		return
	}
	for _, entry := range entries {
		// Only our own generated session directories, never sibling config data.
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "session-") {
			_ = os.RemoveAll(filepath.Join(root, entry.Name()))
		}
	}
}
