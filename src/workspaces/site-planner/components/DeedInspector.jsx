/* @planner-extract — the metes-and-bounds (deed / title tract) Properties panel, NEW-1 2026-11-24.
 * Replaces the deed half of the old MarkupStyleInspector. Module scope (MODULE-SCOPE-COMPONENTS); everything it reads
 * from the planner arrives as a prop; no import back from SitePlanner.jsx.
 *
 * Layout "A" (CLAUDE.md constraint #29): NAME & LABELS · APPEARANCE · CLOSURE · COURSES · SIZE & POSITION, one shared
 * label gutter, a typed % box for opacity, right-aligned pattern selects. Each edit is ONE undo step and writes through
 * the markup itself (never the shared mkStyle, which new markups inherit).
 *   • Name label: text · show · size · colour · placement · rotation (m.label, showName, labelSize, labelColor, nameAt, labelRot)
 *   • Course labels: bearing / distance visibility per course (call.hideBearing / hideDist), size, colour, position, along-the-line
 *     (courseLabelSize / courseLabelColor / courseLabelPlace / courseLabelAlong); `showCalls` stays the master switch.
 *   • Courses: bearing + distance of every straight course are typed; the whole path re-traces (lib/deedCourses.js). */
import { memo, useState, useEffect } from "react";
import { LockGlyph } from "../../../shared/ui/LockToggle.jsx";
import { normalizeDeg } from "../../../shared/ui/RotationStepper.jsx";
import ColorField from "../../../shared/ui/ColorField.jsx";
import { fmtSf, fmtAcres, fmtFeet } from "../lib/measureLabel.js";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { toHex6 } from "../lib/planStyle.js";
import { encumbranceStyle, deedCallsShown } from "../lib/easements.js";
import { deedGapText } from "../lib/deedGap.js";
import { HATCH_OPTIONS } from "../../../shared/style/hatchPatterns.js";
import { SQFT_PER_ACRE } from "../lib/siteGeometry.js";
import { SPACE, CONTROL_H, FONT_SIZE } from "../../../shared/ui/designTokens.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { BORDER_1 } from "../lib/plannerShared.js";
import { NumInput } from "./NumInput.jsx";
import { COLOR_SEED, ENCUMBER_LABEL_BASE_PX } from "../lib/plannerConstants.js";
import { Section, Field, PairedField, PairedFieldHead, PercentField, StdSubLabel, RotationField, ROAD_GUTTER_W, ROAD_SELECT_STYLE } from "./PropFields.jsx";
import { DASH_OPTIONS } from "./PlannerIcons.jsx";
import { loadDeed } from "../lib/deedLazy.js";
import { courseParts, courseEditable, retraceWithEdit, deedClosureFacts, COURSE_LABEL_SIZE_DEFAULT, courseLabelPlaceOf, nameAtOf, nameShown } from "../lib/deedCourses.js";
import { NO_AUTOFILL } from "../../../shared/ui/noAutofill.js";

/* One course row: a typed bearing, a typed distance, and a bearing / distance visibility pair. The bearing keeps its own
 * draft: Enter or click-away commits, Escape puts the old text back (EDITOR-EXIT-CONTRACT, text class). */
