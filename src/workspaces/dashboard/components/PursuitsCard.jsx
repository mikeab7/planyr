/* PursuitsCard — the Dashboard's "Pursuits" card (B1161793, NEW-2, Direction C's second real
 * content card — replacing the placeholder "Pursuits by activity" card, per the owner's
 * approved design). A table of open pursuits.
 *
 * Columns, left to right: Pursuit (name, county underneath) / Yield / Quiet for. Acres was
 * explicitly dropped early in this card's design ("Yield is what he compares two deals on;
 * acreage is a detail you look up once you are inside the deal").
 *
 * ⛔ B1342848 (owner instruction, 2026-09-09: "remove the deal date from pursuits") — the "Next"
 * column (the nearest contractual-date field + countdown) and its sort are gone; see
 * pursuitsList.js's header for why and for what this supersedes. The table now sorts
 * alphabetically, unconditionally, so there's no "no deal dates set yet" banner to show either —
 * an alphabetical list needs no disclaimer the way a fallback pretending to be a date sort did.
 */
import { useEffect, useRef, useState } from "react";
import { isQuietEmphasized } from "../lib/pursuitsList.js";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { IconButton, MenuItem } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";

const EMPTY = { fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" };
const dayWord = (n) => (n === 1 ? "day" : "days");

const thStyle = (align) => ({
  textAlign: align, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
  color: "var(--text-secondary)", padding: "0 8px 6px 0", borderBottom: "1px solid var(--border-default)", whiteSpace: "nowrap",
});
const tdStyle = (align) => ({
  textAlign: align, padding: "7px 8px 7px 0", borderBottom: "1px solid var(--border-default)", verticalAlign: "top",
});

function formatSf(sqft) {
  if (!sqft) return "—";
  return `${Math.round(sqft).toLocaleString()} SF`;
}

function QuietCell({ days }) {
  if (days == null) return <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>—</span>;
  const emphasized = isQuietEmphasized(days);
  return (
    <span style={{ fontSize: emphasized ? 13 : 12, fontWeight: emphasized ? 700 : 500, color: emphasized ? "var(--text-primary)" : "var(--text-secondary)" }}>
      {days} {dayWord(days)}
    </span>
  );
}

/* NEW-1 (2026-10-08) — the owner sets the order. Each row carries a grip (drag it; works with a
 * finger — `touch-action: none` keeps the page from scrolling under the gesture) and a "⋯" menu with
 * Move to top / Move to bottom, so reordering never depends on dragging. Both end in the ONE
 * `onMove(groupId, dest)` — dest is `{ to: "top" | "bottom" }` or `{ index }` (position among the
 * rows shown here) — which the Dashboard turns into the saved order (shared/projects/projectOrder.js).
 * A card rendered without `onMove` (a static render) shows neither control. */

function scrollerOf(el) {
  for (let n = el && el.parentElement; n; n = n.parentElement) {
    const oy = typeof getComputedStyle === "function" ? getComputedStyle(n).overflowY : "";
    if ((oy === "auto" || oy === "scroll") && n.scrollHeight > n.clientHeight) return n;
  }
  return null;
}

function RowMenu({ name, isFirst, isLast, onPick }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const pick = (to) => { setOpen(false); onPick(to); };
  return (
    <>
      <IconButton
        ref={ref}
        size={26}
        title={`Order options for ${name}`}
        aria-label={`Order options for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
      >
        <span aria-hidden="true" style={{ fontSize: 15, lineHeight: 1 }}>⋯</span>
      </IconButton>
      <AnchoredMenu open={open} onClose={() => setOpen(false)} anchorRef={ref} placement="below-right" width={170} gap={4}>
        <MenuItem disabled={isFirst} onClick={() => pick("top")}>Move to top</MenuItem>
        <MenuItem disabled={isLast} onClick={() => pick("bottom")}>Move to bottom</MenuItem>
      </AnchoredMenu>
    </>
  );
}

export function PursuitsCard({ rows, yieldBySite, onOpenProject, onMove, orderError, onRetryOrder }) {
  const rowRefs = useRef(new Map());
  const stopRef = useRef(null);
  const [drag, setDrag] = useState(null); // { id, at } while a grip is held
  useEffect(() => () => { if (stopRef.current) stopRef.current(); }, []);
  if (!rows || !rows.length) return <div style={EMPTY}>No open pursuits right now.</div>;
  const canOrder = typeof onMove === "function";

  const startDrag = (e, id) => {
    if (!canOrder || (e.button != null && e.button !== 0)) return;
    e.preventDefault();
    e.stopPropagation();
    const rest = () => rows.filter((r) => r.groupId !== id);
    const atFor = (y) => {
      let at = 0;
      for (const r of rest()) {
        const el = rowRefs.current.get(r.groupId);
        if (!el) continue;
        const b = el.getBoundingClientRect();
        if (y > b.top + b.height / 2) at++;
      }
      return at;
    };
    const scroller = scrollerOf(rowRefs.current.get(id));
    let y = e.clientY, raf = 0, last = atFor(y);
    setDrag({ id, at: last });
    const tick = () => {
      if (scroller) { // edge auto-scroll, so a long list can be dragged past what is visible
        const b = scroller.getBoundingClientRect();
        const zone = 28;
        if (y < b.top + zone) scroller.scrollTop -= 8;
        else if (y > b.bottom - zone) scroller.scrollTop += 8;
        const at = atFor(y);
        if (at !== last) { last = at; setDrag({ id, at }); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const move = (ev) => { y = ev.clientY; const at = atFor(y); if (at !== last) { last = at; setDrag({ id, at }); } };
    const end = (commit) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", key, true);
      cancelAnimationFrame(raf);
      stopRef.current = null;
      setDrag(null);
      if (commit) onMove(id, { index: last });
    };
    const up = () => end(true);
    const cancel = () => end(false);
    const key = (ev) => { if (ev.key === "Escape") { ev.stopPropagation(); end(false); } };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", key, true);
    stopRef.current = () => end(false);
  };

  // Where the drop line sits: above the row now at `at` among the others, or below the last one.
  const others = drag ? rows.filter((r) => r.groupId !== drag.id) : [];
  const lineAbove = drag && drag.at < others.length ? others[drag.at].groupId : null;
  const lineBelow = drag && drag.at >= others.length && others.length ? others[others.length - 1].groupId : null;
  const lineStyle = (id) => (id === lineAbove ? { boxShadow: "inset 0 2px 0 var(--accent)" }
    : id === lineBelow ? { boxShadow: "inset 0 -2px 0 var(--accent)" } : null);

  return (
    <div style={{ overflowX: "auto" }}>
      {orderError && (
        <div role="alert" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 12, fontWeight: 600, color: "var(--danger-text)", marginBottom: 8 }}>
          <span>Couldn't save your project order. It's kept on screen for now.</span>
          {onRetryOrder && (
            <button type="button" onClick={onRetryOrder} style={{ fontSize: 12, fontWeight: 700, color: "var(--danger-text)", background: "none", border: `1px solid var(--danger-text)`, borderRadius: RADIUS.sm, padding: "2px 8px", cursor: "pointer", fontFamily: "inherit" }}>Retry</button>
          )}
        </div>
      )}
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            {canOrder && <th style={{ ...thStyle("left"), width: 22, padding: "0 0 6px 0" }} aria-label="Reorder" />}
            <th style={thStyle("left")}>Pursuit</th>
            <th style={thStyle("right")}>Yield</th>
            <th style={thStyle("right")}>Quiet for</th>
            {canOrder && <th style={{ ...thStyle("right"), width: 30, padding: "0 0 6px 0" }} aria-label="Order options" />}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const line = lineStyle(r.groupId);
            return (
            <tr
              key={r.groupId}
              ref={(el) => { if (el) rowRefs.current.set(r.groupId, el); else rowRefs.current.delete(r.groupId); }}
              data-project-row={r.groupId}
              onClick={() => onOpenProject?.(r)}
              role={onOpenProject ? "button" : undefined}
              tabIndex={onOpenProject ? 0 : undefined}
              onKeyDown={onOpenProject ? (e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onOpenProject(r); } } : undefined}
              style={{ cursor: onOpenProject ? "pointer" : "default", opacity: drag && drag.id === r.groupId ? 0.45 : 1 }}
            >
              {canOrder && (
                <td style={{ ...tdStyle("left"), ...line, padding: "7px 0 7px 0", verticalAlign: "middle" }}>
                  <span
                    role="button"
                    aria-label={`Drag to reorder ${r.name}`}
                    title="Drag to reorder"
                    data-project-grip={r.groupId}
                    onPointerDown={(e) => startDrag(e, r.groupId)}
                    onClick={(e) => e.stopPropagation()}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 22, height: 26, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1, cursor: drag ? "grabbing" : "grab", touchAction: "none", userSelect: "none" }}
                  >⠿</span>
                </td>
              )}
              <td style={{ ...tdStyle("left"), ...line }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 180 }}>{r.name}</div>
                {r.county && <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.04em", color: "var(--text-secondary)" }}>{r.county}</div>}
              </td>
              <td style={{ ...tdStyle("right"), ...line, fontWeight: 600, color: "var(--text-primary)", whiteSpace: "nowrap" }}>{formatSf(yieldBySite?.[r.siteId])}</td>
              <td style={{ ...tdStyle("right"), ...line, whiteSpace: "nowrap" }}><QuietCell days={r.quietDays} /></td>
              {canOrder && (
                <td style={{ ...tdStyle("right"), ...line, padding: "4px 0 4px 4px", verticalAlign: "middle" }} onClick={(e) => e.stopPropagation()}>
                  <RowMenu name={r.name} isFirst={i === 0} isLast={i === rows.length - 1} onPick={(to) => onMove(r.groupId, { to })} />
                </td>
              )}
            </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
