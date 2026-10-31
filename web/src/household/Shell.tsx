import { useEffect, useState } from "react";
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { api, isAdmin } from "../api";
import { useAuth } from "../AuthContext";
import Icon from "../components/Icon";
import { usePoll } from "./usePoll";
import { errorText } from "./utils";
import "./household.css";
import "./tv.css";

export default function HouseholdShell() {
  const { user, setUser } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const queue = usePoll(api.queueCount, 5000);
  const name = user?.name || user?.username || "Account";
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase();
  useEffect(() => {
    const before = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = "dark";
    document.body.classList.add("household-body");
    return () => {
      document.documentElement.dataset.theme = before;
      document.body.classList.remove("household-body");
    };
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0 });
    document.title = "Mediarium";
  }, [location.pathname, location.search]);
  useEffect(() => {
    const back = () => {
      if (Number(window.history.state?.idx) > 0) navigate(-1);
      else navigate("/watch");
    };
    document.addEventListener("tv-navigate-back", back);
    return () => document.removeEventListener("tv-navigate-back", back);
  }, [navigate]);
  const signOut = async () => {
    try {
      await api.logout();
      setUser(null);
      navigate("/watch", { replace: true });
    } catch (e) {
      setError(errorText(e));
    }
  };
  const kind = new URLSearchParams(location.search).get("kind");
  const home = location.pathname === "/watch";
  return (
    <div className="household">
      <a className="hh-skip" href="#household-main">
        Skip to content
      </a>
      <header className="hh-header">
        <Link to="/watch" className="hh-brand" aria-label="Mediarium home">
          <span className="hh-brand-mark">
            <Icon name="play" size={16} />
          </span>
          <span className="hh-brand-label">Mediarium</span>
        </Link>
        <nav className="hh-nav" aria-label="Main navigation">
          <Link className={home && !kind ? "active" : ""} to="/watch" aria-label="Discover" aria-current={home && !kind ? "page" : undefined}>
            <span className="hh-nav-symbol"><Icon name="compass" size={20} /></span><span className="hh-nav-label">Discover</span>
          </Link>
          <Link
            className={home && kind === "movie" ? "active" : ""}
            to="/watch?kind=movie"
            aria-label="Films"
            aria-current={home && kind === "movie" ? "page" : undefined}
          >
            <span className="hh-nav-symbol"><Icon name="film" size={20} /></span><span className="hh-nav-label">Films</span>
          </Link>
          <Link
            className={home && kind === "tv" ? "active" : ""}
            to="/watch?kind=tv"
            aria-label="Series"
            aria-current={home && kind === "tv" ? "page" : undefined}
          >
            <span className="hh-nav-symbol"><Icon name="tv" size={20} /></span><span className="hh-nav-label">Series</span>
          </Link>
          <NavLink to="/watch/library" aria-label="Library"><span className="hh-nav-symbol"><Icon name="grid" size={20} /></span><span className="hh-nav-label">Library</span></NavLink>
          <NavLink to="/watch/list" aria-label="My list"><span className="hh-nav-symbol"><Icon name="bookmark" size={20} /></span><span className="hh-nav-label">My list</span></NavLink>
        </nav>
        <div className="hh-nav-actions">
          <NavLink
            className="hh-nav-icon"
            to="/watch/search"
            aria-label="Search movies and series"
          >
            <Icon name="search" size={20} />
            <span className="hh-tv-label hh-nav-label">Search</span>
          </NavLink>
          <NavLink
            className="hh-nav-icon hh-download-link"
            to="/watch/downloads"
            aria-label={`Downloads${queue.data?.active ? `, ${queue.data.active} active` : ""}`}
          >
            <Icon name="download" size={20} />
            <span className="hh-tv-label hh-nav-label">Downloads</span>
            {!!queue.data?.active && (
              <span className="hh-count">{queue.data.active}</span>
            )}
          </NavLink>
          <details
            className="hh-account"
            key={location.pathname + location.search}
          >
            <summary aria-label={`Account: ${name}`}>
              <span className="hh-avatar">{initials}</span>
              <span className="hh-tv-label hh-nav-label">{name}</span>
            </summary>
            <div className="hh-account-menu">
              <strong>{name}</strong>
              <Link to="/watch/preferences">
                <Icon name="sliders" size={16} />
                Your taste
              </Link>
              <Link to="/settings/profile">
                <Icon name="shield" size={16} />
                Account settings
              </Link>
              {isAdmin(user) && (
                <Link to="/settings">
                  <Icon name="server" size={16} />
                  Manage server
                </Link>
              )}
              <button onClick={() => void signOut()}>
                <Icon name="logout" size={16} />
                Sign out
              </button>
              {error && <p role="alert">{error}</p>}
            </div>
          </details>
        </div>
      </header>
      <main id="household-main" tabIndex={-1}>
        <Outlet />
      </main>
      <footer className="hh-footer">
        <span>Mediarium</span>
        <Link to="/watch/preferences">Your taste</Link>
        <a
          href="https://github.com/Xinomita/Mediarium/tree/codex/household"
          target="_blank"
          rel="noreferrer"
        >
          Source code
        </a>
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
          Artwork & metadata · TMDB
        </a>
        <a href="https://data.imdb.com/non-commercial-datasets/" target="_blank" rel="noreferrer">Ratings · IMDb</a>
      </footer>
    </div>
  );
}
