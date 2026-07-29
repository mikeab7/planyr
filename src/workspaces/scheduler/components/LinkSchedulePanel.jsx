/* LinkSchedulePanel — the Schedule tab's EMPTY STATE for a project with no linked schedule.
 *
 * NEW-2 restructure: this is no longer a modal. A project with no linked schedule does not have a
 * decision pending — it has an empty Schedule tab, so this renders INSTEAD OF the embedded Gantt
 * (Scheduler.jsx hides the iframe while it applies), not as an overlay on top of it. That single
 * change removes the scrim, removes anything to dismiss — and with nothing to dismiss, NEW-1's
 * permanent strand (a dismissal that suppressed the ONLY create/link entry point for the rest of
 * the session) is impossible by construction. Pressing Dashboard clears the routed project, which
 * unmounts this and brings the iframe back; that is the only way out, and it always works.
 *
 * The surface is deliberately restrained: no scrim, no raised card, no border, no shadow — it sits
 * on the page surface. One headline, one muted line, ONE primary action, and progressive disclosure
 * for the rest. The picker is REVEALED on request rather than sitting there as an empty <select>
 * beside a disabled Link button, which is what a first-run screen must never show.
 *
 * Never auto-links (the owner's suggest-and-confirm rule): a same-named schedule is promoted to a
 * one-click action, everything else is an explicit pick.
 *
 * Theme tokens throughout for light/dark parity (owner rule B318); the scheduler accent is spent on
 * the primary action only. B560 defence kept: `label` falls back to a neutral phrase and Create is
 * disabled when the site name hasn't resolved, so a schedule can never be named the raw group_id.
 */
import { useRef, useState } from "react";
import { MODULE_ACCENT } from "../../../shared/ui/moduleAccent.js";

const ACCENT = MODULE_ACCENT.scheduler;

/* Hover/focus affordances for the borderless text buttons — the one thing inline styles can't
 * express. Injected with the component (the ModuleLoader pattern); only ever one instance mounts. */
const CSS = `
.sched-empty-text {
  background: none; border: none; border-radius: 6px; cursor: pointer;
  font-family: inherit; padding: 6px 8px; line-height: 1.4;
}
.sched-empty-text:hover { text-decoration: underline; }
.sched-empty-text:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
`;

const wrap = {
  position: "absolute", inset: 0, zIndex: 6,
  display: "grid", placeItems: "center",
  padding: "24px", overflow: "auto",
  // The page surface itself — deliberately NOT a scrim: the iframe behind is hidden, not dimmed.
  background: "var(--surface-page)", color: "var(--text-primary)",
  fontFamily: "system-ui, sans-serif",
};
const column = {
  width: "min(360px, 100%)", textAlign: "center",
  display: "flex", flexDirection: "column", alignItems: "center",
};
const headline = {
  fontSize: 17, fontWeight: 600, lineHeight: 1.35, color: "var(--text-primary)",
  overflowWrap: "anywhere", margin: 0,
};
const subline = {
  fontSize: 13, lineHeight: 1.5, color: "var(--text-secondary)", margin: "8px 0 0",
};
const btnPrimary = {
  marginTop: 24, padding: "9px 18px", borderRadius: 8, border: "none",
  background: ACCENT, color: "#fff", cursor: "pointer",
  fontFamily: "inherit", fontSize: 13.5, fontWeight: 600,
};
const textSecondary = { marginTop: 14, fontSize: 13, fontWeight: 500, color: "var(--text-primary)", overflowWrap: "anywhere" };
const textTertiary = { marginTop: 4, fontSize: 12, fontWeight: 500, color: "var(--text-secondary)" };
const pickerRow = { marginTop: 16, width: "100%", display: "flex", gap: 8 };
const selectStyle = {
  flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 8,
  border: "1px solid var(--border-default)", background: "var(--surface-raised)",
  color: "var(--text-primary)", fontFamily: "inherit", fontSize: 13,
};
const btnLink = {
  flex: "none", padding: "8px 14px", borderRadius: 8,
  border: "1px solid var(--border-default)", background: "transparent",
  color: "var(--text-primary)", fontFamily: "inherit", fontSize: 13, fontWeight: 600,
};

/* A calendar outline — thin stroke, no fill, secondary text colour. Decorative only. */
function CalendarGlyph() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false"
      style={{ color: "var(--text-secondary)", marginBottom: 18 }}>
      <rect x="3.25" y="5.25" width="17.5" height="15.5" rx="2.25" stroke="currentColor" strokeWidth="1.25" />
      <path d="M3.25 9.75h17.5M8 3.25v4M16 3.25v4" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

export default function LinkSchedulePanel({ siteName, schedules = [], suggestedMatch = null, onCreate, onLink }) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pick, setPick] = useState("");
  const selectRef = useRef(null);
  // Defensive (B560): the caller only mounts this once the site name is resolved, but never show —
  // or create — a schedule named the raw group_id. Fall back to a neutral label, disable Create.
  const label = siteName || "this project";
  const canCreate = !!siteName;
  // The suggested match is already offered above; don't repeat it inside the picker.
  const others = schedules.filter((s) => s && s.id != null && (!suggestedMatch || s.id !== suggestedMatch.id));
  const canPickOthers = others.length > 0;

  const revealPicker = () => {
    setPickerOpen(true);
    // Focus follows the disclosure, so the keyboard path is Create → reveal → picker → Link.
    setTimeout(() => { try { selectRef.current?.focus(); } catch (_) {} }, 0);
  };

  return (
    <div style={wrap} role="region" aria-label={`No schedule for ${label}`}>
      <style>{CSS}</style>
      <div style={column}>
        <CalendarGlyph />
        <p style={headline}>No schedule for “{label}”</p>
        <p style={subline}>A linked schedule follows this project across tabs.</p>

        <button
          type="button"
          style={{ ...btnPrimary, opacity: canCreate ? 1 : 0.5, cursor: canCreate ? "pointer" : "not-allowed" }}
          onClick={canCreate ? onCreate : undefined}
          disabled={!canCreate}
        >
          Create schedule
        </button>

        {/* A same-named schedule is the likely answer, so it becomes the secondary action itself —
            no "looks like a match" label to explain what the button already says. */}
        {suggestedMatch && (
          <button type="button" className="sched-empty-text" style={textSecondary} onClick={() => onLink(suggestedMatch.id)}>
            Link “{suggestedMatch.name}”
          </button>
        )}

        {/* Progressive disclosure: the picker is REVEALED here, replacing its own trigger, so a
            first-run screen never shows an empty <select> next to a disabled Link button. */}
        {canPickOthers && !pickerOpen && (
          <button
            type="button"
            className="sched-empty-text"
            style={suggestedMatch ? textTertiary : textSecondary}
            onClick={revealPicker}
          >
            Link an existing schedule
          </button>
        )}

        {canPickOthers && pickerOpen && (
          <div style={pickerRow}>
            <select
              ref={selectRef}
              aria-label="Choose a schedule to link"
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              style={selectStyle}
            >
              <option value="">Choose a schedule…</option>
              {others.map((s) => (
                <option key={s.id} value={String(s.id)}>{s.name || `Project ${s.id}`}</option>
              ))}
            </select>
            <button
              type="button"
              disabled={!pick}
              onClick={() => {
                // Match the original (numeric) id type from the schedules list, not the string the
                // <select> hands back, so the embedded app finds the project by ===.
                const sel = others.find((s) => String(s.id) === pick);
                if (sel) onLink(sel.id);
              }}
              style={{ ...btnLink, opacity: pick ? 1 : 0.5, cursor: pick ? "pointer" : "not-allowed" }}
            >
              Link
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
