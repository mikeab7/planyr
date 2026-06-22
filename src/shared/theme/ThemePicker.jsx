/* Light / Dark / System display-theme picker (B389).
 *
 * The single home for the theme control, used by:
 *   • the signed-IN account Settings panel (AuthPanel → Settings tab) — the primary home;
 *   • the signed-OUT top-bar gear (AppHeader), so a logged-out visitor can still switch
 *     (preserves B342's "reachable signed-out" without duplicating it when signed in).
 *
 * Self-contained: reads/sets the ThemeProvider via useTheme, whose matchMedia "System"
 * listener is independent of where this mounts. Uses theme tokens (no raw hex), so it
 * reads correctly on whatever surface it sits on, in either theme. (B317/B342)
 */
import { useTheme } from "./ThemeProvider.jsx";

const THEME_OPTS = [
  { id: "light",  label: "Light",  hint: "Always light",        icon: <><circle cx="8" cy="8" r="3.1" /><path d="M8 1.6v1.5M8 12.9v1.5M1.6 8h1.5M12.9 8h1.5M3.5 3.5l1 1M11.5 11.5l1 1M12.5 3.5l-1 1M4.5 11.5l-1 1" /></> },
  { id: "dark",   label: "Dark",   hint: "Always dark",         icon: <path d="M13 9.4A5.2 5.2 0 0 1 6.6 3 5.2 5.2 0 1 0 13 9.4Z" /> },
  { id: "system", label: "System", hint: "Match your computer", icon: <><rect x="2" y="3" width="12" height="8" rx="1" /><path d="M6 13.4h4M8 11.4v2" /></> },
];

export default function ThemePicker({ heading = true }) {
  const { mode, setMode } = useTheme();
  return (
    <div data-theme-picker>
      {heading && (
        <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)", padding: "0 0 6px" }}>
          Display theme
        </div>
      )}
      {THEME_OPTS.map((o) => {
        const on = mode === o.id;
        return (
          <button
            key={o.id}
            onClick={() => setMode(o.id)}
            aria-pressed={on}
            data-theme-opt={o.id}
            style={{
              display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
              padding: "8px 9px", borderRadius: 7, border: "none", cursor: "pointer",
              fontFamily: "inherit", background: on ? "var(--hover-ghost)" : "transparent", color: "var(--text-primary)",
            }}
            onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "var(--hover-ghost)"; }}
            onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
              {o.icon}
            </svg>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: 12.5, fontWeight: on ? 700 : 500 }}>{o.label}</span>
              <span style={{ display: "block", fontSize: 11, color: "var(--text-secondary)" }}>{o.hint}</span>
            </span>
            {on && <span aria-hidden style={{ color: "var(--accent)", fontWeight: 800, fontSize: 13 }}>✓</span>}
          </button>
        );
      })}
    </div>
  );
}
