import { useEffect, useState } from "react";
import { api } from "../api";
import { household, type Preferences } from "./api";
import { Loading, Problem } from "./Shared";
import { errorText } from "./utils";
import { invalidateHome } from "./cache";
import Icon from "../components/Icon";

const LANGUAGES = [
  ["en", "English"],
  ["fr", "French"],
  ["de", "German"],
  ["es", "Spanish"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Mandarin"],
  ["cn", "Cantonese"],
  ["hi", "Hindi"],
  ["ta", "Tamil"],
  ["te", "Telugu"],
  ["sv", "Swedish"],
  ["da", "Danish"],
  ["no", "Norwegian"],
  ["tr", "Turkish"],
  ["ar", "Arabic"],
];
export default function HouseholdPreferences() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [genres, setGenres] = useState<{ id: number; name: string }[]>([]);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let live = true;
    void household
      .preferences()
      .then((p) => {
        if (live) {
          setPrefs(p);
          setError("");
        }
      })
      .catch((e) => {
        if (live) setError(errorText(e));
      });
    void Promise.all([api.discoverGenres("movie"), api.discoverGenres("tv")])
      .then(([a, b]) => {
        if (live)
          setGenres(
            [...new Map([...a, ...b].map((g) => [g.id, g])).values()].sort(
              (a, b) => a.name.localeCompare(b.name),
            ),
          );
      })
      .catch(() => {
        /* Language and rating choices still work without genre metadata. */
      });
    return () => {
      live = false;
    };
  }, [revision]);
  const update = (patch: Partial<Preferences>) => {
    setPrefs((p) => (p ? { ...p, ...patch } : p));
    setSaved(false);
  };
  const toggle = <T,>(a: T[], v: T) =>
    a.includes(v) ? a.filter((x) => x !== v) : [...a, v];
  const save = async () => {
    if (!prefs) return;
    if (prefs.languages.length < 1 || prefs.languages.length > 4) {
      setError("Choose between one and four original languages.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      // Do not overwrite a watchlist or feedback saved in another tab.
      const latest = await household.preferences();
      const p = await household.savePreferences({
        ...latest,
        languages: prefs.languages,
        includeOtherLanguages: prefs.includeOtherLanguages,
        minRating: prefs.minRating,
        preferredGenres: prefs.preferredGenres,
        blockedGenres: prefs.blockedGenres,
      });
      setPrefs(p);
      setSaved(true);
      invalidateHome();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  const resetFeedback = async (key: "hidden" | "liked") => {
    setSaving(true);
    setError("");
    try {
      const latest = await household.preferences();
      const p = await household.savePreferences({ ...latest, [key]: [] });
      setPrefs((prev) => (prev ? { ...prev, [key]: p[key] } : p));
      invalidateHome();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="hh-page hh-preferences">
      <div className="hh-page-heading">
        <p className="hh-eyebrow">A better starting point</p>
        <h1>Your taste</h1>
        <p>
          Recommendations should suit you. These choices shape discovery; they
          never hide your library or limit a search.
        </p>
      </div>
      {error && (
        <Problem
          message={error}
          retry={!prefs ? () => setRevision((n) => n + 1) : undefined}
        />
      )}
      {!prefs ? (
        !error && <Loading />
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <section className="hh-preference-section">
            <div>
              <h2>Original languages</h2>
              <p>Choose up to four languages you like to watch.</p>
            </div>
            <div className="hh-preference-controls">
              <div className="hh-choice-grid">
                {LANGUAGES.map(([code, label]) => (
                  <label key={code} className="hh-choice">
                    <input
                      type="checkbox"
                      checked={prefs.languages.includes(code)}
                      disabled={
                        !prefs.languages.includes(code) &&
                        prefs.languages.length >= 4
                      }
                      onChange={() =>
                        update({ languages: toggle(prefs.languages, code) })
                      }
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <label className="hh-switch-row">
                <input
                  type="checkbox"
                  checked={prefs.includeOtherLanguages}
                  onChange={(e) =>
                    update({ includeOtherLanguages: e.target.checked })
                  }
                />
                <span>Include discoveries in other languages</span>
              </label>
            </div>
          </section>
          <section className="hh-preference-section">
            <div>
              <h2>Quality over hype</h2>
              <p>
                Popularity is only one signal. Audience ratings are balanced
                against the number of votes so a handful of perfect scores
                cannot dominate.
              </p>
            </div>
            <div className="hh-preference-controls">
              <label className="hh-range-label" htmlFor="minimum-rating">
                Minimum audience rating{" "}
                <output>{prefs.minRating.toFixed(1)} / 10</output>
              </label>
              <input
                id="minimum-rating"
                className="hh-range"
                type="range"
                min="0"
                max="9"
                step=".5"
                value={prefs.minRating}
                onChange={(e) => update({ minRating: Number(e.target.value) })}
              />
              <p className="hh-muted">
                A higher threshold produces a smaller, more selective catalogue.
              </p>
            </div>
          </section>
          <section className="hh-preference-section">
            <div>
              <h2>More of this</h2>
              <p>
                Genres to give extra weight. Leave these empty for a balanced
                mix.
              </p>
            </div>
            <div className="hh-preference-controls">
              <div className="hh-chip-options">
                {genres.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={prefs.preferredGenres.includes(g.id)}
                    className={
                      prefs.preferredGenres.includes(g.id) ? "selected" : ""
                    }
                    onClick={() =>
                      update({
                        preferredGenres: toggle(prefs.preferredGenres, g.id),
                        blockedGenres: prefs.blockedGenres.filter(
                          (id) => id !== g.id,
                        ),
                      })
                    }
                  >
                    {g.name}
                  </button>
                ))}
              </div>
              {!genres.length && (
                <p className="hh-muted">
                  Genre choices will appear when the catalogue is available.
                </p>
              )}
            </div>
          </section>
          <section className="hh-preference-section">
            <div>
              <h2>Leave these out</h2>
              <p>Keep these genres off your recommendation rails.</p>
            </div>
            <div className="hh-preference-controls">
              <div className="hh-chip-options">
                {genres.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    aria-pressed={prefs.blockedGenres.includes(g.id)}
                    className={
                      prefs.blockedGenres.includes(g.id) ? "selected" : ""
                    }
                    onClick={() =>
                      update({
                        blockedGenres: toggle(prefs.blockedGenres, g.id),
                        preferredGenres: prefs.preferredGenres.filter(
                          (id) => id !== g.id,
                        ),
                      })
                    }
                  >
                    {g.name}
                  </button>
                ))}
              </div>
            </div>
          </section>
          <section className="hh-preference-section">
            <div>
              <h2>Your feedback</h2>
              <p>
                Like a title to shape future picks. “Not for me” removes it from
                recommendations.
              </p>
            </div>
            <div className="hh-preference-controls hh-feedback-summary">
              <span>{prefs.liked.length} liked titles</span>
              {prefs.liked.length > 0 && (
                <button
                  type="button"
                  className="hh-text-button"
                  disabled={saving}
                  onClick={() => void resetFeedback("liked")}
                >
                  Clear likes
                </button>
              )}
              <span>{prefs.hidden.length} hidden titles</span>
              {prefs.hidden.length > 0 && (
                <button
                  type="button"
                  className="hh-text-button"
                  disabled={saving}
                  onClick={() => void resetFeedback("hidden")}
                >
                  Show hidden titles again
                </button>
              )}
            </div>
          </section>
          <div className="hh-save-bar">
            <p role="status">
              {saved ? (
                <>
                  <Icon name="check" size={17} /> Preferences saved
                </>
              ) : (
                "Saved to your account, across your devices."
              )}
            </p>
            <button
              type="submit"
              className="hh-button hh-primary"
              disabled={saving}
            >
              {saving ? "Saving…" : "Save preferences"}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
