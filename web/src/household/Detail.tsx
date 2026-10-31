import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import {
  api,
  can,
  isRequested,
  isViewer,
  type Episode,
  type MovieDetail,
  type QueueItem,
  type SeriesDetail,
  type TitleFile,
  type TVDetail,
  type TitleEvent,
} from "../api";
import { useAuth } from "../AuthContext";
import Icon from "../components/Icon";
import {
  household,
  type HouseholdTitle,
  type Kind,
  type Preferences,
} from "./api";
import { Empty, Loading, Problem } from "./Shared";
import { bytes, errorText, titleKey, queueLabel, clampProgress } from "./utils";
import { usePoll } from "./usePoll";
import { invalidateHome } from "./cache";
import Releases from "./Releases";
import { titleMetadata } from "./titleMetadata";
import { TrailerDialog } from "./Trailer";
const Player = lazy(() => import("./Player"));

interface TitleState {
  detail: MovieDetail | TVDetail;
  series: SeriesDetail | null;
  files: TitleFile[];
  queue: QueueItem[];
  events: TitleEvent[];
  fileError: string;
  metadataWarning: string;
}
export default function HouseholdDetail() {
  const { kind, tmdbId } = useParams();
  if ((kind !== "movie" && kind !== "tv") || !/^\d+$/.test(tmdbId || ""))
    return (
      <div className="hh-page">
        <Empty title="That title could not be found">
          <Link to="/watch/search">Search for a title</Link>
        </Empty>
      </div>
    );
  return <TitlePage key={kind + tmdbId} kind={kind} tmdbId={Number(tmdbId)} />;
}
function TitlePage({ kind, tmdbId }: { kind: Kind; tmdbId: number }) {
  const { user } = useAuth();
  const location = useLocation();
  const userId = user?.id ?? 0;
  const [today] = useState(() => new Date().toISOString().slice(0, 10));
  const seed = (location.state as { title?: HouseholdTitle } | null)?.title;
  const [season, setSeason] = useState(1);
  const [trailerOpen, setTrailerOpen] = useState(false);
  const [watchActive, setWatchActive] = useState(false);
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [action, setAction] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [playing, setPlaying] = useState<TitleFile | null>(null);
  const [releases, setReleases] = useState<{
    id: number;
    episode?: number;
  } | null>(null);
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  const [prefError, setPrefError] = useState("");
  const key = titleKey(kind, tmdbId);
  const writable = !!user && !isViewer(user);
  const playable = can(user, "play");
  const load = useCallback(async (): Promise<TitleState> => {
    let detail: MovieDetail | TVDetail;
    let metadataWarning = "";
    try {
      detail = await titleMetadata(userId, kind, tmdbId);
    } catch (e) {
      const local =
        kind === "movie"
          ? (await api.listMovies()).find((m) => m.tmdbId === tmdbId)
          : (await api.listSeries()).find((s) => s.tmdbId === tmdbId);
      if (!local) throw e;
      detail = {
        tmdbId,
        title: local.title,
        year: local.year,
        overview: local.overview,
        posterUrl: local.posterUrl,
        genres: local.genres,
        libraryId: local.id,
      };
      metadataWarning =
        "Online title details are unavailable. Your local files are still available.";
    }
    const id = detail.libraryId;
    let series: SeriesDetail | null = null;
    let files: TitleFile[] = [];
    let fileError = "";
    let queue: QueueItem[] = [];
    let events: TitleEvent[] = [];
    if (id) {
      const answers = await Promise.allSettled([
        kind === "tv" ? api.getSeries(id) : Promise.resolve(null),
        playable
          ? kind === "movie"
            ? api.movieFiles(id)
            : api.seriesFiles(id)
          : Promise.resolve({ files: [] }),
        api.listQueue(),
        kind === "movie" ? api.movieEvents(id) : api.seriesEvents(id),
      ]);
      if (answers[0].status === "fulfilled") series = answers[0].value;
      else fileError = errorText(answers[0].reason);
      if (answers[1].status === "fulfilled")
        files = answers[1].value.files.filter((f) => f.kind === "video");
      else fileError = errorText(answers[1].reason);
      if (answers[2].status === "fulfilled")
        queue = answers[2].value
          .filter((q) =>
            kind === "movie" ? q.movieId === id : q.seriesId === id,
          )
          .sort((a, b) => b.id - a.id)
          .slice(0, 3);
      if (answers[3].status === "fulfilled")
        events = [...answers[3].value]
          .sort((a, b) => b.at.localeCompare(a.at))
          .slice(0, 5);
    }
    setWatchActive(queue.some(q => ["queued", "downloading", "importing"].includes(q.status)));
    return { detail, series, files, queue, events, fileError, metadataWarning };
  }, [kind, tmdbId, playable, userId]);
  const state = usePoll(load, watchActive ? 5000 : 0, !playing && !trailerOpen);
  useEffect(() => {
    let live = true;
    void household
      .preferences()
      .then((p) => {
        if (live) setPrefs(p);
      })
      .catch((e) => {
        if (live) setPrefError(errorText(e));
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    if (state.data?.detail.title)
      document.title = `${state.data.detail.title} · Mediarium`;
  }, [state.data?.detail.title]);
  const data = state.data;
  const detail: MovieDetail | TVDetail | undefined = data?.detail || (seed ? { tmdbId: seed.tmdbId, title: seed.title, year: seed.year, overview: seed.overview, backdropUrl: seed.backdropUrl, posterUrl: seed.posterUrl, genres: seed.genres, libraryId: seed.libraryId } : undefined);
  const id = detail?.libraryId;
  const episodes = data?.series?.episodes || [];
  const seasons = [
    ...new Set([
      ...(detail?.seasonList || []).map((s) => s.number),
      ...episodes.map((e) => e.season),
    ]),
  ].sort((a, b) => a - b);
  const selectedEpisodes = episodes
    .filter((e) => e.season === season)
    .sort((a, b) => a.episode - b.episode);
  const episodeFile = (ep: Episode) =>
    data?.files.find((f) => f.episodeId === ep.id);
  const movieFile = data?.files.find((f) => f.main) || data?.files[0];
  const seasonFile = selectedEpisodes.map(episodeFile).find(Boolean);
  const resumeFile = seed?.progress
    ? data?.files.find((f) => f.path === seed.progress?.path)
    : undefined;
  const primaryFile =
    resumeFile || (kind === "movie" ? movieFile : seasonFile || data?.files[0]);
  const activeQueue = data?.queue.find((q) =>
    ["queued", "downloading", "importing", "paused", "conflict"].includes(
      q.status,
    ),
  );
  const ensureLibrary = async (): Promise<number | null> => {
    if (id) return id;
    const result =
      kind === "movie"
        ? await api.addMovie(tmdbId, {
            monitored: true,
            searchNow: false,
            noUpgrade: true,
          })
        : await api.addSeries(tmdbId, {
            monitor: "none",
            searchNow: false,
            noUpgrade: true,
          });
    if (isRequested(result)) {
      setMessage(result.message);
      state.refresh();
      return null;
    }
    invalidateHome();
    state.refresh();
    return result.id;
  };
  const download = async (episode?: Episode) => {
    setAction(episode ? `episode:${episode.id}` : "download");
    setError("");
    setMessage("");
    try {
      if (!id && !can(user, "manage")) {
        const added =
          kind === "movie"
            ? await api.addMovie(tmdbId, {
                monitored: true,
                searchNow: true,
                noUpgrade: true,
              })
            : await api.addSeries(tmdbId, {
                monitor: "all",
                searchNow: true,
                noUpgrade: true,
              });
        setMessage(
          isRequested(added)
            ? added.message
            : "Added to the library. The server will look for a release.",
        );
      } else {
        const libraryId = await ensureLibrary();
        if (!libraryId) return;
        if (kind === "tv") {
          if (episode) await api.setEpisodeMonitored(episode.id, true);
          else await api.setSeasonMonitored(libraryId, season, true);
        }
        const result =
          kind === "movie"
            ? await api.searchNowMovie(libraryId)
            : await api.searchNowSeries(libraryId, {
                season,
                ...(episode ? { episode: episode.episode } : {}),
              });
        setMessage(
          result.message ||
            (result.grabbed
              ? "Download started on the server."
              : "No matching release was found. You can choose a release or try again later."),
        );
      }
      invalidateHome();
      state.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAction("");
    }
  };
  const choose = async (episode?: Episode) => {
    setAction("releases");
    setError("");
    try {
      const libraryId = await ensureLibrary();
      if (libraryId) setReleases({ id: libraryId, episode: episode?.episode });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setAction("");
    }
  };
  const feedback = async (field: "watchlist" | "liked" | "hidden") => {
    setFeedbackBusy(true);
    setPrefError("");
    try {
      const current = await household.preferences();
      const list = current[field];
      const next = await household.savePreferences({
        ...current,
        [field]: list.includes(key)
          ? list.filter((k) => k !== key)
          : [...list, key],
      });
      setPrefs(next);
      invalidateHome();
    } catch (e) {
      setPrefError(errorText(e));
    } finally {
      setFeedbackBusy(false);
    }
  };
  if (!detail)
    return (
      <div className="hh-page">
        {state.error ? (
          <Problem message={state.error} retry={state.refresh} />
        ) : (
          <Loading hero />
        )}
      </div>
    );
  return (
    <>
      <section className="hh-hero hh-detail-hero" data-tv-row="detail-hero">
        {(detail.backdropUrl || seed?.backdropUrl) && (
          <img
            className="hh-hero-image"
            src={detail.backdropUrl || seed?.backdropUrl}
            alt=""
            fetchPriority="high"
          />
        )}
        <div className="hh-hero-shade" />
        <Link className="hh-detail-back" to="/watch">
          <Icon name="chevron-left" size={19} />
          Browse
        </Link>
        <div className="hh-hero-copy">
          <p className="hh-eyebrow">
            {kind === "movie" ? "Film" : "Series"}
            {primaryFile ? " · In your library" : ""}
          </p>
          <h1>{detail.title}</h1>
          <p className="hh-hero-meta">
            {detail.year > 0 && <span>{detail.year}</span>}
            {detail.certification && (
              <span className="hh-certification">{detail.certification}</span>
            )}
            {!!detail.runtime && <span>{detail.runtime} min</span>}
            {detail.genres?.slice(0, 2).map((g) => (
              <span key={g}>{g}</span>
            ))}
            {!!detail.imdbRating && (
              <span>
                <Icon name="star" size={13} />
                IMDb {detail.imdbRating?.toFixed(1)}
              </span>
            )}
          </p>
          {detail.overview && (
            <p className="hh-hero-overview">{detail.overview}</p>
          )}
          <div className="hh-actions">
            {primaryFile && playable ? (
              <button
                className="hh-button hh-primary"
                onClick={() => setPlaying(primaryFile)}
              >
                <Icon name="play" size={19} />
                {resumeFile
                  ? "Resume"
                  : kind === "tv" && seasonFile
                    ? `Watch season ${season}`
                    : "Watch"}
              </button>
            ) : activeQueue ? (
              <Link className="hh-button hh-primary" to="/watch/downloads">
                <Icon name="download" size={18} />
                View download
              </Link>
            ) : data && writable &&
              can(user, kind === "movie" ? "movies" : "tv") &&
              (!id || can(user, "manage")) ? (
              <button
                className="hh-button hh-primary"
                disabled={!!action}
                onClick={() => void download()}
              >
                <Icon name="download" size={18} />
                {action === "download"
                  ? "Finding a release…"
                  : !can(user, "addDirect") && !id
                    ? "Request title"
                    : kind === "tv" && can(user, "manage")
                      ? `Download season ${season}`
                      : "Download"}
              </button>
            ) : null}
            {!!detail.trailers?.length && <button className="hh-button hh-glass" onClick={() => setTrailerOpen(true)}><Icon name="play" size={19} />Trailer</button>}
            {!!detail.cast?.length && <button className="hh-button hh-glass" onClick={() => document.querySelector<HTMLElement>(".hh-cast-member")?.focus()}>Cast</button>}
            {prefs && (
              <button
                className={`hh-button hh-glass ${prefs.watchlist.includes(key) ? "selected" : ""}`}
                disabled={feedbackBusy}
                aria-pressed={prefs.watchlist.includes(key)}
                onClick={() => void feedback("watchlist")}
              >
                <Icon
                  name={prefs.watchlist.includes(key) ? "check" : "plus"}
                  size={19}
                />
                {prefs.watchlist.includes(key)
                  ? "In my list"
                  : "Add to my list"}
              </button>
            )}
            {writable &&
              can(user, "releases") &&
              (!id ? can(user, "addDirect") : true) && (
                <button
                  className="hh-button hh-glass"
                  disabled={!!action}
                  onClick={() => void choose()}
                >
                  {action === "releases" ? "Opening…" : "Choose a release"}
                </button>
              )}
          </div>
        </div>
      </section>
      <div className="hh-detail-content">
        {state.error && <Problem message={state.error} retry={state.refresh} />}
        {data?.metadataWarning && <Problem message={data.metadataWarning} />}
        {error && <Problem message={error} />}
        {message && (
          <div className="hh-notice" role="status">
            <Icon name="info" size={18} />
            <span>{message}</span>
            <Link to="/watch/downloads">
              Downloads
              <Icon name="chevron-right" size={15} />
            </Link>
          </div>
        )}
        {activeQueue && (
          <Link to="/watch/downloads" className="hh-inline-download">
            <div>
              <Icon name="download" size={21} />
              <strong>{queueLabel(activeQueue)}</strong>
              {activeQueue.status === "downloading" && (
                <span>
                  {clampProgress(activeQueue.progressPct).toFixed(1)}%
                </span>
              )}
              <Icon name="chevron-right" size={18} />
            </div>
            <div className="hh-progress">
              <span
                style={{ width: `${clampProgress(activeQueue.progressPct)}%` }}
              />
            </div>
            {activeQueue.note && <p>{activeQueue.note}</p>}
          </Link>
        )}
        {prefError && (
          <Problem message={`Could not save your taste: ${prefError}`} />
        )}
        {prefs && (
          <div className="hh-feedback">
            <button
              disabled={feedbackBusy}
              aria-pressed={prefs.liked.includes(key)}
              className={prefs.liked.includes(key) ? "selected" : ""}
              onClick={() => void feedback("liked")}
            >
              <Icon name="heart" size={17} />
              {prefs.liked.includes(key) ? "Liked" : "Like this"}
            </button>
            <button
              disabled={feedbackBusy}
              aria-pressed={prefs.hidden.includes(key)}
              className={prefs.hidden.includes(key) ? "selected" : ""}
              onClick={() => void feedback("hidden")}
            >
              <Icon name="eye-off" size={17} />
              {prefs.hidden.includes(key)
                ? "Hidden from recommendations"
                : "Not for me"}
            </button>
          </div>
        )}
        {kind === "tv" && (
          <section className="hh-episodes">
            <div className="hh-section-head">
              <h2>Episodes</h2>
              <div className="hh-season-select">
                <label htmlFor="season">Season</label>
                <select
                  id="season"
                  value={season}
                  onChange={(e) => {
                    setSeason(Number(e.target.value));
                    setMessage("");
                    setError("");
                  }}
                >
                  {(seasons.length ? seasons : [1]).map((n) => (
                    <option key={n} value={n}>
                      {n === 0 ? "Specials" : `Season ${n}`}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {selectedEpisodes.length > 0 ? (
              <div className="hh-episode-list">
                {selectedEpisodes.map((ep) => {
                  const f = episodeFile(ep);
                  return (
                    <article className="hh-episode" key={ep.id}>
                      <div className="hh-episode-number">
                        {String(ep.episode).padStart(2, "0")}
                      </div>
                      <div className="hh-episode-copy">
                        <h3>{ep.title || `Episode ${ep.episode}`}</h3>
                        <p>
                          {ep.overview ||
                            (ep.airDate
                              ? `Released ${ep.airDate}`
                              : "Episode details unavailable.")}
                        </p>
                        <div className="hh-episode-meta">
                          {f ? (
                            <>
                              <span className="hh-ready">Ready to play</span>
                              <span>{bytes(f.size)}</span>
                            </>
                          ) : (
                            <span>
                              {ep.status === "downloading"
                                ? "Downloading on server"
                                : ep.airDate &&
                                    ep.airDate >
                                      today
                                  ? `Coming ${ep.airDate}`
                                  : "Not downloaded"}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="hh-episode-actions">
                        {f && playable ? (
                          <button
                            className="hh-button hh-primary hh-small"
                            onClick={() => setPlaying(f)}
                            aria-label={`Play episode ${ep.episode}: ${ep.title || ""}`}
                          >
                            <Icon name="play" size={17} />
                            Play
                          </button>
                        ) : (
                          writable &&
                          can(user, "manage") && (
                            <button
                              className="hh-button hh-secondary hh-small"
                              disabled={!!action || ep.status === "downloading"}
                              onClick={() => void download(ep)}
                            >
                              {action === `episode:${ep.id}`
                                ? "Searching…"
                                : "Download"}
                            </button>
                          )
                        )}
                        {writable && can(user, "releases") && (
                          <button
                            className="hh-text-button"
                            disabled={!!action}
                            onClick={() => void choose(ep)}
                          >
                            Choose release
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="hh-episode-preview">
                <p>
                  {id
                    ? "Episode details are being loaded. Refresh to check again."
                    : `${detail.seasonList?.find((s) => s.number === season)?.episodes || "The"} episodes in this season. Add it to your server to choose individual episodes.`}
                </p>
                {!id && writable && can(user, "addDirect") && (
                  <button
                    className="hh-button hh-secondary"
                    disabled={!!action}
                    onClick={() => {
                      setAction("add");
                      setError("");
                      void ensureLibrary()
                        .catch((e) => setError(errorText(e)))
                        .finally(() => setAction(""));
                    }}
                  >
                    {action === "add" ? "Adding…" : "Choose episodes"}
                  </button>
                )}
                {id && (
                  <button className="hh-text-button" onClick={state.refresh}>
                    Refresh episodes
                  </button>
                )}
              </div>
            )}
          </section>
        )}
        {data?.fileError && (
          <Problem message={data.fileError} retry={state.refresh} />
        )}
        {kind === "movie" && data && data.files.length > 1 && (
          <section className="hh-files">
            <h2>Available files</h2>
            {data.files.map((f) => (
              <button key={f.path} onClick={() => setPlaying(f)}>
                <Icon name="play" size={18} />
                <span>{f.path}</span>
                <small>{bytes(f.size)}</small>
              </button>
            ))}
          </section>
        )}
        {!!detail.cast?.length && (
          <section className="hh-cast" data-tv-row="cast">
            <div className="hh-section-head">
              <h2>Cast</h2>
            </div>
            <div className="hh-cast-track">
              {detail.cast.map((p, i) => (
                <div className="hh-cast-member" tabIndex={0} key={p.id || i} aria-label={`${p.name}${p.character ? ` as ${p.character}` : ""}`}>
                  {p.profileUrl ? (
                    <img src={p.profileUrl} alt="" loading="lazy" />
                  ) : (
                    <div className="hh-cast-placeholder">
                      {p.name
                        .split(" ")
                        .map((n) => n[0])
                        .slice(0, 2)
                        .join("")}
                    </div>
                  )}
                  <h3>{p.name}</h3>
                  <p>{p.character}</p>
                </div>
              ))}
            </div>
          </section>
        )}
        {!!data?.events.length && (
          <details className="hh-title-activity">
            <summary>
              Recent activity
              <Icon name="chevron-down" size={17} />
            </summary>
            {data.events.map((e, i) => (
              <div key={e.at + i}>
                <time dateTime={e.at}>{new Date(e.at).toLocaleString()}</time>
                <p className={e.level === "error" ? "hh-error-text" : ""}>
                  {e.message}
                </p>
              </div>
            ))}
          </details>
        )}
      </div>
      {trailerOpen && <TrailerDialog title={detail.title} trailers={detail.trailers || []} onClose={() => setTrailerOpen(false)} />}
      {releases && (
        <Releases
          kind={kind}
          id={releases.id}
          title={detail.title}
          season={season}
          episode={releases.episode}
          onClose={() => setReleases(null)}
          onGrab={() => {
            setMessage("Download started on the server.");
            state.refresh();
            invalidateHome();
          }}
        />
      )}
      {playing && id && (
        <Suspense
          fallback={
            <div className="hh-player-loading" role="status">
              Opening player…
            </div>
          }
        >
          <Player
            key={playing.path}
            title={detail.title}
            kind={kind}
            id={id}
            file={playing}
            onClose={() => {
              setPlaying(null);
              invalidateHome();
            }}
          />
        </Suspense>
      )}
    </>
  );
}
