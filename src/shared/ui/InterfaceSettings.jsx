/* NEW-1 / NEW-4 — the INTERFACE section of Settings: preferences about the APP, not about a
 * DRAWING. Display theme and smooth zoom both follow the DEVICE across every plan and every
 * project, which is precisely what makes them settings rather than View-menu toggles.
 *
 * ONE component, rendered in both places Settings is reachable, so the two can never disagree:
 *   • signed IN  — the account panel's Settings → Interface section (AuthPanel);
 *   • signed OUT — the row-1 gear popover (AppHeader), preserving B342's "reachable signed-out".
 *
 * ⛔ There is no second copy of the smooth-zoom switch anywhere. It was removed from the View ▾
 * menu in the same commit that added it here (owner: "DO NOT LEAVE IT IN BOTH PLACES — one home"),
 * and test/smoothZoomHome.test.js counts the occurrences in both directions so a merge that keeps
 * both sides goes red.
 *
 * The state lives in shared/prefs/smoothZoom.js, not here: the planner has to react to a change
 * made from a modal it does not own. This component reads and writes; it decides nothing.
 */
import { useEffect, useState } from "react";
import ThemePicker from "../theme/ThemePicker.jsx";
import { readSmoothZoom, writeSmoothZoom, subscribeSmoothZoom } from "../prefs/smoothZoom.js";

// NEW-2 (B915536) — LITERAL duplicates of designTokens.js's FONT_SIZE steps, not an import: this
// file is in the shared ENTRY chunk (AppHeader.jsx's signed-out gear renders it), and importing
// designTokens.js for the sake of a couple of values measurably ate the route budget —
// bundle.notesRouteJsBytes went from 0.5 KB to 0.2 KB of headroom. Same reasoning as controls.jsx's
// own RADIUS/FONT/PAD literal-duplicate note. Keep in sync by hand.
const FONT_LABEL = 10.5; // design-exempt: literal duplicate of FONT_SIZE.label — see the comment above
const FONT_CONTROL = 12; // design-exempt: literal duplicate of FONT_SIZE.control — see the comment above

const heading = {
  fontSize: FONT_LABEL, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
  color: "var(--text-tertiary)", padding: "0 0 6px",
};

export default function InterfaceSettings() {
  const [smooth, setSmooth] = useState(readSmoothZoom);
  // Another surface (the other Settings home, or another tab on this device) may change it while
  // this one is open — mirror it rather than showing a stale checkbox.
  useEffect(() => subscribeSmoothZoom(setSmooth), []);
  return (
    <div data-interface-settings>
      <ThemePicker />
      <div style={{ height: 1, background: "var(--border-default)", margin: "14px 0 12px" }} />
      <div style={heading}>Zoom</div>
      <label
        data-testid="smooth-zoom-toggle"
        style={{ display: "flex", gap: 9, alignItems: "flex-start", cursor: "pointer", padding: "2px 0" }}
        title="Zoom scales the drawing as one piece while the wheel is turning, then re-draws it sharp the moment you stop. Turn off to re-draw on every notch instead."
      >
        <input
          type="checkbox"
          checked={!!smooth}
          onChange={(e) => setSmooth(writeSmoothZoom(e.target.checked))}
          // NEW-2 (B915536) — inert (a checkbox renders no text glyph), on-scale anyway.
          style={{ marginTop: 2, flex: "none", fontSize: FONT_CONTROL }}
        />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: "block", fontSize: FONT_CONTROL, fontWeight: 600, color: "var(--text-primary)" }}>Smooth zoom</span>
          <span style={{ display: "block", fontSize: FONT_LABEL, color: "var(--text-secondary)", lineHeight: 1.4 }}>
            Scales the drawing while the wheel turns, then redraws it sharp when you stop.
          </span>
        </span>
      </label>
    </div>
  );
}
