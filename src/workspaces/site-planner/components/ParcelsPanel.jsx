/* The Land tab's Parcels table (Parcels panel redesign — NEW-1/2/3).
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
import { deedAcresSummed } from "../lib/parcelOps.js";

const LINE = "1px solid var(--border-default)";
const fmt = (n) => (Math.round(n * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/* ---- inline stroke icons (no emoji) ---- */
const Ico = ({ children, size = 15 }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);
const EyeIcon = () => <Ico><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></Ico>;
const EyeOffIcon = () => <Ico><path d="M3 3l18 18" /><path d="M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1" /><path d="M6.6 6.6A16.6 16.6 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.4-1" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></Ico>;
const LockGlyph = ({ size }) => <Ico size={size}><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></Ico>;
const UnlockGlyph = () => <Ico><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></Ico>;
const ZoomIcon = () => <Ico><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.2-4.2" /></Ico>;
const MoreIcon = () => <Ico><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></Ico>;
const PencilIcon = ({ size }) => <Ico size={size}><path d="M4 20h4L19 9l-4-4L4 16v4z" /><path d="M13.5 6.5l4 4" /></Ico>;
const SplitIcon = () => <Ico><path d="M4 4l16 16" /><rect x="3" y="3" width="18" height="18" rx="2" /></Ico>;
const CloseIcon = () => <Ico size={14}><path d="M6 6l12 12M18 6L6 18" /></Ico>;
const TrashIcon = () => <Ico><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></Ico>;

const iconBtn = {
  width: CONTROL_H.md, height: CONTROL_H.md, padding: 0, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center",
  borderRadius: RADIUS.sm, border: "1px solid transparent", background: "transparent", color: "var(--text-secondary)", cursor: "pointer",
};
const textBtn = {
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: SPACE.xs, height: CONTROL_H.lg, padding: `0 ${SPACE.lg}px`,
  borderRadius: RADIUS.sm, border: LINE, background: "var(--surface-raised)", color: "var(--text-primary)",
  fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
};

function Cell({ label, value }) {
  return (
    <div style={{ flex: 1, minWidth: 0, padding: `${SPACE.md}px ${SPACE.lg}px`, borderRight: LINE }}>
      <div style={{ fontSize: FONT_SIZE.micro, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-secondary)" }}>{label}</div>
      <div style={{ fontSize: FONT_SIZE.display, fontWeight: 700, color: "var(--text-primary)", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, marginTop: 1 }}>{value}</div>
    </div>
  );
}

function Tag({ children }) {
  return <span style={{ flex: "none", padding: "0 6px", borderRadius: RADIUS.pill, border: LINE, background: "var(--surface-page)", color: "var(--text-secondary)", fontSize: FONT_SIZE.micro, fontWeight: 700, lineHeight: "16px" }}>{children}</span>;
}

function Fact({ label, value }) {
  return (
    <div style={{ minWidth: 0 }}>
      <div style={{ fontSize: FONT_SIZE.micro, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-secondary)" }}>{label}</div>
      <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, overflowWrap: "anywhere", minHeight: 16 }} title={value || undefined}>{value || "—"}</div>
    </div>
  );
}

