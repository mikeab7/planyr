/* The Land tab's Parcels LIST (Parcels panel rework — NEW-1; the parcel's own page is ParcelPage.jsx).
 *
 * Presentational: it owns only view state (filter text, sort, which detail card is open, which rows
 * are CHECKED, the row menu). Every action is a callback into SitePlanner.jsx, whose single
 * combine / split / restore functions (lib/parcelOps.js) are what the map toolbar calls too — so
 * nothing here can behave differently from the map.
 *
 * Two different things used to share one checkbox and are now separate:
 *   · the CHECKBOX selects rows for a bulk action (Lock / Combine) — nothing else;
 *   · the EYE includes a parcel in the site total (the parcel's existing `active` flag, unchanged,
 *     so no saved plan needed migrating).
 * Module-scope component and sub-components (MODULE-SCOPE-COMPONENTS) — never define one in a body.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE, CONTROL_H } from "../../../shared/ui/designTokens.js";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { LockGlyph as SharedLockGlyph } from "../../../shared/ui/LockToggle.jsx";
import { isDiagArmed } from "../lib/diagArm.js";
import { NO_AUTOFILL } from "../../../shared/ui/noAutofill.js";
import { measureListOverflow } from "../lib/parcelListOverflow.js";

export const LINE = "1px solid var(--border-default)";
export const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---- inline stroke icons (no emoji) ---- */
export const Ico = ({ children, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);
export const EyeIcon = () => <Ico><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Ico>;
export const EyeOffIcon = () => <Ico><path d="M3 3l18 18" /><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1" /><path d="M6.6 6.6A16.6 16.6 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.4-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Ico>;
export const LockGlyph = ({ size }) => <SharedLockGlyph locked size={size} />;
export const UnlockGlyph = ({ size = 14 }) => <SharedLockGlyph locked={false} size={size} />;
export const ZoomIcon = () => <Ico><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.2-4.2" /></Ico>;
export const MoreIcon = () => <Ico><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></Ico>;
export const PencilIcon = ({ size }) => <Ico size={size}><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></Ico>;
export const SplitIcon = () => <Ico><path d="M4 4l16 16" /><rect x="3" y="3" width="18" height="18" rx="2" /></Ico>;
export const CloseIcon = () => <Ico size={14}><path d="M6 6l12 12M18 6L6 18" /></Ico>;
export const OverlapIcon = () => <Ico size={14}><rect x="3" y="3" width="12" height="12" rx="2" /><rect x="9" y="9" width="12" height="12" rx="2" /></Ico>;
export const TrashIcon = () => <Ico><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Ico>;

export const iconBtn = {
  width: CONTROL_H.md, height: CONTROL_H.md, padding: 0, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
  borderRadius: RADIUS.sm, border: "1px solid transparent", background: "transparent", color: "var(--text-secondary)", cursor: "pointer",
};
export const textBtn = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: SPACE.xs, height: CONTROL_H.lg, padding: `0 ${SPACE.lg}px`,
  borderRadius: RADIUS.sm, border: LINE, background: "var(--surface-raised)", color: "var(--text-primary)",
  fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};

function Tag({ children }) {
  return <span style={{ flex: "none", padding: "0 6px", borderRadius: RADIUS.pill, border: LINE, background: "var(--surface-page)", color: "var(--text-secondary)", fontSize: FONT_SIZE.micro, fontWeight: 700, lineHeight: "16px" }}>{children}</span>;
}

/* Layout C (NEW-2) as a TABLE (owner 2026-10-16, B2243424 ×5): the list is grouped by where a parcel came from, and it reads like a real
 * table. ONE column-heading row sits above the whole list — "Acres" over the figures, a lock icon over the lock column, an eye icon over the
 * visibility column (and the overlap icon over its column while any parcel overlaps) — and every row AND every group header share the same
 * grid — check · name block · acres · icon slot — so the acres of every group line up on a single right edge and each icon kind sits in
 * ONE column on every row. A row ALWAYS shows its lock (closed / open padlock) and its eye (open / struck); only the ⋯ menu waits for hover. */
