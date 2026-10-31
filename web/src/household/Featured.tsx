import { useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Link } from "react-router-dom";
import Icon from "../components/Icon";
import type { MovieDetail, TVDetail } from "../api";
import type { HouseholdTitle } from "./api";
import { titleLink } from "./utils";
import { titleMetadata } from "./titleMetadata";
import { TrailerVideo } from "./Trailer";

export default function Featured({ titles, userId }: { titles: HouseholdTitle[]; userId: number }) {
  const choices = useMemo(() => [...new Map(titles.filter(t => t.backdropUrl).map(t => [`${t.kind}:${t.tmdbId}`, t])).values()].slice(0, 5), [titles]);
  const storage = `household-featured:${userId}`;
  const root = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState(() => {
    let recent: string[] = [];
    try { const value: unknown = JSON.parse(localStorage.getItem(storage) || "[]"); if (Array.isArray(value)) recent = value.filter((v): v is string => typeof v === "string"); } catch { /* Storage is optional. */ }
    const unseen = choices.filter(t => !recent.includes(`${t.kind}:${t.tmdbId}`));
    const pool = unseen.length ? unseen : choices.filter(t => `${t.kind}:${t.tmdbId}` !== recent.at(-1));
    return (pool.length ? pool : choices)[Math.floor(Math.random() * (pool.length || choices.length))];
  });
  const index = Math.max(0, choices.findIndex(t => t.tmdbId === selected?.tmdbId && t.kind === selected.kind));
  const title = choices[index];
  if (!title) return null;
  return <section ref={root} className="hh-hero hh-discovery-hero" aria-label="Featured titles" aria-roledescription="carousel" data-tv-row="hero" data-feature-index={index}>
    <FeatureContent key={`${title.kind}:${title.tmdbId}`} title={title} userId={userId} root={root} />
    {choices.length > 1 && <nav className="hh-feature-picker" aria-label="Featured titles" data-tv-row="featured-titles">
      <button className="hh-feature-arrow" aria-label="Previous featured title" onClick={() => setSelected(choices[(index + choices.length - 1) % choices.length])}><Icon name="chevron-left" size={20} /></button>
      {choices.map((choice, i) => <Link key={`${choice.kind}:${choice.tmdbId}`} className="hh-feature-choice" data-tv-card={`${choice.kind}:${choice.tmdbId}`} aria-current={i === index ? "true" : undefined} aria-label={`Open ${choice.title}`} to={titleLink(choice.kind, choice.tmdbId)} state={{ title: choice }} onFocus={() => setSelected(choice)}><span>{choice.title}</span></Link>)}
      <button className="hh-feature-arrow" aria-label="Next featured title" onClick={() => setSelected(choices[(index + 1) % choices.length])}><Icon name="chevron-right" size={20} /></button>
    </nav>}
  </section>;
}
function FeatureContent({ title, userId, root }: { title: HouseholdTitle; userId: number; root: RefObject<HTMLElement | null> }) {
  const { kind, tmdbId } = title;
  const storage = `household-featured:${userId}`;
  const [detail, setDetail] = useState<MovieDetail | TVDetail | null>(null);
  const [preview, setPreview] = useState(false);
  const [previewStopped, setPreviewStopped] = useState(false);
  useEffect(() => {
    let live = true;
    void titleMetadata(userId, kind, tmdbId).then(d => { if (live) setDetail(d); }).catch(() => {});
    try {
      const recent: string[] = JSON.parse(localStorage.getItem(storage) || "[]");
      localStorage.setItem(storage, JSON.stringify([...recent.filter(k => k !== `${kind}:${tmdbId}`), `${kind}:${tmdbId}`].slice(-12)));
    } catch { /* Storage is optional. */ }
    return () => { live = false; };
  }, [kind, tmdbId, userId, storage]);
  useEffect(() => {
    const el = root.current;
    if (!el || previewStopped || !detail?.trailers?.length) return;
    let timer = 0;
    let inView = false;
    const update = () => {
      window.clearTimeout(timer); setPreview(false);
      if (inView && !document.hidden && !matchMedia("(prefers-reduced-motion: reduce)").matches)
        timer = window.setTimeout(() => setPreview(true), 1800);
    };
    const observer = new IntersectionObserver(([entry]) => { inView = entry.intersectionRatio > .7; update(); }, { threshold: [.7] });
    observer.observe(el); document.addEventListener("visibilitychange", update);
    return () => { observer.disconnect(); window.clearTimeout(timer); document.removeEventListener("visibilitychange", update); };
  }, [detail, previewStopped, root]);
  const trailer = detail?.trailers?.find(v => v.site === "YouTube");
  return <>
    <img className="hh-hero-image" src={title.backdropUrl} alt="" fetchPriority="high" decoding="async" />
    {preview && !previewStopped && trailer && <TrailerVideo key={trailer.key} video={trailer} preview onUnavailable={() => setPreviewStopped(true)} onEnded={() => setPreviewStopped(true)} />}
    <div className="hh-hero-shade" />
    <div className="hh-hero-copy">
      <h1>{title.title}</h1>
      <p className="hh-hero-meta"><span>{title.year || ""}</span><span>{title.kind === "tv" ? "Series" : "Film"}</span>{title.genres?.slice(0, 2).map(g => <span key={g}>{g}</span>)}</p>
      {title.overview && <p className="hh-hero-overview">{title.overview}</p>}
      <div className="hh-actions">
        <Link className="hh-button hh-primary hh-feature-open" to={titleLink(kind, tmdbId)} state={{ title }}>Open {kind === "tv" ? "series" : "film"}<Icon name="chevron-right" size={20} /></Link>
        {trailer && <button className="hh-button hh-glass hh-preview-toggle" aria-label={previewStopped ? "Play preview" : "Stop preview"} onClick={() => { setPreview(false); setPreviewStopped(v => !v); }}><Icon name={previewStopped ? "play" : "pause"} size={18} /></button>}
      </div>
    </div>
  </>;
}
