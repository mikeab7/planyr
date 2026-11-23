/* @planner-extract — the building and road headers of the Properties inspector (audit batch G5c, behaviour-identical move).
 * Were inline functions inside SitePlanner.jsx's main return; now module-scope memoized components
 * (MODULE-SCOPE-COMPONENTS). Everything they read from the planner arrives as a prop; no import back from SitePlanner.jsx. */
import { memo } from "react";
import { LockGlyph } from "../../../shared/ui/LockToggle.jsx";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { roadPanelTitle, roadPanelSubtitle } from "../lib/roadPanelModel.js";
import { RoadGlyph } from "./RoadPanelParts.jsx";
import { buildingNumbers } from "../lib/siteModel.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE, CONTROL_H } from "../../../shared/ui/designTokens.js";
import { commaInt as f0 } from "../../../shared/units/numberFormat.js";
import { BORDER_1, SURF_RAISED } from "../lib/plannerShared.js";
import { BuildingNumberField, InspectorMoreMenu } from "./PropFields.jsx";

export const BuildingInspectorHeader = memo(function BuildingInspectorHeader({
  attemptBuildingNumber,
  bldgNumResetSeq,
  buildingMetrics,
  chip,
  closeInspector,
  deleteSel,
  els,
  selEl,
  setBldgNumConflict,
  toggleLock,
}) {
            // NEW-1 — the building inspector's header: [icon] Building [ number ]   lock · ⋯ · ✕, then ONE
            // summary line. The number is the ONLY place a building's assigned number can be edited (the
            // on-canvas label stays display-only); its conflict dialog is rendered by the body below.
            // The old "📌 Pin" chip at the bottom is this padlock now (the owner did not know what Pin was).
            const b = selEl;
            const hm = buildingMetrics(b);
            const HB = CONTROL_H.lg;
            // Building panel v3 (NEW-1) — lock · ⋯ · ✕ are BORDERLESS icon buttons (hover wash only, via `.bldg-hdr-btn`;
            // the lock's state still rides its glyph). The number is a small field that reads as editable.
            const hdrBtn = { width: HB, height: HB, padding: 0, display: "grid", placeItems: "center", borderRadius: RADIUS.sm, color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.emphasis, lineHeight: 1, listStyle: "none" };
            const lockStyle = hdrBtn; // NEW-2 — greyscale: state rides the glyph's shape/weight (LockGlyph), never an accent fill
            const bldgNo = buildingNumbers(els).get(b.id);
            const digits = Math.max(1, Math.min(3, String(bldgNo == null ? "" : bldgNo).length));
            // Sized to its digits (≈ 24 / 32 / 40 wide), one step smaller and lighter than the "Building" title; the outline
            // (the STRONGER border token) comes from `.bldg-num-box`, which also darkens it on hover.
            const numBox = { width: 16 + 8 * digits, height: CONTROL_H.sm, padding: 0, textAlign: "center", boxSizing: "border-box", fontSize: FONT_SIZE.emphasis, fontWeight: 600, fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, borderRadius: RADIUS.sm, color: "var(--text-primary)", flex: "none" };
            return (
              <div data-testid="building-header" style={{ padding: "2px 0 8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: SPACE.md }}>
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" style={{ flex: "none", color: "var(--text-secondary)" }}>
                    <rect x="1.5" y="4" width="13" height="8.5" rx="1" /><path d="M4.5 12.5v-2.5M8 12.5v-2.5M11.5 12.5v-2.5" />
                  </svg>
                  <span style={{ fontSize: FONT_SIZE.display, fontWeight: 700, color: "var(--text-primary)" }}>Building</span>
                  <BuildingNumberField
                    id={b.id}
                    value={bldgNo}
                    className="bldg-num-box"
                    style={numBox}
                    resetToken={bldgNumResetSeq}
                    onAttempt={(n) => attemptBuildingNumber(b.id, n)}
                    onCancelConflict={() => setBldgNumConflict(null)}
                  />
                  <span style={{ flex: 1 }} />
                  <button type="button" data-testid="building-lock" className="bldg-hdr-btn" style={lockStyle} aria-pressed={!!b.locked}
                    aria-label={b.locked ? "Unlock — allow moving and resizing" : "Lock in place"}
                    title="Lock in place so it can't be moved or resized by accident" onClick={() => toggleLock(b.id)}>
                    <LockGlyph locked={!!b.locked} size={16} />
                  </button>
                  <InspectorMoreMenu testId="building-more" label="More building actions" btnStyle={hdrBtn} btnClassName="bldg-hdr-btn"
                    panelStyle={{ minWidth: 128, padding: SPACE.xs, background: SURF_RAISED, border: BORDER_1, borderRadius: RADIUS.md, boxShadow: "0 8px 22px rgba(28,25,20,0.16)" }}>
                    {(close) => (
                      <button type="button" data-testid="building-delete" style={{ ...chip, width: "100%", border: "none", color: "var(--danger)", textAlign: "left" }}
                        onClick={() => { close(); deleteSel(null, { entry: "panel:element" }); }}>Delete building</button>
                    )}
                  </InspectorMoreMenu>
                  <button type="button" data-testid="building-close" className="bldg-hdr-btn" style={{ ...hdrBtn, color: "var(--text-tertiary)", fontSize: FONT_SIZE.display }} title="Close (the element stays selected; double-click it to reopen) — Esc" aria-label="Close properties" onClick={(e) => { e.stopPropagation(); closeInspector(); }}>✕</button>
                </div>
                <div data-testid="building-summary" title={`${f0(hm.footprint)} SF footprint + ${hm.bumpN} bump-out${hm.bumpN === 1 ? "" : "s"} (${f0(hm.extra)} SF)`} style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)", marginTop: SPACE.xs, fontVariantNumeric: TABULAR_NUMS }}>
                  {f0(hm.total)} SF · {f0(hm.doors)} {hm.doors === 1 ? "door" : "doors"}{b.locked ? " · locked" : ""}
                </div>
              </div>
            );
});

export const RoadInspectorHeader = memo(function RoadInspectorHeader({
  arrangeSel,
  chip,
  closeInspector,
  deleteSel,
  duplicateEl,
  roadLengthOf,
  roadTravel,
  selEl,
  toggleLock,
}) {
            // Road-panel redesign (NEW-1) — the building inspector's header, for a road: [glyph] name (or "Road") ·
            // padlock (= Pin) · ⋯ (Duplicate · Bring to front · Delete road) · ✕, then ONE summary line:
            // length · width · ROW (only when a ROW is designated). The title truncates ONLY when the panel is
            // genuinely narrow (flex-shrink on the title, never on the buttons).
            const r = selEl;
            const HB = CONTROL_H.lg;
            const hdrBtn = { width: HB, height: HB, padding: 0, display: "grid", placeItems: "center", borderRadius: RADIUS.sm, color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.emphasis, lineHeight: 1, listStyle: "none", flex: "none" };
            const title = roadPanelTitle(r);
            const sub = roadPanelSubtitle(r, { lengthFt: roadLengthOf(r), widthFt: roadTravel(r) });
            const menuRow = { ...chip, width: "100%", border: "none", textAlign: "left", display: "block" };
            return (
              <div data-testid="road-header" style={{ padding: "2px 0 8px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: SPACE.md }}>
                  <RoadGlyph />
                  <span data-testid="road-title" title={title} style={{ fontSize: FONT_SIZE.display, fontWeight: 700, color: "var(--text-primary)", flex: "1 1 0", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
                  <button type="button" data-testid="road-lock" className="bldg-hdr-btn" style={hdrBtn} aria-pressed={!!r.locked}
                    aria-label={r.locked ? "Unlock — allow moving and resizing" : "Pin in place"}
                    title="Pin in place so it can't be moved or resized by accident" onClick={() => toggleLock(r.id)}>
                    <LockGlyph locked={!!r.locked} size={16} />
                  </button>
                  <InspectorMoreMenu testId="road-more" label="More road actions" btnStyle={hdrBtn} btnClassName="bldg-hdr-btn"
                    panelStyle={{ minWidth: 128, padding: SPACE.xs, background: SURF_RAISED, border: BORDER_1, borderRadius: RADIUS.md, boxShadow: "0 8px 22px rgba(28,25,20,0.16)" }}>
                    {(close) => (<>
                      <button type="button" data-testid="road-duplicate" style={menuRow} onClick={() => { close(); duplicateEl(r.id); }}>Duplicate</button>
                      <button type="button" data-testid="road-front" style={menuRow} onClick={() => { close(); arrangeSel("front", { kind: "el", id: r.id }); }}>Bring to front</button>
                      <button type="button" data-testid="road-delete" style={{ ...menuRow, color: "var(--danger)" }} onClick={() => { close(); deleteSel(null, { entry: "panel:element" }); }}>Delete road</button>
                    </>)}
                  </InspectorMoreMenu>
                  <button type="button" data-testid="road-close" className="bldg-hdr-btn" style={{ ...hdrBtn, color: "var(--text-tertiary)", fontSize: FONT_SIZE.display }} title="Close (the element stays selected; double-click it to reopen) — Esc" aria-label="Close properties" onClick={(e) => { e.stopPropagation(); closeInspector(); }}>✕</button>
                </div>
                <div data-testid="road-summary" style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)", marginTop: SPACE.xs, fontVariantNumeric: TABULAR_NUMS }}>{sub}</div>
              </div>
            );
});
