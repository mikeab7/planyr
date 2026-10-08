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

export const LINE = "1px solid var(--border-default)";
export const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---- inline stroke icons (no emoji) ---- */
export const Ico = ({ children, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);
export const EyeIcon = () => <Ico><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Ico>;
export const EyeOffIcon = () => <Ico><path d="M3 3l18 18" /><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1" /><path d="M6.6 6.6A16.6 16.6 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.4-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Ico>;
export const LockGlyph = ({ size }) => <Ico size={size}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Ico>;
export const UnlockGlyph = () => <Ico><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></Ico>;
export const ZoomIcon = () => <Ico><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.2-4.2" /></Ico>;
export const MoreIcon = () => <Ico><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></Ico>;
export const PencilIcon = ({ size }) => <Ico size={size}><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></Ico>;
export const SplitIcon = () => <Ico><path d="M4 4l16 16" /><rect x="3" y="3" width="18" height="18" rx="2" /></Ico>;
export const CloseIcon = () => <Ico size={14}><path d="M6 6l12 12M18 6L6 18" /></Ico>;
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

/* The grid every row AND the column header share, so the eye sits exactly under "Active". */
const COLS = "24px minmax(0, 1fr) 44px 38px 26px"; // check · name+acres · lock/pencil · eye · ⋯ (each icon in its OWN cell, so none can sit on the name)
const FILTER_MIN_ROWS = 8; // the filter box only earns its space once the list is long

function secondLine(row) {
  if (row.superseded) return "Split into pieces";
  if (row.splitFrom && row.pc.splitFrom && row.pc.splitFrom.from) return `Split from ${row.pc.splitFrom.from.snapName || "the original"}`;
  return row.origin ? row.origin.line : "";
}

/* The row's ⋯ menu (B2194741): Zoom to · Lock/Unlock · Delete. Delete is a TWO-STEP inline confirm (the same
 * arm-then-confirm shape the plan list uses) and the delete itself shows an Undo toast. Fixed-position so a scrolling
 * panel can never clip it; flips upward near the bottom edge. Module scope (MODULE-SCOPE-COMPONENTS). */
function RowMenu({ row, handlers, open, armed, onOpen, onClose, onArm }) {
  const btnRef = useRef(null);
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!open) { setPos(null); return undefined; }
    const r = btnRef.current && btnRef.current.getBoundingClientRect();
    if (r) { const H = armed ? 96 : 128, up = r.bottom + H > window.innerHeight - 8; setPos({ left: Math.max(8, r.right - 168), top: up ? Math.max(8, r.top - H) : r.bottom + 2 }); }
    const off = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !(e.target.closest && e.target.closest("[data-row-menu]"))) onClose(); };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", off);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", off); };
  }, [open, armed]); // eslint-disable-line react-hooks/exhaustive-deps
  const item = (label, onClick, testid, danger) => (
    <button type="button" role="menuitem" onClick={onClick} data-testid={testid}
      style={{ display: "block", width: "100%", textAlign: "left", padding: `${SPACE.sm}px ${SPACE.lg}px`, border: "none", borderRadius: RADIUS.sm, background: "transparent", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, color: danger ? "var(--danger-text)" : "var(--text-primary)", cursor: "pointer" }}>{label}</button>
  );
  return (
    <div data-row-menu="1" style={{ justifySelf: "center" }}>
      <button ref={btnRef} type="button" style={iconBtn} aria-haspopup="menu" aria-expanded={open} aria-label={`More actions for ${row.name}`} title="More" data-testid={`parcel-row-more-${row.id}`} onClick={() => (open ? onClose() : onOpen())}><MoreIcon /></button>
      {open && pos && (
        <div role="menu" data-testid={`parcel-row-menu-${row.id}`} style={{ position: "fixed", left: pos.left, top: pos.top, zIndex: 50, width: 168, padding: SPACE.xs, border: LINE, borderRadius: RADIUS.md, background: "var(--surface-raised)", boxShadow: "var(--shadow-popover, 0 4px 14px var(--border-strong))" }}>
          {!armed && <>
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

/* One row. Checkbox (combine only) · name + where it came from (opens the parcel page) · acres · lock / rename ·
 * eye (Active) · ⋯. The lock and the rename pencil live in their OWN grid cell beside the name (B2194741): the
 * pencil used to be absolutely positioned over the first letter of the name. The padlock is a real button — shown
 * always when locked, on hover / keyboard focus when not (always on touch) — and toggles Lock with an Undo toast. */
function ParcelRow({ row, selected, picked, pickMode, checked, handlers }) {
  const dim = !row.included || row.superseded;
  const sub = secondLine(row);
  const [menu, setMenu] = useState(null); // null | "menu" | "confirm"
  const renameable = row.splitFrom || row.origin.kind === "combined";
  return (
    <div style={{ marginLeft: row.depth * SPACE.xl }}>
      <div className="land-parcel-row" data-testid={`parcel-table-row-${row.id}`} data-included={row.included ? "1" : "0"}
        style={{ position: "relative", display: "grid", gridTemplateColumns: COLS, alignItems: "center", minHeight: 52, borderBottom: LINE, borderLeft: `2px solid ${selected || picked ? "var(--accent-site)" : "transparent"}`, borderRadius: 0, background: selected || picked ? "var(--surface-selected)" : "transparent" }}>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", alignSelf: "stretch", cursor: "pointer" }}>
          <input type="checkbox" checked={checked} onChange={() => handlers.onCheck(row.id)} aria-label={`Select ${row.name} to combine`} data-testid={`parcel-row-check-${row.id}`} style={{ width: 15, height: 15, margin: 0, cursor: "pointer" }} />
        </label>
        <button type="button" onClick={() => handlers.onRowClick(row.id, pickMode)} aria-pressed={pickMode ? picked : undefined} data-testid={`parcel-row-${row.id}`}
          title={`${row.name}${sub ? ` — ${sub}` : ""}`}
          onKeyDown={(e) => { if ((e.key === "Delete" || e.key === "Backspace") && !pickMode) { e.preventDefault(); e.stopPropagation(); setMenu("confirm"); } }}
          style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) auto", alignItems: "center", columnGap: SPACE.xs, minWidth: 0, alignSelf: "stretch", padding: `${SPACE.sm}px ${SPACE.sm}px ${SPACE.sm}px ${SPACE.xs}px`, border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: "inherit", opacity: dim ? 0.55 : 1 }}>
          <span style={{ minWidth: 0, display: "block" }}>
            <span data-testid={`parcel-row-name-${row.id}`} style={{ display: "block", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: FONT_SIZE.emphasis, fontWeight: 650, color: "var(--text-primary)" }}>{row.name}</span>
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>{sub}</span>
          </span>
          <span style={{ minWidth: 48, textAlign: "right", fontSize: FONT_SIZE.emphasis, fontWeight: 650, color: "var(--text-primary)", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, textDecoration: row.included ? "none" : "line-through" }} data-testid={`parcel-row-acres-${row.id}`}>{fmt(row.acres)}</span>
        </button>
        <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "flex-end", gap: 0 }}>
          <button type="button" className={row.locked ? undefined : "land-row-hover"} onClick={() => handlers.onToggleLock(row.id)} aria-pressed={!!row.locked} data-testid={`parcel-row-lock-${row.id}`}
            aria-label={row.locked ? `Unlock ${row.name}` : `Lock ${row.name}`}
            title={row.locked ? "Locked — even Edit parcels can't change it. Click to unlock." : "Unlocked. Click to lock — keeps Edit parcels from changing this boundary."}
            style={{ ...iconBtn, width: 22, height: 22, color: "var(--text-secondary)" }}>{row.locked ? <LockGlyph size={13} /> : <UnlockGlyph size={13} />}</button>
          {renameable
            ? <button type="button" className="land-row-hover" style={{ ...iconBtn, width: 22, height: 22 }} title="Rename — opens the name field" aria-label={`Rename ${row.name}`} onClick={() => handlers.onOpenPage(row.id)} data-testid={`parcel-row-pencil-${row.id}`}><PencilIcon size={12} /></button>
            : null}
        </span>
        <button type="button" onClick={() => handlers.onToggleInclude(row.id)} aria-pressed={row.included} data-testid={`parcel-row-eye-${row.id}`}
          aria-label={row.included ? `Make ${row.name} not active` : `Make ${row.name} active`}
          title={row.included ? "Active — counted in the site total. Click to leave it out." : "Not active — left out of the site total. Click to count it."}
          style={{ ...iconBtn, justifySelf: "center", color: row.included ? "var(--text-primary)" : "var(--text-secondary)" }}>
          {row.included ? <EyeIcon /> : <EyeOffIcon />}
        </button>
        <RowMenu row={row} handlers={handlers} open={menu !== null} armed={menu === "confirm"} onOpen={() => setMenu("menu")} onClose={() => setMenu(null)} onArm={() => setMenu("confirm")} />
      </div>
    </div>
  );
}

export default function ParcelsPanel({
  rows, siteAcres, addMenu, splitMode, selectedId, pickMode, pickedIds, combinePreview, handlers,
}) {
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
    return rows.filter((r) => !q || [r.name, r.apn, r.owner].some((s) => s && String(s).toLowerCase().includes(q)));
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
  const rowList = useMemo(() => shown.map((row) => (
    <ParcelRow key={row.id} row={row} selected={selectedId === row.id} picked={!!pickedIds && pickedIds.has(row.id)} pickMode={!!pickMode} checked={checked.has(row.id)} handlers={H} />
  )), [shown, selectedId, pickedIds, pickMode, checked, H]);

  return (
    <div data-testid="parcels-panel" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {splitMode ? (
        <div data-testid="parcels-split-header" style={{ display: "flex", alignItems: "center", gap: SPACE.lg, padding: `${SPACE.md}px 0 ${SPACE.lg}px` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>Splitting {splitMode.name} · {fmt(splitMode.acres)} AC</div>
            <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", marginTop: 2 }}>Draw a line across it on the map, double-click to finish.</div>
          </div>
          <button type="button" style={textBtn} onClick={handlers.onCancelSplit} data-testid="parcels-split-cancel">Cancel</button>
        </div>
      ) : (
        <div data-testid="parcels-summary" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: SPACE.lg, padding: `${SPACE.xs}px 0 ${SPACE.lg}px` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: SPACE.sm, minWidth: 0 }}>
            <span data-testid="parcels-site-acres" style={{ fontSize: "calc(var(--font-display) * 1.5)", fontWeight: 800, color: "var(--text-primary)", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>{fmt(siteAcres)}</span>
            <span style={{ fontSize: FONT_SIZE.control, fontWeight: 700, color: "var(--text-secondary)" }}>AC in site</span>
          </div>
          <span data-testid="parcels-active-count" style={{ flex: "none", fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>{inCount} of {counted.length} parcels active</span>
        </div>
      )}

      {showFilter && (
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or account" aria-label="Filter parcels by name or account" data-testid="parcels-filter"
          onKeyDown={(e) => e.stopPropagation()}
          style={{ height: CONTROL_H.lg, marginBottom: SPACE.md, padding: `0 ${SPACE.lg}px`, border: LINE, borderRadius: RADIUS.sm, background: "var(--surface-field)", color: "var(--text-primary)", fontFamily: "inherit", fontSize: FONT_SIZE.control }} />
      )}

      {/* Column header — same grid as every row, so the eye sits directly under "Active". */}
      <div style={{ display: "grid", gridTemplateColumns: COLS, alignItems: "center", padding: `0 0 ${SPACE.xs}px`, border: "1px solid transparent", fontSize: FONT_SIZE.micro, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
        <span />
        <span style={{ display: "flex", justifyContent: "space-between", paddingLeft: SPACE.xs, paddingRight: SPACE.md }}><span>Parcel</span><span style={{ minWidth: 48, textAlign: "right" }}>Acres</span></span>
        <span />
        <span style={{ textAlign: "center" }} data-testid="parcels-active-head">Active</span>
        <span />
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: SPACE.xs }} data-testid="parcels-list">
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
            style={{ ...textBtn, background: "var(--accent-site)", color: "var(--on-accent-site)", borderColor: "var(--accent-site)", opacity: preview && preview.ok ? 1 : 0.5, cursor: preview && preview.ok ? "pointer" : "not-allowed" }}>Combine</button>
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
