import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon";
import { useAuth } from "../AuthContext";
import { isAdmin } from "../api";
import { HOME_INVALIDATED, readHomeCache, writeHomeCache } from "./cache";
import { household, type HomeResponse, type Kind } from "./api";
import { Empty, Loading, Problem, Rail, TitleCard } from "./Shared";
import { discoveryRails, genreTitles, mergeHomePages } from "./discovery";
import { errorText, titleLink } from "./utils";

export default function HouseholdHome() {
  const { user } = useAuth();
  const [query] = useSearchParams();
  const value = query.get("kind");
  const kind = value === "movie" || value === "tv" ? value : undefined;
  return <Discovery key={`${user?.id}:${kind || "all"}`} userId={user?.id ?? 0} kind={kind} admin={isAdmin(user)} />;
}
function Discovery({ userId, kind, admin }: { userId: number; kind?: Kind; admin: boolean }) {
  const [data, setData] = useState<HomeResponse | null>(() => readHomeCache(userId, kind));
  const [error, setError] = useState("");
  const [moreError, setMoreError] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [revision, setRevision] = useState(0);
  const [genre, setGenre] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    request.current?.abort();
    request.current = ctl;
    void household.home(ctl.signal, kind).then((d) => {
      if (ctl.signal.aborted) return;
      writeHomeCache(userId, d, kind);
      setData(d); setError(""); setMoreError(""); setLoadingMore(false);
    }).catch((e) => { if (!ctl.signal.aborted) setError(errorText(e)); });
    const refresh = () => { request.current?.abort(); setLoadingMore(false); setRevision((n) => n + 1); };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener(HOME_INVALIDATED, refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      ctl.abort(); request.current?.abort();
      window.removeEventListener(HOME_INVALIDATED, refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [revision, userId, kind]);
  const loadMore = async () => {
    if (!data || loadingMore) return;
    const ctl = new AbortController();
    request.current?.abort(); request.current = ctl;
    setLoadingMore(true); setMoreError("");
    try {
      const next = await household.home(ctl.signal, kind, data.page + 1);
      if (ctl.signal.aborted) return;
      const merged = mergeHomePages(data, next);
      writeHomeCache(userId, merged, kind); setData(merged);
    } catch (e) { if (!ctl.signal.aborted) setMoreError(errorText(e)); }
    finally { if (!ctl.signal.aborted) setLoadingMore(false); }
  };
  if (!data) return error ? <div className="hh-page"><Problem message={error} retry={() => setRevision((n) => n + 1)} /></div> : <Loading hero />;
  const allRails = discoveryRails(data, kind);
  const genres = [...new Set(allRails.flatMap((r) => r.items.flatMap((t) => t.genres || [])))].sort();
  const matching = genre ? genreTitles(allRails, genre) : [];
  const hasItems = genre ? matching.length > 0 : allRails.length > 0;
  const candidate = data.hero;
  const hero = !genre && candidate && !candidate.available && !candidate.libraryId && (!kind || candidate.kind === kind)
    ? candidate : (genre ? matching : allRails.flatMap((r) => r.items)).find((t) => t.backdropUrl);
  const heading = kind === "movie" ? "Discover films" : kind === "tv" ? "Discover series" : "Discover";
  return <>
    {hero && <section className={`hh-hero hh-discovery-hero ${hero.backdropUrl ? "" : "hh-hero-no-art"}`} aria-label={hero.title}>
      {hero.backdropUrl && <img className="hh-hero-image" src={hero.backdropUrl} alt="" fetchPriority="high" />}
      <div className="hh-hero-shade" />
      <div className="hh-hero-copy">
        <p className="hh-eyebrow">{kind === "tv" ? "Your next series" : kind === "movie" ? "Your next film" : "Something new for tonight"}</p>
        <h1>{hero.title}</h1>
        <p className="hh-hero-meta"><span>{hero.year || ""}</span><span>{hero.kind === "tv" ? "Series" : "Film"}</span>{hero.genres?.slice(0, 2).map((g) => <span key={g}>{g}</span>)}
          {!!hero.rating && <span>TMDB audience {hero.rating.toFixed(1)} / 10</span>}
        </p>
        {hero.overview && <p className="hh-hero-overview">{hero.overview}</p>}
        <div className="hh-actions"><Link className="hh-button hh-primary" to={titleLink(hero.kind, hero.tmdbId)} state={{ title: hero }}><Icon name="info" size={19} />Explore title</Link>
          <Link className="hh-button hh-glass" to="/watch/preferences"><Icon name="sliders" size={18} />Your taste</Link></div>
        {hero.reason && <p className="hh-reason">{hero.reason}</p>}
      </div>
    </section>}
    <div className={`hh-home-content ${hero ? "" : "hh-discovery-no-hero"}`}>
      <div className="hh-discovery-toolbar">
        {hero ? <h2>{heading}</h2> : <h1>{heading}</h1>}
        <div className="hh-discovery-tools"><div className="hh-genre-filter"><label htmlFor="discovery-genre">Genre</label><select id="discovery-genre" value={genre} onChange={(e) => setGenre(e.target.value)}><option value="">All genres</option>{genres.map((g) => <option key={g} value={g}>{g}</option>)}</select></div><Link to="/watch/search" className="hh-discovery-search"><Icon name="search" size={17} />Search</Link></div>
      </div>
      {error && <div className="hh-home-warning"><Problem message={error} retry={() => setRevision((n) => n + 1)} /></div>}
      {data.warnings.map((w) => {
        const needsSetup = /(?:tmdb|metadata).*key|movie database connection/i.test(w);
        return <div className="hh-home-warning" key={w}>
          <Problem message={w} retry={needsSetup ? undefined : () => setRevision((n) => n + 1)} />
          {admin && needsSetup && <Link className="hh-button hh-secondary hh-small" to="/settings/metadata">Set up film & TV metadata</Link>}
        </div>;
      })}
      {hasItems ? genre ? (
        <section className="hh-rail hh-poster-rail" aria-labelledby="genre-results-heading">
          <div className="hh-section-head">
            <h2 id="genre-results-heading">{genre}</h2>
            <p className="hh-muted" role="status">{matching.length} {matching.length === 1 ? "title" : "titles"}</p>
          </div>
          <div className="hh-title-grid hh-shelf-grid">
            {matching.map((title, i) => <TitleCard key={`${title.kind}:${title.tmdbId}`} title={title} discovery poster eager={i < 6} />)}
          </div>
        </section>
      ) : allRails.map((r, i) => <Rail key={r.id} title={r.title} subtitle={r.subtitle} items={r.items} eager={i === 0} discovery poster={i > 0} />) : <Empty title={genre ? `No ${genre.toLowerCase()} picks in these shelves` : "Find your next good watch"}>{genre ? "Explore more to load another selection, or choose a different genre." : <Link to="/watch/preferences">Choose genres and languages to shape discovery.</Link>}</Empty>}
      <div className="hh-explore-more">
        {moreError && <Problem message={moreError} retry={() => void loadMore()} />}
        {data.hasMore && <button className="hh-button hh-secondary" disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? "Finding more titles…" : "Explore more"}<Icon name="chevron-down" size={17} /></button>}
        <p role="status" aria-live="polite">{loadingMore ? "Loading the next selection" : !data.hasMore && hasItems ? "You’re up to date with these picks." : ""}</p>
      </div>
    </div>
  </>;
}