const ACRES_W = 54; // fits "1,234.56" at the row's semibold figure size
const ICON = 18; // every row icon box
/* The icon slot holds [overlap marker] · padlock · eye · ⋯, left-aligned in fixed seats so each kind has one column on every row. The padlock,
 * eye and ⋯ seats always exist; the overlap seat exists once any parcel overlaps another — wider for EVERY row (never a per-row width), so a
 * marker has a seat in the slot, never in the name block. */
const SLOT_PAD = 3; // breathing room between the acres figure and the first icon seat
export const slotWidth = (anyOverlap = false) => SLOT_PAD + ICON * (3 + (anyOverlap ? 1 : 0));
const colsFor = (slotW) => `18px minmax(0, 1fr) ${ACRES_W}px ${slotW}px`;
const FIRST_LINE_H = 29; // one name line (17) + the row's 6px top/bottom padding: checkbox, acres and icons centre on the FIRST line of a wrapped row
const FILTER_MIN_ROWS = 8; // the filter box only earns its space once the list is long

export const GROUPS = [
  { key: "county", label: "County lots" },
  { key: "combined", label: "Combined" },
  { key: "drawn", label: "Drawn" },
  { key: "other", label: "Other" }, // no source evidence at all
];
/* A deed-plotted boundary is a hand-entered outline, so it lives with Drawn; "unknown" is the catch-all. */
export const groupKeyOf = (row) => { const k = row.origin && row.origin.kind; return k === "county" || k === "combined" ? k : (k === "drawn" || k === "deed") ? "drawn" : "other"; };

/* Bucket rows into the groups (empty ones dropped). A split piece stays with the lot it was cut from, so a group
 * never separates a parent from its pieces; list order inside a group is the outline's. */
export function groupRows(rows) {
  const buckets = new Map(GROUPS.map((g) => [g.key, []]));
  let rootKey = "other";
  for (const r of rows) {
    if (!r.depth) rootKey = groupKeyOf(r);
    buckets.get(r.depth ? rootKey : groupKeyOf(r)).push(r);
  }
  return GROUPS.map((g) => {
    const list = buckets.get(g.key);
    const live = list.filter((r) => !r.superseded);
    return { ...g, rows: list, count: live.length, activeAcres: live.reduce((t, r) => t + (r.included ? r.acres : 0), 0) };
  }).filter((g) => g.rows.length);
}

/* Overlap disclosure (the site total is DISSOLVED — shared ground counts once — while every row and group shows its own
 * area, so on a plan whose parcels overlap the two honestly disagree). The gap is the double-counted ground; the summary names it. */
export function overlapAcres(rows, siteAcres) {
  const additive = rows.filter((r) => !r.superseded && r.included).reduce((t, r) => t + r.acres, 0);
  const gap = additive - siteAcres;
  return gap > 0.05 ? gap : 0;
}
/* "Parcel 4 (12.3 ac), Tract A (1.2 ac)" for a row's hover, or "" when it overlaps nothing. */
export function overlapNamesOf(row, byId) {
  const list = (row.overlaps || []).map((o) => ({ ...o, other: byId.get(o.id) })).filter((o) => o.other);
  return list.map((o) => `${rowText(o.other).label} (${fmt(o.sqft / 43560)} ac)`).join(", ");
}

/* The row's label + its optional second line. An unnamed COUNTY lot is labelled by its account (no second line — the
 * account IS the identity); a named county lot / a combined parcel says where it came from; a drawn one says nothing.
 * Any OTHER parcel with no name the owner typed reads by its stable number ("Parcel 4", siteModel.parcelNumbers) — never a row of
 * identical "Unnamed" labels, and never derived from an address, owner or legal description (constraint #19). */
export function rowText(row) {
  const kind = row.origin && row.origin.kind;
  if (row.superseded) return { label: row.name, sub: "Split into pieces", muted: false };
  const split = row.splitFrom && row.pc.splitFrom && row.pc.splitFrom.from ? `Split from ${row.pc.splitFrom.from.snapName || "the original"}` : "";
  if (row.unnamed && kind === "county" && row.apn && !split) return { label: `Acct ${row.apn}`, sub: "", muted: true };
  const sub = split || (kind === "drawn" ? "" : row.origin ? row.origin.line : "");
  return { label: row.name, sub, muted: false };
}

