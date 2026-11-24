/* @planner-extract — the building Properties body, split by SECTION (audit batch G2, behaviour-identical move): the number-conflict
 * dialog and the Footprint · Docks & walls · Structure · Appearance sections. Were inline in SitePlanner.jsx's inspector; now
 * module-scope memoized components (MODULE-SCOPE-COMPONENTS). Everything they read from the planner arrives as a prop; no import
 * back from SitePlanner.jsx. */
import { memo } from "react";
import { TABULAR_NUMS } from "../../../shared/theme/typography.js";
import ColorField from "../../../shared/ui/ColorField.jsx";
import RotationStepper, { normalizeDeg } from "../../../shared/ui/RotationStepper.jsx";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { commaDec1 as f1, commaInt as f0 } from "../../../shared/units/numberFormat.js";
import { ZONE_CATALOG, footprintDepth, footprintLength } from "../lib/dockZones.js";
import { DOGEAR_D, DOGEAR_W } from "../lib/dogEar.js";
import { effectivePadElev } from "../lib/floodplainMitigation.js";
import { loadingTypeLabel, wallClickPatch } from "../lib/loadingWalls.js";
import { elStyle, toHex6 } from "../lib/planStyle.js";
import { COLOR_SEED, MAX_DIM, ROW4, ROW6 } from "../lib/plannerConstants.js";
import { BORDER_1, SURF_RAISED } from "../lib/plannerShared.js";
import { buildingNumbers } from "../lib/siteModel.js";
import { KIND_LABEL, bumpEnds, wallRowPlan } from "../lib/wallRows.js";
import Collapse from "./Collapse.jsx";
import { NumInput } from "./NumInput.jsx";
import { Field, LoadingWallPicker, PairedField, PairedFieldHead } from "./PropFields.jsx";
import { PadElevRow, WallRows } from "./WallRows.jsx";

export const BuildingNumberConflict = memo(function BuildingNumberConflict({ conflict, txtPrimary, txtTertiary, resolveBuildingNumberConflict, els, linkBtn, setBldgNumConflict, b, txtSecondary, setBldgNumResetSeq }) {
  const nums = buildingNumbers(els);
  const holderNo = nums.get(conflict.holderId) ?? conflict.n;
  const cur = nums.get(b.id);
  const n = conflict.n;
  const optBtn = (extra) => ({ display: "block", width: "100%", textAlign: "left", padding: "7px 9px", marginBottom: SPACE.sm, borderRadius: RADIUS.sm, border: BORDER_1, background: SURF_RAISED, color: txtPrimary, cursor: "pointer", fontFamily: "inherit", ...extra });
  return (
    <div data-testid="bldg-num-conflict" style={{ margin: `0 0 ${SPACE.xl}px`, padding: "8px 9px", borderRadius: RADIUS.sm, border: BORDER_1, background: SURF_RAISED }}>
      <div style={{ fontSize: FONT_SIZE.label, lineHeight: 1.5, color: txtPrimary, marginBottom: SPACE.md }}>That number belongs to Building {holderNo} — what should happen?</div>
      <button type="button" data-testid="bldg-num-swap" style={optBtn()} onClick={() => resolveBuildingNumberConflict("swap")}>
        <span style={{ display: "block", fontSize: FONT_SIZE.control, fontWeight: 600 }}>Swap with Building {holderNo}</span>
        <span style={{ display: "block", fontSize: FONT_SIZE.label, color: txtTertiary, lineHeight: 1.4 }}>This becomes {n} · Building {holderNo} becomes {cur}</span>
      </button>
      <button type="button" data-testid="bldg-num-shift" style={optBtn({ borderColor: "var(--accent)" })} onClick={() => resolveBuildingNumberConflict("shift")}>
        <span style={{ display: "block", fontSize: FONT_SIZE.control, fontWeight: 600 }}>Insert at {n}, shift the rest up</span>
        <span style={{ display: "block", fontSize: FONT_SIZE.label, color: txtTertiary, lineHeight: 1.4 }}>{n}→{n + 1}, {n + 1}→{n + 2} … · this building becomes {n}</span>
      </button>
      <div style={{ textAlign: "right" }}>
        <button type="button" data-testid="bldg-num-cancel" style={{ ...linkBtn, fontSize: FONT_SIZE.control, textDecoration: "none", color: txtSecondary }}
          onClick={() => { setBldgNumConflict(null); setBldgNumResetSeq((q) => q + 1); }}>Cancel</button>
      </div>
    </div>
  );
});

