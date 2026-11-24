/* @planner-extract — the dock, multi-select, callout, measurement and ramp blocks of the Properties inspector (audit batch G5c, behaviour-identical move).
 * Were inline functions inside SitePlanner.jsx's main return; now module-scope memoized components
 * (MODULE-SCOPE-COMPONENTS). Everything they read from the planner arrives as a prop; no import back from SitePlanner.jsx. */
import { memo } from "react";
import { LockGlyph } from "../../../shared/ui/LockToggle.jsx";
import { normalizeDeg } from "../../../shared/ui/RotationStepper.jsx";
import ColorField from "../../../shared/ui/ColorField.jsx";
import { MEASURE_STD_KEYS } from "../lib/standardsApply.js";
import { MEASURE_LINE, measureStyle } from "../lib/measureStyle.js";
import { fmtInt, fmtSf, fmtAcres, fmtFeet } from "../lib/measureLabel.js";
import { pushRecent } from "../../../shared/ui/colorRecents.js";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { TYPE, toHex6 } from "../lib/planStyle.js";
import { offsetPolygon } from "../lib/parcelOffset.js";
import { buildingNumbers } from "../lib/siteModel.js";
import { rampSpan, rampLengthFt, rampRiseFt, rampLayout, rampFlags, wallFrame, moduleStops, fitAlongTheWall } from "../lib/driveInRamp.js";
import { SQFT_PER_ACRE, polyArea, ringOf, isCenterlineRoad, roadStripRing } from "../lib/siteGeometry.js";
import { hostAxisExtents } from "../lib/dogEar.js";
import { calloutStyle } from "../lib/calloutStyle.js";
import { dockSidesFor } from "../lib/dockZones.js";
import { zoneIndexOf } from "../lib/assemblyOps.js";
import { dockLayerPosition } from "../lib/dockLayerPanel.js";
import { resolveGridSettings } from "../lib/buildingGrid.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE, CONTROL_H } from "../../../shared/ui/designTokens.js";
import { BORDER_1, SURF_RAISED } from "../lib/plannerShared.js";
import { NumInput } from "./NumInput.jsx";
import { COLOR_SEED, measPts, measMode, pathLen } from "../lib/plannerConstants.js";
import { Section, Field, PairedField, PairedFieldHead, DriveInRampPanel, PercentField, StdSubLabel, AlignIcon, VAlignIcon, RotationField, LineSample } from "./PropFields.jsx";
import { DASH_OPTIONS } from "./PlannerIcons.jsx";
import { NO_AUTOFILL } from "../../../shared/ui/noAutofill.js";

export const DockLayerInspector = memo(function DockLayerInspector({
  els,
  selEl,
  setSel,
}) {
            // NEW-1 — the dock layer's one sub-line: the host building (a link that selects it, which is how you grow /
            // shrink every dock side at once) and the layer's place in the default sequence. Nothing else.
            const hb = els.find((x) => x.id === selEl.attachedTo);
            const hbNo = hb ? buildingNumbers(els).get(hb.id) : null;
            return (
              <div data-testid="dock-subline" style={{ display: "flex", alignItems: "baseline", gap: SPACE.md, fontSize: FONT_SIZE.label, color: "var(--text-secondary)", padding: "0 0 4px" }}>
                {hb && <button type="button" data-testid="dock-host-link" onClick={() => setSel({ kind: "el", id: hb.id })} title="Select the building — grow or shrink every dock side at once"
                  style={{ padding: 0, border: "none", background: "transparent", cursor: "pointer", fontFamily: "inherit", fontSize: FONT_SIZE.label, color: "var(--accent-site-text)", textDecoration: "underline", textUnderlineOffset: 2 }}>{`Building${hbNo != null ? ` ${hbNo}` : ""} ›`}</button>}
                <span>{dockLayerPosition(zoneIndexOf(selEl))}</span>
              </div>
            );
});

