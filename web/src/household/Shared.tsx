import { useRef, type ReactNode } from "react";
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
}: {
  title: HouseholdTitle;
  eager?: boolean;
}) {
  return (
    <Link
      className="hh-title-card"
      to={titleLink(title.kind, title.tmdbId)}
      state={{ title }}
    >
      <Artwork title={title} eager={eager} />
      {title.progress && title.progress.duration > 0 && (
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
          {title.available && (
            <span className="hh-ready">
              <Icon name="play" size={11} /> Ready to play
            </span>
          )}
        </p>
      </div>
    </Link>
  );
}
export function Rail({
  title,
  items,
  eager = false,
}: {
  title: string;
  items: HouseholdTitle[];
  eager?: boolean;
}) {
  const rail = useRef<HTMLDivElement>(null);
  if (items.length === 0) return null;
  const move = (direction: number) =>
    rail.current?.scrollBy({
      left: direction * rail.current.clientWidth * 0.82,
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  return (
    <section className="hh-rail" aria-label={title}>
      <div className="hh-section-head">
        <h2>{title}</h2>
        <div className="hh-rail-buttons">
          <button
            className="hh-round"
            aria-label={`Previous titles in ${title}`}
            onClick={() => move(-1)}
          >
            <Icon name="chevron-left" size={19} />
          </button>
          <button
            className="hh-round"
            aria-label={`More titles in ${title}`}
            onClick={() => move(1)}
          >
            <Icon name="chevron-right" size={19} />
          </button>
        </div>
      </div>
      <div className="hh-rail-track" ref={rail}>
        {items.map((t, i) => (
          <TitleCard
            key={`${t.kind}:${t.tmdbId}`}
            title={t}
            eager={eager && i < 4}
          />
        ))}
      </div>
    </section>
  );
}
