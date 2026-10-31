import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Icon from "../components/Icon";
import { useAuth } from "../AuthContext";
import { isAdmin } from "../api";
import { readHomeCache, writeHomeCache } from "./cache";
import { household, type HomeResponse } from "./api";
import { Empty, Loading, Problem, Rail } from "./Shared";
import { errorText, titleLink } from "./utils";

export default function HouseholdHome() {
  const { user } = useAuth();
  const userId = user?.id ?? 0;
  const [query] = useSearchParams();
  const kind = query.get("kind");
  const [data, setData] = useState<HomeResponse | null>(() =>
    readHomeCache(userId),
  );
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    void household
      .home(ctl.signal)
      .then((d) => {
        writeHomeCache(userId, d);
        setData(d);
        setError("");
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(errorText(e));
      });
    const onVisible = () => {
      if (document.visibilityState === "visible") setRevision((n) => n + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      ctl.abort();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [revision, userId]);
  if (!data)
    return error ? (
      <div className="hh-page">
        <Problem message={error} retry={() => setRevision((n) => n + 1)} />
      </div>
    ) : (
      <Loading hero />
    );
  const rails = data.rails
    .map((r) => ({
      ...r,
      items: r.items.filter((t) => !kind || t.kind === kind),
    }))
    .filter((r) => r.items.length);
  const hero =
    data.hero && (!kind || data.hero.kind === kind)
      ? data.hero
      : rails.flatMap((r) => r.items).find((t) => t.backdropUrl);
  return (
    <>
      {hero && (
        <section
          className={`hh-hero ${hero.backdropUrl ? "" : "hh-hero-no-art"}`}
          aria-label={hero.title}
        >
          {hero.backdropUrl && (
            <img
              className="hh-hero-image"
              src={hero.backdropUrl}
              alt=""
              fetchPriority="high"
            />
          )}
          <div className="hh-hero-shade" />
          <div className="hh-hero-copy">
            <p className="hh-eyebrow">
              {hero.available ? "In your library" : "Tonight’s pick"}
            </p>
            <h1>{hero.title}</h1>
            <p className="hh-hero-meta">
              <span>{hero.year || ""}</span>
              <span>{hero.kind === "tv" ? "Series" : "Film"}</span>
              {hero.genres?.slice(0, 2).map((g) => (
                <span key={g}>{g}</span>
              ))}
              {!!hero.rating && (
                <span>
                  <Icon name="star" size={13} />
                  {hero.rating.toFixed(1)}
                </span>
              )}
            </p>
            {hero.overview && (
              <p className="hh-hero-overview">{hero.overview}</p>
            )}
            <div className="hh-actions">
              <Link
                className="hh-button hh-primary"
                to={titleLink(hero.kind, hero.tmdbId)}
                state={{ title: hero }}
              >
                <Icon name={hero.available ? "play" : "info"} size={19} />
                {hero.available ? "Watch" : "Explore title"}
              </Link>
              <Link className="hh-button hh-glass" to="/watch/search">
                <Icon name="search" size={18} />
                Find something
              </Link>
            </div>
            {hero.reason && <p className="hh-reason">{hero.reason}</p>}
          </div>
        </section>
      )}
      <div className={hero ? "hh-home-content" : "hh-page"}>
        {!hero && (
          <div className="hh-page-heading">
            <p className="hh-eyebrow">Your home cinema</p>
            <h1>
              {kind === "movie"
                ? "Films"
                : kind === "tv"
                  ? "Series"
                  : "Watch now"}
            </h1>
          </div>
        )}
        {error && (
          <Problem message={error} retry={() => setRevision((n) => n + 1)} />
        )}
        {data.warnings.map((w) => (
          <div className="hh-home-warning" key={w}>
            <Problem message={w} />
            {isAdmin(user) && /tmdb|metadata.*key|movie database connection/i.test(w) && (
              <Link
                className="hh-button hh-secondary hh-small"
                to="/settings/metadata"
              >
                Set up film & TV metadata
              </Link>
            )}
          </div>
        ))}
        {rails.length ? (
          rails.map((r, i) => (
            <Rail key={r.id} title={r.title} items={r.items} eager={i === 0} />
          ))
        ) : (
          <Empty title="Your next good watch starts here">
            Search for a film or series to download, or adjust your taste to
            discover more.
          </Empty>
        )}
        <section className="hh-taste-prompt">
          <div>
            <h2>Make this feel more like you.</h2>
            <p>
              Choose your languages and genres. Save what interests you; hide
              what doesn’t.
            </p>
          </div>
          <Link className="hh-button hh-secondary" to="/watch/preferences">
            Shape your recommendations
            <Icon name="chevron-right" size={17} />
          </Link>
        </section>
      </div>
    </>
  );
}
