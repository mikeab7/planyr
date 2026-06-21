/* ThemeProvider — light / dark / system theming foundation (B317).
 *
 * - mode: the user's CHOICE — "light" | "dark" | "system" (default "system").
 * - resolved: the ACTIVE theme — "light" | "dark" (System resolves via the OS).
 * - Persists the choice in localStorage["planyr.theme"] (source of truth on load).
 * - Drives `data-theme` on <html>; the inline pre-paint script in index.html sets
 *   it before first paint (no flash), and this keeps it in step thereafter.
 * - System mode live-updates when the OS flips (matchMedia change listener).
 *
 * Components read theme via the CSS tokens (var(--…)); the drafting canvas reads the
 * JS palette via usePalette() (real hexes — see palette.js for why).
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { paletteFor } from "./palette.js";

const KEY = "planyr.theme";
const ThemeCtx = createContext(null);

const mql = () => window.matchMedia("(prefers-color-scheme: dark)");
function systemPrefersDark() {
  try { return mql().matches; } catch { return false; }
}
function readStoredMode() {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* private mode / disabled storage */ }
  return "system";
}
const resolveMode = (mode) => (mode === "system" ? (systemPrefersDark() ? "dark" : "light") : mode);

function applyResolved(resolved) {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.theme = resolved;
  // Keep the mobile browser UI bar in step with the chrome color.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", resolved === "dark" ? "#111319" : "#EAEEF3");
}

export function ThemeProvider({ children }) {
  const [mode, setModeState] = useState(readStoredMode);
  const [resolved, setResolved] = useState(() => resolveMode(readStoredMode()));

  // Reflect the resolved theme onto <html>.
  useEffect(() => { applyResolved(resolved); }, [resolved]);

  // Recompute the resolved theme when the chosen mode changes.
  useEffect(() => { setResolved(resolveMode(mode)); }, [mode]);

  // While following the system, react to the OS flipping light/dark mid-session.
  useEffect(() => {
    if (mode !== "system") return;
    const m = mql();
    const onChange = () => setResolved(systemPrefersDark() ? "dark" : "light");
    if (m.addEventListener) m.addEventListener("change", onChange);
    else if (m.addListener) m.addListener(onChange); // older Safari
    return () => {
      if (m.removeEventListener) m.removeEventListener("change", onChange);
      else if (m.removeListener) m.removeListener(onChange);
    };
  }, [mode]);

  const setMode = useCallback((next) => {
    setModeState(next);
    try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  }, []);

  return (
    <ThemeCtx.Provider value={{ mode, resolved, setMode }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeCtx) || { mode: "system", resolved: "light", setMode: () => {} };
}

// The active theme's color palette as real hexes — for the SVG canvas + export.
export function usePalette() {
  return paletteFor(useTheme().resolved);
}
