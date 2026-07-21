import { useEffect, useState } from "react";
import { TABULAR_NUMS } from "../../../shared/theme/typography.js";

/* Collapse (FINAL UI SPEC — Yield panel + Pond inspector) — the ONE collapsible section
 * primitive for the Yield panel and the pond inspector. A header row carries the section
 * title, an optional count badge, a one-line summary shown only when CLOSED (so a folded
 * section still reports its headline at a glance), and a chevron. Open/closed persists per
 * `sectionId` in localStorage, so a user's fold choices survive a reload.
 *
 * Accessibility: the header is a real <button> (Enter/Space toggle for free, aria-expanded
 * set), so it's keyboard- and screen-reader-reachable; the open/closed state is signalled by
 * the rotating chevron AND the summary showing/hiding, never by color alone. Theme tokens
 * only — no raw hex. Module scope (MODULE-SCOPE-COMPONENTS). */

export const collapseStorageKey = (id) => `planyr:collapse:${id}`;

function readOpen(sectionId, defaultOpen) {
  if (!sectionId) return defaultOpen;
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(collapseStorageKey(sectionId)) : null;
    if (raw === "1") return true;
    if (raw === "0") return false;
  } catch (_) { /* storage unavailable — fall through to the default */ }
  return defaultOpen;
}

export default function Collapse({
  sectionId, title, summary, count, defaultOpen = false, children, headerRight, style,
}) {
  const [open, setOpen] = useState(() => readOpen(sectionId, defaultOpen));
  useEffect(() => {
    if (!sectionId) return;
    try { localStorage.setItem(collapseStorageKey(sectionId), open ? "1" : "0"); } catch (_) { /* quota/unavailable — UI state only */ }
  }, [open, sectionId]);

  return (
    <div style={{ borderTop: "1px solid var(--planner-border)", ...style }}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "9px 2px",
          background: "none", border: "none", cursor: "pointer", textAlign: "left", fontFamily: "inherit",
        }}
      >
        <span aria-hidden="true" style={{ flex: "none", width: 10, fontSize: 10, color: "var(--text-tertiary)", transform: open ? "rotate(90deg)" : "none", transition: "transform .16s ease" }}>▶</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.07em", textTransform: "uppercase", color: "var(--text-secondary)", flex: "none" }}>{title}</span>
        {count != null ? (
          <span style={{ flex: "none", fontSize: 9.5, fontWeight: 700, color: "var(--text-tertiary)", background: "var(--planner-panel)", borderRadius: 999, padding: "0 6px", fontVariantNumeric: TABULAR_NUMS }}>{count}</span>
        ) : null}
        {!open && summary ? (
          <span style={{ marginLeft: "auto", minWidth: 0, fontSize: 10.5, color: "var(--text-tertiary)", fontVariantNumeric: TABULAR_NUMS, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{summary}</span>
        ) : null}
        {headerRight != null ? (
          <span onClick={(e) => e.stopPropagation()} style={{ marginLeft: open || !summary ? "auto" : 8, flex: "none" }}>{headerRight}</span>
        ) : null}
      </button>
      {open ? <div style={{ padding: "0 2px 9px" }}>{children}</div> : null}
    </div>
  );
}
