/* Road cross-section designer (NEW-1) — "design road": a row per band (type + width, add / remove /
 * reorder) with a LIVE TO-SCALE TYPICAL-SECTION PREVIEW that updates on commit (never mid-keystroke —
 * see BandWidthInput), a horizontal dimension string beneath each band, a running total, and the
 * derived section/ROW/pavement numbers. Presets are named + saved at the ACCOUNT level
 * (lib/userPrefs.js, the same store "Save for all projects" already uses) so a section designed once
 * is reusable on any road in any project, signed in or not (a signed-out mirror lives in localStorage
 * the same way Standards' account layer already does).
 *
 * NEW-2 (owner report, 2026-08-26) — the preview is drawn the way a roadway typical section is
 * actually drafted: LOOKING DOWN THE ROAD, bands running left to right (matching the road as it's
 * drawn on the canvas), a centerline mark, and a real horizontal dimension string — see
 * XSectionPreview's own header for the detail.
 *
 * Two ways in, both reaching this same dialog (never a popover that gates drawing — a deliberate
 * dialog opened from Properties or from the road tool's own preset menu is fine; a panel blocking the
 * canvas before anything is drawn is not, per the owner's own instruction on the cloud-tool cleanup):
 *   • Properties → "Edit cross-section..." on a selected road — `mode="edit"`, bound to that road,
 *     `lengthFt` supplied so the pavement-area preview is real, not per-100'.
 *   • The Road tool's width flyout → "Design cross-section..." — `mode="new"`, sets the ACTIVE section
 *     for the next road drawn; length is unknown yet, so the area preview reads "per 100 ft".
 *
 * Lazily loaded (a modal a session opens rarely) — same pattern as SetLocationDialog.jsx. Module
 * scope throughout (MODULE-SCOPE-COMPONENTS): XSectionPreview is a sibling function component, never
 * defined inside the dialog's render body. */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  BAND_TYPES, bandTypeOf, normalizeBands, makeXSection, curbToCurbWidth, pavedWidth, rowWidth,
  pavementArea, bandLayout, bandStripeMarks, BAND_FILL_TOKEN, BAND_FILL_OPACITY, BUILT_IN_XSECTION_PRESETS,
  MIN_BAND_WIDTH_FT, parseWidthDraft, designatedRowFt, rowMarginFt,
} from "../lib/roadCrossSection.js";

