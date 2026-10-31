import { useEffect, useRef, useState } from "react";
import { errorText } from "./utils";

// One request at a time, only while visible. A refresh failure keeps the last
// successful view and exposes the error rather than replacing real data.
export function usePoll<T>(
  load: () => Promise<T>,
  interval = 5000,
  enabled = true,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const fn = useRef(load);
  useEffect(() => {
    fn.current = load;
  }, [load]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      if (!live || busy || document.visibilityState === "hidden") return;
      busy = true;
      clearTimeout(timer);
      try {
        const answer = await fn.current();
        if (live) {
          setData(answer);
          setError("");
        }
      } catch (e) {
        if (live) setError(errorText(e));
      } finally {
        busy = false;
        if (live) {
          setLoading(false);
          if (interval > 0) timer = setTimeout(() => void run(), interval);
        }
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void run();
      else clearTimeout(timer);
    };
    void run();
    document.addEventListener("visibilitychange", visible);
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [interval, enabled, revision]);
  return {
    data,
    error,
    loading: enabled && loading,
    refresh: () => setRevision((r) => r + 1),
  };
}
