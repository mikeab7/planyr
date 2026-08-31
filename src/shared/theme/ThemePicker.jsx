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
import { RADIUS } from "../ui/radius.js";

// NEW-2 (B915536) — LITERAL duplicates of designTokens.js's FONT_SIZE steps, not an import: this
// file is in the shared ENTRY chunk (reached via AppHeader.jsx's signed-out gear), and importing
// designTokens.js for the sake of a few values measurably ate the route budget —
// bundle.notesRouteJsBytes went from 0.5 KB to 0.2 KB of headroom. Same reasoning as controls.jsx's
// own RADIUS/FONT/PAD literal-duplicate note. Keep in sync by hand.
const FONT_LABEL = 10.5; // design-exempt: literal duplicate of FONT_SIZE.label — see the comment above
const FONT_CONTROL = 12; // design-exempt: literal duplicate of FONT_SIZE.control — see the comment above
const FONT_EMPHASIS = 13; // design-exempt: literal duplicate of FONT_SIZE.emphasis — see the comment above

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
        <div style={{ fontSize: FONT_LABEL, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-tertiary)", padding: "0 0 6px" }}>
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
              padding: "8px 9px", borderRadius: RADIUS.sm, border: "none", cursor: "pointer", // NEW-3 — was a raw 7 (off-scale); a row nested inside its RADIUS.lg menu panel is RADIUS.sm per the nesting rule
              fontFamily: "inherit", background: on ? "var(--hover-ghost)" : "transparent", color: "var(--text-primary)",
              // NEW-2 (B915536) — the row itself has no text of its own (every child below sets
              // its own size), so this was inert scaffolding falling through to the UA default.
              fontSize: FONT_CONTROL,
            }}
            onMouseEnter={(e) => { if (!on) e.currentTarget.style.background = "var(--hover-ghost)"; }}
            onMouseLeave={(e) => { if (!on) e.currentTarget.style.background = "transparent"; }}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor"
              strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ flex: "none" }}>
              {o.icon}
            </svg>
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontSize: FONT_CONTROL, fontWeight: on ? 700 : 500 }}>{o.label}</span>
              <span style={{ display: "block", fontSize: FONT_LABEL, color: "var(--text-secondary)" }}>{o.hint}</span>
            </span>
            {on && <span aria-hidden style={{ color: "var(--accent)", fontWeight: 800, fontSize: FONT_EMPHASIS }}>✓</span>}
          </button>
        );
      })}
    </div>
  );
}