/* The row's ⋯ menu (B2194741): Zoom to · Lock/Unlock · Delete. Delete is a TWO-STEP inline confirm (the same
 * arm-then-confirm shape the plan list uses) and the delete itself shows an Undo toast. Fixed-position so a scrolling
 * panel can never clip it; flips upward near the bottom edge. Module scope (MODULE-SCOPE-COMPONENTS). */
function RowMenu({ row, handlers, open, armed, onOpen, onClose, onArm, renameable }) {
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const r = btnRef.current && btnRef.current.getBoundingClientRect();
    if (r) { const H = armed ? 96 : renameable ? 160 : 128, up = r.bottom + H > window.innerHeight - 8; setPos({ left: Math.max(8, r.right - 168), top: up ? Math.max(8, r.top - H) : r.bottom + 2 }); }
    const off = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !(e.target.closest && e.target.closest("[data-row-menu]"))) onClose(); };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", off);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", off); };
  }, [open, armed]); // eslint-disable-line react-hooks/exhaustive-deps
  const item = (label, onClick, testid, danger) => (
    <button type="button" role="menuitem" onClick={onClick} data-testid={testid}
      style={{ display: "block", width: "100%", textAlign: "left", padding: `${SPACE.sm}px ${SPACE.lg}px`, border: "none", borderRadius: RADIUS.sm, background: "transparent", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, color: danger ? "var(--danger-text)" : "var(--text-primary)", cursor: "pointer" }}>{label}</button>
  );
  return (
    <div data-row-menu="1" style={{ flex: "none" }}>
      <button ref={btnRef} type="button" className={`land-row-hover${open ? " is-open" : ""}`} style={{ ...iconBtn, width: ICON, height: ICON }} aria-haspopup="menu" aria-expanded={open} aria-label={`More actions for ${row.name}`} title="More" data-testid={`parcel-row-more-${row.id}`} onClick={() => (open ? onClose() : onOpen())}><MoreIcon /></button>
      {open && pos && (
        <div role="menu" data-testid={`parcel-row-menu-${row.id}`} style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 50, width: 168, padding: SPACE.xs, border: LINE, borderRadius: RADIUS.md, background: "var(--surface-raised)", boxShadow: "var(--shadow-popover, 0 4px 14px var(--border-strong))" }}>
          {!armed && <>
            {renameable && item("Rename", () => { onClose(); handlers.onOpenPage(row.id); }, `parcel-row-pencil-${row.id}`)}
            {item("Zoom to", () => { onClose(); handlers.onZoom(row.id); }, `parcel-row-menu-zoom-${row.id}`)}
            {item(row.locked ? "Unlock" : "Lock", () => { onClose(); handlers.onToggleLock(row.id); }, `parcel-row-menu-lock-${row.id}`)}
            {item("Delete…", onArm, `parcel-row-menu-delete-${row.id}`, true)}
          </>}
          {armed && <div data-testid={`parcel-row-delete-confirm-${row.id}`}>
            <div style={{ padding: `${SPACE.sm}px ${SPACE.lg}px`, fontSize: FONT_SIZE.control, color: "var(--text-primary)", overflowWrap: "anywhere" }}>Delete {row.name}?</div>
            {item("Delete", () => { onClose(); handlers.onDelete(row.id); }, `parcel-row-delete-yes-${row.id}`, true)}
            {item("Cancel", onClose, `parcel-row-delete-no-${row.id}`)}
          </div>}
        </div>
      )}
    </div>
  );
}

/* A long account number never splits mid-digit: it drops whole onto its own line first (an inline-block), and only breaks if the column is narrower than the number itself. */
const keepDigits = (text) => String(text).split(/(\d{6,})/).map((t, i) => (i % 2 ? <span key={i} style={{ display: "inline-block", maxWidth: "100%", overflowWrap: "anywhere" }}>{t}</span> : t));

