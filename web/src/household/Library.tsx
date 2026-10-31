import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../AuthContext";
import { household, type HouseholdTitle } from "./api";
import { Empty, Loading, Problem, Rail, TitleCard } from "./Shared";
import { usePoll } from "./usePoll";
import { continueWatching } from "./discovery";

export default function HouseholdLibrary({
  watchlist = false,
}: {
  watchlist?: boolean;
}) {
  const { user } = useAuth();
  return <LibraryView key={`${user?.id ?? "anonymous"}:${watchlist ? "list" : "library"}`} watchlist={watchlist} />;
}

function LibraryView({ watchlist }: { watchlist: boolean }) {
  const [kind, setKind] = useState("all");
  const [filter, setFilter] = useState("");
  const state = usePoll(async (): Promise<{ items: HouseholdTitle[]; partial: boolean }> => {
    if (watchlist) return household.watchlist();
    return { items: (await household.library()).sort(
      (a, b) =>
        Number(b.available) - Number(a.available) ||
        a.title.localeCompare(b.title),
    ), partial: false };
  }, 30000);
  const shown = (state.data?.items || []).filter(
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
      {!watchlist && !state.loading && <Rail title="Continue watching" items={continueWatching(shown)} />}
      {!watchlist && shown.length > 0 && <h2 className="hh-library-all">All titles</h2>}
      {state.data?.partial && <Problem message="Some saved titles could not load. Your list is still saved." retry={state.refresh} />}
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
