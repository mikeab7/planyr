/* @planner-extract — the road Properties body, split by SECTION (audit batch G2, behaviour-identical move): Road · Cross-section · Label ·
 * Intersection · Taper, and the hidden min-radius review. Were inline in SitePlanner.jsx's inspector; now module-scope memoized
 * components (MODULE-SCOPE-COMPONENTS). Everything they read from the planner arrives as a prop; no import back from SitePlanner.jsx. */
import { memo } from "react";
import { Button as UiButton } from "../../../shared/ui/controls.jsx";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { commaInt as f0 } from "../../../shared/units/numberFormat.js";
import { DEFAULT_ROAD_CLASS, classReturnRadius, roadClassOf, roadClassesOf } from "../lib/roadClasses.js";
import { rowWidth } from "../lib/roadCrossSection.js";
import { labelSummary as roadLabelSummary, xsButtonLabel, xsCaption, xsStripBands, xsSummary } from "../lib/roadPanelModel.js";
import { roadDefaultRadius } from "../lib/siteGeometry.js";
import Collapse from "./Collapse.jsx";
import { NumInput } from "./NumInput.jsx";
import { Field, ROAD_GUTTER_W, ROAD_SELECT_STYLE } from "./PropFields.jsx";
import { RoadStripCaption, RoadXSectionStrip } from "./RoadPanelParts.jsx";