const f1 = (n) => (Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : "—");
const f0 = (n) => (Number.isFinite(n) ? Math.round(n).toString() : "—");
const uid = () => `xsec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/* NEW-2 (owner report, 2026-08-26 — "and lets make it horizontal? that makes sense to me based on the
 * details I usually see") — a roadway typical section is drawn looking down the road: pavement runs
 * left-to-right, the dimension string runs horizontally beneath it. These constants govern that
 * layout (see XSectionPreview below); nothing here is a real-world dimension, they're all screen px. */
const PREVIEW_MIN_W = 320; // fallback content width for the very first render, before the container is measured
const SWATCH_D = 64; // the swatch's own depth — pure texture (a road drawn in plan view has no "front"), no dimension
const MAX_PX_PER_FT = 6.5; // legibility ceiling — a narrow section's bands don't get absurdly wide, and a section
  // that would otherwise overflow the dialog gets scaled DOWN below this, never clipped or made to scroll
const LADDER_MARGIN = 24; // total horizontal margin reserved so the outermost ticks/labels never touch the SVG edge
const CL_LABEL_H = 24; // room for the "C"/"L" centerline glyphs at the very top of the preview
const CL_EXT = 8; // how far the centerline's dash-dot line extends below the swatch (it starts above it, at the top)
const LEADER_ROW_H = 13; // vertical space per stacked leader-label row, above the swatch
const LEADER_GAP = 6; // gap between the last leader row (or the centerline label, if there are none) and the swatch
const DIM_GAP = 10; // gap between the swatch and the dimension ladder line below it
const DIM_TICK = 5; // dimension-ladder tick half-length
const DIM_ROW_H = 13; // vertical space per stacked row when a band's own width figure doesn't fit under its ticks
const TOTAL_GAP = 14; // gap between the dimension numbers and the running-total line

// A deliberately conservative (slightly OVER-) estimate of a label's rendered width, used only to
// decide whether it fits its own column — erring wide means a borderline label gets moved out with a
// leader rather than risking the clip/squeeze this whole feature exists to prevent.
const CHAR_W = 0.56;
const estTextW = (text, fontSize) => text.length * fontSize * CHAR_W;

/* Greedy row-packing: given items carrying {mid, halfW} (a horizontal center + half its rendered
 * width), assign each a `.row` (mutated in place; 0 = nearest the anchor line) so nothing sharing a
 * row overlaps. Used for both the above-swatch leader labels and the below-ladder tight-width
 * numbers — two independent stacks, same packing rule. Returns the row count. */
function packRows(items, gap) {
  const rowRight = [];
  for (const it of [...items].sort((a, b) => a.mid - b.mid)) {
    let row = rowRight.findIndex((right) => it.mid - it.halfW > right + gap);
    if (row === -1) { row = rowRight.length; rowRight.push(-Infinity); }
    it.row = row;
    rowRight[row] = it.mid + it.halfW;
  }
  return rowRight.length;
}

/* NEW-1 follow-up — the width field that used to be a raw, always-controlled `<input type="number">`
 * bound straight to committed band state, so every keystroke was a commit: typing "2" on the way to
 * "25" instantly set that band's width to 2, and the WHOLE dialog (preview + every derived total)
 * recomputed off that transient value. This mirrors SitePlanner.jsx's NumInput contract — a local
 * DRAFT the user types into, committed to the model only on blur or Enter — so a prefix of a valid
 * number (or any of the other legitimate mid-typing states parseWidthDraft names) never touches
 * `bands`, and the preview/totals therefore keep showing the LAST COMMITTED geometry the whole time
 * someone is mid-edit. No error styling is shown at all here — an unparseable draft at commit time
 * just silently reverts to the last committed value, and a below-minimum one is silently clamped up
 * to MIN_BAND_WIDTH_FT — never a red border, never a blocked keystroke, per the owner's own rule. */
/* B783280 — `forceCommit` is for the ONE caller (the ROW field below) whose `value` prop is not a
 * true committed model value but a computed DEFAULT (the current band total, shown so the field is
 * never blank). Without it, a user who types the exact digits already on screen — the realistic case
 * whenever the ROW is meant to equal the modeled section, e.g. a 68′ boulevard plus 16′+16′ parkways
 * showing "100" before anyone has designated anything — produces `next === value` and `onCommit` is
 * silently skipped, so nothing is ever designated and no ROW line ever draws: a LOUD-FAILURE violation
 * (the field visibly reads "100" either way, designated or not). `dirtyRef` tracks a real keystroke so
 * an untouched blur (just tabbing through, no edit) still costs nothing; band-width fields keep the old
 * equality-suppression, since their `value` IS the persisted model value and re-typing the same number
 * is a genuine no-op there. */
function BandWidthInput({ value, onCommit, ariaLabel = "Band width, feet", testId, forceCommit = false }) {
  const [draft, setDraft] = useState(() => String(value));
  const committedRef = useRef(value);
  const dirtyRef = useRef(false);
  useEffect(() => {
    if (value !== committedRef.current) { committedRef.current = value; setDraft(String(value)); dirtyRef.current = false; }
  }, [value]);
  const commit = () => {
    const n = parseWidthDraft(draft);
    const next = n == null ? committedRef.current : Math.max(MIN_BAND_WIDTH_FT, n);
    const wasDirty = dirtyRef.current;
    committedRef.current = next;
    setDraft(String(next));
    dirtyRef.current = false;
    if (next !== value || (forceCommit && wasDirty)) onCommit(next);
  };
  return (
    <input type="text" inputMode="decimal" value={draft} aria-label={ariaLabel} data-testid={testId}
      onChange={(e) => { setDraft(e.target.value); dirtyRef.current = true; }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          const el = e.currentTarget;
          requestAnimationFrame(() => { try { el.select(); } catch (_) {} });
        } else if (e.key === "Escape") {
          e.preventDefault();
          setDraft(String(committedRef.current));
        }
      }}
      style={{ width: 60, padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit", border: "1px solid var(--planner-border)", borderRadius: 7, background: "var(--surface-base)", color: "var(--text-primary)" }} />
  );
}

const STRIPE_STYLE = {
  "yellow-solid": { stroke: "#e6b800", dash: undefined, w: 1.6 },
  "yellow-double": { stroke: "#e6b800", dash: undefined, w: 1.6, double: true },
  "white-dash": { stroke: "#f2f2f2", dash: "10 8", w: 1.4 },
  "white-solid": { stroke: "#f2f2f2", dash: undefined, w: 1.4 },
};

/* NEW-2 (owner report, 2026-08-26) — a real typical-section drawing: bands run LEFT TO RIGHT (matching
 * the road as it's actually drawn on the plan, and the only orientation a horizontal dimension string
 * can work in at all — see the note on the old rotated total label this replaces, below), a centerline
 * mark at bandLayout's true offset-0, and a proper dimension string beneath (a tick at every band
 * boundary, each band's own width underneath, the running total below that). A band too narrow to hold
 * its own label — inside the swatch, or under its own dimension ticks — is never clipped, squeezed, or
 * left to overflow into its neighbor: the label moves OUT onto a leader line instead (`packRows`,
 * above). Hovering or focusing a row in the band list below highlights the matching band here
 * (`activeIndex`), which is the one genuine advantage a top-to-bottom preview had — kept, not lost, in
 * the rotation.
 *
 * WIDTH IS MEASURED, NOT ASSUMED (`wrapRef`/`ResizeObserver`) — this dialog's own width used to be
 * "assumed ≈ the fixed pixel value used to compute px/ft" in the vertical layout (a mismatch which is
 * what produced the B776560 giant-numeral bug in the first place, further down this file's own git
 * history). Now that the WIDE axis is the one that has to fit the dialog, guessing is not an option: a
 * 68′ boulevard and a 100+′ arterial both need the real container width to decide their scale, so the
 * preview measures its own wrapping div (synchronously, in a layout effect — before the first paint,
 * so there is no flash of the wrong size) and re-measures on every resize. The per-foot scale is
 * capped at MAX_PX_PER_FT for legibility and otherwise sized to exactly fill the measured width, so
 * content width is always <= what's available — it SCALES TO FIT, per the owner's own instruction,
 * never clips and never needs a scrollbar. */
function XSectionPreview({ xsection, activeIndex }) {
  const wrapRef = useRef(null);
  const [containerW, setContainerW] = useState(PREVIEW_MIN_W);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => { const w = el.clientWidth; if (w > 0) setContainerW(w); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { edges, rowW } = bandLayout(xsection);
  if (!edges.length || !(rowW > 0)) return <div ref={wrapRef} style={{ width: "100%" }} />;

  // NEW-1 — a designated ROW is drawn as an outer boundary AROUND the modeled bands, so the preview's
  // own extent has to grow to fit it (never fit only the bands and let the ROW boundary run off the
  // edge). `margin` is null both when nothing is designated and when the modeled bands already exceed
  // the designated ROW (see rowMarginFt's own header) — that invalid state gets no ROW drawing here,
  // matching the canvas exactly; the loud warning below the field is what surfaces it.
  const designatedRow = designatedRowFt(xsection);
  const margin = designatedRow != null ? rowMarginFt(xsection) : null;
  const totalExtent = margin != null ? designatedRow : rowW;

  const usableW = Math.max(60, containerW - LADDER_MARGIN);
  const scale = Math.min(MAX_PX_PER_FT, usableW / totalExtent); // px per foot — content width never exceeds usableW
  const contentW = totalExtent * scale;
  const padLeft = (containerW - contentW) / 2; // centers on the TRUE centerline (offset 0), not on the band block's own (possibly asymmetric) span
  const xOf = (offsetFt) => padLeft + (totalExtent / 2 - offsetFt) * scale; // offset 0 → the drawing's horizontal middle, always
  const marks = bandStripeMarks(xsection);

  // Per-band label: "Type · width" if the band's own column holds it, just "width" if it holds that,
  // or — never clipped, squeezed, or left to overflow — moved OUT above the swatch on a leader line.
  const labels = edges.map((e) => {
    const bandPxW = Math.max(0, (e.from - e.to) * scale);
    const full = `${bandTypeOf(e.band.type).label} · ${f1(e.band.w)}′`;
    const short = `${f1(e.band.w)}′`;
    const mid = (xOf(e.from) + xOf(e.to)) / 2;
    if (bandPxW - 6 >= estTextW(full, 10.5)) return { edge: e, mode: "inside", text: full, fontSize: 10.5, mid };
    if (bandPxW - 6 >= estTextW(short, 9)) return { edge: e, mode: "inside", text: short, fontSize: 9, mid };
    return { edge: e, mode: "leader", text: full, fontSize: 9, mid, halfW: estTextW(full, 9) / 2 };
  });
  const leaders = labels.filter((l) => l.mode === "leader");
  const leaderRows = leaders.length ? packRows(leaders, 6) : 0;

  // The dimension string below the swatch — every band's width, always, tick-marked in the real civil
  // convention. A band too narrow to hold its own number under its own ticks gets the same leader
  // treatment, one row further down, rather than overlapping its neighbor's number.
  const dimNums = edges.map((e) => {
    const bandPxW = Math.max(0, (e.from - e.to) * scale);
    const text = `${f1(e.band.w)}′`;
    const mid = (xOf(e.from) + xOf(e.to)) / 2;
    const fits = bandPxW - 4 >= estTextW(text, 9.5);
    return { edge: e, text, mid, fits, halfW: estTextW(text, 9.5) / 2 };
  });
  const tightDims = dimNums.filter((d) => !d.fits);
  const dimRows = tightDims.length ? packRows(tightDims, 6) : 0;

  // Vertical layout, top to bottom — see the constants block above for what each gap is for.
  let y = CL_LABEL_H;
  const leaderTop = y;
  if (leaderRows > 0) y += leaderRows * LEADER_ROW_H;
  y += LEADER_GAP;
  const swatchTop = y;
  y += SWATCH_D;
  const swatchBottom = y;
  y = swatchBottom + DIM_GAP;
  const ladderY = y;
  y += DIM_TICK + 12;
  const dimNumBaseY = y;
  if (dimRows > 0) y += dimRows * DIM_ROW_H;
  y += TOTAL_GAP;
  const totalY = y;
  // NEW-1 — a second, OUTER dimension string for the designated ROW itself, stacked below the band
  // total rather than merged into the same ladder: the two numbers answer different questions ("what
  // did I draw" vs. "what did I designate") and conflating them into one ladder would blur exactly
  // that distinction.
  let rowLadderY = null, rowTotalY = null;
  if (margin != null) {
    y += DIM_GAP;
    rowLadderY = y;
    y += DIM_TICK + 12;
    y += TOTAL_GAP;
    rowTotalY = y;
  }
  const svgH = y + 6;

  const clX = xOf(0);
  const outerFrom = edges[0].from, outerTo = edges[edges.length - 1].to; // the band block's own true outer edges — NOT assumed symmetric (see xOf's own note)

  return (
    <div ref={wrapRef} style={{ width: "100%" }}>
      <svg viewBox={`0 0 ${containerW} ${svgH}`} width={containerW} height={svgH}
        style={{ display: "block", background: "var(--surface-base)", borderRadius: 8 }}
        role="img" aria-label="Cross-section preview, looking down the road">
        {/* the centerline — a dash-dot line through the section's true drawn offset 0, with the
            traditional "C" over "L" mark (drawn as plain ASCII text, never a Unicode glyph a font
            might not carry) rather than a symbol that could silently render as a tofu box */}
        <text x={clX} y={9} textAnchor="middle" style={{ fontSize: 7, fontWeight: 700, fill: "var(--text-tertiary)" }}>C</text>
        <text x={clX} y={19} textAnchor="middle" style={{ fontSize: 7, fontWeight: 700, fill: "var(--text-tertiary)" }}>L</text>
        <line x1={clX} y1={CL_LABEL_H} x2={clX} y2={swatchBottom + CL_EXT} stroke="var(--text-tertiary)" strokeWidth={0.9} strokeDasharray="8 3 1.5 3" />

        {/* NEW-1 — the designated ROW: an outer boundary beyond the modeled bands (dashed, distinct
            from both the centerline's dash-dot and the ROW's own margin fill below), plus the
            undesignated margin shaded distinctly from every band's own fill — reads as "reserved,
            not modeled" rather than as another band. The margin drawn here is the TRUE geometric gap
            on each side (the band block's own outer edge out to the symmetric ROW boundary), which
            can differ slightly from the single averaged "(Y-X)/2 each side" figure shown in the
            dialog's text summary whenever the modeled bands themselves aren't symmetric about the
            centerline — an honest picture of the actual geometry beats forcing two equal rects that
            wouldn't line up with where the bands really end. */}
        {margin != null && (() => {
          const rowL = xOf(designatedRow / 2), rowR = xOf(-designatedRow / 2);
          const bandL = xOf(outerFrom), bandR = xOf(outerTo);
          return (
            <>
              {rowL < bandL && <rect x={rowL} y={swatchTop} width={bandL - rowL} height={SWATCH_D} fill="var(--text-tertiary)" fillOpacity={0.07} stroke="none" />}
              {bandR < rowR && <rect x={bandR} y={swatchTop} width={rowR - bandR} height={SWATCH_D} fill="var(--text-tertiary)" fillOpacity={0.07} stroke="none" />}
              <line x1={rowL} y1={swatchTop - 5} x2={rowL} y2={swatchBottom + 5} stroke="var(--text-tertiary)" strokeWidth={0.9} strokeDasharray="4 3" />
              <line x1={rowR} y1={swatchTop - 5} x2={rowR} y2={swatchBottom + 5} stroke="var(--text-tertiary)" strokeWidth={0.9} strokeDasharray="4 3" />
            </>
          );
        })()}

        {/* the swatch — bands run LEFT TO RIGHT, matching the road as drawn on the plan */}
        {edges.map((e) => {
          const x0 = xOf(e.from), x1 = xOf(e.to);
          const bandW = Math.max(0.5, x1 - x0);
          const tok = BAND_FILL_TOKEN[e.band.type];
          return (
            <rect key={e.index} x={Math.min(x0, x1)} y={swatchTop} width={bandW} height={SWATCH_D}
              fill={tok || "var(--planner-raised)"} fillOpacity={tok ? BAND_FILL_OPACITY[e.band.type] : 0.5}
              stroke="var(--planner-border)" strokeWidth={0.5} />
          );
        })}
        {activeIndex != null && edges[activeIndex] && (() => {
          const e = edges[activeIndex];
          const x0 = Math.min(xOf(e.from), xOf(e.to)), x1 = Math.max(xOf(e.from), xOf(e.to));
          return <rect x={x0 + 0.75} y={swatchTop + 0.75} width={Math.max(0.5, x1 - x0 - 1.5)} height={SWATCH_D - 1.5}
            fill="none" stroke="var(--accent)" strokeWidth={2} rx={2} />;
        })()}

        {/* lane markings — vertical now, at the same within-curb seams */}
        {marks.map((m, i) => {
          const x = xOf(m.atOffset);
          const st = STRIPE_STYLE[m.style];
          if (!st) return null;
          if (st.double) {
            return (
              <g key={i}>
                <line x1={x - 1.1} y1={swatchTop} x2={x - 1.1} y2={swatchBottom} stroke={st.stroke} strokeWidth={st.w} />
                <line x1={x + 1.1} y1={swatchTop} x2={x + 1.1} y2={swatchBottom} stroke={st.stroke} strokeWidth={st.w} />
              </g>
            );
          }
          return <line key={i} x1={x} y1={swatchTop} x2={x} y2={swatchBottom} stroke={st.stroke} strokeWidth={st.w} strokeDasharray={st.dash} />;
        })}

        {/* in-band type/width labels, or — for a band too narrow to hold one — a leader line out above the swatch */}
        {labels.map((l, i) => l.mode === "inside" ? (
          <text key={i} x={l.mid} y={swatchTop + SWATCH_D / 2} textAnchor="middle" dominantBaseline="middle"
            style={{ fontSize: l.fontSize, fill: "var(--text-secondary)", fontWeight: 600 }}>{l.text}</text>
        ) : null)}
        {leaders.map((l, i) => {
          const rowFromTop = leaderRows - 1 - l.row; // row 0 (nearest the swatch) sits at the BOTTOM of the stack
          const labelY = leaderTop + rowFromTop * LEADER_ROW_H + LEADER_ROW_H - 4;
          const stubTop = labelY + 2;
          return (
            <g key={i}>
              <line x1={l.mid} y1={stubTop} x2={l.mid} y2={swatchTop} stroke="var(--text-tertiary)" strokeWidth={0.75} />
              <text x={l.mid} y={labelY} textAnchor="middle" style={{ fontSize: l.fontSize, fill: "var(--text-secondary)", fontWeight: 600 }}>{l.text}</text>
            </g>
          );
        })}

        {/* the dimension string — a tick at every band boundary, this band's own width underneath (or
            one row further down, on a short leader stub, when the column is too tight to hold it
            without overlapping its neighbor), and the running total beneath all of it. This is what
            replaces the old preview's ROTATED total label (see B776560): a rotated label needed the
            box's HEIGHT to hold its whole rendered length, which clipped it to "tot" at any modest
            height. A horizontal dimension string never has that problem at any section width. */}
        <g stroke="var(--text-tertiary)" strokeWidth={0.75} fill="none">
          <line x1={xOf(outerFrom)} y1={ladderY} x2={xOf(outerTo)} y2={ladderY} />
          {edges.map((e) => <line key={`t${e.index}`} x1={xOf(e.to)} y1={ladderY - DIM_TICK} x2={xOf(e.to)} y2={ladderY + DIM_TICK} />)}
          <line x1={xOf(outerFrom)} y1={ladderY - DIM_TICK} x2={xOf(outerFrom)} y2={ladderY + DIM_TICK} />
        </g>
        {dimNums.map((d, i) => {
          const row = d.fits ? 0 : d.row + 1;
          const y0 = dimNumBaseY + (row > 0 ? row * DIM_ROW_H : 0);
          return (
            <g key={i}>
              {row > 0 && <line x1={d.mid} y1={ladderY} x2={d.mid} y2={y0 - 8} stroke="var(--text-tertiary)" strokeWidth={0.75} />}
              <text x={d.mid} y={y0} textAnchor="middle" style={{ fontSize: 9.5, fill: "var(--text-secondary)", fontWeight: 600 }}>{d.text}</text>
            </g>
          );
        })}

        <text x={clX} y={totalY} textAnchor="middle" style={{ fontSize: 10, fill: "var(--text-tertiary)", fontWeight: 700 }}>{f1(rowW)}′ total</text>

        {/* NEW-1 — the ROW's OWN dimension string: a wider ladder spanning the full designated width,
            ticked at the band block's outer edges and at the ROW boundary, with the ROW total below —
            distinct from (never merged into) the band ladder above it. */}
        {margin != null && (() => {
          const rowL = xOf(designatedRow / 2), rowR = xOf(-designatedRow / 2);
          const bandL = xOf(outerFrom), bandR = xOf(outerTo);
          const leftMarginFt = (bandL - rowL) / scale, rightMarginFt = (rowR - bandR) / scale;
          const leftText = `${f1(leftMarginFt)}′`, rightText = `${f1(rightMarginFt)}′`;
          return (
            <>
              <g stroke="var(--text-tertiary)" strokeWidth={0.75} fill="none">
                <line x1={rowL} y1={rowLadderY} x2={rowR} y2={rowLadderY} />
                <line x1={rowL} y1={rowLadderY - DIM_TICK} x2={rowL} y2={rowLadderY + DIM_TICK} />
                <line x1={bandL} y1={rowLadderY - DIM_TICK} x2={bandL} y2={rowLadderY + DIM_TICK} />
                <line x1={bandR} y1={rowLadderY - DIM_TICK} x2={bandR} y2={rowLadderY + DIM_TICK} />
                <line x1={rowR} y1={rowLadderY - DIM_TICK} x2={rowR} y2={rowLadderY + DIM_TICK} />
              </g>
              {rowL < bandL && (bandL - rowL) - 4 >= estTextW(leftText, 9) && (
                <text x={(rowL + bandL) / 2} y={rowLadderY + 11} textAnchor="middle" style={{ fontSize: 9, fill: "var(--text-tertiary)", fontWeight: 600 }}>{leftText}</text>
              )}
              {bandR < rowR && (rowR - bandR) - 4 >= estTextW(rightText, 9) && (
                <text x={(bandR + rowR) / 2} y={rowLadderY + 11} textAnchor="middle" style={{ fontSize: 9, fill: "var(--text-tertiary)", fontWeight: 600 }}>{rightText}</text>
              )}
              <text x={clX} y={rowTotalY} textAnchor="middle" style={{ fontSize: 10, fill: "var(--text-primary)", fontWeight: 700 }}>{f1(designatedRow)}′ R.O.W.</text>
            </>
          );
        })()}
      </svg>
    </div>
  );
}

const rowStyle = { display: "flex", alignItems: "center", gap: 6, padding: "4px 0" };
const smallBtn = { width: 24, height: 24, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, border: "1px solid var(--planner-border)", background: "var(--surface-raised)", color: "var(--text-secondary)", cursor: "pointer", fontSize: 12, lineHeight: 1, padding: 0 };

export default function RoadCrossSectionDialog({ mode = "edit", initialXSection, lengthFt, presets, onSavePreset, onApply, onCancel }) {
  const [bands, setBands] = useState(() => normalizeBands(initialXSection && initialXSection.bands));
  const [presetName, setPresetName] = useState("");
  // NEW-2 — which band row is being hovered or focused, so the preview can highlight the matching
  // band: the one genuine advantage the old top-to-bottom preview had over a rotated one, preserved
  // deliberately rather than lost in the rotation.
  const [activeIdx, setActiveIdx] = useState(null);
  // NEW-1 (owner: "id like to designate the ROW to like a 100' row should be shown") — a DESIGNATED
  // right-of-way, independent of `bands`. `null` means "not designated" (the field still SHOWS the
  // band total as its default — see the field below — but nothing is stored or drawn on the canvas
  // until the user commits a real value). Deliberately not reset when a preset swaps `bands` — the
  // designated ROW is a fact about this ROAD, not about which bands happen to be modeled right now.
  const [rowDesignFt, setRowDesignFt] = useState(() => (initialXSection && initialXSection.rowDesignFt) || null);
  const x = makeXSection(bands, rowDesignFt);
  const c2c = curbToCurbWidth(x), row = rowWidth(x);
  const designatedRow = designatedRowFt(x);
  const rowMargin = designatedRow != null ? rowMarginFt(x) : null;
  const rowExceeded = designatedRow != null && row > designatedRow; // LOUD-FAILURE — never silently clamped
  const areaLenFt = mode === "edit" && lengthFt > 0 ? lengthFt : 100;
  const area = pavementArea(x, areaLenFt);
  const allPresets = [...BUILT_IN_XSECTION_PRESETS, ...(Array.isArray(presets) ? presets : [])];

  const setBand = (i, patch) => setBands((a) => a.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  const addBand = () => setBands((a) => [...a, { type: "travel", w: bandTypeOf("travel").defaultFt }]);
  const removeBand = (i) => setBands((a) => a.filter((_, j) => j !== i));
  const move = (i, dir) => setBands((a) => {
    const j = i + dir;
    if (j < 0 || j >= a.length) return a;
    const next = a.slice();
    [next[i], next[j]] = [next[j], next[i]];
    return next;
  });
  const loadPreset = (p) => setBands(normalizeBands(p.bands));
  const saveAsPreset = () => {
    const name = presetName.trim();
    if (!name || !onSavePreset) return;
    const userPresets = Array.isArray(presets) ? presets : [];
    onSavePreset([...userPresets, { id: uid(), name, bands: normalizeBands(bands) }]);
    setPresetName("");
  };
  const deletePreset = (id) => { if (onSavePreset) onSavePreset((presets || []).filter((p) => p.id !== id)); };

  const canApply = bands.length > 0 && c2c > 0;

  return (
    <div role="dialog" aria-modal="true" aria-label="Design road cross-section" data-testid="road-xsection-dialog"
      onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onCancel(); } }}
      style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(20,18,15,0.42)", display: "grid", placeItems: "center", padding: 16 }}
      onPointerDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div onPointerDown={(e) => e.stopPropagation()}
        style={{ width: "min(720px, 100%)", maxHeight: "calc(100vh - 32px)", overflowY: "auto", background: "var(--surface-raised)", border: "1px solid var(--planner-border)", borderRadius: 12, boxShadow: "0 18px 50px rgba(0,0,0,0.32)", padding: 18 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--text-primary)" }}>Design road cross-section</div>
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 3, lineHeight: 1.5 }}>
          An ordered list of bands across the road — travel lanes, a median, turn lane, shoulders, parking, sidewalks. Widths are measured across the centerline.
        </div>

        <div style={{ marginTop: 12 }}>
          <XSectionPreview xsection={x} activeIndex={activeIdx} />
        </div>

        <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 10, fontSize: 12.5, color: "var(--text-secondary)" }}>
          <span>Section width (curb to curb) <b style={{ color: "var(--text-primary)" }}>{f1(c2c)}′</b></span>
          <span>Total ROW width <b style={{ color: "var(--text-primary)" }}>{f1(row)}′</b></span>
          {/* NEW-1 follow-up (owner review, item 4) — "(per 100′)" sat BEFORE the number, where it
           * reads as a passing qualifier easily skimmed past; a reader could mistake the number for
           * the road's real total pavement area. Moved after the number, spelled out as a rate
           * ("...per 100 ft of road"), so it reads unambiguously as a unit on the figure itself. */}
          <span>Pavement area <b style={{ color: "var(--text-primary)" }}>{f0(area.sf)} SF · {f1(area.sy)} SY</b>{mode === "edit" && lengthFt > 0 ? "" : " per 100 ft of road"}</span>
          {/* NEW-1 — the two DESIGNATED figures, shown only once a real ROW has been committed
           * (below the field it derives from a bare band total is nothing new to say). */}
          {designatedRow != null && <span>Designated ROW <b style={{ color: "var(--text-primary)" }}>{f1(designatedRow)}′</b></span>}
          {rowMargin != null && <span>ROW margin <b style={{ color: "var(--text-primary)" }}>{f1(rowMargin)}′</b> each side</span>}
        </div>

        {/* NEW-1 (owner: "id like to designate the ROW to like a 100' row should be shown") — a real
         * right-of-way is a legal dedication, normally WIDER than the modeled pavement section, with
         * the remainder an undesignated margin either side. Defaults to showing the current band
         * total (`row`) so an untouched field commits nothing (BandWidthInput's own onCommit only
         * fires when the committed value differs from what's shown) — "editable upward" from there. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10, fontSize: 12.5, color: "var(--text-secondary)" }}>
          <span style={{ fontWeight: 600, color: "var(--text-primary)" }}>Right-of-way width (ft)</span>
          <BandWidthInput value={designatedRow ?? row} onCommit={(w) => setRowDesignFt(w)} ariaLabel="Right-of-way width, feet" testId="road-xsection-row" forceCommit />
          {designatedRow != null && (
            <button type="button" onClick={() => setRowDesignFt(null)} style={{ ...smallBtn, width: "auto", padding: "0 8px", color: "var(--text-tertiary)" }} title="Clear the designated ROW — the modeled band total is used instead, and no ROW line is drawn">
              Clear
            </button>
          )}
        </div>
        {/* NEW-1 (g) — LOUD-FAILURE: an over-modeled section is never silently clamped to fit the
         * designated ROW. This is the one place that state is surfaced; the canvas simply skips
         * drawing a ROW boundary it cannot honestly place (see SitePlanner.jsx's rowMarginFt gate). */}
        {rowExceeded && (
          <div role="alert" style={{ marginTop: 8, padding: "7px 10px", borderRadius: 8, background: "var(--danger-bg)", border: "1px solid var(--danger-border)", color: "var(--danger-text)", fontSize: 12, fontWeight: 600 }}>
            ⚠ The modeled bands total {f1(row)}′ — wider than the designated {f1(designatedRow)}′ right-of-way. Widen the ROW or narrow the bands; it is not auto-clamped.
          </div>
        )}

        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, color: "var(--text-tertiary)", marginBottom: 4 }}>Bands</div>
          {bands.map((b, i) => (
            <div key={i} style={{ ...rowStyle, ...(activeIdx === i ? { background: "var(--planner-raised)", borderRadius: 6 } : null) }}
              data-testid="road-xsection-band-row"
              onMouseEnter={() => setActiveIdx(i)}
              onMouseLeave={() => setActiveIdx((cur) => (cur === i ? null : cur))}
              onFocus={() => setActiveIdx(i)}
              onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setActiveIdx((cur) => (cur === i ? null : cur)); }}>
              <span style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                <button type="button" style={smallBtn} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up" title="Move up">▲</button>
                <button type="button" style={smallBtn} disabled={i === bands.length - 1} onClick={() => move(i, 1)} aria-label="Move down" title="Move down">▼</button>
              </span>
              <select value={b.type} onChange={(e) => setBand(i, { type: e.target.value })}
                style={{ flex: "1 1 auto", minWidth: 0, padding: "6px 8px", fontSize: 12.5, fontFamily: "inherit", border: "1px solid var(--planner-border)", borderRadius: 7, background: "var(--surface-base)", color: "var(--text-primary)" }}>
                {BAND_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
              <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                <BandWidthInput value={b.w} onCommit={(w) => setBand(i, { w })} />
                <span style={{ fontSize: 12, color: "var(--text-tertiary)" }}>ft</span>
              </span>
              <button type="button" style={{ ...smallBtn, width: 26, height: 26, color: "var(--danger)" }} onClick={() => removeBand(i)} aria-label="Remove band" title="Remove band">✕</button>
            </div>
          ))}
          <button type="button" onClick={addBand}
            style={{ marginTop: 6, padding: "6px 10px", fontSize: 12, fontWeight: 600, borderRadius: 7, border: "1px dashed var(--planner-border)", background: "transparent", color: "var(--accent)", cursor: "pointer" }}>
            ＋ Add band
          </button>
        </div>

        <div style={{ marginTop: 16, borderTop: "1px solid var(--planner-border)", paddingTop: 12 }}>
          <div style={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 700, color: "var(--text-tertiary)", marginBottom: 6 }}>Presets</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {allPresets.map((p) => (
              <span key={p.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <button type="button" onClick={() => loadPreset(p)}
                  style={{ padding: "5px 10px", fontSize: 12, borderRadius: 999, border: "1px solid var(--planner-border)", background: "var(--surface-base)", color: "var(--text-primary)", cursor: "pointer" }}>
                  {p.name}
                </button>
                {!p.builtin && <button type="button" onClick={() => deletePreset(p.id)} aria-label={`Delete preset ${p.name}`} title="Delete preset"
                  style={{ ...smallBtn, width: 20, height: 20, fontSize: 10, color: "var(--text-tertiary)" }}>✕</button>}
              </span>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
            <input value={presetName} onChange={(e) => setPresetName(e.target.value)} placeholder="Name this section to reuse it on any road, any project"
              style={{ flex: 1, minWidth: 0, padding: "6px 10px", fontSize: 12.5, fontFamily: "inherit", border: "1px solid var(--planner-border)", borderRadius: 7, background: "var(--surface-base)", color: "var(--text-primary)" }} />
            <button type="button" disabled={!presetName.trim()} onClick={saveAsPreset}
              style={{ padding: "6px 12px", fontSize: 12, fontWeight: 600, borderRadius: 7, border: "1px solid var(--planner-border)", background: "var(--surface-base)", color: presetName.trim() ? "var(--text-primary)" : "var(--text-tertiary)", cursor: presetName.trim() ? "pointer" : "default" }}>
              Save as preset
            </button>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
          <button type="button" onClick={onCancel} style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: "1px solid var(--planner-border)", background: "var(--surface-raised)", color: "var(--text-primary)", cursor: "pointer" }}>Cancel</button>
          <button type="button" data-testid="road-xsection-apply" disabled={!canApply} onClick={() => canApply && onApply(x)}
            style={{ padding: "7px 14px", fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: "1px solid var(--accent)", background: canApply ? "var(--accent)" : "var(--surface-raised)", color: canApply ? "var(--on-accent)" : "var(--text-tertiary)", cursor: canApply ? "pointer" : "default" }}>
            {mode === "edit" ? "Apply to this road" : "Use this section"}
          </button>
        </div>
      </div>
    </div>
  );
}
