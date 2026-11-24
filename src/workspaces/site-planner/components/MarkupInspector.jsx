/* @planner-extract — the markup blocks of the Properties inspector (audit batch G5b, behaviour-identical move).
 * Were inline functions inside SitePlanner.jsx's main return; now module-scope memoized components
 * (MODULE-SCOPE-COMPONENTS). Everything they read from the planner arrives as a prop; no import back from SitePlanner.jsx. */
import { memo } from "react";
import { closedMarkupSize, openMarkupLength } from "../lib/markupPick.js";
import { CLOUD_ARC_MIN_FT, CLOUD_ARC_STEP_FT, CLOUD_ARC_MAX_FT, CLOUD_ARC_DEFAULT_FT, CLOUD_STATUS_OPTIONS, clampCloudArcFt } from "../lib/cloudGeometry.js";
import { LockGlyph } from "../../../shared/ui/LockToggle.jsx";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import { normalizeDeg } from "../../../shared/ui/RotationStepper.jsx";
import ColorField from "../../../shared/ui/ColorField.jsx";
import { fmtSf, fmtAcres, fmtFeet } from "../lib/measureLabel.js";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { toHex6 } from "../lib/planStyle.js";
import { EASEMENT_TYPES, easementType, easementLabel, easementRecordingSummary, easementArea, easementStyle } from "../lib/easements.js";
import { HATCH_OPTIONS } from "../../../shared/style/hatchPatterns.js";
import Collapse from "./Collapse.jsx";
import { SQFT_PER_ACRE } from "../lib/siteGeometry.js";
import { SPACE, CONTROL_H } from "../../../shared/ui/designTokens.js";
import { BORDER_1, SURF_RAISED } from "../lib/plannerShared.js";
import { NumInput } from "./NumInput.jsx";
import { COLOR_SEED, MK_BOX_KINDS } from "../lib/plannerConstants.js";
import { Section, ROAD_GUTTER_W, Field, PairedField, PairedFieldHead, PercentField, StdSubLabel, RotationField } from "./PropFields.jsx";
import { DASH_OPTIONS } from "./PlannerIcons.jsx";

