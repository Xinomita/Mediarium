import { useState } from "react";
import { Link } from "react-router-dom";
import { household, type HouseholdTitle } from "./api";
import { Empty, Loading, Problem, TitleCard } from "./Shared";
import { usePoll } from "./usePoll";

export default function HouseholdLibrary({
  watchlist = false,
}: {
  watchlist?: boolean;
}) {
  const [kind, setKind] = useState("all");
  const [filter, setFilter] = useState("");
  const state = usePoll(async (): Promise<HouseholdTitle[]> => {
    if (watchlist)
      return (
        (await household.home()).rails.find((r) => r.id === "watchlist")
          ?.items || []
      );
    return (await household.library()).sort(
      (a, b) =>
        Number(b.available) - Number(a.available) ||
        a.title.localeCompare(b.title),
    );
  }, 30000);
  const shown = (state.data || []).filter(
    (t) =>
      (kind === "all" || t.kind === kind) &&
      t.title.toLocaleLowerCase().includes(filter.toLocaleLowerCase()),
  );
  return (
    <div className="hh-page">
      <div className="hh-page-heading">
        <p className="hh-eyebrow">
          {watchlist ? "For another night" : "On your server"}
        </p>
        <h1>{watchlist ? "My list" : "Your library"}</h1>
        <p>
          {watchlist
            ? "The films and series you want to come back to."
            : "Ready to watch, and the titles you’re collecting."}
        </p>
      </div>
      <div className="hh-library-tools">
        <div className="hh-segments" aria-label="Library type">
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
        <div className="hh-filter">
          <label htmlFor="library-filter">Filter titles</label>
          <input
            id="library-filter"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Title"
          />
        </div>
      </div>
      {state.error && <Problem message={state.error} retry={state.refresh} />}
      {state.loading ? (
        <Loading />
      ) : shown.length ? (
        <div className="hh-title-grid">
          {shown.map((t) => (
            <TitleCard key={t.kind + t.tmdbId} title={t} />
          ))}
        </div>
      ) : (
        !state.error && (
          <Empty
            title={
              filter
                ? "No matching titles"
                : watchlist
                  ? "Keep the good ones for later."
                  : "Nothing in your library yet."
            }
          >
            <Link to="/watch/search">
              {watchlist
                ? "Find something to save"
                : "Find a film or series to download"}
            </Link>
          </Empty>
        )
      )}
    </div>
  );
}