export const MultiStyleInspector = memo(function MultiStyleInspector({
  PAL,
  applyMultiStyle,
  chip,
  clearMultiElStyle,
  liveMultiStyle,
  livePick,
  multiMembers,
  multiStyle,
  numInput,
}) {
            const { caps, props } = multiStyle;
            const hasEl = multiMembers.some((m) => m.kind === "el");
            const mixNote = { fontSize: 11, color: PAL.muted };
            // The SAME one-chip colour control as everywhere else, with a hatched "Mixed" chip when
            // the selection disagrees (a colour has no indeterminate state). Its picker paints the
            // WHOLE selection: a swatch click in ONE undo frame (applyMultiStyle), the "Custom…"
            // wheel live with one frame per picking session — no dialog box (inline-editors rule).
            // Returns the swatch content alone (no Field wrapper) — B1618656 NEW-1 places it inside
            // a PairedField's own OUTLINE/FILL column instead.
            const colorSwatch = (label, prop) => {
              const st = props[prop]; if (!st) return undefined;
              return (
                <span key={prop} style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
                  <ColorField title={label} value={st.mixed ? "#808080" : toHex6(st.value)} mixed={st.mixed} seed={COLOR_SEED}
                    pick={livePick((v) => liveMultiStyle({ [prop]: v }))}
                    onSwatch={(v) => { applyMultiStyle({ [prop]: v }); pushRecent(v); }} />
                  {st.mixed && <span style={mixNote}>Mixed</span>}
                </span>
              );
            };
            return (
              // NEW-1 — plain wrapper: the OUTER dock panel (line ~13873) already carries the canonical
              // data-testid="property-panel"; a second copy here made getByTestId("property-panel")
              // resolve to 2 elements (a Playwright strict-mode violation) any time a multi-selection's
              // Properties was open.
              <div>
              {/* B1215682/NEW-2 — on the phone bottom sheet, the chrome row directly above (the
                  "Element" collapse header) already reads "N selected" verbatim — an exact
                  byte-for-byte duplicate, unlike the desktop docked panel where this Section is
                  the ONLY place that count appears. Suppressing it here (not on desktop) reclaims
                  a whole card's worth of vertical space with zero information loss. */}
              <Section title={null}>
                {(caps.includes("fill") || caps.includes("stroke")) && (<>
                  <PairedFieldHead left="Outline" right="Fill" />
                  <PairedField label="Colour"
                    left={caps.includes("stroke") ? colorSwatch("Outline", "stroke") : undefined}
                    right={caps.includes("fill") ? colorSwatch("Fill", "fill") : undefined}
                  />
                </>)}
                {caps.includes("weight") && (
                  <PairedField label="Weight"
                    left={<NumInput style={{ ...numInput, width: "100%" }} value={props.weight.mixed ? null : props.weight.value} placeholder="—" min={0.5} step={0.5} coarse={2} onCommit={(n) => applyMultiStyle({ weight: n })} />}
                  />
                )}
                {caps.includes("strokeWidth") && (
                  <PairedField label="Line weight"
                    left={<span style={{ display: "flex", alignItems: "center", gap: SPACE.md, minWidth: 0, flexWrap: "wrap" }}>
                      <NumInput style={{ ...numInput, width: 46, minWidth: 0 }} value={props.strokeWidth.mixed ? null : props.strokeWidth.value} placeholder="—" min={0.5} max={12} step={0.5} coarse={2}
                        ariaLabel="Line weight" onCommit={(n) => applyMultiStyle({ strokeWidth: Math.max(0.5, Math.min(12, n)) })} />
                      {!props.strokeWidth.mixed && <LineSample weight={props.strokeWidth.value} />}
                      {props.strokeWidth.mixed && <span style={mixNote}>Mixed</span>}
                    </span>}
                  />
                )}
                {caps.includes("dash") && (
                  <PairedField label="Pattern"
                    left={<select style={{ ...numInput, width: "100%", fontFamily: "inherit" }} value={props.dash.mixed ? "" : (props.dash.value || "solid")} onChange={(e) => { if (e.target.value) applyMultiStyle({ dash: e.target.value }); }}>
                      {props.dash.mixed && <option value="" disabled>Mixed</option>}
                      {DASH_OPTIONS}
                    </select>}
                  />
                )}
                {(caps.includes("fillOpacity") || caps.includes("strokeOpacity")) && (
                  <PairedField label="Opacity"
                    left={caps.includes("strokeOpacity") ? (
                      <span style={{ display: "flex", alignItems: "center", gap: SPACE.xxs, minWidth: 0, flexWrap: "wrap" }}>
                        <NumInput style={{ ...numInput, width: "100%", minWidth: 0 }} value={props.strokeOpacity.mixed ? null : Math.round(props.strokeOpacity.value * 100)} placeholder="—" min={0} max={100} step={5}
                          ariaLabel="Outline opacity" onCommit={(n) => applyMultiStyle({ strokeOpacity: Math.max(0, Math.min(100, Math.round(n))) / 100 })} />
                        <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)", flex: "none" }}>%</span>
                        {props.strokeOpacity.mixed && <span style={mixNote}>Mixed</span>}
                      </span>
                    ) : undefined}
                    right={caps.includes("fillOpacity") ? (
                      /* Mixed → no committed value to show (matches Weight's own "—" placeholder
                         above); typing any number, including 100, is a real change written to every
                         member, same as the slider it replaces. */
                      <span style={{ display: "flex", alignItems: "center", gap: SPACE.xxs, minWidth: 0, flexWrap: "wrap" }}>
                        <NumInput style={{ ...numInput, width: "100%", minWidth: 0 }} value={props.fillOpacity.mixed ? null : Math.round(props.fillOpacity.value * 100)} placeholder="—" min={0} max={100} step={5}
                          ariaLabel="Fill opacity" onCommit={(n) => applyMultiStyle({ fillOpacity: Math.max(0, Math.min(100, Math.round(n))) / 100 })} />
                        <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-tertiary)", flex: "none" }}>%</span>
                        {props.fillOpacity.mixed && <span style={mixNote}>Mixed</span>}
                      </span>
                    ) : undefined}
                  />
                )}
                {hasEl && (
                  <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                    <button style={{ ...chip, flex: 1 }} onClick={clearMultiElStyle} title="Revert every selected element to its type default colors">Reset</button>
                  </div>
                )}
                <div style={{ fontSize: 10.5, color: PAL.muted, marginTop: 6 }}>Editing {multiMembers.length} item{multiMembers.length === 1 ? "" : "s"}. Only the properties they share are shown.</div>
              </Section>
              </div>
            );
});