export const EasementInspector = memo(function EasementInspector({
  PAL,
  chip,
  coalesceLabelWrite,
  colorCtl,
  deleteSel,
  easeTypeAnchor,
  easeTypeMenu,
  inlineLabelControls,
  labelSessionRef,
  menuItem,
  menuPanel,
  numInput,
  pushHistory,
  selMarkup,
  setEaseType,
  setEaseTypeMenu,
  setMarkups,
  setSelEasement,
  toggleMarkupLock,
  withEaseRing,
}) {
            const e = selMarkup;
            const t = easementType(e.easeType);
            const area = easementArea(e);
            const isStrip = e.mode !== "boundary";
            const seg = (on) => ({ ...chip, flex: 1, padding: "6px 0", textAlign: "center", background: on ? PAL.accent : SURF_RAISED, color: on ? "#fff" : PAL.ink, borderColor: on ? PAL.accent : "var(--border-default)" });
            const txt = { ...numInput, width: 150, fontFamily: "inherit" };
            // NEW-EASE-STYLE — resolved appearance (type default, or this easement's own override).
            const est = easementStyle(e);
            const swatch = { width: 34, height: 26, padding: 0, border: BORDER_1, borderRadius: 6, cursor: "pointer" };
            const check = (label, val, key) => (
              <label style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: PAL.ink, marginBottom: 7, cursor: "pointer" }}>
                <input type="checkbox" checked={!!val} onChange={(ev) => setSelEasement({ [key]: ev.target.checked })} /> {label}
              </label>
            );
            return (
              <Section title={null}>
                {/* Map label — what the map and the PDF draw. Empty = the automatic name (type + width),
                    which keeps tracking those while no custom text is set. One undo frame per typing session. */}
                <Field label={<b style={{ color: PAL.ink }}>Map label</b>}>
                  <input value={e.labelOverride || ""} maxLength={120} data-testid="easement-map-label"
                    onChange={(ev) => { const v = ev.target.value; coalesceLabelWrite(`ease-label-${e.id}`, (p) => setMarkups((a) => a.map((m) => (m.id === e.id ? withEaseRing(m, p) : m))))({ labelOverride: v }, { live: true }); }}
                    onBlur={() => { labelSessionRef.current = null; }}
                    placeholder={easementLabel({ ...e, labelOverride: "" })} style={txt} />
                </Field>
                {/* NEW-2 — the area line under the label is OFF by default; this is the same toggle the label's right-click menu carries. */}
                {check("Show area on label", e.showArea === true, "showArea")}
                <Field label="Type">
                  <button ref={easeTypeAnchor} style={{ ...chip, display: "flex", alignItems: "center", gap: 6 }} onClick={() => setEaseTypeMenu((o) => !o)}>
                    <span style={{ width: 9, height: 9, borderRadius: 2, background: t.color }} /> {t.label} <span style={{ color: PAL.muted }}>▾</span>
                  </button>
                  <AnchoredMenu open={easeTypeMenu} onClose={() => setEaseTypeMenu(false)} anchorRef={easeTypeAnchor} placement="below-right" width={224} panelStyle={menuPanel}>
                    {EASEMENT_TYPES.map((ty) => (
                      <button key={ty.key} style={{ ...menuItem(e.easeType === ty.key), display: "flex", alignItems: "center", gap: 8 }} onClick={() => { setSelEasement({ easeType: ty.key }); setEaseType(ty.key); setEaseTypeMenu(false); }}>
                        <span style={{ width: 9, height: 9, borderRadius: 2, background: ty.color }} /> {ty.label}
                      </button>
                    ))}
                  </AnchoredMenu>
                </Field>
                {isStrip && <Field label="Width (ft)"><NumInput boxed fill ariaLabel="Width" value={Math.round(e.width || 0)} min={1} step={1} coarse={10} onCommit={(n) => setSelEasement({ width: n })} /></Field>}
                <Field label="Status">
                  <span style={{ display: "flex", gap: 5, width: 150 }}>
                    <button style={seg(e.status !== "proposed")} onClick={() => setSelEasement({ status: "existing" })}>Existing</button>
                    <button style={seg(e.status === "proposed")} onClick={() => setSelEasement({ status: "proposed" })}>Proposed</button>
                  </span>
                </Field>
                <Collapse sectionId="easement-recording" title="Recording details" defaultOpen={false} summary={easementRecordingSummary(e)}>
                  <Field label="Holder / beneficiary"><input value={e.holder || ""} onChange={(ev) => setSelEasement({ holder: ev.target.value })} placeholder="e.g. CenterPoint" style={txt} /></Field>
                  <Field label="Recording ref"><input value={e.recording || ""} onChange={(ev) => setSelEasement({ recording: ev.target.value })} placeholder="Vol/Pg or Clerk's #" style={txt} /></Field>
                  {check("Exclusive easement", e.exclusive, "exclusive")}
                </Collapse>
                <div style={{ borderTop: `1px solid ${PAL.panelLine}`, margin: "8px 0", paddingTop: 8 }}>
                  {check("Restricts buildings", e.restrictsBuildings !== false, "restrictsBuildings")}
                  {check("Restricts paving", e.restrictsPaving === true, "restrictsPaving")}
                </div>
                <StdSubLabel section="text">Text</StdSubLabel>
                {/* B620 — inline label riding the easement (distinct from the centroid caption above; double-click the
                    easement also opens this in place). inlineLabel doesn't touch the ring, so a plain spread is safe;
                    onFocus pushes one undo frame per edit. */}
                <Field gutter={ROAD_GUTTER_W} oneLine label="Inline label"><input value={e.inlineLabel || ""} maxLength={120}
                  onFocus={() => pushHistory()}
                  onChange={(ev) => setMarkups((a) => a.map((m) => (m.id === selMarkup.id ? { ...m, inlineLabel: ev.target.value } : m)))}
                  placeholder='e.g. 20&#39; DRAINAGE ESMT' style={txt} /></Field>
                {/* B678 — per-label repeat spacing / text size / background halo (only once a label is typed) */}
                {inlineLabelControls(e, "easement", coalesceLabelWrite(selMarkup.id, (p) => setMarkups((a) => a.map((m) => (m.id === selMarkup.id ? { ...m, ...p } : m)))))}
                <Field label="Notes"><textarea value={e.notes || ""} onChange={(ev) => setSelEasement({ notes: ev.target.value })} rows={2} style={{ width: 150, boxSizing: "border-box", padding: "5px 7px", fontSize: 12, fontFamily: "inherit", border: BORDER_1, borderRadius: 8, color: PAL.ink, resize: "vertical" }} /></Field>
                {/* NEW-EASE-STYLE — colour / fill / hatch, editable per easement. Defaults to this
                    easement's TYPE colour (above) until touched; "Reset" clears back to the type
                    default rather than leaving a stale override behind. */}
                <div>
                  <StdSubLabel section="appearance">Appearance</StdSubLabel>
                  <PairedFieldHead left="Outline" right="Fill" />
                  <PairedField label="Colour"
                    left={<ColorField value={toHex6(est.stroke)} {...colorCtl((v) => setSelEasement({ stroke: v }))} seed={COLOR_SEED} title="Outline color" style={swatch} />}
                    right={<ColorField value={toHex6(est.fill)} {...colorCtl((v) => setSelEasement({ fill: v }))} seed={COLOR_SEED} title="Fill color" style={swatch} />}
                  />
                  <PairedField label="Opacity"
                    right={<PercentField boxed value={est.fillOpacity} max={60} onCommit={(v) => setSelEasement({ fillOpacity: v })} inputStyle={numInput} ariaLabel="Fill opacity" />}
                  />
                  <PairedField label="Pattern"
                    right={<select autoComplete="off" aria-label="Fill pattern" style={{ ...numInput, width: "100%", height: CONTROL_H.md, boxSizing: "border-box", padding: "0 6px", fontFamily: "inherit", textAlign: "right", textAlignLast: "right" }} value={est.hatch} onChange={(ev) => setSelEasement({ hatch: ev.target.value })}>{HATCH_OPTIONS.map((h) => <option key={h.key} value={h.key}>{h.label}</option>)}</select>}
                  />
                  {est.hasOverride && <button style={{ ...chip, marginTop: 4 }} onClick={() => setSelEasement({ fill: null, stroke: null, fillOpacity: null, hatch: null })} title={`Revert to the ${t.label} type's default appearance`}>↺ Reset to type default</button>}
                </div>
                {/* NEW-3 (layout "A") — SIZE & POSITION: the area it covers (the strip's Width (ft) stays with the easement's attributes up top — the
                    Map label → Type → Width → Status order is guarded by e2e easement-map-label). The instruction line that used to follow
                    ("Drag a centerline dot to reshape … Shift-click an edge to add a point, right-click a dot to remove one") restated how to
                    drag / reshape and is gone (PANEL-BREVITY). */}
                <StdSubLabel section="size">Size & position</StdSubLabel>
                <Field label="Area"><span style={{ fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, fontWeight: 700, fontSize: 13, color: PAL.ink }}>{fmtSf(area)} · {fmtAcres(area / SQFT_PER_ACRE)}</span></Field>
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button style={chip} onClick={() => toggleMarkupLock(e.id)}><span style={{ display: "inline-flex", alignItems: "center", gap: SPACE.xs }}><LockGlyph locked={!!e.locked} size={13} />{e.locked ? "Unlock" : "Lock"}</span></button>
                  <button style={{ ...chip, color: PAL.danger }} onClick={() => deleteSel(null, { entry: "panel:easement" })}>Delete</button>
                </div>
              </Section>
            );
});