/* The inline detail card that opens under a row. */
function DetailCard({ row, handlers }) {
  const { pc } = row;
  const from = (pc.combined && pc.combined.from) || [];
  const isTract = from.length > 0;
  const sf = pc.splitFrom && pc.splitFrom.from;
  const deed = isTract ? deedAcresSummed(pc) : (pc.statedAcres != null && pc.statedAcres !== "" ? Number(pc.statedAcres) : null);
  return (
    <div role="region" aria-label={`${row.name} details`} data-testid={`parcel-detail-${row.id}`}
      style={{ margin: `0 0 ${SPACE.sm}px`, padding: SPACE.xl, border: LINE, borderTop: "none", borderRadius: `0 0 ${RADIUS.md}px ${RADIUS.md}px`, background: "var(--surface-raised)" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: SPACE.lg }}>
        <div style={{ minWidth: 0, fontSize: FONT_SIZE.emphasis, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{row.name}</div>
        <div style={{ flex: "none", fontSize: 20 /* design-exempt: detail-card headline, the one large number */, fontWeight: 800, color: "var(--text-primary)", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>{fmt(row.acres)} <span style={{ fontSize: FONT_SIZE.control, fontWeight: 700 }}>AC</span></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: `${SPACE.md}px ${SPACE.xl}px`, marginTop: SPACE.lg }}>
        <Fact label="Owner" value={row.owner} />
        <Fact label="APN" value={row.apn} />
        <Fact label={isTract ? "Deed acres, summed" : "Deed acres"} value={deed != null ? fmt(deed) : ""} />
        <Fact label="Drawn acres" value={fmt(row.acres)} />
      </div>
      {isTract && (
        <div style={{ marginTop: SPACE.xl }}>
          <div style={{ fontSize: FONT_SIZE.micro, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: SPACE.xs }}>Made from</div>
          {from.map((s, i) => {
            const ac = handlers.acresOf(s);
            return (
              <div key={s.id || i} style={{ display: "flex", alignItems: "baseline", gap: SPACE.md, padding: `${SPACE.xs}px 0`, borderTop: i ? LINE : "none", fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.snapName || "Parcel"}>{(s.snapName || "Parcel")}</span>
                <span style={{ flex: "none", color: "var(--text-secondary)", fontFamily: NUM_FONT }}>{s.acct || ""}</span>
                <span style={{ flex: "none", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>{fmt(ac)} AC</span>
              </div>
            );
          })}
        </div>
      )}
      {sf && (
        <div style={{ marginTop: SPACE.xl, display: "flex", alignItems: "center", gap: SPACE.md, fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>
          <span style={{ color: "var(--text-secondary)" }}>Split from</span>
          <strong style={{ minWidth: 0, overflowWrap: "anywhere" }}>{(sf.snapName || "the original")}</strong>
          <button type="button" style={{ ...textBtn, marginLeft: "auto" }} onClick={() => handlers.onRestoreSplit(row.id)} data-testid={`parcel-restore-split-${row.id}`}>Restore original</button>
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: SPACE.md, marginTop: SPACE.xl }}>
        <button type="button" style={textBtn} onClick={() => handlers.onZoom(row.id)}><ZoomIcon /> Zoom to</button>
        {isTract ? (
          <>
            <button type="button" style={textBtn} onClick={() => handlers.onSplit(row.id)} data-testid={`parcel-split-${row.id}`}><SplitIcon /> Split</button>
            <button type="button" style={textBtn} onClick={() => handlers.onRestoreCombined(row.id)} data-testid={`parcel-restore-combined-${row.id}`}>Restore {from.length} originals</button>
          </>
        ) : (
          <>
            <button type="button" style={textBtn} onClick={() => handlers.onSplit(row.id)} data-testid={`parcel-split-${row.id}`}><SplitIcon /> Split</button>
            <button type="button" style={textBtn} onClick={() => handlers.onToggleLock(row.id)}>{row.locked ? <><UnlockGlyph /> Unlock</> : <><LockGlyph /> Lock</>}</button>
            <button type="button" style={{ ...textBtn, color: "var(--danger-text)", borderColor: "var(--danger-border)" }} onClick={() => handlers.onRemove(row.id)} data-testid={`parcel-remove-${row.id}`}><TrashIcon /> Remove</button>
          </>
        )}
      </div>
    </div>
  );
}

/* A single table row. Selection checkbox · name block (opens the detail card) · acres · eye. */
function ParcelRow({ row, open, selected, picked, pickMode, checked, renaming, menuOpen, handlers }) {
  const { pc } = row;
  const dim = !row.included || row.superseded;
  const ink = { color: "var(--text-primary)" };
  const sub = [row.apn, row.owner].filter(Boolean).join(" · ");
  return (
    <div style={{ marginLeft: row.depth * SPACE.xl }}>
      <div className="land-parcel-row" data-testid={`parcel-table-row-${row.id}`} data-included={row.included ? "1" : "0"}
        style={{ position: "relative", display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto 34px", alignItems: "center", minHeight: 52, border: picked ? "1px solid var(--accent-site)" : LINE, borderRadius: open ? `${RADIUS.md}px ${RADIUS.md}px 0 0` : RADIUS.md, background: selected || picked ? "var(--surface-selected)" : "var(--surface-raised)", opacity: dim ? 0.62 : 1 }}>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", cursor: "pointer" }}>
          <input type="checkbox" checked={checked} onChange={() => handlers.onCheck(row.id)} aria-label={`Select ${row.name}`} data-testid={`parcel-row-check-${row.id}`} style={{ width: 15, height: 15, cursor: "pointer" }} />
        </label>
        {renaming ? (
          <RenameField row={row} handlers={handlers} />
        ) : (
          <button type="button" onClick={() => handlers.onRowClick(row.id, pickMode)} aria-expanded={pickMode ? undefined : open} aria-pressed={pickMode ? picked : undefined} data-testid={`parcel-row-${row.id}`}
            title={`${row.name}${sub ? ` — ${sub}` : ""}`}
            style={{ gridColumn: "2 / 4", display: "flex", alignItems: "center", gap: SPACE.md, minWidth: 0, height: "100%", padding: `${SPACE.sm}px ${SPACE.md}px ${SPACE.sm}px ${SPACE.xs}px`, border: "none", background: "transparent", textAlign: "left", cursor: "pointer", fontFamily: "inherit" }}>
            <span style={{ flex: 1, minWidth: 0, display: "block" }}>
              <span style={{ display: "flex", alignItems: "center", gap: SPACE.sm, minWidth: 0 }}>
                <span style={{ ...ink, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: FONT_SIZE.emphasis, fontWeight: 650 }}>{row.name}</span>
                {row.locked && <span style={{ flex: "none", display: "inline-flex", color: "var(--text-secondary)" }} aria-label="Locked" title="Locked"><LockGlyph size={12} /></span>}
                {row.combined && <Tag>Combined</Tag>}
                {row.splitFrom && <Tag>Split</Tag>}
                {row.superseded && <Tag>Split parent</Tag>}
              </span>
              <span style={{ display: "block", minHeight: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>{sub}</span>
            </span>
            <span style={{ flex: "none", minWidth: 64, textAlign: "right", fontSize: FONT_SIZE.emphasis, fontWeight: 650, ...ink, fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>{fmt(row.acres)}</span>
          </button>
        )}
        <button type="button" onClick={() => handlers.onToggleInclude(row.id)} aria-pressed={row.included} data-testid={`parcel-row-eye-${row.id}`}
          aria-label={row.included ? `Exclude ${row.name} from the site total` : `Include ${row.name} in the site total`}
          title={row.included ? "In the site total — click to exclude" : "Excluded from the site total — click to include"}
          style={{ ...iconBtn, gridColumn: 4, margin: "0 auto", color: row.included ? "var(--text-primary)" : "var(--text-secondary)" }}>
          {row.included ? <EyeIcon /> : <EyeOffIcon />}
        </button>
        {/* Row actions: hover / keyboard-focus only (.land-row-actions, index.css). Sit under the acres column. */}
        <div className="land-row-actions" style={{ position: "absolute", right: 36, bottom: 3, display: "flex", gap: 2, background: selected ? "var(--surface-selected)" : "var(--surface-raised)", borderRadius: RADIUS.sm }}>
          <button type="button" style={iconBtn} title="Zoom to this parcel" aria-label={`Zoom to ${row.name}`} onClick={() => handlers.onZoom(row.id)}><ZoomIcon /></button>
          <button type="button" style={iconBtn} title={row.locked ? "Unlock this parcel's boundary" : "Lock this parcel's boundary"} aria-label={row.locked ? `Unlock ${row.name}` : `Lock ${row.name}`} onClick={() => handlers.onToggleLock(row.id)}>{row.locked ? <UnlockGlyph /> : <LockGlyph />}</button>
          <div style={{ position: "relative" }}>
            <button type="button" style={iconBtn} title="More" aria-label={`More actions for ${row.name}`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => handlers.onMenu(menuOpen ? null : row.id)} data-testid={`parcel-row-more-${row.id}`}><MoreIcon /></button>
            {menuOpen && (
              <div role="menu" style={{ position: "absolute", right: 0, top: CONTROL_H.md, zIndex: 5, minWidth: 150, padding: SPACE.xs, border: LINE, borderRadius: RADIUS.md, background: "var(--surface-raised)", boxShadow: "var(--shadow-popover, 0 4px 14px var(--border-strong))" }}>
                <MenuRow label="Split…" onClick={() => handlers.onSplit(row.id)} testid={`parcel-menu-split-${row.id}`} />
                <MenuRow label="Rename" onClick={() => handlers.onRename(row.id)} />
                <MenuRow label="Remove" danger onClick={() => handlers.onRemove(row.id)} />
              </div>
            )}
          </div>
        </div>
        {row.splitFrom && !renaming && (
          <button type="button" style={{ ...iconBtn, position: "absolute", left: 28, top: 3, width: 18, height: 18 }} title="Rename this piece" aria-label={`Rename ${row.name}`} onClick={() => handlers.onRename(row.id)} data-testid={`parcel-row-pencil-${row.id}`}><PencilIcon size={11} /></button>
        )}
      </div>
      {open && <DetailCard row={row} handlers={handlers} />}
    </div>
  );
}

function MenuRow({ label, onClick, danger, testid }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} data-testid={testid}
      style={{ display: "block", width: "100%", textAlign: "left", padding: `${SPACE.sm}px ${SPACE.lg}px`, border: "none", borderRadius: RADIUS.sm, background: "transparent", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, color: danger ? "var(--danger-text)" : "var(--text-primary)", cursor: "pointer" }}>{label}</button>
  );
}

/* Inline rename — commit on Enter / click-away, Esc cancels (no dialog boxes). */
function RenameField({ row, handlers }) {
  const [v, setV] = useState(row.name);
  const ref = useRef(null);
  useEffect(() => { if (ref.current) { ref.current.focus(); ref.current.select(); } }, []);
  const done = useRef(false);
  const commit = () => { if (done.current) return; done.current = true; handlers.onRenameCommit(row.id, v); };
  return (
    <input ref={ref} value={v} aria-label={`Rename ${row.name}`} data-testid={`parcel-rename-${row.id}`}
      onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") commit(); else if (e.key === "Escape") { done.current = true; handlers.onRenameCommit(row.id, null); } }}
      style={{ gridColumn: "2 / 4", minWidth: 0, margin: `0 ${SPACE.md}px 0 ${SPACE.xs}px`, height: CONTROL_H.lg, padding: `0 ${SPACE.md}px`, border: "1px solid var(--accent-site)", borderRadius: RADIUS.sm, background: "var(--surface-field)", color: "var(--text-primary)", fontFamily: "inherit", fontSize: FONT_SIZE.emphasis, fontWeight: 600 }} />
  );
}

export default function ParcelsPanel({
  rows, siteAcres, headerRight, allLocked, splitMode, selectedId, openRequest, pickMode, pickedIds,
  combinePreview, handlers,
}) {
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState(null); // null | "asc" | "desc"
  const [openId, setOpenId] = useState(null);
  const [checked, setChecked] = useState(() => new Set());
  const [menuId, setMenuId] = useState(null);
  const [renamingId, setRenamingId] = useState(null);
  const listRef = useRef(null);

  // A combine (panel or map) asks for its tract's card to open.
  useEffect(() => { if (openRequest && openRequest.id) setOpenId(openRequest.id); }, [openRequest]);
  // Drop checks / open card for parcels that no longer exist (combine, split, remove, undo).
  const liveIds = useMemo(() => new Set(rows.map((r) => r.id)), [rows]);
  useEffect(() => {
    setChecked((c) => { const n = new Set([...c].filter((id) => liveIds.has(id))); return n.size === c.size ? c : n; });
    setOpenId((o) => (o && !liveIds.has(o) ? null : o));
    setRenamingId((o) => (o && !liveIds.has(o) ? null : o));
  }, [liveIds]);
  // Close the row menu on outside click / Escape.
  useEffect(() => {
    if (!menuId) return undefined;
    const off = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !(e.target.closest && e.target.closest("[role=menu]"))) setMenuId(null); };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", off);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", off); };
  }, [menuId]);
  // Bring a freshly opened card into view.
  useEffect(() => {
    if (!openId || !listRef.current) return;
    const el = listRef.current.querySelector(`[data-testid="parcel-detail-${openId}"]`);
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [openId]);

  const counted = rows.filter((r) => !r.superseded);
  const inCount = counted.filter((r) => r.included).length;
  const lockedCount = counted.filter((r) => r.locked).length;

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    let list = rows.filter((r) => !q || [r.name, r.apn, r.owner].some((s) => s && String(s).toLowerCase().includes(q)));
    if (sort) list = [...list].sort((a, b) => (sort === "asc" ? a.acres - b.acres : b.acres - a.acres));
    return list;
  }, [rows, filter, sort]);

  const allChecked = shown.length > 0 && shown.every((r) => checked.has(r.id));
  const someChecked = shown.some((r) => checked.has(r.id));
  const checkedIds = [...checked].filter((id) => liveIds.has(id));
  const checkedAcres = rows.filter((r) => checked.has(r.id)).reduce((s, r) => s + r.acres, 0);
  const checkedKey = checkedIds.join("|");
  const preview = useMemo(() => (checkedIds.length >= 2 ? combinePreview(checkedIds) : null), [checkedKey, rows]); // eslint-disable-line react-hooks/exhaustive-deps
  const allCheckedLocked = checkedIds.length > 0 && rows.filter((r) => checked.has(r.id)).every((r) => r.locked);

  const H = useMemo(() => ({
    ...handlers,
    onCheck: (id) => setChecked((c) => { const n = new Set(c); if (n.has(id)) n.delete(id); else n.add(id); return n; }),
    onRowClick: (id, picking) => { if (picking) { handlers.onPickRow(id); return; } setOpenId((o) => (o === id ? null : id)); handlers.onSelectRow(id); },
    onMenu: setMenuId,
    onRename: (id) => { setMenuId(null); setRenamingId(id); },
    onRenameCommit: (id, v) => { setRenamingId(null); if (v != null) handlers.onRename(id, v); },
    onSplit: (id) => { setMenuId(null); handlers.onSplit(id); },
    onRemove: (id) => { setMenuId(null); handlers.onRemove(id); },
  }), [handlers]);
  // The row list only re-renders when something it shows changed — never on a pan / zoom frame.
  const rowList = useMemo(() => shown.map((row) => (
    <ParcelRow key={row.id} row={row} open={openId === row.id} selected={selectedId === row.id} picked={!!pickedIds && pickedIds.has(row.id)} pickMode={!!pickMode} checked={checked.has(row.id)}
      renaming={renamingId === row.id} menuOpen={menuId === row.id} handlers={H} />
  )), [shown, openId, selectedId, pickedIds, pickMode, checked, renamingId, menuId, H]);

  return (
    <div data-testid="parcels-panel" style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      {/* Header — or, while splitting, the one instruction */}
      {splitMode ? (
        <div data-testid="parcels-split-header" style={{ display: "flex", alignItems: "center", gap: SPACE.lg, padding: `${SPACE.md}px 0 ${SPACE.lg}px` }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700, color: "var(--text-primary)", overflowWrap: "anywhere" }}>Splitting {splitMode.name} · {fmt(splitMode.acres)} AC</div>
            <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", marginTop: 2 }}>Draw a line across it on the map, double-click to finish.</div>
          </div>
          <button type="button" style={textBtn} onClick={handlers.onCancelSplit} data-testid="parcels-split-cancel">Cancel</button>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: SPACE.md, padding: `${SPACE.xs}px 0 ${SPACE.lg}px` }}>
          <div style={{ fontSize: FONT_SIZE.display, fontWeight: 700, color: "var(--text-primary)" }}>Parcels</div>
          <span data-testid="parcels-count" style={{ padding: "0 7px", borderRadius: RADIUS.pill, background: "var(--surface-page)", border: LINE, fontSize: FONT_SIZE.label, fontWeight: 700, color: "var(--text-primary)", lineHeight: "18px" }}>{counted.length}</span>
          <span style={{ flex: 1 }} />
          <button type="button" style={textBtn} onClick={() => handlers.onSplit(null)} data-testid="parcels-split-btn" title="Split a parcel by drawing a line across it"><SplitIcon /> Split</button>
          {headerRight}
        </div>
      )}

      {/* Stat strip */}
      <div style={{ display: "flex", border: LINE, borderRight: "none", borderRadius: RADIUS.md, background: "var(--surface-raised)", overflow: "hidden", marginBottom: SPACE.lg }}>
        <Cell label="Site acres" value={<span data-testid="parcels-site-acres">{fmt(siteAcres)}</span>} />
        <Cell label="In site" value={<span data-testid="parcels-in-site">{inCount}</span>} />
        <Cell label="Locked" value={<span data-testid="parcels-locked">{lockedCount}</span>} />
      </div>

      {/* Filter + Lock all */}
      <div style={{ display: "flex", alignItems: "center", gap: SPACE.md, marginBottom: SPACE.md }}>
        <input type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter by name or APN" aria-label="Filter parcels by name or APN" data-testid="parcels-filter"
          onKeyDown={(e) => e.stopPropagation()}
          style={{ flex: 1, minWidth: 0, height: CONTROL_H.lg, padding: `0 ${SPACE.lg}px`, border: LINE, borderRadius: RADIUS.sm, background: "var(--surface-field)", color: "var(--text-primary)", fontFamily: "inherit", fontSize: FONT_SIZE.control }} />
        <button type="button" style={textBtn} onClick={handlers.onToggleAllLock} data-testid="parcels-lock-all"
          title={allLocked ? "Unlock every parcel's boundary" : "Lock every parcel's boundary — none can be moved or reshaped on the map until unlocked"}>
          {allLocked ? <><UnlockGlyph /> Unlock all</> : <><LockGlyph /> Lock all</>}
        </button>
      </div>

      {/* Column header */}
      <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto 34px", alignItems: "center", padding: `0 0 ${SPACE.xs}px`, fontSize: FONT_SIZE.micro, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
        <label style={{ display: "flex", justifyContent: "center", cursor: "pointer" }}>
          <input type="checkbox" checked={allChecked} ref={(el) => { if (el) el.indeterminate = !allChecked && someChecked; }} aria-label="Select all parcels"
            onChange={() => setChecked(allChecked ? new Set() : new Set(shown.map((r) => r.id)))} data-testid="parcels-select-all" style={{ width: 15, height: 15, cursor: "pointer" }} />
        </label>
        <span style={{ paddingLeft: SPACE.xs }}>Parcel</span>
        <button type="button" onClick={() => setSort((s) => (s === null ? "desc" : s === "desc" ? "asc" : null))} data-testid="parcels-sort-acres"
          aria-label={`Sort by acres${sort ? `, currently ${sort === "desc" ? "largest first" : "smallest first"}` : ""}`}
          style={{ minWidth: 64, textAlign: "right", border: "none", background: "transparent", padding: 0, font: "inherit", letterSpacing: "inherit", textTransform: "inherit", color: "inherit", cursor: "pointer" }}>
          Acres{sort === "desc" ? " ↓" : sort === "asc" ? " ↑" : ""}
        </button>
        <span style={{ textAlign: "center" }}>In</span>
      </div>

      <div ref={listRef} style={{ display: "flex", flexDirection: "column", gap: SPACE.xs }} data-testid="parcels-list">
        {rowList}
        {!shown.length && <div style={{ padding: SPACE.xl, fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>No parcels match “{filter}”.</div>}
      </div>

      {/* Footer */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: SPACE.lg, padding: `${SPACE.lg}px 0 ${SPACE.xs}px`, fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>
        <span data-testid="parcels-showing">Showing {shown.length} of {rows.length}</span>
        <span style={{ fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, color: "var(--text-primary)", fontWeight: 650 }}>{fmt(siteAcres)} AC in site</span>
      </div>

      {/* Bulk-action bar */}
      {checkedIds.length >= 2 && (
        <div role="toolbar" aria-label="Actions for selected parcels" data-testid="parcels-action-bar"
          style={{ position: "sticky", bottom: SPACE.md, marginTop: SPACE.md, display: "flex", alignItems: "center", gap: SPACE.md, padding: `${SPACE.md}px ${SPACE.lg}px`, borderRadius: RADIUS.lg, background: "var(--text-primary)", color: "var(--surface-raised)", boxShadow: "0 4px 14px var(--border-strong)" }}>
          <div style={{ flex: 1, minWidth: 0, fontSize: FONT_SIZE.control }}>
            <div style={{ fontWeight: 700 }}>{checkedIds.length} selected</div>
            <div data-testid="parcels-action-reason" style={{ fontSize: FONT_SIZE.label, overflowWrap: "anywhere" }}>{fmt(checkedAcres)} AC · {preview && preview.ok ? "all touching" : (preview && preview.message) || ""}</div>
          </div>
          <button type="button" onClick={() => handlers.onLockMany(checkedIds)} data-testid="parcels-bar-lock"
            style={{ ...textBtn, background: "transparent", color: "inherit", borderColor: "var(--surface-raised)" }}>{allCheckedLocked ? "Unlock" : "Lock"}</button>
          <button type="button" disabled={!(preview && preview.ok)} onClick={() => { handlers.onCombine(checkedIds); setChecked(new Set()); }} data-testid="parcels-bar-combine"
            title={preview && !preview.ok ? preview.message : "Combine the selected parcels into one"}
            style={{ ...textBtn, background: "var(--accent-site)", color: "var(--on-accent-site)", borderColor: "var(--accent-site)", opacity: preview && preview.ok ? 1 : 0.5, cursor: preview && preview.ok ? "pointer" : "not-allowed" }}>Combine</button>
          <button type="button" onClick={() => setChecked(new Set())} aria-label="Clear selection" data-testid="parcels-bar-clear" style={{ ...iconBtn, color: "inherit" }}><CloseIcon /></button>
        </div>
      )}
    </div>
  );
}