const CourseRow = memo(function CourseRow({ call, index, PAL, disabled, onEdit, onToggle }) {
  const parts = courseParts(call);
  const editable = courseEditable(call) && !disabled;
  const [draft, setDraft] = useState(parts.bearing);
  useEffect(() => { setDraft(parts.bearing); }, [parts.bearing]);
  const box = { width: "100%", minWidth: 0, boxSizing: "border-box", height: CONTROL_H.md, padding: "0 6px", fontSize: FONT_SIZE.control, fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, color: PAL.ink, background: "var(--surface-raised)", border: "1px solid var(--border-strong)", borderRadius: RADIUS.sm };
  // A refused bearing puts the stored text back (the box must never keep showing something the deed does not say).
  const commit = () => { if (draft.trim() !== parts.bearing.trim()) Promise.resolve(onEdit(index, { bearingText: draft })).then((ok) => { if (!ok) setDraft(parts.bearing); }); };
  const eye = (on, key, label) => (
    <button type="button" aria-pressed={on} aria-label={`${on ? "Hide" : "Show"} ${label} label on course ${index + 1}`} title={`${on ? "Hide" : "Show"} the ${label} label on this course`}
      data-testid={`deed-course-${key}-${index}`} onClick={() => onToggle(index, key, on)}
      style={{ width: 22, height: CONTROL_H.md, padding: 0, fontSize: FONT_SIZE.label, fontWeight: 700, cursor: "pointer", borderRadius: RADIUS.sm, border: BORDER_1, background: on ? "var(--accent-soft, transparent)" : "transparent", color: on ? PAL.ink : PAL.muted, opacity: on ? 1 : 0.6, fontFamily: "inherit" }}>
      {label[0].toUpperCase()}
    </button>
  );
  return (
    <li data-testid={`deed-course-${index}`} style={{ listStyle: "none", display: "grid", gridTemplateColumns: "16px minmax(0,1.5fr) minmax(0,1fr) 22px 22px", columnGap: 5, alignItems: "center", marginBottom: 5 }}>
      <span style={{ fontSize: FONT_SIZE.label, color: PAL.muted, textAlign: "right" }}>{index + 1}</span>
      {editable
        ? <input {...NO_AUTOFILL} aria-label={`Bearing of course ${index + 1}`} data-testid={`deed-course-bearing-${index}`} value={draft} spellCheck={false} style={box}
            onChange={(e) => setDraft(e.target.value)} onBlur={commit}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.currentTarget.blur(); } else if (e.key === "Escape") { e.preventDefault(); setDraft(parts.bearing); e.currentTarget.blur(); } }} />
        : <span title={call.curve ? "A curved course keeps its arc as read from the deed" : "Unlock the deed (and edit before using it as the parcel) to retype courses"} style={{ ...box, display: "flex", alignItems: "center", border: "1px solid transparent", background: "transparent", overflow: "hidden", whiteSpace: "nowrap" }}>{parts.bearing}{call.curve ? " (curve)" : ""}</span>}
      {editable
        ? <NumInput boxed fill ariaLabel={`Distance of course ${index + 1}`} testid={`deed-course-dist-${index}`} unit="ft" value={Math.round(call.distFt * 100) / 100} min={0.01} step={1} coarse={10} onCommit={(n) => onEdit(index, { distFt: n })} />
        : <span style={{ ...box, display: "flex", alignItems: "center", border: "1px solid transparent", background: "transparent" }}>{parts.dist}</span>}
      {eye(!call.hideBearing, "hideBearing", "bearing")}
      {eye(!call.hideDist, "hideDist", "distance")}
    </li>
  );
});

