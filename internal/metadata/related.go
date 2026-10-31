package metadata

import (
	"context"
	"fmt"
	"net/url"
	"strconv"
)

// Kinds of related list TMDB offers for a title.
const (
	RelatedRecommended = "recommendations" // what people who liked it also liked
	RelatedSimilar     = "similar"         // matched on genre and keywords
)

// RelatedMovies fetches one page of the movies TMDB relates to a movie: its
// recommendations or its similar list (see the Related* constants). The page
// goes through the page cache, so asking again soon costs nothing.
func (c *Client) RelatedMovies(ctx context.Context, tmdbID int, related string) ([]Movie, error) {
	return c.RelatedMoviesPage(ctx, tmdbID, related, 1)
}

// RelatedMoviesPage supports deeper candidate retrieval without a separate client.
func (c *Client) RelatedMoviesPage(ctx context.Context, tmdbID int, related string, pageNum int) ([]Movie, error) {
	page, err := c.moviePage(ctx, fmt.Sprintf("/movie/%d/%s", tmdbID, related), url.Values{"language": {"en-US"}, "page": {strconv.Itoa(ClampPage(pageNum))}})
	if err != nil {
		return nil, err
	}
	return page.Results, nil
}

// RelatedShows is RelatedMovies for shows.
func (c *Client) RelatedShows(ctx context.Context, tmdbID int, related string) ([]Show, error) {
	return c.RelatedShowsPage(ctx, tmdbID, related, 1)
}

// RelatedShowsPage is the TV counterpart of RelatedMoviesPage.
func (c *Client) RelatedShowsPage(ctx context.Context, tmdbID int, related string, pageNum int) ([]Show, error) {
	page, err := c.showPage(ctx, fmt.Sprintf("/tv/%d/%s", tmdbID, related), url.Values{"language": {"en-US"}, "page": {strconv.Itoa(ClampPage(pageNum))}})
	if err != nil {
		return nil, err
	}
	return page.Results, nil
}
