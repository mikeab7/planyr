/* @planner-extract — AUDIT BATCH G1: the loading-wall rows editor (WallRows and its helpers), moved verbatim out of SitePlanner.jsx.
 * Behaviour-identical; see test/helpers/plannerSource.js. */
import { ADD_GROUP, stripPlan, legendKinds, KIND_LABEL, TRAILER_MAX_ROWS, TRAILER_MIN_ROW_DEPTH, bumpSummary, orderedAddOptions, STRIP, pieceLabel, chipLabel, pieceTooltip, pieceShowsIcon } from "../lib/wallRows.js";
import { FONT_SIZE, CONTROL_H, SPACE } from "../../../shared/ui/designTokens.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { WALL_PIECE_EDGE, WALL_PIECE_TEXT } from "../lib/planStyle.js";
import WallKindIcon from "./WallKindIcon.jsx";
import { useState, useRef, useEffect, useCallback } from "react";
import { BORDER_1, SURF_RAISED } from "../lib/plannerShared.js";
import { NumInput } from "./NumInput.jsx";
import { TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { Field } from "./PropFields.jsx";
import { ROW4 } from "../lib/plannerConstants.js";
import { commaDec1 as f1 } from "../../../shared/units/numberFormat.js";


/* WallRows — "Docks & walls" (Building panel v3, NEW-4). ONE strip per wall (a cross-dock building's two dock
   walls included): a left cell (badge with the wall's compass letter(s) + its role word), then a BAR whose pieces
   are that wall's layers outward, left → right (the building is at the left), then a dashed "+". Bar length is
   proportional to the wall's total depth on a scale shared by every wall of this building (`stripPlan`); a piece's
   fill IS its layer's plan colour, so the strip and the canvas always match. A piece opens ONE compact edit box
   directly under its row (a caret points up at the piece); a legend under the last row names the kinds present.
   Bump-outs are NOT a dock-row chip any more: one line under the wall picker (`Bump-outs n · a × p ft` + edit).
   Presentational and module-scope (MODULE-SCOPE-COMPONENTS): every edit is a callback into SitePlanner's per-wall
   handlers, which take the row's `sides`. Theme tokens only (the few literals live in planStyle.js).
   rows: [{ key, role, sides, badge, isDock, layers:[{id,kind,depth,fill,rows,aisle,rowDepths,index,split}],
            bump:{ n, ends:[{sign,label,on}], along, proj } | null }] */
const WALL_LEFT_W = 58;
function WallBinGlyph() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ display: "block" }}>
      <path d="M2.5 4.2h11M6.2 4.2V2.6h3.6v1.6M4 4.2l.6 9.2h6.8l.6-9.2M6.6 6.8v4.4M9.4 6.8v4.4" />
    </svg>
  );
}
/* WallAddControl — the end of a wall row (NEW-1 amendment of B2651024, owner 2026-11-04: "Put every option on the row as its own
   icon, no ▾."): a small plus glyph (NOT a button) followed by ONE icon button per entry of `opts` (`orderedAddOptions`, exactly the
   set `addOptions` allows, in that order, so the likely next layer is the leftmost icon). Each button is the layer's legend swatch —
   the SAME fill as the strip piece (`fillFor`) — with `WallKindIcon` inside; no word on it, the full name is in its aria-label and
   title ("Add car parking to the End wall (N)" / "Add car parking to this wall"). One press adds that layer through `onAdd` (the same
   `addWallLayer` / `addLayerOnSide` path as before). Nothing at all when `opts` is empty (after a Road). No menu, no open state, so
   it is a plain module-scope component (MODULE-SCOPE-COMPONENTS) and its buttons stay usable after every press. */