/* One row: checkbox (combine only) · name (+ source line, wraps, never cut) · acres · overlap / padlock / eye / ⋯ (all in the right-hand slot). The name
 * block opens the parcel page and uses the FULL name-block width (rename, constraint #18, is a ⋯ menu item — never an icon in the name flow).
 * The padlock (closed = locked, open = not) and the eye (open = counted, struck = left out) are ALWAYS shown, each a button with an Undo
 * toast; ⋯ shows on row hover / keyboard focus (always on touch screens). */
function ParcelRow({ row, selected, picked, pickMode, checked, handlers, cols, slotW, overlapNames, seatOverlap }) {
  const dim = !row.included || row.superseded;
  const { label, sub, muted } = rowText(row);
  const [menu, setMenu] = useState(null); // null | "menu" | "confirm"
  const renameable = row.splitFrom || row.origin.kind === "combined";
  const open = () => handlers.onRowClick(row.id, pickMode);
  const nameColor = dim || muted ? "var(--text-secondary)" : "var(--text-primary)";
  return (
    <div>
      <div className="land-parcel-row" data-testid={`parcel-table-row-${row.id}`} data-included={row.included ? "1" : "0"} data-group-kind={groupKeyOf(row)}
        style={{ position: "relative", display: "grid", gridTemplateColumns: cols, alignItems: "start", borderBottom: LINE, borderLeft: `2px solid ${selected || picked ? "var(--accent-site)" : "transparent"}`, borderRadius: 0, background: selected || picked ? "var(--surface-selected)" : "transparent" }}>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", height: FIRST_LINE_H, cursor: "pointer" }}>
          <input type="checkbox" checked={checked} onChange={() => handlers.onCheck(row.id)} aria-label={`Select ${label} to combine`} data-testid={`parcel-row-check-${row.id}`} style={{ width: 14, height: 14, margin: 0, cursor: "pointer" }} />
        </label>
        <div style={{ display: "flex", alignItems: "center", minWidth: 0, alignSelf: "stretch", paddingLeft: row.depth * SPACE.xl }}>
          <button type="button" onClick={open} aria-pressed={pickMode ? picked : undefined} data-testid={`parcel-row-${row.id}`}
            title={`${row.name}${sub ? ` — ${sub}` : ""}`}
            onKeyDown={(e) => { if ((e.key === "Delete" || e.key === "Backspace") && !pickMode) { e.preventDefault(); e.stopPropagation(); setMenu("confirm"); } }}
            style={{ flex: "1 1 auto", minWidth: 0, display: "block", padding: `${SPACE.sm}px ${SPACE.xxs}px ${SPACE.sm}px ${SPACE.xxs}px`, border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
            <span data-testid={`parcel-row-name-${row.id}`} style={{ display: "block", overflowWrap: "break-word", fontSize: FONT_SIZE.emphasis, lineHeight: "17px", fontWeight: muted ? 400 : 650, color: nameColor }}>{keepDigits(label)}</span>
            {sub && <span data-testid={`parcel-row-source-${row.id}`} style={{ display: "block", overflowWrap: "break-word", fontSize: FONT_SIZE.label, lineHeight: "14px", color: "var(--text-secondary)" }}>{keepDigits(sub)}</span>}
          </button>
        </div>
        <span onClick={open} data-testid={`parcel-row-acres-${row.id}`} style={{ height: FIRST_LINE_H, display: "flex", alignItems: "center", justifyContent: "flex-end", cursor: "pointer", fontSize: FONT_SIZE.emphasis, fontWeight: 650, color: dim ? "var(--text-secondary)" : "var(--text-primary)", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, textDecoration: row.included ? "none" : "line-through", whiteSpace: "nowrap", paddingRight: SPACE.xxs }}>{fmt(row.acres)}</span>
        <span data-testid={`parcel-row-slot-${row.id}`} style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", width: slotW, height: FIRST_LINE_H, boxSizing: "border-box", paddingLeft: SLOT_PAD }}>
          {seatOverlap && <span style={{ width: ICON, height: ICON, flex: "none", display: "inline-flex" }}>{overlapNames && <span role="img" tabIndex={0} aria-label={`Overlaps ${overlapNames}`} title={`Overlaps ${overlapNames}`} data-testid={`parcel-row-overlap-${row.id}`}
            style={{ width: ICON, height: ICON, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)", cursor: "default" }}><OverlapIcon /></span>}</span>}
          <span style={{ width: ICON, height: ICON, flex: "none", display: "inline-flex" }}><button type="button" onClick={() => handlers.onToggleLock(row.id)} aria-pressed={!!row.locked} data-testid={`parcel-row-lock-${row.id}`} data-locked={row.locked ? "1" : "0"}
            aria-label={row.locked ? `Unlock ${label}` : `Lock ${label}`}
            title={row.locked ? "Locked — even Edit parcels can't change it. Click to unlock." : "Not locked. Click to lock it against Edit parcels."} style={{ ...iconBtn, width: ICON, height: ICON }}>{row.locked ? <LockGlyph size={13} /> : <UnlockGlyph size={13} />}</button></span>
          <button type="button" onClick={() => handlers.onToggleInclude(row.id)} aria-pressed={row.included} data-testid={`parcel-row-eye-${row.id}`} data-included={row.included ? "1" : "0"}
            aria-label={row.included ? `Make ${label} not active` : `Make ${label} active`}
            title={row.included ? "Active — counted in the site total. Click to leave it out." : "Not active — left out of the site total. Click to count it."}
            style={{ ...iconBtn, width: ICON, height: ICON, color: row.included ? "var(--text-primary)" : "var(--text-secondary)" }}>
            {row.included ? <EyeIcon /> : <EyeOffIcon />}
          </button>
          <RowMenu row={row} renameable={!!renameable} handlers={handlers} open={menu !== null} armed={menu === "confirm"} onOpen={() => setMenu("menu")} onClose={() => setMenu(null)} onArm={() => setMenu("confirm")} />
        </span>
      </div>
    </div>
  );
}

/* The column-heading row (once, above the first group): "Acres" over the figures, and an ICON over each icon column — the
 * same seats, in the same order and at the same x as every row's (it is built from the SAME grid and slot), so a header icon sits
 * centred over the icons beneath it. The icons are headings, not buttons: they carry a hover/aria name and do nothing. */
function ColumnHeader({ cols, slotW, anyOverlap }) {
  const head = { fontSize: FONT_SIZE.micro, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)" };
  const seat = (testid, title, glyph) => (
    <span data-testid={testid} role="img" aria-label={title} title={title} style={{ width: ICON, height: ICON, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--text-secondary)" }}>{glyph}</span>
  );
  return (
    <div data-testid="parcels-columns" style={{ display: "grid", gridTemplateColumns: cols, alignItems: "center", padding: `${SPACE.xs}px 0`, borderBottom: "1px solid var(--border-strong)" }}>
      <span />
      <span data-testid="parcels-col-name" style={{ ...head, paddingLeft: SPACE.xxs }}>Name</span>
      <span data-testid="parcels-col-acres" style={{ ...head, textAlign: "right", paddingRight: SPACE.xxs }}>Acres</span>
      <span data-testid="parcels-col-slot" style={{ display: "flex", alignItems: "center", justifyContent: "flex-start", width: slotW, height: ICON, boxSizing: "border-box", paddingLeft: SLOT_PAD }}>
        {anyOverlap && seat("parcels-col-overlap", "Overlaps another parcel", <OverlapIcon />)}
        {seat("parcels-col-lock", "Locked — even Edit parcels can't change it", <LockGlyph size={13} />)}
        {seat("parcels-col-eye", "Active — counted in the site total", <EyeIcon />)}
        <span style={{ width: ICON, flex: "none" }} />
      </span>
    </div>
  );
}

/* A group header: small uppercase label + count on the left, the group's ACTIVE acres on the right in the SAME column
 * as the rows' acres, a rule under it. */
function GroupHeader({ group, cols }) {
  return (
    <div data-testid={`parcels-group-${group.key}`} style={{ display: "grid", gridTemplateColumns: cols, alignItems: "baseline", padding: `${SPACE.lg}px 0 ${SPACE.xs}px`, borderBottom: "1px solid var(--border-strong)" }}>
      <span style={{ gridColumn: "1 / 3", paddingLeft: SPACE.xs, fontSize: FONT_SIZE.micro, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", overflowWrap: "break-word", color: "var(--text-secondary)" }}>{group.label} · {group.count}</span>
      <span data-testid={`parcels-group-acres-${group.key}`} style={{ textAlign: "right", paddingRight: SPACE.xxs, fontSize: FONT_SIZE.label, fontWeight: 600, color: "var(--text-secondary)", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, whiteSpace: "nowrap" }}>{fmt(group.activeAcres)}</span>
      <span />
    </div>
  );
}

export default function ParcelsPanel({
  rows, siteAcres, addMenu, splitMode, selectedId, pickMode, pickedIds, combinePreview, handlers,
}) {
  // READ-ONLY, armed-only (?planyrDiag=1): `window.__parcelListOverflow()` names whatever pokes past the panel body's right edge.
  const rootRef = useRef(null);
  useEffect(() => {
    window.__parcelListOverflow = () => (isDiagArmed() ? measureListOverflow(rootRef.current) : null);
    return () => { delete window.__parcelListOverflow; };
  }, []);
  const [filter, setFilter] = useState("");
  const [checked, setChecked] = useState(() => new Set());

  // Drop checks for parcels that no longer exist (combine, split, remove, undo).
  const liveIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  useEffect(() => {
    setChecked((c) => { const n = new Set([...c].filter((id) => liveIds.has(id))); return n.size === c.size ? c : n; });
  }, [liveIds]);

  const counted = rows.filter((r) => !r.superseded);
  const inCount = counted.filter((r) => r.included).length;
  const showFilter = rows.length > FILTER_MIN_ROWS;

  const shown = useMemo(() => {
    const q = showFilter ? filter.trim().toLowerCase() : "";
    return rows.filter((r) => !q || [r.unnamed ? null : r.name, r.apn, r.owner].some((s) => s && String(s).toLowerCase().includes(q)));
  }, [rows, filter, showFilter]);

  const checkedIds = [...checked].filter((id) => liveIds.has(id));
  const checkedKey = checkedIds.join("|");
  const preview = useMemo(() => (checkedIds.length >= 2 ? combinePreview(checkedIds) : null), [checkedKey, rows]); // eslint-disable-line react-hooks/exhaustive-deps

  const H = useMemo(() => ({
    ...handlers,
    onCheck: (id) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    onRowClick: (id, picking) => { if (picking) { handlers.onPickRow(id); return; } handlers.onOpenPage(id); },
  }), [handlers]);
  // The row list only re-renders when something it shows changed — never on a pan / zoom frame.
  const anyOverlap = rows.some((r) => !r.superseded && r.included && (r.overlaps || []).length > 0);
  const slotW = slotWidth(anyOverlap), cols = colsFor(slotW);
  const byId = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const overlapAc = useMemo(() => overlapAcres(rows, siteAcres), [rows, siteAcres]);
  const rowList = useMemo(() => groupRows(shown).map((g) => (
    <div key={g.key} data-testid={`parcels-section-${g.key}`}>
      <GroupHeader group={g} cols={cols} />
      {g.rows.map((row) => (
        <ParcelRow key={row.id} row={row} selected={selectedId === row.id} picked={!!pickedIds && pickedIds.has(row.id)} pickMode={!!pickMode} checked={checked.has(row.id)} handlers={H} cols={cols} slotW={slotW} overlapNames={overlapNamesOf(row, byId)} seatOverlap={anyOverlap} />
      ))}
    </div>
  )), [shown, selectedId, pickedIds, pickMode, checked, H, cols, slotW, byId, anyOverlap]);

  return (
    <div ref={rootRef} data-testid="parcels-panel" style={{ display: "flex", flexDirection: "column", minWidth: 0, maxWidth: "100%", overflowX: "clip" }}>
      {splitMode ? (
        <div data-testid="parcels-split-header" style={{ display: "flex", alignItems: "center", gap: SPACE.lg, padding: `${SPACE.md}px 0 ${SPACE.lg}px` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>Splitting {splitMode.name} · {fmt(splitMode.acres)} AC</div>
            <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", marginTop: 2 }}>Draw a line across it on the map, double-click to finish.</div>
          </div>
          <button type="button" style={textBtn} onClick={handlers.onCancelSplit} data-testid="parcels-split-cancel">Cancel</button>
        </div>
      ) : (
        <div data-testid="parcels-summary" style={{ padding: `${SPACE.xs}px 0 ${SPACE.xs}px`, fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>
          <div data-testid="parcels-summary-line">
            <span data-testid="parcels-site-acres" style={{ fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>{fmt(siteAcres)}</span> AC in site
            <span style={{ color: "var(--text-secondary)" }}> · </span>
            <span data-testid="parcels-active-count">{inCount} of {counted.length} active</span>
          </div>
          {overlapAc > 0 && <div data-testid="parcels-overlap" title="Parcels overlap, so the site total counts shared ground once while the rows add up to more. Rows marked with the overlap icon show where." style={{ color: "var(--text-secondary)" }}>{fmt(overlapAc)} AC overlaps, counted once</div>}
        </div>
      )}

      {showFilter && (
        <input type="search" {...NO_AUTOFILL} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or account" aria-label="Filter parcels by name or account" data-testid="parcels-filter"
          onKeyDown={(e) => e.stopPropagation()}
          style={{ height: CONTROL_H.lg, marginBottom: SPACE.md, padding: `0 ${SPACE.lg}px`, border: LINE, borderRadius: RADIUS.sm, background: "var(--surface-field)", color: "var(--text-primary)", fontFamily: "inherit", fontSize: FONT_SIZE.control }} />
      )}

      <div style={{ display: "flex", flexDirection: "column" }} data-testid="parcels-list">
        {shown.length > 0 && <ColumnHeader cols={cols} slotW={slotW} anyOverlap={anyOverlap} />}
        {rowList}
        {!shown.length && <div style={{ padding: SPACE.xl, fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>No parcels match “{filter}”.</div>}
      </div>

      {/* Combining is the only thing the checkboxes are for: nothing shows with one checked. */}
      {checkedIds.length >= 2 && (
        <div role="toolbar" aria-label="Combine the selected parcels" data-testid="parcels-action-bar"
          style={{ marginTop: SPACE.md, display: "flex", alignItems: "center", gap: SPACE.md, padding: `${SPACE.md}px ${SPACE.lg}px`, borderRadius: RADIUS.lg, background: "var(--surface-page)", border: LINE, color: "var(--text-primary)" }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: FONT_SIZE.control }}>
            <div style={{ fontWeight: 700 }}>{checkedIds.length} selected</div>
            {preview && !preview.ok && <div data-testid="parcels-action-reason" style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", overflowWrap: "anywhere" }}>{preview.message}</div>}
          </div>
          <button type="button" disabled={!(preview && preview.ok)} onClick={() => { handlers.onCombine(checkedIds); setChecked(new Set()); }} data-testid="parcels-bar-combine"
            title={preview && !preview.ok ? preview.message : "Combine the selected parcels into one"}
            style={{ ...textBtn, background: "var(--accent-site)", color: "var(--on-accent-site)", borderColor: "var(--accent-site)", opacity: preview && preview.ok ? 1 : 0.5, cursor: preview && preview.ok ? "pointer" : "default" }}>Combine</button>
          <button type="button" onClick={() => setChecked(new Set())} aria-label="Clear selection" data-testid="parcels-bar-clear" style={iconBtn}><CloseIcon /></button>
        </div>
      )}

      {/* The two ways to change land: add some, or edit what is there. */}
      <div style={{ display: "flex", gap: SPACE.md, marginTop: SPACE.lg }}>
        {addMenu}
        <button type="button" style={{ ...textBtn, flex: 1 }} onClick={handlers.onEditParcels} data-testid="parcels-edit-btn"
          title="Reshape boundaries: drag corners, move a parcel, draw a line across it to split">
          <PencilIcon size={14} /> Edit parcels
        </button>
      </div>
    </div>
  );
}