export const BuildingFootprintSection = memo(function BuildingFootprintSection({ rotateSelTo, unit, txtPrimary, ax, buildingSqft, resetBuildingFootprint, linkBtn, chip, b, editBuildingFootprint, muted, resizeSelEl }) {
  return (
    <Collapse sectionId="building-footprint" title="Footprint" defaultOpen summary={`${Math.round(footprintLength(b))} × ${Math.round(footprintDepth(b))} ft`}
      headerRight={b.points ? null : (
        <button type="button" style={linkBtn} data-testid="edit-outline" title="Convert to an editable outline — angle an end wall or clip a corner (loaded walls stay straight)" onClick={() => editBuildingFootprint(b.id)}>✎ Edit outline</button>
      )}>
      {b.points ? (
        // NEW-1/B872 — an irregular building: Length/Depth become the read-only BOUNDING dims
        // (true area is polygon-exact). A reshaped-from-rect building (footEdit) can reset;
        // a hand-click-drawn one just reads out (no rectangle to go back to).
        <>
          <Field label="Length"><span style={ROW6}><span style={{ fontSize: FONT_SIZE.control, color: txtPrimary }}>{Math.round(footprintLength(b))}</span>{unit("ft bounding")}</span></Field>
          <Field label="Depth"><span style={ROW6}><span style={{ fontSize: FONT_SIZE.control, color: txtPrimary }}>{Math.round(footprintDepth(b))}</span>{unit("ft bounding")}</span></Field>
          <div style={{ ...muted, lineHeight: 1.4, margin: "2px 0 6px" }}>Irregular footprint · <b style={{ color: txtPrimary }}>{f0(buildingSqft(b))} SF</b>. Length/Depth show the bounding box.{b.footEdit ? " Drag corners on the canvas to reshape — loaded walls stay straight (their corners slide along the wall); Shift-click an end/rear wall to add a control point." : ""}</div>
          {b.footEdit && <button style={{ ...chip, width: "100%", marginBottom: SPACE.md }} title="Discard the reshape — back to the bounding rectangle" onClick={() => resetBuildingFootprint(b.id)}>↺ Reset to rectangle</button>}
        </>
      ) : (
        // Building panel v3 (NEW-2) — one bordered box per number: value · unit · stacked ▲▼ (the shared NumberBox).
        <>
          <Field label="Length">
            <NumInput boxed unit="ft" boxWidth={96} ariaLabel="Length" testid="footprint-length" value={Math.round(footprintLength(b))} min={1} max={MAX_DIM} step={1} coarse={10} onCommit={(n) => resizeSelEl({ [ax.length]: n })} />
          </Field>
          <Field label="Depth">
            <NumInput boxed unit="ft" boxWidth={96} ariaLabel="Depth" testid="footprint-depth" value={Math.round(footprintDepth(b))} min={1} max={MAX_DIM} step={1} coarse={10} onCommit={(n) => resizeSelEl({ [ax.depth]: n })} />
          </Field>
        </>
      )}
      <Field label="Rotation">
        <RotationStepper boxed boxWidth={108} data-testid="footprint-rotation" value={b.rot || 0} disabled={!!b.locked || !!b.points}
          disabledReason={b.points ? "Reset the footprint to a rectangle to rotate it" : "Unlock this element to rotate it"}
          onCommit={(deg) => rotateSelTo(deg)}
          onStep={(d) => rotateSelTo(normalizeDeg((b.rot || 0) + d))} />
      </Field>
    </Collapse>
  );
});

