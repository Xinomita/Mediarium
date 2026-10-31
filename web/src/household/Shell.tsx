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
          Mediarium
        </Link>
        <nav className="hh-nav" aria-label="Main navigation">
          <Link className={home && !kind ? "active" : ""} to="/watch">
            Watch now
          </Link>
          <Link
            className={home && kind === "movie" ? "active" : ""}
            to="/watch?kind=movie"
          >
            Films
          </Link>
          <Link
            className={home && kind === "tv" ? "active" : ""}
            to="/watch?kind=tv"
          >
            Series
          </Link>
          <NavLink to="/watch/library">Library</NavLink>
          <NavLink to="/watch/list">My list</NavLink>
        </nav>
        <div className="hh-nav-actions">
          <NavLink
            className="hh-nav-icon"
            to="/watch/search"
            aria-label="Search movies and series"
          >
            <Icon name="search" size={20} />
          </NavLink>
          <NavLink
            className="hh-nav-icon hh-download-link"
            to="/watch/downloads"
            aria-label={`Downloads${queue.data?.active ? `, ${queue.data.active} active` : ""}`}
          >
            <Icon name="download" size={20} />
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
        <span>Mediarium · Your home cinema</span>
        <Link to="/watch/preferences">Your taste</Link>
        <a
          href="https://github.com/Xinomita/Mediarium/tree/codex/household"
          target="_blank"
          rel="noreferrer"
        >
          Source code
        </a>
        <a href="https://www.themoviedb.org" target="_blank" rel="noreferrer">
          Film & TV data by TMDB
        </a>
      </footer>
    </div>
  );
}