export const NeutralMarkupInspector = memo(function NeutralMarkupInspector({
  PAL,
  chip,
  coalesceLabelWrite,
  colorCtl,
  deleteSel,
  inlineLabelControls,
  liveMarkup,
  liveMarkupCloud,
  numInput,
  pushHistory,
  selMarkup,
  setMarkups,
  setSelMarkup,
  setSelMarkupCloud,
  setSelMarkupGeom,
  textInput,
  toggleMarkupLock,
}) {
            // NO `background` on the swatch — ColorField paints the current colour as the chip's background and spreads this on top.
            const swatch = { width: 34, height: 26, padding: 0, border: BORDER_1, borderRadius: 6, cursor: "pointer" };
            const valStyle = { fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, fontWeight: 700, fontSize: 13, color: PAL.ink };
            const isCloud = selMarkup.kind === "cloud";
            const closed = selMarkup.kind !== "line" && selMarkup.kind !== "polyline";
            const isBox = MK_BOX_KINDS.includes(selMarkup.kind);
            // Cloud writes its OWN sticky style (mkCloudStyle), never the shared mkStyle every other markup tool draws from next.
            const setStyle = isCloud ? setSelMarkupCloud : setSelMarkup;
            const liveStyle = isCloud ? liveMarkupCloud : liveMarkup;
            const hatchOn = closed && !!selMarkup.hatch && selMarkup.hatch !== "none";
            const patSel = { ...numInput, width: "100%", height: CONTROL_H.md, boxSizing: "border-box", padding: "0 6px", fontFamily: "inherit", textAlign: "right", textAlignLast: "right" };
            const dashSel = <select autoComplete="off" aria-label="Line pattern" style={patSel} value={selMarkup.dash || "solid"} onChange={(e) => setStyle({ dash: e.target.value })}>{DASH_OPTIONS}</select>;
            const weightBox = <NumInput boxed fill ariaLabel="Line weight" testid="markup-weight" value={selMarkup.weight ?? 2} min={0.5} step={0.5} coarse={2} onCommit={(n) => setStyle({ weight: n })} />;
            const size = closed ? closedMarkupSize(selMarkup) : null;
            return (
              <div>
              <Section title={null}>
                <StdSubLabel section="appearance">Appearance</StdSubLabel>
                {closed ? (<>
                  <PairedFieldHead left="Outline" right="Fill" />
                  <PairedField label="Colour"
                    left={<ColorField value={toHex6(selMarkup.stroke)} {...colorCtl((v) => liveStyle({ stroke: v }))} seed={COLOR_SEED} title="Outline color" style={swatch} />}
                    right={<ColorField value={toHex6(selMarkup.fill)} {...colorCtl((v) => liveStyle({ fill: v }))} seed={COLOR_SEED} title="Fill color" style={swatch} />}
                  />
                  <PairedField label="Opacity"
                    left={<PercentField boxed value={selMarkup.strokeOpacity ?? 1} onCommit={(v) => setStyle({ strokeOpacity: v })} ariaLabel="Outline opacity" />}
                    right={<PercentField boxed value={selMarkup.fillOpacity ?? 0} onCommit={(v) => setStyle({ fillOpacity: v })} ariaLabel="Fill opacity" />}
                  />
                  <PairedField label="Weight" left={weightBox} />
                  <PairedField label="Pattern"
                    left={dashSel}
                    right={<select autoComplete="off" aria-label="Fill pattern" style={patSel} value={selMarkup.hatch || "none"} onChange={(e) => setStyle({ hatch: e.target.value })}>{HATCH_OPTIONS.map((h) => <option key={h.key} value={h.key}>{h.key === "none" ? "Flat" : h.label}</option>)}</select>}
                  />
                  {hatchOn && (
                    <PairedField label="Hatch colour"
                      right={<ColorField value={toHex6(selMarkup.hatchColor || selMarkup.stroke || selMarkup.fill)} {...colorCtl((v) => liveStyle({ hatchColor: v }))} seed={COLOR_SEED} title="Hatch color" style={swatch} />}
                    />
                  )}
                </>) : (<>
                  <Field label="Colour"><ColorField value={toHex6(selMarkup.stroke)} {...colorCtl((v) => liveStyle({ stroke: v }))} seed={COLOR_SEED} title="Line color" style={swatch} /></Field>
                  <Field label="Opacity"><PercentField boxed value={selMarkup.strokeOpacity ?? 1} onCommit={(v) => setStyle({ strokeOpacity: v })} ariaLabel="Line opacity" /></Field>
                  <Field label="Weight">{weightBox}</Field>
                  <Field label="Pattern">{dashSel}</Field>
                </>)}

                <StdSubLabel section="size">Size & position</StdSubLabel>
                {/* A closed shape's SIZE, read off the SAME geometry the canvas draws (markupPick.js's `closedMarkupSize`). */}
                {size && (<>
                  <Field label="Area"><span style={valStyle}>{fmtSf(size.area)} · {fmtAcres(size.area / SQFT_PER_ACRE)}</span></Field>
                  <Field label="Perimeter"><span style={valStyle}>{fmtFeet(size.perimeter)}</span></Field>
                </>)}
                {isBox && (<>
                  <Field label="Width"><NumInput boxed fill unit="ft" ariaLabel="Width" value={Math.round(selMarkup.w)} min={1} step={1} coarse={10} onCommit={(n) => setSelMarkupGeom({ w: n })} /></Field>
                  <Field label="Height"><NumInput boxed fill unit="ft" ariaLabel="Height" value={Math.round(selMarkup.h)} min={1} step={1} coarse={10} onCommit={(n) => setSelMarkupGeom({ h: n })} /></Field>
                </>)}
                {isCloud && (
                  <Field label="Arc size"><NumInput boxed fill unit="ft" ariaLabel="Arc size" value={selMarkup.arcFt ?? CLOUD_ARC_DEFAULT_FT} min={CLOUD_ARC_MIN_FT} max={CLOUD_ARC_MAX_FT} step={CLOUD_ARC_STEP_FT} onCommit={(n) => setSelMarkupCloud({ arcFt: clampCloudArcFt(n) })} /></Field>
                )}
                {isBox && (
                  <Field label="Rotation"><RotationField value={selMarkup.rot || 0} locked={!!selMarkup.locked} lockedReason="Unlock this markup to rotate it"
                    onCommit={(deg) => setSelMarkupGeom({ rot: deg })}
                    onStep={(d) => setSelMarkupGeom({ rot: normalizeDeg((selMarkup.rot || 0) + d) })} /></Field>
                )}
                {/* B620 — inline label riding the line (open paths only; double-click the line also opens this in place). NON-sticky
                    (direct setMarkups, never setMkStyle); onFocus pushes ONE undo frame per edit (not one per keystroke). */}
                {!closed && (<>
                  <Field label="Length"><span style={valStyle}>{fmtFeet(openMarkupLength(selMarkup) || 0)}</span></Field>
                  <Field gutter={ROAD_GUTTER_W} oneLine label="Inline label"><input autoComplete="off" value={selMarkup.inlineLabel || ""} maxLength={120}
                    onFocus={() => pushHistory()}
                    onChange={(e) => setMarkups((a) => a.map((m) => (m.id === selMarkup.id ? { ...m, inlineLabel: e.target.value } : m)))}
                    placeholder={'e.g. 18" SANITARY SEWER'} style={{ ...textInput, width: "100%", minWidth: 0 }} /></Field>
                  {/* B678 — per-label repeat spacing / text size / background halo (only once a label is typed) */}
                  {inlineLabelControls(selMarkup, selMarkup.kind, coalesceLabelWrite(selMarkup.id, (p) => setMarkups((a) => a.map((m) => (m.id === selMarkup.id ? { ...m, ...p } : m)))))}
                </>)}
                {isCloud && (() => {
                  const fmtWhen = (iso) => { try { return iso ? new Date(iso).toLocaleString() : "—"; } catch (_) { return "—"; } };
                  const cs = { display: "flex", gap: 5, width: 150 };
                  return (
                    <div style={{ borderTop: `1px solid ${PAL.panelLine}`, margin: "8px 0", paddingTop: 8 }}>
                      {/* NEW-4 — the reviewer metadata the owner never uses is tucked into ONE collapsed "More" (nothing deleted: every value still round-trips when expanded and edited). */}
                      <Collapse sectionId="cloud-more" title="More" defaultOpen={false}>
                      <Field label="Subject"><input autoComplete="off" value={selMarkup.subject ?? ""} maxLength={80} onFocus={() => pushHistory()} onChange={(e) => setMarkups((a) => a.map((m) => (m.id === selMarkup.id ? { ...m, subject: e.target.value, modifiedAt: new Date().toISOString() } : m)))} placeholder="Cloud" style={textInput} /></Field>
                      <Field label="Comment" title="Reviewer notes on this markup"><textarea value={selMarkup.comment ?? ""} onFocus={() => pushHistory()} onChange={(e) => setMarkups((a) => a.map((m) => (m.id === selMarkup.id ? { ...m, comment: e.target.value, modifiedAt: new Date().toISOString() } : m)))} rows={2} style={{ width: 150, boxSizing: "border-box", padding: "5px 7px", fontSize: 12, fontFamily: "inherit", border: BORDER_1, borderRadius: 8, color: PAL.ink, resize: "vertical" }} /></Field>
                      <Field label="Status">
                        <span style={cs}>
                          <select style={{ ...numInput, width: 150, fontFamily: "inherit" }} value={selMarkup.status ?? "None"} onChange={(e) => setSelMarkupCloud({ status: e.target.value })}>
                            {CLOUD_STATUS_OPTIONS.map((s) => <option key={s} value={s}>{s}</option>)}
                          </select>
                        </span>
                      </Field>
                      <Field label="Label"><input autoComplete="off" value={selMarkup.label ?? ""} maxLength={40} onFocus={() => pushHistory()} onChange={(e) => setMarkups((a) => a.map((m) => (m.id === selMarkup.id ? { ...m, label: e.target.value, modifiedAt: new Date().toISOString() } : m)))} placeholder="e.g. 1" style={textInput} /></Field>
                      <Field label="Layer"><input autoComplete="off" value={selMarkup.layer ?? ""} maxLength={40} onFocus={() => pushHistory()} onChange={(e) => setMarkups((a) => a.map((m) => (m.id === selMarkup.id ? { ...m, layer: e.target.value, modifiedAt: new Date().toISOString() } : m)))} placeholder="e.g. Reviewer 1" style={textInput} /></Field>
                      <Field label="Author"><input autoComplete="off" value={selMarkup.author ?? ""} maxLength={60} onFocus={() => pushHistory()} onChange={(e) => setMarkups((a) => a.map((m) => (m.id === selMarkup.id ? { ...m, author: e.target.value, modifiedAt: new Date().toISOString() } : m)))} style={textInput} /></Field>
                      <div style={{ fontSize: 10.5, color: PAL.muted, lineHeight: 1.6, marginTop: 4 }}>
                        Created {fmtWhen(selMarkup.createdAt)}<br />Modified {fmtWhen(selMarkup.modifiedAt)}
                      </div>
                      </Collapse>
                    </div>
                  );
                })()}
                {/* NEW-5 — the Cloud panel carries NO how-to text (owner 2026-10-08); the gestures themselves are unchanged. */}
                {!isCloud && (
                  <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.5, marginTop: 8 }}>
                    {/* B922/NEW-3 — a locked markup renders no reshape dots, so say so instead of "drag a dot". */}
                    {selMarkup.locked
                      ? "Locked — click Unlock below to move or reshape it."
                      : isBox
                      ? "Drag the corner/edge grips to resize, the top handle to rotate."
                      : selMarkup.kind === "line"
                        ? "Drag either end dot to move it."
                        // NEW-1/B649504 — Shift-click never removed a point (only adds, on an edge); removal is right-click a dot, or select + Delete.
                        : "Drag a dot to reshape; Shift-click an edge to add a point, right-click a dot to remove one."}
                  </div>
                )}
                {!["rect", "ellipse", "polygon"].includes(selMarkup.kind) && <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  <button style={chip} onClick={() => toggleMarkupLock(selMarkup.id)}><span style={{ display: "inline-flex", alignItems: "center", gap: SPACE.xs }}><LockGlyph locked={!!selMarkup.locked} size={13} />{selMarkup.locked ? "Unlock" : "Lock"}</span></button>
                  <button style={{ ...chip, color: PAL.danger }} onClick={() => deleteSel(null, { entry: "panel:markup" })}>Delete</button>
                </div>}
              </Section>
              </div>
            );
});
