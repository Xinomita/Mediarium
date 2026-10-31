package api

import "testing"

func TestHouseholdArtNamesAreConfined(t *testing.T) {
	if householdArtName("movie", 123, "poster") != "movie-123-poster.jpg" {
		t.Fatal("valid name")
	}
	for _, k := range []string{"../movie", "", "other"} {
		if householdArtName(k, 123, "poster") != "" {
			t.Fatal(k)
		}
	}
	for _, v := range []string{"../secret.key", "poster.jpg", ""} {
		if householdArtName("movie", 123, v) != "" {
			t.Fatal(v)
		}
	}
	for _, id := range []int{0, -1} {
		if householdArtName("tv", id, "poster") != "" {
			t.Fatal(id)
		}
	}
}
