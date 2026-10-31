// Package imdb reads the official personal/non-commercial ratings dataset.
// No credentials or per-title remote requests are required.
package imdb

import (
	"bufio"
	"compress/gzip"
	"context"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

type Rating struct {
	Score float64
	Votes int
}
type Store struct {
	mu      sync.RWMutex
	ratings map[uint32]Rating
	path    string
	next    time.Time
	busy    bool
	updated time.Time
}

func ID(id string) (uint32, bool) {
	if !strings.HasPrefix(id, "tt") || len(id) < 4 {
		return 0, false
	}
	n, e := strconv.ParseUint(id[2:], 10, 32)
	return uint32(n), e == nil && n > 0
}
func Parse(r io.Reader) (map[uint32]Rating, error) {
	scanner := bufio.NewScanner(io.LimitReader(r, 256<<20))
	if !scanner.Scan() || scanner.Text() != "tconst\taverageRating\tnumVotes" {
		return nil, fmt.Errorf("invalid IMDb ratings header")
	}
	out := make(map[uint32]Rating)
	for scanner.Scan() {
		row := strings.Split(scanner.Text(), "\t")
		if len(row) != 3 {
			return nil, fmt.Errorf("invalid IMDb row")
		}
		id, ok := ID(row[0])
		score, e := strconv.ParseFloat(row[1], 64)
		votes, ve := strconv.Atoi(row[2])
		if !ok || e != nil || ve != nil || !(score >= 0 && score <= 10) || votes < 0 {
			return nil, fmt.Errorf("invalid IMDb rating")
		}
		out[id] = Rating{score, votes}
	}
	if e := scanner.Err(); e != nil {
		return nil, e
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("empty IMDb ratings")
	}
	return out, nil
}
func read(path string) (map[uint32]Rating, error) {
	f, e := os.Open(path)
	if e != nil {
		return nil, e
	}
	defer f.Close()
	gz, e := gzip.NewReader(f)
	if e != nil {
		return nil, e
	}
	defer gz.Close()
	return Parse(gz)
}
func New(dir string) *Store {
	s := &Store{path: filepath.Join(dir, "imdb", "title.ratings.tsv.gz")}
	// Load the last good local dataset synchronously once at startup.
	if data, e := read(s.path); e == nil {
		s.ratings = data
		if st, e := os.Stat(s.path); e == nil {
			s.updated = st.ModTime()
			s.next = st.ModTime().Add(24 * time.Hour)
		}
	}
	s.refreshIfDue()
	return s
}
func (s *Store) Lookup(id string) (Rating, bool) {
	if s == nil {
		return Rating{}, false
	}
	s.refreshIfDue()
	n, ok := ID(id)
	if !ok {
		return Rating{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	r, ok := s.ratings[n]
	return r, ok
}
func (s *Store) Ready() bool {
	if s == nil {
		return false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.ratings) > 0
}
func (s *Store) refreshIfDue() {
	s.mu.Lock()
	if s.busy || time.Now().Before(s.next) {
		s.mu.Unlock()
		return
	}
	s.busy = true
	s.next = time.Now().Add(time.Hour)
	s.mu.Unlock()
	go func() {
		defer func() { s.mu.Lock(); s.busy = false; s.mu.Unlock() }()
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
		defer cancel()
		req, e := http.NewRequestWithContext(ctx, "GET", "https://datasets.imdbws.com/title.ratings.tsv.gz", nil)
		if e != nil {
			return
		}
		res, e := http.DefaultClient.Do(req)
		if e != nil {
			return
		}
		defer res.Body.Close()
		if res.StatusCode != 200 {
			return
		}
		if os.MkdirAll(filepath.Dir(s.path), 0750) != nil {
			return
		}
		f, e := os.CreateTemp(filepath.Dir(s.path), "ratings-*.tmp")
		if e != nil {
			return
		}
		name := f.Name()
		defer os.Remove(name)
		n, e := io.Copy(f, io.LimitReader(res.Body, (64<<20)+1))
		ce := f.Close()
		if e != nil || ce != nil || n > 64<<20 {
			return
		}
		ratings, e := read(name)
		if e != nil || len(ratings) < 100000 {
			return
		}
		if os.Rename(name, s.path) != nil {
			return
		}
		s.mu.Lock()
		s.ratings = ratings
		s.updated = time.Now()
		s.next = s.updated.Add(24 * time.Hour)
		s.mu.Unlock()
	}()
}
