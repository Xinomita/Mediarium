package imdb

import (
	"strings"
	"testing"
	"time"
)

func TestRatings(t *testing.T) {
	r, e := Parse(strings.NewReader("tconst\taverageRating\tnumVotes\ntt0133093\t8.7\t2100000\n"))
	if e != nil || r[133093].Score != 8.7 || r[133093].Votes != 2100000 {
		t.Fatalf("%v %v", r, e)
	}
	for _, bad := range []string{"", "x\taverageRating\tnumVotes\n", "tconst\taverageRating\tnumVotes\ntt1\tNaN\t9\n", "tconst\taverageRating\tnumVotes\ntt0133093\t8.7\t-1\n"} {
		if _, e := Parse(strings.NewReader(bad)); e == nil {
			t.Fatal("accepted corrupt dataset")
		}
	}
	s := &Store{ratings: r, next: time.Now().Add(time.Hour)}
	if _, ok := s.Lookup("tt99999999"); ok {
		t.Fatal("missing score fabricated")
	}
}
