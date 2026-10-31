import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import type { HouseholdTitle } from "./api";
import { titleLink, clampProgress } from "./utils";

export function Problem({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="hh-problem" role="alert">
      <Icon name="warning" size={19} />
      <span>{message}</span>
      {retry && <button onClick={retry}>Try again</button>}
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="hh-empty">
      <Icon name="film" size={34} />
      <h2>{title}</h2>
      {children && <p>{children}</p>}
    </div>
  );
}
export function Loading({ hero = false }: { hero?: boolean }) {
  return (
    <div className="hh-loading" role="status" aria-label="Loading">
      {hero && <div className="hh-skeleton hh-skeleton-hero" />}
      <div className="hh-skeleton hh-skeleton-heading" />
      <div className="hh-loading-cards">
        {[0, 1, 2, 3].map((i) => (
          <div className="hh-skeleton" key={i} />
        ))}
      </div>
    </div>
  );
}
export function Artwork({
  title,
  wide = true,
  eager = false,
}: {
  title: HouseholdTitle;
  wide?: boolean;
  eager?: boolean;
}) {
  const url = wide
    ? title.backdropUrl || title.posterUrl
    : title.posterUrl || title.backdropUrl;
  return (
    <div
      className={`hh-art ${wide ? "hh-art-wide" : "hh-art-poster"} ${wide && !title.backdropUrl ? "hh-art-fallback" : ""}`}
    >
      {url ? (
        <img
          src={url}
          alt=""
          loading={eager ? "eager" : "lazy"}
          decoding="async"
        />
      ) : (
        <span className="hh-art-placeholder">
          <Icon name={title.kind === "tv" ? "tv" : "film"} size={38} />
          <span>{title.title}</span>
        </span>
      )}
    </div>
  );
}
export function TitleCard({
  title,
  eager = false,
  discovery = false,
  poster = false,
}: {
  title: HouseholdTitle;
  eager?: boolean;
  discovery?: boolean;
  poster?: boolean;
}) {
  return (
    <Link
      className="hh-title-card"
      to={titleLink(title.kind, title.tmdbId)}
      state={{ title }}
    >
      <Artwork title={title} eager={eager} wide={!poster} />
      {!discovery && title.progress && title.progress.duration > 0 && (
        <div className="hh-card-progress">
          <span
            style={{
              width: `${clampProgress((title.progress.position / title.progress.duration) * 100)}%`,
            }}
          />
        </div>
      )}
      <div className="hh-card-copy">
        <h3>{title.title}</h3>
        <p>
          {title.year > 0 && <span>{title.year}</span>}
          <span>{title.kind === "tv" ? "Series" : "Film"}</span>
          {!discovery && title.available && (
            <span className="hh-ready">
              <Icon name="play" size={11} /> Ready to play
            </span>
          )}
        </p>
        {!!title.rating && <p className="hh-card-rating">TMDB audience <strong>{title.rating.toFixed(1)}</strong><span>/ 10</span></p>}
        {discovery && title.reason && <p className="hh-card-reason">{title.reason}</p>}
      </div>
    </Link>
  );
}
export function Rail({
  title, subtitle, items, eager = false, discovery = false, poster = false,
}: {
  title: string;
  subtitle?: string;
  items: HouseholdTitle[];
  eager?: boolean;
  discovery?: boolean;
  poster?: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  const trackId = useId();
  const [expanded, setExpanded] = useState(false);
  const [edges, setEdges] = useState({ start: true, end: true });
  useEffect(() => {
    const el = rail.current;
    if (!el || expanded) return;
    const measure = () => setEdges({ start: el.scrollLeft < 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
    measure();
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    el.addEventListener("scroll", measure, { passive: true });
    return () => { resize.disconnect(); el.removeEventListener("scroll", measure); };
  }, [expanded, items.length]);
  if (items.length === 0) return null;
  const move = (direction: number) => rail.current?.scrollBy({
    left: direction * rail.current.clientWidth * .82,
    behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
  });
  return <section className={`hh-rail ${poster ? "hh-poster-rail" : ""} ${expanded ? "hh-rail-expanded" : ""}`} aria-label={title}>
    <div className="hh-section-head">
      <div><h2>{title}</h2>{subtitle && <p className="hh-shelf-subtitle">{subtitle}</p>}</div>
      <div className="hh-rail-buttons">
        {discovery && <button className="hh-shelf-toggle" aria-expanded={expanded} aria-controls={trackId} aria-label={`${expanded ? "Collapse" : "See all"} ${title}`} onClick={() => setExpanded((v) => !v)}>{expanded ? "Show shelf" : "See all"}<span>{items.length}</span></button>}
        {!expanded && <><button className="hh-round" disabled={edges.start} aria-label={`Previous titles in ${title}`} aria-controls={trackId} onClick={() => move(-1)}><Icon name="chevron-left" size={19} /></button>
          <button className="hh-round" disabled={edges.end} aria-label={`More titles in ${title}`} aria-controls={trackId} onClick={() => move(1)}><Icon name="chevron-right" size={19} /></button></>}
      </div>
    </div>
    <div className={expanded ? "hh-title-grid hh-shelf-grid" : "hh-rail-track"} id={trackId} ref={rail} role="group" aria-label={`${title} titles`} tabIndex={expanded ? undefined : 0}>
      {items.map((t, i) => <TitleCard key={`${t.kind}:${t.tmdbId}`} title={t} eager={eager && i < 4} discovery={discovery} poster={poster} />)}
    </div>
  </section>;
}