export const BuildingLoadingSection = memo(function BuildingLoadingSection({ hm, setTrailerAisle, bumpSpecsOf, removeBumpsOn, setEmployeeParkingRows, applyBuildingLoading, settings, setWallLayerDepth, noDock, numInput, addWallLayer, wallLayersOn, toggleBumpCorner, setTrailerRowDepth, txtPrimary, b, muted, toggleBumpEnd, removeWallLayer, setTrailerRows, setBumpSize }) {
  const bumpSpecs = bumpSpecsOf(b);
  const plan = wallRowPlan(b);
  const wallRowsData = plan.map((r) => {
    const isDock = r.role === "dock";
    const mine = isDock ? bumpSpecs.filter((x) => r.sides.includes(x.side)) : [];
    return {
      ...r, isDock,
      layers: wallLayersOn(b, r.sides[0]),
      bump: isDock ? {
        n: mine.length,
        ends: bumpEnds(r.sides[0], b.rot || 0).map((e) => ({ ...e, on: r.sides.every((s) => bumpSpecs.some((x) => x.side === s && x.sign === e.sign)) })),
        along: Math.round(mine[0] ? mine[0].along : DOGEAR_W), proj: Math.round(mine[0] ? mine[0].proj : DOGEAR_D),
      } : null,
    };
  });
  const wallOps = {
    footEdit: !!b.footEdit,
    depth: (row, layer, n) => setWallLayerDepth(b, row.sides, layer, n),
    trailerRows: (row, layer, n) => setTrailerRows(b, row.sides, layer, n),
    trailerRowDepth: (row, layer, i, n) => setTrailerRowDepth(b, row.sides, layer, i, n),
    trailerAisle: (row, layer, n) => setTrailerAisle(b, row.sides, layer, n),
    parkingRows: (row, n) => setEmployeeParkingRows(b, n, row.sides),
    remove: (row, layer) => removeWallLayer(b, row.sides, layer),
    add: (row, key) => addWallLayer(b, row.sides, key),
    bumpEnd: (row, sign) => toggleBumpEnd(b, row.sides, sign),
    bumpSize: (row, along, proj) => setBumpSize(b, row.sides, along, proj),
    bumpRemoveAll: (row) => removeBumpsOn(b, row.sides),
  };
  return (
    <Collapse sectionId="building-loading" title="Docks & walls" defaultOpen summary={`${loadingTypeLabel(b)} · ${hm.doors} ${hm.doors === 1 ? "door" : "doors"}`}>
      <div style={{ display: "flex", alignItems: "center", gap: SPACE.xl }}>
        <LoadingWallPicker b={b} bumps={bumpSpecs} onWall={(side) => applyBuildingLoading(wallClickPatch(b, side))} onCorner={(side, sign) => toggleBumpCorner(b, side, sign)} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div data-testid="loading-type" style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 600, color: txtPrimary }}>{loadingTypeLabel(b)}</div>
          <div data-testid="loading-doors" style={{ fontSize: FONT_SIZE.control, color: txtPrimary, marginTop: SPACE.xxs }}>{noDock ? "No dock doors" : `${f0(hm.doors)} dock ${hm.doors === 1 ? "door" : "doors"}`}{hm.rampN ? ` · ${hm.rampN} drive-in` : ""}</div>
          <div style={{ ...muted, fontSize: FONT_SIZE.micro, lineHeight: 1.4, marginTop: SPACE.md }}>Click a wall to load or unload it. Click a dashed corner to add a bump-out.</div>
        </div>
      </div>
      <WallRows key={b.id} rows={wallRowsData} ops={wallOps} numInput={numInput} canEditBumps={!b.footEdit} kindFills={Object.fromEntries(Object.keys(KIND_LABEL).map((k) => [k, elStyle({ type: (ZONE_CATALOG[k] || {}).elType }, settings).fill]))} />
    </Collapse>
  );
});