export const DeedInspector = memo(function DeedInspector({
  PAL,
  alignDeedToParcel,
  chip,
  coalesceLabelWrite,
  colorCtl,
  deedAlreadyPromoted,
  deedGroupMembers,
  deedMainOf,
  deleteSel,
  flashWarn,
  labelSessionRef,
  liveMarkup,
  numInput,
  parcels,
  promoteDeedToParcel,
  pushHistory,
  rotateDeedTo,
  selMarkup,
  setMarkups,
  setSelMarkup,
  setSelMarkupGeom,
  toggleMarkupLock,
}) {
  const m = selMarkup;
  const swatch = { width: 34, height: 26, padding: 0, border: BORDER_1, borderRadius: RADIUS.sm, cursor: "pointer" };
  const patSel = { ...numInput, width: "100%", height: CONTROL_H.md, boxSizing: "border-box", padding: "0 6px", fontFamily: "inherit", textAlign: "right", textAlignLast: "right" };
  const txt = { ...numInput, width: "100%", fontFamily: "inherit", boxSizing: "border-box" };
  const est = encumbranceStyle(m);
  const calls = m.calls || [];
  const dm = deedMainOf(deedGroupMembers(m), m);
  const promoted = deedAlreadyPromoted(dm);
  const hasParcel = parcels.some((p) => p.active !== false && (p.points?.length || 0) >= 3);
  const facts = deedClosureFacts(m);
  const gapInfo = deedGapText(facts.trace);
  const stroke = toHex6(m.stroke || est.stroke);
  const locked = !!m.locked;
  const frozen = locked || promoted;

  // Name + label writes: NON-STICKY (setMarkups directly, never the shared mkStyle), one undo frame per typing session.
  const writeLabel = coalesceLabelWrite(`deed-label-${m.id}`, (p) => setMarkups((a) => a.map((x) => (x.id === m.id ? { ...x, ...p } : x))));

  // One course edit = one undo step. The path is re-traced by the deed workflow's own dead-reckoning (loaded on demand).
  const editCourse = async (index, patch) => {
    let deed;
    try { deed = await loadDeed(); } catch (err) { flashWarn("Couldn't load the deed tools to re-trace that course. Try again.", 6000); return false; }
    const r = retraceWithEdit(m, index, patch, deed);
    if (!r.ok) { if (!r.unchanged && r.reason) flashWarn(r.reason, 7000); return false; }
    pushHistory();
    setMarkups((a) => a.map((x) => (x.id === m.id ? { ...x, calls: r.calls, centerline: r.centerline, pts: r.pts, closed: r.closed } : x)));
    return true;
  };
  const toggleCourse = (index, key, wasShown) => {
    pushHistory();
    setMarkups((a) => a.map((x) => (x.id === m.id ? { ...x, calls: (x.calls || []).map((c, i) => (i === index ? { ...c, [key]: wasShown } : c)) } : x)));
  };

  const check = (label, on, onChange, testid) => (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT_SIZE.control, color: PAL.ink, cursor: "pointer", marginBottom: 6 }}>
      <input type="checkbox" data-testid={testid} checked={on} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: PAL.accent, width: 14, height: 14 }} />
      <span>{label}</span>
    </label>
  );
  const sel = (aria, value, onChange, options, testid) => (
    <select style={ROAD_SELECT_STYLE} aria-label={aria} data-testid={testid} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
    </select>
  );
  const defaultName = m.except ? "Save & except" : "Tract boundary";

  return (
    <div>
      <Section title={null}>
      <div data-testid="deed-inspector">
        {/* NAME & LABELS — the tract's name on the map: text, show, size, colour, placement, rotation. */}
        <StdSubLabel section="text">Name &amp; labels</StdSubLabel>
        <Field gutter={ROAD_GUTTER_W} oneLine label="Name">
          <input {...NO_AUTOFILL} value={m.label || ""} maxLength={120} data-testid="deed-name" placeholder={defaultName} style={txt}
            onChange={(ev) => writeLabel({ label: ev.target.value }, { live: true })} onBlur={() => { labelSessionRef.current = null; }} />
        </Field>
        {check("Show name on the map", nameShown(m), (v) => setSelMarkupGeom({ showName: v }), "deed-show-name")}
        {nameShown(m) && (<>
          <Field gutter={ROAD_GUTTER_W} oneLine label="Text size">
            <NumInput boxed unit="pt" boxWidth={96} ariaLabel="Name text size" testid="deed-name-size" value={m.labelSize ?? ENCUMBER_LABEL_BASE_PX} min={5} max={48} step={1} coarse={4} onCommit={(n) => setSelMarkupGeom({ labelSize: n })} />
          </Field>
          <Field gutter={ROAD_GUTTER_W} oneLine label="Text colour">
            <ColorField value={toHex6(m.labelColor || stroke)} {...colorCtl((v) => setSelMarkupGeom({ labelColor: v }))} seed={COLOR_SEED} title="Name colour" style={swatch} />
          </Field>
          <Field gutter={ROAD_GUTTER_W} oneLine label="Position">
            {sel("Name position", nameAtOf(m), (v) => setSelMarkupGeom({ nameAt: v }), [["center", "Centre of the tract"], ["top", "Toward the top"], ["bottom", "Toward the bottom"]], "deed-name-at")}
          </Field>
          <Field gutter={ROAD_GUTTER_W} oneLine label="Rotation">
            <NumInput boxed unit="°" boxWidth={96} ariaLabel="Name rotation" testid="deed-name-rot" value={m.labelRot ?? 0} min={-180} max={180} step={5} coarse={15} onCommit={(n) => setSelMarkupGeom({ labelRot: n })} />
          </Field>
        </>)}

        {/* The per-course bearing / distance labels: master switch, then how they look. Which courses show which half lives in the list below. */}
        <StdSubLabel section="text">Course labels</StdSubLabel>
        {/* NEW-1 — per-shape "Show calls" (default OFF, saved on the shape, one undo frame). Uses setSelMarkupGeom, NOT setSelMarkup: that one also writes the shared mkStyle, which new markups inherit. */}
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: FONT_SIZE.control, color: PAL.ink, cursor: "pointer", marginBottom: 6 }}>
          <input type="checkbox" data-testid="deed-show-calls" checked={deedCallsShown(m)} onChange={(e) => setSelMarkupGeom({ showCalls: e.target.checked })} style={{ accentColor: PAL.accent, width: 14, height: 14 }} />
          <span>Show calls</span>
        </label>
        {deedCallsShown(m) && (<>
          <Field gutter={ROAD_GUTTER_W} oneLine label="Text size">
            <NumInput boxed unit="pt" boxWidth={96} ariaLabel="Course label text size" testid="deed-course-size" value={m.courseLabelSize ?? COURSE_LABEL_SIZE_DEFAULT} min={5} max={36} step={1} coarse={3} onCommit={(n) => setSelMarkupGeom({ courseLabelSize: n })} />
          </Field>
          <Field gutter={ROAD_GUTTER_W} oneLine label="Text colour">
            <ColorField value={toHex6(m.courseLabelColor || stroke)} {...colorCtl((v) => setSelMarkupGeom({ courseLabelColor: v }))} seed={COLOR_SEED} title="Course label colour" style={swatch} />
          </Field>
          <Field gutter={ROAD_GUTTER_W} oneLine label="Position">
            {sel("Course label position", courseLabelPlaceOf(m), (v) => setSelMarkupGeom({ courseLabelPlace: v }), [["above", "Above the line"], ["on", "On the line"], ["below", "Below the line"]], "deed-course-place")}
          </Field>
          {check("Turn with the line", m.courseLabelAlong === true, (v) => setSelMarkupGeom({ courseLabelAlong: v }), "deed-course-along")}
        </>)}

        {/* APPEARANCE — Outline | Fill; a deed's fill pattern is its hatch (encumbrance shares the easement appearance model). */}
        <StdSubLabel section="appearance">Appearance</StdSubLabel>
        <PairedFieldHead left="Outline" right="Fill" />
        <PairedField label="Colour"
          left={<ColorField value={toHex6(m.stroke)} {...colorCtl((v) => liveMarkup({ stroke: v }))} seed={COLOR_SEED} title="Outline color" style={swatch} />}
          right={<ColorField value={toHex6(est.fill)} {...colorCtl((v) => liveMarkup({ fill: v }))} seed={COLOR_SEED} title="Fill color" style={swatch} />}
        />
        <PairedField label="Opacity" right={<PercentField boxed value={est.fillOpacity} max={60} onCommit={(v) => setSelMarkup({ fillOpacity: v })} ariaLabel="Fill opacity" />} />
        <PairedField label="Weight" left={<NumInput boxed fill ariaLabel="Line weight" testid="markup-weight" value={m.weight ?? 2} min={0.5} step={0.5} coarse={2} onCommit={(n) => setSelMarkup({ weight: n })} />} />
        <PairedField label="Pattern"
          left={<select autoComplete="off" aria-label="Line pattern" style={patSel} value={m.dash || "solid"} onChange={(e) => setSelMarkup({ dash: e.target.value })}>{DASH_OPTIONS}</select>}
          right={<select autoComplete="off" aria-label="Fill pattern" style={patSel} value={est.hatch} onChange={(ev) => setSelMarkup({ hatch: ev.target.value })}>{HATCH_OPTIONS.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}</select>}
        />
        {est.hasOverride && <button style={{ ...chip, marginTop: 4 }} onClick={() => setSelMarkup({ fill: null, fillOpacity: null, hatch: null })} title="Revert to the default encumbrance appearance">↺ Reset to default</button>}

        {/* CLOSURE — perimeter, area and the misclosure in plain words (the canvas draws the gap as a red dashed line). */}
        <StdSubLabel section="closure">Closure</StdSubLabel>
        <Field gutter={ROAD_GUTTER_W} oneLine label="Perimeter"><span data-testid="deed-perimeter" style={{ fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, fontWeight: 700, fontSize: FONT_SIZE.emphasis, color: PAL.ink }}>{fmtFeet(facts.perimFt)}</span></Field>
        <Field gutter={ROAD_GUTTER_W} oneLine label="Area"><span data-testid="deed-area" style={{ fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, fontWeight: 700, fontSize: FONT_SIZE.emphasis, color: PAL.ink }}>{fmtSf(facts.areaSf)} · {fmtAcres(facts.areaSf / SQFT_PER_ACRE)}</span></Field>
        <div data-testid="deed-closure" style={{ fontSize: FONT_SIZE.control, lineHeight: 1.5, marginBottom: 8, fontWeight: 700, color: gapInfo.closes ? PAL.text : PAL.danger }}>
          {gapInfo.closes ? "" : "⚠ "}{gapInfo.text}{gapInfo.precision ? ` ${gapInfo.precision}.` : ""}
        </div>

        {/* COURSES — every call, typed. Retyping a bearing or distance re-traces the whole description from its first point. */}
        {calls.length > 0 && (
          <details open data-testid="deed-courses-list" style={{ fontSize: FONT_SIZE.control, color: PAL.ink, marginBottom: 8 }}>
            <summary style={{ cursor: "pointer", fontWeight: 600 }}>Courses ({calls.length})</summary>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", margin: "6px 0 4px", gap: 6 }}>
              <span style={{ fontSize: FONT_SIZE.label, color: PAL.muted }}>{frozen ? (promoted ? "Already the parcel boundary: courses are read-only." : "Unlock the deed to retype its courses.") : "Retype a bearing or distance; the shape re-draws."}</span>
              <button style={{ ...chip, padding: "2px 7px" }} data-testid="deed-courses-show-all" onClick={() => { pushHistory(); setMarkups((a) => a.map((x) => (x.id === m.id ? { ...x, calls: (x.calls || []).map((c) => ({ ...c, hideBearing: false, hideDist: false })) } : x))); }} title="Show both labels on every course">Show all</button>
            </div>
            <ol style={{ margin: 0, padding: 0 }}>
              {calls.map((c, i) => <CourseRow key={i} call={c} index={i} PAL={PAL} disabled={frozen} onEdit={editCourse} onToggle={toggleCourse} />)}
            </ol>
          </details>
        )}

        {/* SIZE & POSITION — fit the deed to the county map, promote it, turn it. */}
        <StdSubLabel section="size">Size &amp; position</StdSubLabel>
        <div style={{ marginTop: 6, paddingTop: 8, borderTop: BORDER_1 }}>
          <button style={{ ...chip, width: "100%", fontWeight: 700 }} disabled={locked} onClick={() => alignDeedToParcel(dm.id)}>
            📐 {hasParcel ? "Align to county parcel" : "Rotate to grid north"}
          </button>
          {/* NEW-2 — promote the plotted deed to a real parcel boundary. */}
          <button data-testid="deed-promote" style={{ ...chip, width: "100%", fontWeight: 700, marginTop: 6 }}
            disabled={promoted}
            title={promoted ? "This deed is already a parcel on the plan" : "Turn this deed into a real parcel — acreage, setbacks and the area math all start working on it"}
            onClick={() => promoteDeedToParcel(dm.id)}>
            ▦ {promoted ? "Already the parcel boundary" : "Use as parcel boundary"}
          </button>
          {!promoted && (
            <div style={{ fontSize: FONT_SIZE.label, color: PAL.muted, lineHeight: 1.5, marginTop: 6 }}>
              With the county map down, the legal description is the best boundary you have. The deed stays on the plan either way.
            </div>
          )}
          <div style={{ fontSize: FONT_SIZE.label, color: PAL.muted, lineHeight: 1.5, marginTop: 6 }}>
            {hasParcel
              ? "Surveys state bearings on State Plane grid north; the parcel and aerial are true north. This spins the deed onto the county parcel to cancel that ~1–2° tilt (which fans out to tens of feet over a long line)."
              : "No county parcel loaded to fit to — this applies the State Plane grid-north correction for this location. Load the parcel (Add parcel → Identify) for an exact fit, or nudge below."}
          </div>
          <Field label="Rotation"><RotationField value={dm.rotApplied || 0} locked={locked} lockedReason="Unlock this deed to rotate it"
            onCommit={(deg) => rotateDeedTo(dm.id, deg)}
            onStep={(d) => rotateDeedTo(dm.id, normalizeDeg((dm.rotApplied || 0) + d))} /></Field>
        </div>
        {locked && <div style={{ fontSize: FONT_SIZE.control, color: PAL.muted, lineHeight: 1.5, marginTop: 8 }}>Locked — click Unlock below to move or reshape it.</div>}
        <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
          <button style={chip} onClick={() => toggleMarkupLock(m.id)}><span style={{ display: "inline-flex", alignItems: "center", gap: SPACE.xs }}><LockGlyph locked={locked} size={13} />{locked ? "Unlock" : "Lock"}</span></button>
          <button style={{ ...chip, color: PAL.danger }} onClick={() => deleteSel(null, { entry: "panel:markup" })}>Delete</button>
        </div>
      </div>
      </Section>
    </div>
  );
});