function WallAddControl({ row, opts, onAdd, fillFor }) {
  if (!opts.length) return null;
  const wallName = `${{ dock: "Dock", rear: "Rear", ends: "End", sides: "Side" }[row.role] || "Wall"} wall (${row.badge})`;
  return (
    <span data-testid="wall-add-group" data-wall-add="1" style={{ flex: "none", display: "inline-flex", alignItems: "center", gap: ADD_GROUP.GAP }}>
      <span aria-hidden="true" data-testid="wall-add-plus" style={{ flex: "none", width: ADD_GROUP.PLUS_W, textAlign: "center", fontSize: FONT_SIZE.control, fontWeight: 700, lineHeight: 1, color: "var(--accent-text, var(--accent))" }}>+</span>
      {opts.map((o) => (
        <button key={o.key} type="button" data-testid={`wall-add-${o.key}`} data-kind={o.key} data-wall-add="1"
          aria-label={`Add ${o.label.toLowerCase()} to the ${wallName}`} title={`Add ${o.label.toLowerCase()} to this wall`}
          style={{ flex: "none", boxSizing: "border-box", width: ADD_GROUP.ICON, height: ADD_GROUP.ICON, padding: 0, display: "grid", placeItems: "center", cursor: "pointer",
            border: "1px solid var(--accent)", borderRadius: RADIUS.sm, background: fillFor(o.key),
            boxShadow: o.key === "sidewalk" ? `inset 0 0 0 1px ${WALL_PIECE_EDGE}` : "none" }}
          onClick={() => onAdd(o.key)}>
          <WallKindIcon kind={o.key} size={14} />
        </button>
      ))}
    </span>
  );
}
export function WallRows({ rows, ops, numInput: _numInput, canEditBumps, kindFills }) {
  const [open, setOpen] = useState(null);          // { rowKey, id } — the one piece whose edit box is open
  const [pending, setPending] = useState(null);    // { rowKey, kind, before } — open the layer a just-pressed add created
  const [bumpOpen, setBumpOpen] = useState(false); // the bump-outs editor under the "Bump-outs" line
  const boxRef = useRef(null);
  useEffect(() => {
    if (!pending) return;
    const row = rows.find((r) => r.key === pending.rowKey);
    // The NEW layer is the outermost of its kind (a second trailer piece must not reopen the first one).
    const ofKind = row ? row.layers.filter((l) => l.kind === pending.kind) : [];
    if (row && ofKind.length > pending.before) { setOpen({ rowKey: row.key, id: ofKind[ofKind.length - 1].id }); setPending(null); return; }
    // NEW-1 (2026-11-04) — "+ parking" on a wall that already has parking adds ROWS, not a layer: the count of parking layers
    // does not rise, the layer's row count does. Open its box (Rows ready) once the rows rise.
    if (row && pending.kind === "parking" && pending.beforeRows != null && ofKind[0] && (ofKind[0].rows || 0) > pending.beforeRows) { setOpen({ rowKey: row.key, id: ofKind[0].id }); setPending(null); }
  }, [pending, rows]);
  // The open piece may vanish (removed, undone): close its box rather than leave it pointing at nothing.
  useEffect(() => {
    if (!open) return;
    const row = rows.find((r) => r.key === open.rowKey);
    if (!row || !row.layers.some((l) => l.id === open.id)) setOpen(null);
  }, [open, rows]);
  // Editor-exit contract: click-away COMMITS what is typed (blur first, then close), Escape abandons it.
  const commitAndClose = useCallback(() => {
    const ae = typeof document !== "undefined" ? document.activeElement : null;
    if (ae && boxRef.current && boxRef.current.contains(ae) && typeof ae.blur === "function") ae.blur();
    setOpen(null);
  }, []);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (t && t.closest && (t.closest('[data-testid="wall-edit-box"]') || t.closest('[data-testid="wall-piece"]') || t.closest('[data-wall-add]'))) return;
      commitAndClose();
    };
    const onKey = (e) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(null); } };
    document.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", onDown, true); window.removeEventListener("keydown", onKey, true); };
  }, [open, commitAndClose]);

  const muted = { fontSize: FONT_SIZE.label, color: "var(--text-tertiary)" };
  const toggleBtn = (on) => ({ minWidth: 30, height: CONTROL_H.md, padding: "0 8px", fontSize: FONT_SIZE.control, fontWeight: 700, borderRadius: RADIUS.sm, border: on ? "1px solid var(--accent)" : BORDER_1, background: on ? "var(--accent)" : SURF_RAISED, color: on ? "var(--on-accent)" : "var(--text-primary)", fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" });
  const link = { padding: 0, border: "none", background: "transparent", color: "var(--accent-text, var(--accent))", cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.label, fontWeight: 600, textDecoration: "underline", textUnderlineOffset: 2 };
  const badgeStyle = (row) => row.role === "dock"
    ? { background: "var(--accent)", color: "var(--on-accent)", border: "1px solid var(--accent)" }
    : row.role === "rear"
      ? { background: "transparent", color: "var(--accent-text, var(--accent))", border: "1px solid var(--accent)" }
      : { background: "var(--surface-field)", color: "var(--text-secondary)", border: BORDER_1 };
  const boxStyle = { margin: `${SPACE.sm}px 0`, padding: SPACE.md, borderRadius: RADIUS.sm, border: BORDER_1, background: "var(--surface-field)", display: "flex", flexDirection: "column", gap: SPACE.md, position: "relative" };

  const plan = stripPlan(rows);
  const legend = legendKinds(rows);
  const openRow = open ? rows.find((r) => r.key === open.rowKey) : null;
  const openLayer = openRow ? openRow.layers.find((l) => l.id === open.id) : null;
  const dockRows = rows.filter((r) => r.isDock && r.bump);
  const bumpN = dockRows.reduce((t, r) => t + r.bump.n, 0);
  const bumpRef = dockRows.find((r) => r.bump.n > 0) || dockRows[0];
  const allDockSides = dockRows.flatMap((r) => r.sides);

  const swatch = (layer, w = 20, h = 20) => (
    <span aria-hidden="true" style={{ flex: "none", width: w, height: h, borderRadius: RADIUS.sm, background: layer.fill, display: "grid", placeItems: "center", boxShadow: layer.kind === "sidewalk" ? `inset 0 0 0 1px ${WALL_PIECE_EDGE}` : "none" }}>
      <WallKindIcon kind={layer.kind} size={Math.round(Math.min(w, h) * 0.7)} />
    </span>
  );
  const numField = (label, input) => <span style={{ display: "inline-flex", alignItems: "center", gap: SPACE.sm }}><span style={muted}>{label}</span>{input}</span>;

  // The one-line edit box. NO wall name, NO long title, NO total-depth text, NO close button, NO note — a swatch, the
  // short name, the editable numbers (right-aligned) and the bin.
  const editBox = (row, layer, caretX) => {
    const isCourt = layer.kind === "court";
    const binTitle = isCourt ? "Removes the truck court and its trailer parking; everything outside moves in" : "Remove — anything outside it moves in";
    const bin = (
      <button type="button" className="wall-bin" data-testid="wall-piece-remove" aria-label={`Remove ${KIND_LABEL[layer.kind]}`} title={binTitle}
        onClick={() => { setOpen(null); ops.remove(row, layer); }}
        style={{ flex: "none", width: CONTROL_H.md, height: CONTROL_H.md, padding: 0, display: "grid", placeItems: "center", border: "none", borderRadius: RADIUS.sm, background: "transparent", cursor: "pointer" }}>
        <WallBinGlyph />
      </button>
    );
    const head = (numbers) => (
      <span style={{ display: "flex", alignItems: "center", gap: SPACE.md }}>
        {swatch(layer)}
        <span style={{ fontSize: FONT_SIZE.control, fontWeight: 700, color: "var(--text-primary)" }}>{KIND_LABEL[layer.kind]}</span>
        <span style={{ flex: 1 }} />
        {numbers}
        {bin}
      </span>
    );
    let body;
    if (layer.kind === "parking") {
      const en = !layer.split && !ops.footEdit;
      body = head(numField("Rows", <NumInput boxed boxWidth={64} ariaLabel="Parking rows" testid="wall-parking-rows" value={layer.rows} min={0} max={24} step={1} onCommit={(n) => { if (en) ops.parkingRows(row, n); }} />));
    } else if (layer.kind === "trailer" && !layer.wallKid) {
      // NEW-1 (2026-11-03): one row ⇒ ONE line — Rows and Depth. Two or more ⇒ Rows on the first line, then Row 1, Row 2 … and
      // the Aisle together on a second. (The single row's depth is still stored as row 1 — `trailerRowDepth(…, 0, …)`.)
      const rowsField = numField("Rows", <NumInput boxed boxWidth={56} ariaLabel="Trailer rows" testid="wall-trailer-rows" value={layer.rows} min={1} max={TRAILER_MAX_ROWS} step={1} onCommit={(n) => ops.trailerRows(row, layer, n)} />);
      // The Rows field keeps ONE position in both shapes (so changing 1 ↔ 2 rows never remounts it and drops focus).
      body = (
        <>
          {head(<>{rowsField}{layer.rows < 2 && numField("Depth", <NumInput boxed unit="ft" boxWidth={84} ariaLabel="Trailer depth" testid="wall-trailer-row-1" value={layer.rowDepths[0]} min={TRAILER_MIN_ROW_DEPTH} step={1} coarse={5} onCommit={(n) => ops.trailerRowDepth(row, layer, 0, n)} />)}</>)}
          {layer.rows >= 2 && (
            <span data-testid="wall-trailer-rowline" style={{ display: "flex", flexWrap: "wrap", justifyContent: "flex-end", columnGap: SPACE.sm, rowGap: SPACE.md }}>
              {layer.rowDepths.map((d, i) => numField(`Row ${i + 1}`, <NumInput key={i} boxed boxWidth={46} ariaLabel={`Trailer row ${i + 1} depth`} testid={`wall-trailer-row-${i + 1}`} value={d} min={TRAILER_MIN_ROW_DEPTH} step={1} coarse={5} onCommit={(n) => ops.trailerRowDepth(row, layer, i, n)} />))}
              {numField("Aisle", <NumInput boxed boxWidth={46} ariaLabel="Aisle between trailer rows" testid="wall-trailer-aisle" value={layer.aisle} min={0} step={1} coarse={5} onCommit={(n) => ops.trailerAisle(row, layer, n)} />)}
            </span>
          )}
        </>
      );
    } else {
      body = head(numField("Depth", <NumInput boxed unit="ft" boxWidth={84} ariaLabel="Depth" testid="wall-depth" value={layer.depth} min={1} step={1} coarse={5} onCommit={(n) => ops.depth(row, layer, n)} />));
    }
    return (
      <div ref={boxRef} data-testid="wall-edit-box" data-kind={layer.kind} style={boxStyle}>
        <span aria-hidden="true" data-testid="wall-edit-caret" style={{ position: "absolute", top: -5, left: caretX - 5, width: 8, height: 8, transform: "rotate(45deg)", background: "var(--surface-field)", borderTop: BORDER_1, borderLeft: BORDER_1 }} />
        {body}
      </div>
    );
  };

  const bumpEditor = () => (
    <div data-testid="bump-editor" style={{ ...boxStyle, marginTop: SPACE.sm }}>
      {dockRows.map((r) => (
        <span key={r.key} data-wall={r.sides.join(",")} style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>
          <span style={muted}>{dockRows.length > 1 ? `${r.badge} wall · At` : "At"}</span>
          {r.bump.ends.map((e) => (
            <button key={e.sign} type="button" data-testid={`bump-end-${e.sign < 0 ? "start" : "end"}`} data-wall={r.sides.join(",")} aria-pressed={e.on} disabled={!canEditBumps}
              title={canEditBumps ? `${e.on ? "Remove" : "Add"} the bump-out at the ${e.label} end${dockRows.length > 1 ? ` of the ${r.badge} wall` : ""}` : "Reset the footprint to a rectangle first — bump-outs anchor to square corners"}
              onClick={() => ops.bumpEnd(r, e.sign)} style={{ ...toggleBtn(e.on), opacity: canEditBumps ? 1 : 0.5 }}>{e.label}</button>
          ))}
        </span>
      ))}
      <span style={{ display: "flex", alignItems: "center", gap: SPACE.sm, flexWrap: "wrap" }}>
        <span style={muted}>Size</span>
        <span title="Along the dock wall"><NumInput boxed boxWidth={64} ariaLabel="Bump-out size along the dock wall" value={bumpRef.bump.along} min={1} step={1} coarse={5} onCommit={(n) => ops.bumpSize({ sides: allDockSides }, n, bumpRef.bump.proj)} /></span>
        <span style={muted}>×</span>
        <span title="Out from the dock face"><NumInput boxed unit="ft" boxWidth={92} ariaLabel="Bump-out size out from the dock face" value={bumpRef.bump.proj} min={1} step={1} coarse={5} onCommit={(n) => ops.bumpSize({ sides: allDockSides }, bumpRef.bump.along, n)} /></span>
        <span style={{ flex: 1 }} />
        <button type="button" data-testid="bump-remove-all" style={{ ...link, color: "var(--danger-text, var(--danger))" }} disabled={bumpN < 1} onClick={() => { setBumpOpen(false); ops.bumpRemoveAll({ sides: allDockSides }); }}>Remove all</button>
      </span>
    </div>
  );

  return (
    <div data-testid="wall-rows" style={{ marginTop: SPACE.xl, display: "flex", flexDirection: "column", gap: SPACE.sm }}>
      {dockRows.length > 0 && (
        <div data-testid="bump-line">
          <span style={{ display: "flex", alignItems: "baseline", gap: SPACE.md }}>
            <span data-testid="bump-summary" style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", fontVariantNumeric: TABULAR_NUMS }}>{bumpSummary(bumpN, bumpRef.bump.along, bumpRef.bump.proj)}</span>
            <button type="button" data-testid="bump-edit" style={link} aria-expanded={bumpOpen} onClick={() => { setOpen(null); setBumpOpen((o) => !o); }}>{bumpOpen ? "done" : "edit"}</button>
          </span>
          {bumpOpen && bumpEditor()}
        </div>
      )}
      {rows.map((row) => {
        const opts = orderedAddOptions(row.isDock, row.layers);
        const fillFor = (kind) => { const have = rows.flatMap((r) => r.layers).find((l) => l.kind === kind); return have ? have.fill : (kindFills || {})[kind]; };
        const shown = openLayer && openRow && openRow.key === row.key ? openLayer : null;
        const geo = plan.rows[row.key];
        const total = geo.total;
        return (
          <div key={row.key} data-testid="wall-row" data-row={row.key} data-role={row.role} data-sides={row.sides.join(",")}>
            <div style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>
              <span data-testid="wall-row-head" style={{ flex: "none", width: WALL_LEFT_W, display: "inline-flex", alignItems: "center", gap: SPACE.sm }}>
                <span data-testid="wall-row-badge" style={{ ...badgeStyle(row), minWidth: 22, padding: "1px 5px", borderRadius: RADIUS.sm, fontSize: FONT_SIZE.micro, fontWeight: 700, textAlign: "center", lineHeight: 1.4 }}>{row.badge}</span>
                <span data-testid="wall-row-role" style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>{row.role}</span>
              </span>
              {row.layers.length > 0 && (
                <span data-testid="wall-strip" data-total={total} data-bar-w={geo.barW} data-grown={geo.barW > STRIP.FULL + 0.01 ? "1" : undefined} style={{ flex: "0 1 auto", minWidth: 0, width: geo.barW, height: CONTROL_H.sm, display: "flex", gap: STRIP.GAP, borderRadius: 4, overflow: "hidden", background: "var(--surface-raised)", boxShadow: "0 0 0 1px var(--border-strong)" }}>
                  {row.layers.map((l, i) => {
                    const label = pieceLabel(l);
                    const w = geo.pieces[i].w;
                    const sel = !!shown && shown.id === l.id;
                    return (
                      <button key={l.id} type="button" className="wall-piece" data-testid="wall-piece" data-kind={l.kind} data-index={i} aria-pressed={sel} aria-label={chipLabel(l)} title={pieceTooltip(l, total)}
                        onClick={() => { if (sel) commitAndClose(); else { setBumpOpen(false); setOpen({ rowKey: row.key, id: l.id }); } }}
                        style={{ flex: "0 1 auto", minWidth: 0, width: w, height: "100%", padding: 0, border: "none", borderRadius: 0, background: l.fill, color: WALL_PIECE_TEXT, cursor: "pointer", fontFamily: "inherit",
                          display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 3, overflow: "hidden", whiteSpace: "nowrap",
                          fontSize: FONT_SIZE.micro, fontWeight: 600, fontVariantNumeric: TABULAR_NUMS,
                          boxShadow: sel ? "inset 0 0 0 2px var(--accent)" : (l.kind === "sidewalk" ? `inset 0 0 0 1px ${WALL_PIECE_EDGE}` : "none") }}>
                        {pieceShowsIcon(w, label) && <WallKindIcon kind={l.kind} size={11} />}
                        <span>{label}</span>
                      </button>
                    );
                  })}
                </span>
              )}
              <WallAddControl row={row} opts={opts} fillFor={fillFor} onAdd={(key) => { setOpen(null); setBumpOpen(false); ops.add(row, key); setPending({ rowKey: row.key, kind: key, before: row.layers.filter((l) => l.kind === key).length, beforeRows: key === "parking" ? ((row.layers.find((l) => l.kind === "parking") || {}).rows || 0) : null }); }} />
            </div>
            {shown && editBox(row, shown, WALL_LEFT_W + SPACE.sm + geo.pieces[row.layers.findIndex((l) => l.id === shown.id)].x + geo.pieces[row.layers.findIndex((l) => l.id === shown.id)].w / 2)}
          </div>
        );
      })}
      {legend.length > 0 && (
        <div data-testid="wall-legend" style={{ display: "flex", flexWrap: "wrap", columnGap: SPACE.xl, rowGap: SPACE.xs, paddingLeft: WALL_LEFT_W + SPACE.sm, marginTop: SPACE.xs }}>
          {legend.map((k) => {
            const sample = rows.flatMap((r) => r.layers).find((l) => l.kind === k.kind);
            const on = !!openLayer && openLayer.kind === k.kind;
            return (
              <span key={k.kind} data-testid="wall-legend-item" data-kind={k.kind} data-selected={on ? "1" : undefined} style={{ display: "inline-flex", alignItems: "center", gap: SPACE.xs, fontSize: FONT_SIZE.micro, color: "var(--text-secondary)", fontWeight: on ? 700 : 400 }}>
                <span aria-hidden="true" style={{ width: 16, height: 14, borderRadius: 3, background: sample.fill, display: "grid", placeItems: "center", boxShadow: on ? "0 0 0 2px var(--accent)" : (k.kind === "sidewalk" ? `inset 0 0 0 1px ${WALL_PIECE_EDGE}` : "none") }}>
                  <WallKindIcon kind={k.kind} size={10} />
                </span>
                {k.name}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* PadElevRow — the Pad elevation row, now in Structure (NEW-4). Blank = automatic; a small ⓘ shows the
   floodplain-fill explanation on demand instead of an always-on paragraph. */
export function PadElevRow({ value, auto, info, onCommit, numInput, resetBtn, muted }) {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <>
      <Field label="Pad elev.">
        <span style={ROW4}>
          <NumInput allowClear style={{ ...numInput, width: 64 }} ariaLabel="Pad elevation (ft NAVD88)" value={value ?? ""} placeholder={auto != null ? `auto ${f1(auto)}` : "auto"} onCommit={(n) => onCommit(Number.isFinite(n) ? n : null)} />
          {value != null && <button type="button" data-testid="pad-elev-auto" title="Back to automatic (slab FF, dock zones minus the dock drop)" onClick={() => onCommit(null)} style={resetBtn}>auto ↺</button>}
          <button type="button" data-testid="pad-elev-info" aria-expanded={showInfo} aria-label="What is pad elevation for?" title="What is pad elevation for?" onClick={() => setShowInfo((v) => !v)}
            style={{ width: 16, height: 16, padding: 0, borderRadius: RADIUS.pill, border: BORDER_1, background: SURF_RAISED, color: "var(--text-secondary)", fontSize: FONT_SIZE.micro, fontWeight: 700, lineHeight: 1, cursor: "pointer", fontFamily: "inherit", flex: "none" }}>i</button>
        </span>
      </Field>
      {showInfo && <div data-testid="pad-elev-note" style={{ ...muted, fontSize: FONT_SIZE.micro, lineHeight: 1.45, margin: `0 0 ${SPACE.sm}px` }}>{info}</div>}
    </>
  );
}
