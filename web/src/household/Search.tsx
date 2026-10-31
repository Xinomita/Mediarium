import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api, type TitleResult } from "../api";
import Icon from "../components/Icon";
import { Empty, Loading, Problem, TitleCard } from "./Shared";
import { errorText, searchTitle } from "./utils";

export default function HouseholdSearch() {
  const [params, setParams] = useSearchParams();
  const tv = document.documentElement.dataset.tv === "true";
  const [numbers, setNumbers] = useState(false);
  const firstKey = useRef<HTMLButtonElement>(null);
  const [value, setValue] = useState(params.get("q") || "");
  const [results, setResults] = useState<TitleResult[]>([]);
  const [kind, setKind] = useState("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const q = params.get("q") || "";
  useEffect(() => {
    if (tv) firstKey.current?.focus();
    else input.current?.focus();
  }, [tv]);
  useEffect(() => {
    setValue(q);
  }, [q]);
  useEffect(() => {
    const timer = setTimeout(() => {
      if (value.trim() !== q)
        setParams(value.trim() ? { q: value.trim() } : {}, { replace: true });
    }, 300);
    return () => clearTimeout(timer);
  }, [value, q, setParams]);
  useEffect(() => {
    if (!q) {
      setResults([]);
      setLoading(false);
      setError("");
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    setError("");
    void api
      .discoverSearch(q, ctl.signal)
      .then(setResults)
      .catch((e) => {
        if (!ctl.signal.aborted) setError(errorText(e));
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [q, revision]);
  const shown = results.filter((t) => kind === "all" || t.kind === kind);
  return (
    <div className="hh-page hh-search-page">
      <div className="hh-page-heading">
        <h1>Find your next watch.</h1>
      </div>
      <form
        className="hh-search-form"
        onSubmit={(e) => {
          e.preventDefault();
          setParams(value.trim() ? { q: value.trim() } : {});
        }}
      >
        <label htmlFor="household-search">Search films and series</label>
        <div className="hh-search-field">
          <Icon name="search" size={24} />
          <input
            ref={input}
            id="household-search"
            type="search"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="A title, an old favourite…"
            autoComplete="off"
          />
        </div>
      </form>
      {tv && <div className="hh-tv-keyboard" aria-label="Search keyboard">
        <div className="hh-tv-letter-row">
          {(numbers ? "0123456789" : "ABCDEFGHIJKLMNOPQRSTUVWXYZ").split("").map((letter, index) => <button key={letter} ref={index === 0 ? firstKey : undefined} type="button" aria-label={letter} onClick={() => setValue(v => v + letter.toLowerCase())}>{letter}</button>)}
        </div>
        <div className="hh-tv-keyboard-actions">
          <button type="button" onClick={() => setNumbers(v => !v)}>{numbers ? "ABC" : "123"}</button>
          <button type="button" onClick={() => setValue(v => v + " ")}>Space</button>
          <button type="button" onClick={() => setValue(v => v.slice(0, -1))}>Delete</button>
          <button type="button" onClick={() => setValue("")}>Clear</button>
        </div>
      </div>}
      {q && (
        <div className="hh-segments" aria-label="Search result type">
          {[
            ["all", "All"],
            ["movie", "Films"],
            ["tv", "Series"],
          ].map(([k, label]) => (
            <button
              key={k}
              className={kind === k ? "active" : ""}
              aria-pressed={kind === k}
              onClick={() => setKind(k)}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {error && (
        <Problem message={error} retry={() => setRevision((n) => n + 1)} />
      )}
      {loading ? (
        <Loading />
      ) : q ? (
        shown.length ? (
          <>
            <p className="hh-results-label">
              {shown.length} {shown.length === 1 ? "result" : "results"} for “
              {q}”
            </p>
            <div className="hh-title-grid">
              {shown.map((t) => (
                <TitleCard key={t.kind + t.tmdbId} title={searchTitle(t)} />
              ))}
            </div>
          </>
        ) : (
          !error && (
            <Empty title="No matching titles">
              Try a different title or spelling. Search includes every language.
            </Empty>
          )
        )
      ) : (
        <div className="hh-search-welcome">
          <p>Search the whole catalogue, in any language.</p>
          <Link to="/watch" className="hh-button hh-secondary">
            Browse your recommendations
            <Icon name="chevron-right" size={17} />
          </Link>
        </div>
      )}
    </div>
  );
}