export const CalloutInspector = memo(function CalloutInspector({
  PAL,
  beginEditCallout,
  chip,
  colorCtl,
  deleteSel,
  liveCallout,
  numInput,
  selCallout,
  setSelCallout,
  toggleCalloutLock,
}) {
            const cs = calloutStyle(selCallout);
            // NO `background` on the swatch — ColorField paints the current colour as the chip's background and spreads this on top.
            const swatch = { width: 34, height: 26, padding: 0, border: BORDER_1, borderRadius: 6, cursor: "pointer" };
            // B1765730 — a small, fixed-size icon-button toggle (never flex:1).
            const segSm = (on) => ({ width: 26, height: 26, flex: "none", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", borderRadius: RADIUS.sm, border: `1px solid ${on ? PAL.accent : "var(--border-default)"}`, background: on ? PAL.accent : SURF_RAISED, color: on ? "var(--on-accent)" : PAL.ink, cursor: "pointer", fontFamily: "inherit", fontSize: 12 });
            const patSel = { ...numInput, width: "100%", height: CONTROL_H.md, boxSizing: "border-box", padding: "0 6px", fontFamily: "inherit", textAlign: "right", textAlignLast: "right" };
            const vAlignHint = "shows once the box is taller than its text — drag the box's top or bottom grip";
            const fixedExtent = selCallout.boxW != null || selCallout.boxH != null;
            return (
              // NEW-1 — plain wrapper (see the multi-select branch above for why the duplicate testid was removed).
              <div>
              <Section title={null}>
                {/* A plain (white, normal border) full-width button at the very top — it moved up from the bottom. */}
                <button type="button" data-testid="callout-edit-text" style={{ ...chip, width: "100%", marginBottom: SPACE.sm }} onClick={() => beginEditCallout(selCallout.id)}>✎ Edit text</button>

                <StdSubLabel section="text">Text</StdSubLabel>
                <Field label="Colour"><ColorField value={toHex6(cs.color)} {...colorCtl((v) => liveCallout({ color: v }))} seed={COLOR_SEED} title="Text color" style={swatch} /></Field>
                <Field label="Size"><NumInput boxed fill unit="pt" ariaLabel="Text size" value={cs.size} min={1} max={96} step={1} coarse={4} onCommit={(n) => setSelCallout({ size: n })} /></Field>
                <Field label="Style">
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                    <button type="button" style={{ ...segSm(cs.bold), fontWeight: 800 }} title="Bold" aria-label="Bold" aria-pressed={cs.bold} onClick={() => setSelCallout({ bold: !cs.bold })}>B</button>
                    <button type="button" style={{ ...segSm(cs.italic), fontStyle: "italic" }} title="Italic" aria-label="Italic" aria-pressed={cs.italic} onClick={() => setSelCallout({ italic: !cs.italic })}>I</button>
                    <button type="button" style={{ ...segSm(cs.underline), textDecoration: "underline" }} title="Underline" aria-label="Underline" aria-pressed={cs.underline} onClick={() => setSelCallout({ underline: !cs.underline })}>U</button>
                    <button type="button" data-testid="callout-strike" style={{ ...segSm(cs.strike), textDecoration: "line-through" }} title="Strikethrough" aria-label="Strikethrough" aria-pressed={cs.strike} onClick={() => setSelCallout({ strike: !cs.strike })}>S</button>
                    <button type="button" data-testid="callout-caps" style={{ ...segSm(cs.caps), fontSize: 10.5, fontWeight: 700, letterSpacing: "-0.02em" }} title="All caps (display only — the typed text is not changed)" aria-label="All caps" aria-pressed={cs.caps} onClick={() => setSelCallout({ caps: !cs.caps })}>AA</button>
                  </div>
                </Field>
                <Field label="Align">
                  <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap" }}>
                    {[["left", "Align left"], ["center", "Align center"], ["right", "Align right"]].map(([a, lbl]) => (
                      <button type="button" key={a} style={segSm(cs.align === a)} title={lbl} aria-label={lbl} aria-pressed={cs.align === a} onClick={() => setSelCallout({ align: a })}><AlignIcon dir={a} /></button>
                    ))}
                    <div aria-hidden="true" style={{ width: 1, height: 18, background: PAL.panelLine, margin: "0 2px", flex: "none" }} />
                    {[["top", "Align text to the top"], ["middle", "Align text to the middle"], ["bottom", "Align text to the bottom"]].map(([a, lbl]) => (
                      <button type="button" key={a} data-testid={`callout-valign-${a}`} style={segSm(cs.valign === a)} title={`${lbl} (${vAlignHint})`} aria-label={lbl} aria-pressed={cs.valign === a} onClick={() => setSelCallout({ valign: a })}><VAlignIcon dir={a} /></button>
                    ))}
                  </div>
                </Field>
                <Field label="Spacing"><NumInput boxed fill unit="×" ariaLabel="Line spacing" value={cs.lineHeight} min={0.8} step={0.1} coarse={0.5} onCommit={(n) => setSelCallout({ lineHeight: n })} /></Field>

                <StdSubLabel section="appearance">Appearance</StdSubLabel>
                {/* NEW-1/NEW-2 (B1652704/B1652705) — the outline carries a weight, a dash pattern and its own opacity (lib/calloutStyle.js +
                    the shared DASH_OPTIONS list), and the fill its own opacity. Fill has no weight / pattern, so those cells carry the shared em-dash. */}
                <PairedFieldHead left="Outline" right="Fill" />
                <PairedField label="Colour"
                  left={<ColorField value={toHex6(cs.stroke)} {...colorCtl((v) => liveCallout({ stroke: v }))} seed={COLOR_SEED} title="Outline color" style={swatch} />}
                  right={<ColorField value={toHex6(cs.fill)} {...colorCtl((v) => liveCallout({ fill: v }))} seed={COLOR_SEED} title="Fill color" style={swatch} />}
                />
                <PairedField label="Opacity"
                  left={<PercentField boxed value={cs.opacity} onCommit={(v) => setSelCallout({ opacity: v })} ariaLabel="Outline opacity" />}
                  right={<PercentField boxed value={cs.fillOpacity} onCommit={(v) => setSelCallout({ fillOpacity: v })} ariaLabel="Fill opacity" />}
                />
                <PairedField label="Weight" left={<NumInput boxed fill ariaLabel="Line weight" testid="callout-weight" value={cs.weight} min={0.5} step={0.5} coarse={2} onCommit={(n) => setSelCallout({ weight: n })} />} />
                <PairedField label="Pattern" left={<select autoComplete="off" aria-label="Line pattern" style={patSel} value={cs.dash} onChange={(e) => setSelCallout({ dash: e.target.value })}>{DASH_OPTIONS}</select>} />

                <StdSubLabel section="size">Size & position</StdSubLabel>
                <PairedFieldHead left="X" right="Y" />
                <PairedField label="Margin"
                  left={<NumInput boxed fill ariaLabel="Margin X" value={cs.padX} min={0} step={1} coarse={4} onCommit={(n) => setSelCallout({ padX: n })} />}
                  right={<NumInput boxed fill ariaLabel="Margin Y" value={cs.padY} min={0} step={1} coarse={4} onCommit={(n) => setSelCallout({ padY: n })} />}
                />
                {/* NEW-2 (B1612641) — the same rotation control every other rotatable object uses, now with the angle glyph, quarter turns and Level. */}
                <Field label="Rotation"><RotationField value={selCallout.rot || 0} locked={!!selCallout.locked} lockedReason="Unlock this callout to rotate it"
                  onCommit={(deg) => setSelCallout({ rot: deg })}
                  onStep={(d) => setSelCallout({ rot: normalizeDeg((selCallout.rot || 0) + d) })} /></Field>
                {/* B913 — a fixed width (side grip) and/or fixed height (top / bottom grip) was set. "Fit to text" clears both so the box
                    auto-sizes to its content again (matches the per-element inspector). */}
                {fixedExtent && (
                  <button type="button" style={{ ...chip, width: "100%" }} title="Clear the fixed width and height — auto-size the box to its text again (Alt+Z)" onClick={() => setSelCallout({ boxW: null, boxH: null })}>↔ Fit to text <kbd style={{ marginLeft: 6 }}>Alt Z</kbd></button>
                )}
                <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
                  {/* NEW-1 — the markup and measurement inspectors both carry a Lock chip here; an annotation was the one drawn object with no lock control. */}
                  <button style={chip} onClick={() => toggleCalloutLock(selCallout.id)}><span style={{ display: "inline-flex", alignItems: "center", gap: SPACE.xs }}><LockGlyph locked={!!selCallout.locked} size={13} />{selCallout.locked ? "Unlock" : "Lock"}</span></button>
                  <button style={{ ...chip, color: PAL.danger }} onClick={() => deleteSel(null, { entry: "panel:callout" })}>{selCallout.noLeader ? "Delete text box" : "Delete callout"}</button>
                </div>
              </Section>
              </div>
            );
});

export const MeasureInspector = memo(function MeasureInspector({
  PAL,
  calibrationState,
  chip,
  colorCtl,
  deleteSel,
  liveMeasure,
  numInput,
  pushHistory,
  selMeasure,
  setMeasures,
  setSelMeasure,
  textInput,
  toggleMeasureLock,
}) {
            const m = selMeasure;
            const mode = measMode(m);
            const fpts = measPts(m);
            const rows = [];
            // NEW-3 (f) — the panel reads the SAME formatters as the canvas chip, so screen,
            // panel and paper can never disagree about how a number is written.
            if (mode === "count") rows.push(["Items", fmtInt(fpts.length)]);
            else if (mode === "area") { rows.push(["Area", `${fmtSf(polyArea(fpts))} · ${fmtAcres(polyArea(fpts) / SQFT_PER_ACRE)}`]); rows.push(["Perimeter", fmtFeet(pathLen([...fpts, fpts[0]]))]); }
            else rows.push(["Length", fmtFeet(pathLen(fpts))]);
            const valStyle = { fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, fontWeight: 700, fontSize: 13, color: PAL.ink };
            // NEW-1 (found while wiring the measurement panel) — NO `background` here. ColorField
            // paints the CURRENT COLOUR as the chip's background and then spreads this override on
            // top, so a hardcoded surface colour blanked every colour chip in these panels: the
            // control you click to change a colour showed no colour. Leave it to ColorField.
            const swatch = { width: 34, height: 26, padding: 0, border: BORDER_1, borderRadius: 6, cursor: "pointer" };
            const patSel = { ...numInput, width: "100%", height: CONTROL_H.md, boxSizing: "border-box", padding: "0 6px", fontFamily: "inherit", textAlign: "right", textAlignLast: "right" };
            const closed = mode === "area";
            const stylable = mode !== "count";
            const uncal = calibrationState === "uncalibrated";
            const hasOverride = MEASURE_STD_KEYS.some((k) => m[k] !== undefined) || !!m.labelOffset;
            const ms = measureStyle(m);
            const weightBox = <NumInput boxed fill ariaLabel="Line weight" testid="measure-weight" value={m.weight ?? MEASURE_LINE.weight} min={0.5} step={0.5} coarse={2} onCommit={(n) => setSelMeasure({ weight: n })} />;
            const dashSel = <select autoComplete="off" aria-label="Line pattern" style={patSel} value={m.dash || MEASURE_LINE.dash} onChange={(e) => setSelMeasure({ dash: e.target.value })}>{DASH_OPTIONS}</select>;
            return (
              <div>
              <Section title={null}>
                {uncal && <div style={{ fontSize: 11, color: "var(--warn-text)", lineHeight: 1.5, marginBottom: 8 }}>⚠ This drawing isn’t calibrated yet — the value below is in raw units, not real feet. Calibrate to a known distance first.</div>}
                <Field label="Label"><input {...NO_AUTOFILL} value={m.label || ""} maxLength={80}
                  onFocus={() => pushHistory()}
                  onChange={(ev) => setMeasures((a) => a.map((x) => (x.id === m.id ? { ...x, label: ev.target.value } : x)))}
                  placeholder="e.g. Front setback" style={textInput} /></Field>

                <StdSubLabel section="appearance">Appearance</StdSubLabel>
                {/* Line + fill, routed through the shared ColorField (so it inherits the recently used colours) and the shared
                    DASH_OPTIONS list. Every mode gets the line controls; only a closed area gets a fill — and only then is there a
                    second side to pair against, so a non-closed measurement is one column. */}
                {closed ? (<>
                  <PairedFieldHead left="Outline" right="Fill" />
                  <PairedField label="Colour"
                    left={<ColorField value={toHex6(ms.stroke)} {...colorCtl((v) => liveMeasure({ stroke: v }))} seed={COLOR_SEED} title="Outline color" style={swatch} />}
                    right={<ColorField value={toHex6(ms.fill)} {...colorCtl((v) => liveMeasure({ fill: v }))} seed={COLOR_SEED} title="Fill color" style={swatch} />}
                  />
                  <PairedField label="Opacity"
                    right={<PercentField boxed value={m.fillOpacity ?? MEASURE_LINE.fillOpacity} onCommit={(v) => setSelMeasure({ fillOpacity: v })} ariaLabel="Fill opacity" />}
                  />
                  <PairedField label="Weight" left={weightBox} />
                  <PairedField label="Pattern" left={dashSel} />
                </>) : (<>
                  <Field label={mode === "count" ? "Markers" : "Colour"}><ColorField value={toHex6(ms.stroke)} {...colorCtl((v) => liveMeasure({ stroke: v }))} seed={COLOR_SEED} title={mode === "count" ? "Marker color" : "Line color"} style={swatch} /></Field>
                  <Field label="Weight">{weightBox}</Field>
                  {stylable && <Field label="Pattern">{dashSel}</Field>}
                </>)}
                {uncal && <div style={{ fontSize: 10.5, color: "var(--warn-text)", lineHeight: 1.45, margin: "2px 2px 6px" }}>Your colour is saved, but this measurement stays amber on the drawing until the sheet is calibrated — that amber means “this number isn’t real feet yet”.</div>}

                <StdSubLabel section="size">Size & position</StdSubLabel>
                {rows.map(([k, v], j) => <Field key={j} label={k}><span style={valStyle}>{v}</span></Field>)}
                {m.locked && <div style={{ fontSize: 11, color: PAL.muted, lineHeight: 1.5, marginTop: 8 }}>Locked — click Unlock below to move or reshape it.</div>}
                <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                  <button style={chip} onClick={() => toggleMeasureLock(m.id)}><span style={{ display: "inline-flex", alignItems: "center", gap: SPACE.xs }}><LockGlyph locked={!!m.locked} size={13} />{m.locked ? "Unlock" : "Lock"}</span></button>
                  {hasOverride && <button style={chip} title="Back to your Standards defaults, including where the label sits"
                    onClick={() => setSelMeasure({ ...Object.fromEntries(MEASURE_STD_KEYS.map((k) => [k, null])), labelOffset: null })}>Reset style</button>}
                  <button style={{ ...chip, color: PAL.danger }} onClick={() => deleteSel(null, { entry: "panel:measure" })}>Delete</button>
                </div>
              </Section>
              </div>
            );
});

export const DriveInRampInspector = memo(function DriveInRampInspector({
  chip,
  deleteSel,
  els,
  parcelSetbacks,
  parcels,
  rampDockIn,
  rampDoorRun,
  roundTrim,
  selEl,
  setRampPatch,
  settings,
  sharpFor,
}) {
            // NEW-3 (2026-10-30) — the drive-in ramp's own panel. Everything it quotes is read from lib/driveInRamp.js off the HOST, so the panel, the
            // canvas, the door belt and the grading plane cannot disagree; every edit is one history frame and the write seam re-derives the box.
            const host = els.find((x) => x.id === selEl.attachedTo && x.type === "building" && !x.points) || null;
            const rec = selEl.ramp || null;
            if (!host || !rec) return <Section title={null}><div style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>This ramp is no longer attached to a building.</div><button type="button" style={chip} onClick={() => deleteSel(null, { entry: "panel:element" })}>Delete</button></Section>;
            const dockSides = dockSidesFor(host).dockSides, marker = !dockSides.includes(rec.side);
            const court = els.find((x) => x.attachedTo === host.id && x.truckCourt && x.truckCourt.side === rec.side && !x.points);
            const courtDepth = court ? (rec.side === "top" || rec.side === "bottom" ? hostAxisExtents(host, court).dimBY : hostAxisExtents(host, court).dimBX) : null;
            const stackIds = new Set(els.filter((x) => x.attachedTo === host.id && (x.truckCourt || x.forCourt || x.forTrailer || x.prevZone || x.stackSide)).map((x) => x.id));
            const flagRing = (x) => { try { return isCenterlineRoad(x) ? roadStripRing(x, settings, sharpFor(x), roundTrim(x)) : ringOf(x); } catch (_) { return null; } };
            const others = els.filter((x) => x.id !== selEl.id && x.id !== host.id && !stackIds.has(x.id))
              .map((x) => ({ id: x.id, name: x.dogEar ? "the corner bump-out" : `the ${(TYPE[x.type]?.label || "another element").split(" / ")[0].toLowerCase()}`, ring: flagRing(x) }));
            const allowedRings = parcels.filter((pc) => pc.active !== false && pc.points && pc.points.length >= 3).map((pc) => { const sb = parcelSetbacks(pc); return (sb.some((v) => v > 0) ? offsetPolygon(pc.points, sb) : null) || pc.points; });
            const flags = rampFlags(host, rec, { dockSides, dockHeightIn: rampDockIn, courtDepthFt: courtDepth, others, allowedRings });
            const sp = rampSpan(rec, { marker, dockHeightIn: rampDockIn });
            const doorsNow = rampDoorRun(host, rec.side).doors, leaf = resolveGridSettings(host, settings).doorWidth;
            const doorsTaken = marker ? 0 : doorsNow.filter((c) => Math.min(c + leaf / 2, sp.u1) - Math.max(c - leaf / 2, sp.u0) > 1).length;
            return (
              <Section title={null}>
                <DriveInRampPanel ramp={rec} marker={marker} lengthFt={rampLengthFt(rec, rampDockIn)} riseIn={rampRiseFt(rec, rampDockIn) * 12} dockHeightIn={rampDockIn}
                  doorsTaken={doorsTaken} flags={flags}
                  onPatch={(patch) => {
                    // turning it ALONG the wall, or flipping which way it runs, keeps the footprint on the wall (a door position that would overrun it slides in)
                    const turning = patch.layout === "along" || (rampLayout(rec) === "along" && patch.dir != null);
                    const fit = turning ? fitAlongTheWall({ ...rec, ...patch }, { L: wallFrame(host, rec.side).L, stops: moduleStops(doorsNow), dockHeightIn: rampDockIn, keepDir: patch.dir != null ? patch.dir : null }) : null;
                    setRampPatch(selEl.id, fit ? { ...patch, ...fit } : patch);
                  }}
                  onAt={(n) => { const stops = moduleStops(doorsNow); const want = Number.isFinite(n) ? n : rec.at; setRampPatch(selEl.id, { at: Math.round((stops.length ? stops.reduce((b, v) => (Math.abs(v - want) < Math.abs(b - want) ? v : b), stops[0]) : want) * 100) / 100 }); }}
                  onRise={(n) => setRampPatch(selEl.id, { riseIn: Number.isFinite(n) ? n : null })}
                  onDelete={() => deleteSel(null, { entry: "panel:element" })} />
              </Section>
            );
});
