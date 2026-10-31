# Household discovery

The household fork separates discovery (`/watch`, Films and Series) from owned
media (`/watch/library`) and saved titles (`/watch/list`). Existing administrative
and download routes remain available.

## Recommendation policy

- Retrieve multiple pages from popular, highly rated, recent and genre-specific
  TMDB discover feeds, plus three recommendation pages per personal seed.
- Use up to six seeds, ordered by explicit likes, saves, substantial viewing
  (at least five minutes), then weaker shared-library inspiration. A partial
  preview is not treated as positive feedback. Completed viewing is included;
  it is never described as a like. Uncatalogued test videos are not inferred seeds.
- Label the actual seed relationship. Aggregate agreement across seeds;
  deduplicate each seed's contribution. Explicit likes carry more weight than
  shared library ownership. Personal cache keys include settings and seeds.
- Screen discovery for language/genre preferences, hides, a meaningful vote sample,
  valid release date and a Bayesian audience score of at least 6.8. Shrink ratings
  toward a 6.2 prior with 250 votes. The user rating floor can narrow this selection.
- Rank using 64% confidence-adjusted audience rating, 30% seed affinity, 5% explicit
  genre/language relevance and 1% capped popularity. Recency only selects its own
  shelf. A greedy genre-overlap penalty diversifies general picks; cross-shelf
  repetition penalties avoid starving later rows.
- Films require an actual digital/disc date on or before today. Missing dates and
  failed checks fail closed. TV must have aired. Availability metadata does not
  certify any individual download; existing release checks still apply.
- Exclude all library entries from discovery. Retain them in Library regardless
  of recommendation filters or metadata outages. Saved titles have a separate
  endpoint with a partial-provider header, and unresolved keys are preserved.
- Each source fetch is bounded and cached. Home accepts kind=movie|tv and page=1..20.
  Shelves can expand, deeper pages deduplicate within shelves, and genre browsing
  uses one deduplicated grid instead of multiple sparse filtered rows.

## Evidence and limitations

This is a transparent household hybrid, not a trained Netflix recommender.
TMDB provides item relationships; this app combines them with household feedback.
TMDB audience ratings are explicitly labelled. No Rotten Tomatoes or Metacritic
critic feed is configured. Sparse feedback, incomplete metadata and language
filters can limit matches. Search remains the full catalogue.

Design references: [Netflix recommendations](https://help.netflix.com/en/node/100639),
[Amazon item-to-item history](https://www.amazon.science/the-history-of-amazons-recommendation-algorithm),
[TMDB recommendations](https://developer.themoviedb.org/reference/movie-recommendations),
[TMDB discover filters](https://developer.themoviedb.org/reference/discover-movie).

Regression coverage includes rating confidence, personal candidate isolation,
release/date/provider failure gates, owned-title exclusion, paging, seed precedence,
preview exclusion, offline watchlists, progress and route permissions. Frontend
coverage includes per-user/type caches, page deduplication, genre-grid deduplication
and resume filtering. Build with Dockerfile.household; retain this fork's migrations.
