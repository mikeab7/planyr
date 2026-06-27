/* LinkSchedulePanel — the cross-module "connect this site to a schedule" resolution panel.
 *
 * Shown by Scheduler.jsx when the URL route points at a Site Planner project (a site group)
 * that has no linked schedule yet. It is the "suggest-and-confirm" surface for the owner's
 * request — never auto-links:
 *   • Create a schedule for this site (pre-named + linked, then opened).
 *   • Link an EXISTING schedule — a same-named one is surfaced as a one-click suggestion,
 *     and any schedule can be linked from the manual picker.
 *
 * Styling uses theme tokens (light/dark parity, owner rule B318) and the scheduler accent.
 */
import { useState } from "react";
import { MODULE_ACCENT } from "../../../shared/ui/moduleAccent.js";

const ACCENT = MODULE_ACCENT.scheduler;

const card = {
  width: "min(440px, calc(100% - 32px))",
  padding: "22px 22px 20px", borderRadius: 14,
  background: "var(--surface-raised)", color: "var(--text-primary)",
  border: "1px solid var(--border-default)", boxShadow: "0 18px 48px rgba(0,0,0,0.28)",
  fontFamily: "system-ui, sans-serif",
};
const btnPrimary = {
  display: "block", width: "100%", padding: "10px 14px", borderRadius: 9,
  border: "none", background: ACCENT, color: "#fff", cursor: "pointer",
  fontFamily: "inherit", fontSize: 13.5, fontWeight: 700,
};
const btnGhost = {
  display: "block", width: "100%", padding: "9px 14px", borderRadius: 9,
  border: "1px solid var(--border-default)", background: "transparent",
  color: "var(--text-primary)", cursor: "pointer", fontFamily: "inherit",
  fontSize: 13, fontWeight: 600, textAlign: "left",
};

export default function LinkSchedulePanel({ siteName, schedules = [], suggestedMatch = null, onCreate, onLink }) {
  const [pick, setPick] = useState("");
  // Don't offer the suggested match again inside the manual picker.
  const others = schedules.filter((s) => s && s.id != null && (!suggestedMatch || s.id !== suggestedMatch.id));

  return (
    <div
      role="dialog"
      aria-label="Connect this site to a schedule"
      style={{ position: "absolute", inset: 0, zIndex: 6, display: "grid", placeItems: "center",
        background: "color-mix(in srgb, var(--surface-page) 78%, transparent)" }}
    >
      <div style={card}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase", color: ACCENT, marginBottom: 6 }}>
          Connect a schedule
        </div>
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4 }}>
          No schedule linked to “{siteName}” yet
        </div>
        <p style={{ margin: "0 0 16px", fontSize: 12.5, lineHeight: 1.5, color: "var(--text-secondary)" }}>
          Connect a schedule to this project so it follows you when you switch tabs. You can spin up
          a new one, or link a schedule you’ve already built.
        </p>

        <button style={btnPrimary} onClick={onCreate}>
          Create a schedule for “{siteName}”
        </button>

        {suggestedMatch && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6 }}>
              Looks like a match
            </div>
            <button style={btnGhost} onClick={() => onLink(suggestedMatch.id)}>
              🔗 Link the existing schedule “{suggestedMatch.name}”
            </button>
          </div>
        )}

        {others.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6 }}>
              Or link a different schedule
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <select
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                style={{ flex: 1, minWidth: 0, padding: "8px 10px", borderRadius: 8,
                  border: "1px solid var(--border-default)", background: "var(--surface-page)",
                  color: "var(--text-primary)", fontFamily: "inherit", fontSize: 13 }}
              >
                <option value="">Choose a schedule…</option>
                {others.map((s) => (
                  <option key={s.id} value={String(s.id)}>{s.name || `Project ${s.id}`}</option>
                ))}
              </select>
              <button
                disabled={!pick}
                onClick={() => {
                  // Match the original (numeric) id type from the schedules list, not the string
                  // the <select> hands back, so the embedded app finds the project by ===.
                  const sel = others.find((s) => String(s.id) === pick);
                  if (sel) onLink(sel.id);
                }}
                style={{ ...btnGhost, width: "auto", flex: "none", textAlign: "center",
                  opacity: pick ? 1 : 0.5, cursor: pick ? "pointer" : "not-allowed" }}
              >
                Link
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