export const BuildingStructureSection = memo(function BuildingStructureSection({ hm, setSelEl, unit, hasGridOverrides, resetBtn, resetBuildingGridOverrides, linkBtn, numInput, b, pushHistory, muted, props, jumpToStandards, settings }) {
  const autoBoth = !props.clearHeight.overridden && !props.slab.overridden;
  const autoLink = (title) => <button type="button" style={{ ...linkBtn, fontSize: FONT_SIZE.micro, marginLeft: 2 }} title={title} onClick={() => jumpToStandards("building")}>auto</button>;
  // NEW-4 — Pad elevation lives here now (it fed the floodplain-fill screen from a bare row under the readout).
  const fmS = settings.floodMitigation || {};
  const padAuto = effectivePadElev({ ...b, padElevFt: null }, { padFfeFt: Number.isFinite(fmS.padFfeFt) ? fmS.padFfeFt : null, dockDropFt: Number.isFinite(fmS.dockDropFt) ? fmS.dockDropFt : 4 });
  const gsum = hm.gg.summary;
  return (
    <Collapse sectionId="building-structure" title="Structure" defaultOpen={false}
      summary={`${props.clearHeight.value}′ clear · ${props.slab.value}″ slab${autoBoth ? " · auto" : ""} · pad ${b.padElevFt != null ? `${f1(b.padElevFt)}′` : "auto"}`}>
      <Field label="Clear height">
        <span style={ROW4}>
          <NumInput style={{ ...numInput, width: 52 }} value={props.clearHeight.value} min={1} onCommit={(n) => { pushHistory(); setSelEl({ clearHeightOverride: n }); }} />
          {unit("ft")}
          {props.clearHeight.overridden
            ? <button title="Revert to auto (by size)" onClick={() => { pushHistory(); setSelEl({ clearHeightOverride: null }); }} style={resetBtn}>set ↺</button>
            : autoLink("Automatic by size — change the rule in Standards → Buildings")}
        </span>
      </Field>
      <Field label="Slab">
        <span style={ROW4}>
          <NumInput style={{ ...numInput, width: 52 }} value={props.slab.value} min={1} onCommit={(n) => { pushHistory(); setSelEl({ slabThicknessOverride: n }); }} />
          {unit("in")}
          {props.slab.overridden
            ? <button title="Revert to auto (by size)" onClick={() => { pushHistory(); setSelEl({ slabThicknessOverride: null }); }} style={resetBtn}>set ↺</button>
            : autoLink("Automatic by size — change the rule in Standards → Buildings")}
        </span>
      </Field>
      <PadElevRow value={b.padElevFt} auto={padAuto} numInput={numInput} resetBtn={resetBtn} muted={muted}
        info="Feeds the floodplain-mitigation fill screen (ft NAVD88); blank = the plan's pad FFE."
        onCommit={(v) => { pushHistory(); setSelEl({ padElevFt: v }); }} />
      {hasGridOverrides(b) && (
        <div data-testid="grid-overrides-note" style={{ ...muted, fontSize: FONT_SIZE.micro, margin: `${SPACE.xs}px 0` }}>
          Grid overrides set on this building · <button type="button" style={{ ...linkBtn, fontSize: FONT_SIZE.micro }} onClick={resetBuildingGridOverrides}>reset</button>
        </div>
      )}
      <div data-testid="grid-line" style={{ ...muted, fontSize: FONT_SIZE.micro, marginTop: SPACE.sm, fontVariantNumeric: TABULAR_NUMS }}>
        {gsum ? <>Grid {gsum.lengthTyp}′ × {gsum.depthTyp}′ typ{gsum.speedBay ? <> · speed bay {gsum.speedBay}′</> : ""} · {gsum.lengthCount} × {gsum.depthCount} bays · </> : "Grid · "}
        <button type="button" style={{ ...linkBtn, fontSize: FONT_SIZE.micro }} onClick={() => jumpToStandards("building")}>Standards ↗</button>
      </div>
    </Collapse>
  );
});

export const BuildingAppearanceSection = memo(function BuildingAppearanceSection({ clearElStyle, setSelEl, curStyle, chip, strokeWidthRow, setStyleDefault, fillOpacityCell, strokeOpacityCell, colorCtl }) {
  if (!curStyle) return null;
  return (
    <Collapse sectionId="building-appearance" title="Appearance" defaultOpen summary="outline · fill">
      <PairedFieldHead left="Outline" right="Fill" />
      <PairedField label="Colour"
        left={<span style={ROW6}><ColorField value={toHex6(curStyle.stroke)} {...colorCtl((v) => setSelEl({ stroke: v }))} seed={COLOR_SEED} title="Outline color" /></span>}
        right={<span style={ROW6}><ColorField value={toHex6(curStyle.fill)} {...colorCtl((v) => setSelEl({ fill: v }))} seed={COLOR_SEED} title="Fill color" /></span>}
      />
      <PairedField label="Opacity" left={strokeOpacityCell} right={fillOpacityCell} />
      {strokeWidthRow}
      <div style={{ display: "flex", gap: SPACE.sm, marginTop: SPACE.md, alignItems: "center" }}>
        <button type="button" style={chip} onClick={setStyleDefault} title="Use these colors, opacity and line weight for every new building">Set as default</button>
        <button type="button" style={chip} onClick={clearElStyle} title="Revert this element to the type default">Reset</button>
      </div>
    </Collapse>
  );
});