export const RoadSizeSection = memo(function RoadSizeSection({ rowFt, readout, jumpToStandards, setRoadClass, setRoadLength, stepBox, settings, linkBtn, travelFt, roadLengthOf, designed, selEl, showRow, cl, setRoadRowFt, setRoadTravel, mutedEll }) {
  return (
    <Collapse sectionId="road-size" title="Road" defaultOpen>
      <Field gutter={ROAD_GUTTER_W} oneLine label="Length">
        {cl ? (
          <span data-testid="road-length" title="Follows the line you drew. Drag its ends or corners on the plan to change it." style={readout}><span style={{ flex: "none" }}>{f0(roadLengthOf(selEl))} ft</span><span style={mutedEll}>follows the line</span></span>
        ) : stepBox({ ariaLabel: "Road length", testid: "road-length-input", value: Math.round(roadLengthOf(selEl)), min: 1, step: 1, coarse: 10, onCommit: (n) => setRoadLength(selEl, n) })}
      </Field>
      {/* NEW-2/NEW-4 — "Road width", never "travel width": the pavement between the curb faces (B180).
          NEW-1 — once a road carries a REAL designed cross-section, one number can no longer describe
          it (which of the bands would a typed width resize?), so the row becomes a read-only summary
          and the cross-section button is the only way to change it. A plain road keeps the editable box. */}
      <Field gutter={ROAD_GUTTER_W} oneLine label="Width" title={designed ? "Set by this road's cross-section — a designed section can't be resized by one number." : "Curb face to curb face — the pavement between the curbs. The curb is added outside this width."}>
        {designed ? (
          <span data-testid="road-width-readonly" style={readout}><span style={{ flex: "none" }}>{travelFt} ft</span><span style={mutedEll}>set by cross-section</span></span>
        ) : stepBox({ ariaLabel: "Road width", testid: "road-width", value: travelFt, min: 1, step: 2, coarse: 10, onCommit: (n) => setRoadTravel(selEl, n) })}
      </Field>
      {/* Right-of-way — blank = not designated (the key is removed, the boundary stops drawing). An
          undesignated field steps from the section's own width (`seed`), never from 0. */}
      {showRow && (
        <Field gutter={ROAD_GUTTER_W} oneLine label="Right-of-way" title="A designated legal ROW, drawn as a boundary line on the plan — wider than the modeled section, with the remainder an undesignated margin each side. Blank = not designated.">
          {stepBox({ ariaLabel: "Right-of-way width", testid: "road-row", placeholder: "—", value: rowFt, seed: selEl.xsection ? Math.round(rowWidth(selEl.xsection)) : travelFt, min: 1, step: 5, coarse: 20, allowClear: true, onCommit: (n) => setRoadRowFt(selEl, n) })}
        </Field>
      )}
      {cl && (
        <Field gutter={ROAD_GUTTER_W} oneLine label="Class">
          <span style={{ display: "flex", alignItems: "center", gap: SPACE.sm }}>
            <select style={ROAD_SELECT_STYLE} data-testid="road-class" aria-label="Road class" value={selEl.roadClass || DEFAULT_ROAD_CLASS} onChange={(e) => setRoadClass(selEl, e.target.value)}>
              {roadClassesOf(settings).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
            <button type="button" title="Class defaults — edit in Standards" aria-label="Edit road class defaults in Standards" onClick={() => jumpToStandards("roads")} style={{ ...linkBtn, fontSize: FONT_SIZE.control, flex: "none" }}>↗</button>
          </span>
        </Field>
      )}
    </Collapse>
  );
});

export const RoadXSectionSection = memo(function RoadXSectionSection({ roadCurbOf, roadTravel, travelFt, selEl, setXsDialog }) {
  return (
    <Collapse sectionId="road-xsection" title="Cross-section" defaultOpen summary={xsSummary(selEl)}>
      <RoadXSectionStrip bands={xsStripBands(selEl, { travelFt: roadTravel(selEl), curbFt: roadCurbOf(selEl) })} />
      <RoadStripCaption>{xsCaption(selEl, { travelFt })}</RoadStripCaption>
      <UiButton type="button" variant="ghost" data-testid="edit-road-xsection" style={{ width: "100%" }}
        onClick={() => setXsDialog({ mode: "edit", elId: selEl.id })}>{xsButtonLabel(selEl)}</UiButton>
    </Collapse>
  );
});

export const RoadLabelSection = memo(function RoadLabelSection({ inlineLabelControls, setSelEl, coalesceLabelWrite, selEl, pushHistory }) {
  return (
    <Collapse sectionId="road-label" title="Label" defaultOpen summary={roadLabelSummary(selEl)}>
      <Field gutter={ROAD_GUTTER_W} oneLine label="Name"><input data-testid="road-name" aria-label="Road name" value={selEl.inlineLabel || ""} maxLength={120}
        onFocus={() => pushHistory()}
        onChange={(e) => setSelEl({ inlineLabel: e.target.value })}
        placeholder="e.g. MAIN STREET" style={ROAD_SELECT_STYLE} /></Field>
      {/* B678 — text size / repeat spacing / background halo / position (only once a name is typed) */}
      {inlineLabelControls(selEl, "road", coalesceLabelWrite(selEl.id, (p) => setSelEl(p)))}
    </Collapse>
  );
});

export const RoadIntersectionSection = memo(function RoadIntersectionSection({ setRoadDrive, setRoadTee, subHead, myTees, muted, settings, stepBox, myDrives, DRIVE_RETURN, selEl }) {
  return (
    <Collapse sectionId="road-intersection" title="Intersection">
      {myTees.length > 0 && (() => {
        const tj = myTees[0];
        const seedR = classReturnRadius(roadClassOf(settings, selEl.roadClass));
        const curR = selEl.tee && selEl.tee.throughId === tj.throughId && selEl.tee.returnR > 0 ? selEl.tee.returnR : seedR;
        const curFlare = selEl.tee && selEl.tee.throughId === tj.throughId && selEl.tee.flare > 0 ? selEl.tee.flare : 0;
        return (
          <div data-testid="road-tee-params" style={{ marginBottom: SPACE.md }}>
            <div style={{ ...subHead, marginTop: 0 }}>Tee intersection</div>
            <Field gutter={ROAD_GUTTER_W} oneLine label="Curb return">{stepBox({ ariaLabel: "Curb return", value: Math.round(curR), min: 0, step: 1, coarse: 5, onCommit: (n) => setRoadTee(selEl, tj.throughId, { returnR: n }) })}</Field>
            <Field gutter={ROAD_GUTTER_W} oneLine label="Throat flare">{stepBox({ ariaLabel: "Throat flare", value: Math.round(curFlare), min: 0, step: 1, coarse: 5, onCommit: (n) => setRoadTee(selEl, tj.throughId, { flare: n }) })}</Field>
            <div style={{ ...muted, lineHeight: 1.4 }}>Rounds the curb returns where this road meets the through road{myTees.length > 1 ? ` (${myTees.length} tees)` : ""}. Larger return / flare widens the throat. Seeded from the road class; returns clamp to fit.</div>
          </div>
        );
      })()}
      {myDrives.map((dj) => {
        const kindLbl = dj.kind === "truckcourt" ? "truck court" : "parking drive";
        const seedR = DRIVE_RETURN[dj.kind] ?? 20;
        const rec = selEl.driveTee && selEl.driveTee.targetId === dj.targetId ? selEl.driveTee : (selEl.driveTee2 && selEl.driveTee2.targetId === dj.targetId ? selEl.driveTee2 : null);
        const curR = rec && rec.returnR > 0 ? rec.returnR : seedR;
        const curFlare = rec && rec.flare > 0 ? rec.flare : 0;
        const tgt = { targetId: dj.targetId, kind: dj.kind };
        return (
          <div key={`${dj.targetId}:${dj.endIdx}`} data-testid="road-drive-params">
            <div style={{ ...subHead, marginTop: 0 }}>Drive intersection · {kindLbl}</div>
            <Field gutter={ROAD_GUTTER_W} oneLine label="Curb return">{stepBox({ ariaLabel: "Curb return", value: Math.round(curR), min: 0, step: 1, coarse: 5, onCommit: (n) => setRoadDrive(selEl, { returnR: n }, tgt) })}</Field>
            <Field gutter={ROAD_GUTTER_W} oneLine label="Throat flare">{stepBox({ ariaLabel: "Throat flare", value: Math.round(curFlare), min: 0, step: 1, coarse: 5, onCommit: (n) => setRoadDrive(selEl, { flare: n }, tgt) })}</Field>
            <div style={{ ...muted, lineHeight: 1.4 }}>Where this road meets the {kindLbl}. Seeded {dj.kind === "truckcourt" ? "truck-scale (≈50′)" : "car-scale (≈20′)"}; returns clamp to fit.</div>
          </div>
        );
      })}
    </Collapse>
  );
});

export const RoadTaperSection = memo(function RoadTaperSection({ stepBox, setRoadTaper, selEl, roundTrim }) {
  const tp = roundTrim(selEl) && roundTrim(selEl).taper;
  const ends = tp ? ["s", "e"].filter((k) => tp[k]) : [];
  if (!ends.length) return null;
  return (
    <Collapse sectionId="road-taper" title="Taper" defaultOpen summary={ends.map((k) => `${Math.round(tp[k].lenFt)} ft`).join(" · ")}>
      {ends.map((k) => (
        <Field key={k} gutter={ROAD_GUTTER_W} oneLine label={ends.length > 1 ? (k === "s" ? "Start length" : "End length") : "Length"} title="How far back from the joint this road narrows (or widens) to meet the road it joins. Blank = automatic.">
          {stepBox({ ariaLabel: ends.length > 1 ? (k === "s" ? "Taper length at the start" : "Taper length at the end") : "Taper length", testid: `road-taper-${k}`, placeholder: String(Math.round(tp[k].lenFt)), value: tp[k].auto ? null : Math.round(tp[k].reqFt), seed: Math.round(tp[k].lenFt), min: 1, step: 5, coarse: 20, allowClear: true, onCommit: (n) => setRoadTaper(selEl, k, n) })}
        </Field>
      ))}
    </Collapse>
  );
});

export const RoadRadiusWarning = memo(function RoadRadiusWarning({ warn, chip, PAL, setRoadVtxSel, fixPrev, linkBtn, selEl, setSel, fixRoadRadiusFor }) {
  return (
    <div data-testid="road-radius-warning" style={{ fontSize: 11.5, color: PAL.danger, fontWeight: 600, marginTop: 2, lineHeight: 1.4 }}>
      ⚠ {f0(warn.minR)}′ radius — below {f0(warn.threshold)}′ min for {warn.label}
      {/* B946/NEW-2 — the passive warning becomes an ACTION: round the tight corners up to spec. */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 5 }}>
        <button style={{ ...chip, color: PAL.accent, borderColor: PAL.accent, fontWeight: 600 }} onClick={() => fixRoadRadiusFor(selEl)}>Fix radius</button>
        <span style={{ fontSize: 10.5, color: PAL.muted, fontWeight: 400 }}>Rounds each tight corner to {f0(warn.threshold)}′.</span>
      </div>
      {fixPrev && fixPrev.residual.length > 0 && (
        <div style={{ fontSize: 10.5, color: PAL.muted, fontWeight: 400, marginTop: 4, lineHeight: 1.4 }}>
          {fixPrev.residual.length} corner{fixPrev.residual.length === 1 ? "" : "s"} (
          {fixPrev.residual.map((r) => `#${r.index + 1}`).join(", ")}
          ) can’t reach {f0(warn.threshold)}′ without moving the road’s endpoints — the segments are too short to fit the arc.{" "}
          <button style={{ ...linkBtn, fontSize: 10.5 }} onClick={() => { setSel({ kind: "el", id: selEl.id }); setRoadVtxSel({ id: selEl.id, idx: fixPrev.residual[0].index }); }}>Show</button>
        </div>
      )}
      <div style={{ fontSize: 10.5, color: PAL.muted, fontWeight: 400, marginTop: 3 }}>Screening only — verify against the adopted code.</div>
    </div>
  );
});

