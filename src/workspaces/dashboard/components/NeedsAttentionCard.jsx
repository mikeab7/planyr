/* NeedsAttentionCard — one flat, cross-project list of tasks in the "Needs Attn." state,
 * sorted by how long each has been there (B1161792, NEW-1, Direction C's first real content
 * card — replacing a placeholder count card, per the owner's approved design).
 *
 * Deliberately NOT grouped by project (explicitly rejected in the brief) — the project name
 * appears only in each row's own sub-line. Reads `needsAttentionSince`, a field the embedded
 * Scheduler stamps (see needsAttentionList.js's own header for why this is the right source of
 * truth and why a days-past-due proxy is refused).
 */
import { useEffect, useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { Button, IconButton } from "../../../shared/ui/controls.jsx";
import { needsAttentionTotals, attentionBarFraction } from "../lib/needsAttentionList.js";
import { formatShortDate } from "../lib/dashboardDates.js";

const MUTED = { fontSize: 12, color: "var(--text-secondary)" };
const EMPTY = { fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" };
const TOP_ROWS = 8;
// Below this measured row-list width the day-count + name + sub-line already fill the row, so
// the trailing bar is dropped rather than left to crowd the text (the brief's own instruction).
// Not a design token — a layout behavior threshold local to this one card, the same shape as
// e.g. the Comps entry grid's own MOBILE_BREAKPOINT_PX.
const BAR_MIN_ROW_WIDTH = 360;
const BAR_LANE_WIDTH = 40;

function useMeasuredWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (typeof w === "number") setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function AttentionBar({ fraction }) {
  return (
    <span
      aria-hidden="true"
      style={{ flex: "none", width: BAR_LANE_WIDTH, height: 4, borderRadius: RADIUS.pill, background: "var(--border-default)", overflow: "hidden", display: "inline-block" }}
    >
      <span style={{ display: "block", height: "100%", width: `${Math.round(fraction * 100)}%`, background: "var(--accent)", borderRadius: RADIUS.pill }} />
    </span>
  );
}

function AttentionRow({ row, maxDays, showBar, onOpen }) {
  const dueLabel = row.dueDate ? formatShortDate(row.dueDate) : null;
  return (
    <div
      onClick={() => onOpen?.(row)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen?.(row); } }}
      style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 0", cursor: "pointer", borderRadius: RADIUS.sm }}
    >
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "none", width: 32 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "var(--accent)", lineHeight: 1 }}>{row.days}</span>
        <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", color: "var(--text-secondary)" }}>DAYS</span>
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.taskName}</div>
        <div style={{ ...MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {row.projectName} · {dueLabel ? `due ${dueLabel}` : "no due date"} · {row.waiting} waiting
        </div>
      </div>
      {showBar && <AttentionBar fraction={attentionBarFraction(row.days, maxDays)} />}
    </div>
  );
}

function NeedsAttentionModal({ rows, onOpen, onClose }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const maxDays = rows[0]?.days || 0;
  return (
    <div
      style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }} // design-exempt: modal scrim — no backdrop/scrim token exists repo-wide yet (matches MapFinder.jsx's confirmDel scrim)
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog" aria-modal="true" aria-label="Everything needing attention"
        style={{ background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: RADIUS.lg, width: "100%", maxWidth: 560, maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 24px 64px rgba(0,0,0,0.35)" }} // design-exempt: no shadow-color token exists repo-wide yet (same gap SheetView.jsx/CompEntryGrid.jsx already cite)
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 14px", borderBottom: "1px solid var(--border-default)" }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", flex: 1 }}>Needs attention — {rows.length}</span>
          <IconButton size={26} onClick={onClose} title="Close">
            <span style={{ fontSize: 13 }}>×</span>
          </IconButton>
        </div>
        <div style={{ overflow: "auto", padding: "4px 14px 12px" }}>
          {rows.map((r) => (
            <AttentionRow key={`${r.projectId}:${r.taskId}`} row={r} maxDays={maxDays} showBar onOpen={onOpen} />
          ))}
        </div>
      </div>
    </div>
  );
}

export function NeedsAttentionCard({ rows, onOpenTask }) {
  const [showAll, setShowAll] = useState(false);
  const [listRef, listWidth] = useMeasuredWidth();
  if (!rows || !rows.length) return <div style={EMPTY}>Nothing needs attention right now.</div>;

  const top = rows.slice(0, TOP_ROWS);
  const maxDays = rows[0].days;
  const totals = needsAttentionTotals(rows);
  const showBar = listWidth == null || listWidth >= BAR_MIN_ROW_WIDTH;

  return (
    <div>
      <div ref={listRef}>
        {top.map((r) => (
          <AttentionRow key={`${r.projectId}:${r.taskId}`} row={r} maxDays={maxDays} showBar={showBar} onOpen={onOpenTask} />
        ))}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-default)" }}>
        <div style={{ ...MUTED, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {totals.map((t) => `${t.projectName} ${t.count}`).join(" · ")}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>Show all {rows.length}</Button>
      </div>
      {showAll && <NeedsAttentionModal rows={rows} onOpen={onOpenTask} onClose={() => setShowAll(false)} />}
    </div>
  );
}
