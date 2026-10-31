# Mediarium Household fork

A household web interface for browsing, downloading and watching on one server.
Based on Mediarium 3.9.0; the upstream administration pages remain available at
/manage and /settings. The default home is /watch.

## Run

Build with `docker compose -f compose.household.yaml up -d --build`.
Create the first owner account in the setup wizard. Configure your own TMDB API
key, indexers and download destinations in Settings. No provider credentials
are included. The Compose file stores new data under household-data and uses
port 8265. Ensure the config and media directories are writable by UID 950.
Existing media can be mounted read-only and registered as additional folders;
new downloads should use writable destinations. Do not point this fork at an
existing Mediarium database without taking a backup.

Features include films/series browsing, search, personal watchlists, explicit
taste settings, release selection, server download progress and same-site video
playback. Recommendations combine audience-rating confidence, bounded popularity,
language/genre preferences, recency and diversity; no demographic inference.
Existing library titles remain accessible regardless of discovery preferences.
A personal TMDB key is required for new-title discovery. The footer attributes
TMDB and links to this modified source under the upstream AGPL license.

## Playback

MP4/WebM use browser playback, with HLS fallback when necessary. Other containers
use FFmpeg H.264/AAC conversion, up to 1080p. HLS.js is preferred on compatible
browsers; Safari can use native HLS. Resume, seeking and text subtitles are
supported. Progress and streaming sessions belong to the signed-in account.
Four conversions globally and two per account are allowed; idle sessions expire.

Conversion currently uses CPU, not hardware acceleration. Full 4K/HDR performance,
image subtitles and alternate audio-track selection are not validated/supported
as complete household features. This is a LAN deployment, not an internet
exposure recipe. Keep the existing media services until household testing is done.

## Verification

Focused Go tests cover ranking/preferences, access roles, path containment, owner
isolation, artwork and FFmpeg playback. HouseholdDownloadImportAndPlayback uses
a locally generated video and local torrent peer to exercise search, grab,
transfer, byte-exact import, availability, subtitles, resume and seeking. FFmpeg
must be installed for these tests; missing FFmpeg causes explicit skips.
That short test fixture disables duration validation only inside its isolated
test environment. Real installations should keep duration validation enabled.

Frontend checks: npm test and npm run build in web/. Server checks:
`go test ./internal/household ./internal/mediafiles` and
`go test ./internal/api -run 'Household|MemberRoutes|Viewer|TitleFiles|Discover|Permission' -count=1`.
The fork's production container includes FFmpeg.
