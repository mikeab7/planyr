/* LinkSchedulePanel — the cross-module "connect this site to a schedule" resolution panel.
 *
 * Shown by Scheduler.jsx when the URL route points at a Site Planner project (a site group)
 * that has no linked schedule yet. It is the "suggest-and-confirm" surface for the owner's
 * request — never auto-links:
 *   • Create a schedule for this site (pre-named + linked, then opened).
 *   • Link an EXISTING schedule — a same-named one is surfaced as a one-click suggestion,
 *     and any schedule can be linked from the manual picker.
 *
 * Copy is deliberately terse (B1051): a headline, one line of why, and the actions. The old
 * uppercase eyebrow + two-sentence paragraph restated the headline three times over.
 *
 * B1050 — the panel is DISMISSABLE (X + Escape). It used to be a modal with no way out, so a
 * route↔iframe desync turned into a dead end. Dismissing links and creates nothing.
 *
 * Styling uses theme tokens (light/dark parity, owner rule B318) and the scheduler accent.
 */
import { useEffect, useState } from "react";
import { MODULE_ACCENT } from "../../../shared/ui/moduleAccent.js";

const ACCENT = MODULE_ACCENT.scheduler;

const card = {
  position: "relative",
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
  // A long schedule name must wrap inside the card, never run past its edge.
  overflowWrap: "anywhere",
};
const btnClose = {
  position: "absolute", top: 10, right: 10,
  width: 28, height: 28, padding: 0, borderRadius: 8,
  border: "1px solid var(--border-default)", background: "transparent",
  color: "var(--text-secondary)", cursor: "pointer",
  fontFamily: "inherit", fontSize: 15, lineHeight: 1,
  display: "grid", placeItems: "center",
};

export default function LinkSchedulePanel({ siteName, schedules = [], suggestedMatch = null, onCreate, onLink, onDismiss }) {
  const [pick, setPick] = useState("");
  // Defensive: the caller only mounts this once the site name is resolved, but never show or
  // create a schedule named the raw id — fall back to a neutral label and disable Create if the
  // name is somehow missing (B560).
  const label = siteName || "this project";
  const canCreate = !!siteName;
  // Don't offer the suggested match again inside the manual picker.
  const others = schedules.filter((s) => s && s.id != null && (!suggestedMatch || s.id !== suggestedMatch.id));

  // Escape closes (B1050). Window-level so it works wherever focus sits inside the workspace;
  // no-ops when the caller passes no onDismiss, so the panel can never swallow the key silently.
  useEffect(() => {
    if (!onDismiss) return;
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); onDismiss(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <div
      role="dialog"
      aria-label={`No schedule for ${label} yet`}
      style={{ position: "absolute", inset: 0, zIndex: 6, display: "grid", placeItems: "center",
        background: "color-mix(in srgb, var(--surface-page) 78%, transparent)" }}
    >
      <div style={card}>
        {onDismiss && (
          <button type="button" style={btnClose} onClick={onDismiss} aria-label="Close" title="Close (Esc)">
            ✕
          </button>
        )}
        <div style={{ fontWeight: 800, fontSize: 17, marginBottom: 4, paddingRight: 30, overflowWrap: "anywhere" }}>
          No schedule for “{label}” yet
        </div>
        <p style={{ margin: "0 0 16px", fontSize: 12.5, lineHeight: 1.5, color: "var(--text-secondary)" }}>
          Link one and it stays with this project across tabs.
        </p>

        <button style={{ ...btnPrimary, opacity: canCreate ? 1 : 0.5, cursor: canCreate ? "pointer" : "not-allowed" }} onClick={canCreate ? onCreate : undefined} disabled={!canCreate}>
          Create schedule
        </button>

        {suggestedMatch && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6 }}>
              Looks like a match
            </div>
            <button style={btnGhost} onClick={() => onLink(suggestedMatch.id)}>
              Link “{suggestedMatch.name}”
            </button>
          </div>
        )}

        {others.length > 0 && (
          <div style={{ marginTop: 14 }}>
            <div style={{ fontSize: 11.5, fontWeight: 700, color: "var(--text-secondary)", marginBottom: 6 }}>
              Link an existing schedule
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