export const RoadCurveAtVertex = memo(function RoadCurveAtVertex({ subHead, chip, setRoadVtx, PAL, settings, numInput, selEl, vtreat, vsel }) {
  return (
    <div data-testid="road-curve-at-vertex" style={{ marginTop: 8 }}>
      <div style={subHead}>Curve at vertex</div>
      {vsel == null ? (
        <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.45 }}>Click a road vertex on the canvas to set it sharp · arc · smooth.{selEl.pts.length <= 2 ? " A straight 2-point road has no interior vertex." : ""}</div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 6 }}>
            {[["sharp", "Sharp"], ["arc", "Arc"], ["smooth", "Smooth"]].map(([k, lbl]) => (
              <button key={k} style={{ ...chip, flex: 1, ...(vtreat === k ? { borderColor: PAL.accent, color: PAL.accent, fontWeight: 600 } : {}) }}
                onClick={() => setRoadVtx(selEl, vsel, k === "arc" ? { treatment: "arc", radius: (selEl.vtx && selEl.vtx[vsel] && selEl.vtx[vsel].radius) || roadDefaultRadius(selEl, settings) } : { treatment: k })}>{lbl}</button>
            ))}
          </div>
          {vtreat === "arc" && (
            <Field label="Arc radius (ft)"><NumInput style={numInput} value={Math.round((selEl.vtx && selEl.vtx[vsel] && selEl.vtx[vsel].radius) || roadDefaultRadius(selEl, settings))} min={1} onCommit={(n) => setRoadVtx(selEl, vsel, { treatment: "arc", radius: n })} /></Field>
          )}
          <div style={{ fontSize: 10.5, color: PAL.muted, marginTop: 4, lineHeight: 1.4 }}>Vertex {vsel + 1} of {selEl.pts.length}. Arc fillets are feasibility-clamped to the adjacent segments.</div>
        </>
      )}
    </div>
  );
});
