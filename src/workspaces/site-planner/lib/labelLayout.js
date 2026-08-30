// Shared label level-of-detail + collision engine (B121).
//
// The Site Planner used to paint every element's centred label (name + area + dimensions)
// at the shape centroid with NO collision handling, so adjacent labels overprinted into an
// unreadable pile when zoomed out. This module is the one place that decides, per label:
//   (1) LEVEL-OF-DETAIL — how many of its priority-ordered lines survive at the current
//       zoom / shape size (drop the lowest-priority lines first), and
//   (2) COLLISION — which labels yield when their boxes would overlap: highest-importance
//       first, shrinking a loser to fewer lines or hiding it entirely rather than overprint.
//
// Pure geometry (no React / DOM) so it can be unit-tested without a browser and reused across
// surfaces — notably B123's per-building 4-line stack, which feeds into this same pool rather
// than standing up a parallel renderer.

import { labelForms, interiorFitter } from "./labelFitLadder.js";
import { boundedCache } from "./pureCache.js";

// Axis-aligned box from a centre + size (screen px). x/y are the top-left corner.
export const boxOf = (cx, cy, w, h) => ({ x: cx - w / 2, y: cy - h / 2, w, h });

// Do two boxes overlap, expanded by `pad` px of breathing room on every side?
export const boxesOverlap = (a, b, pad = 0) =>
  a.x - pad < b.x + b.w && a.x + a.w + pad > b.x &&
  a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;

// Level-of-detail. `lines` are ordered HIGHEST priority first (index 0 = name = last to
// drop; the trailing lines — dimensions — drop first). Keep as many leading lines as fit
// within `maxH` px of vertical room, always keeping at least one (you never fully blank a
// label here — collision resolution decides full hiding).
export const fitLines = (lines, lh, maxH) => {
  if (!lines || lines.length === 0) return [];
  let keep = lines.length;
  if (Number.isFinite(maxH) && lh > 0) keep = Math.min(keep, Math.floor(maxH / lh));
  return lines.slice(0, Math.max(1, keep));
};

/* ⛔ B548818 — THE BOX IS SIZED FROM MEASURED TEXT, NOT A CHARACTER COUNT.
 *
 * What this used to be, and what it cost: `widest line by CHARACTER COUNT × charW`, where every
 * caller set `charW = fontSize × 0.6`. Two independent errors compound in that one line. The
 * character count treats "1" and "M" as the same width, and 0.6 em is far wider than the app's
 * face actually draws digits (Inter's figures are ~0.55 em, and a measurement chip's content is
 * almost all digits and separators). Measured on the owner's plan: a chip whose widest line
 * rendered 53.5 units wide was given a box of 91.5 — the estimate ran 71% over, so the plate
 * carried 19 units of dead air on each side against 0.9 above and 3.2 below. Lopsided, and it
 * makes an already-crowded drawing more crowded.
 *
 * `textW` is an optional map of line-text → MEASURED px, supplied by the caller (which is the
 * only place that knows each line's font size, weight and letter-spacing) through the shared
 * `bestMeasurer` — real canvas metrics in a browser, the per-character table in Node. A caller
 * that supplies none keeps the old estimate exactly, so nothing changes by accident; a line with
 * no entry (a REFLOWABLE spec, which is an object rather than a string) falls back the same way.
 */
const widthOf = (lines, it) => {
  const charW = typeof it === "number" ? it : it.charW; // legacy positional form, still used by tests
  const tw = typeof it === "number" ? null : it.textW;
  return Math.max(1, ...lines.map((t) => {
    const s = String(t);
    const m = tw ? tw[s] : undefined;
    return Number.isFinite(m) ? m : s.length * charW;
  }));
};

// Greedy collision + level-of-detail layout with a narrow-shape escape hatch (B121).
// Each item: { id, cx, cy, lines, lh, charW, halfW, halfH, importance }
//   - halfW/halfH: the shape's on-screen bounding half-extents (px). `maxH` is still accepted
//     as a legacy alias for 2*halfH (halfW then defaults to ∞, i.e. never lead a label out).
//   - lines: strings, or a REFLOWABLE spec ({ parts, sep, keep }) that the shared fit ladder
//     (lib/labelFitLadder) may stack or abbreviate — see `labelForms`.
//   - ring / ringOrigin / ringPpf (optional): the element's polygon in FEET plus the feet point
//     that maps to (cx, cy) and the px-per-foot in force. Given these, fit is measured against
//     the ring's ACTUAL INTERIOR — the largest inscribed rectangles — instead of its bounding
//     box, and the label may slide inside that interior to dodge an obstacle. A bounding box
//     overstates the room an irregular pond has, which is how a label that could not fit was
//     told it fitted (NEW-1).
//   - mustLabel (optional): this element may never end the frame unlabelled. The ladder always
//     ends in a leadered `outside` rung, so a FIT failure can never blank any label; mustLabel
//     additionally refuses to let a COLLISION blank it — it walks the outside placement further
//     out until it clears, and commits the last try rather than saying nothing.
// Higher `importance` wins ties for space. Returns Map(id -> placement):
//   { lines, x, y, leader, rung, box } — x/y is the label's CENTRE; `leader` is null for a normal
// label drawn inside its shape, or { x, y } (the shape centroid to draw a thin connector back to)
// when the label had to be pulled OUTSIDE. `rung` names which rung of the shared ladder was
// chosen. An id absent from the map lost a COLLISION this frame (its element still draws;
// zooming in reveals it again) — never a fit failure.
export const layoutLabelsSolve = (items, opts = {}) => {
  const pad = opts.pad == null ? 2 : opts.pad;
  const gap = opts.gap == null ? 4 : opts.gap; // px between an outside label and its shape
  const placed = []; // boxes already committed this frame
  // B951 — fixed OBSTACLES that the reflow pool must avoid but that are not themselves
  // reflowable labels: the parcel-area badges ("5.24 ac" pills). They paint at a fixed spot
  // (the parcel centroid, or the user-dragged offset) and were previously a SEPARATE layer the
  // collision engine never saw, so a building's name/sf/dims stack could overprint one into an
  // unreadable jumble ("166,240 sf ac"). Seeding them as pre-committed boxes makes an element
  // label yield — shrink a line, leader out, or hide — around the badge instead of piling onto
  // it. Order-independent (they're all present before the first label is placed) and immovable.
  for (const ob of (opts.obstacles || [])) { if (ob) placed.push(ob); }
  const out = new Map();
  // Most important first; stable id tiebreak so the result is deterministic (testable).
  const ordered = [...(items || [])].sort(
    (a, b) => (b.importance - a.importance) || (String(a.id) < String(b.id) ? -1 : 1),
  );
  for (const it of ordered) {
    const halfH = it.halfH != null ? it.halfH : (it.maxH != null ? it.maxH / 2 : Infinity);
    const halfW = it.halfW != null ? it.halfW : Infinity;
    // NEW-2 / NEW-5: a label may be rotated to run along a thin strip's long axis. Its
    // on-screen footprint is the rotated bounding box, so a vertical label is tested for
    // fit against the strip's (tall) height and its (narrow) width — the orientation we want.
    const rot = it.rot || 0;
    const rad = (rot * Math.PI) / 180, ca = Math.abs(Math.cos(rad)), sa = Math.abs(Math.sin(rad));
    const screenSize = (lines) => {
      const w0 = widthOf(lines, it), h0 = lines.length * it.lh;
      return { w: ca * w0 + sa * h0, h: sa * w0 + ca * h0 };
    };
    const free = (box) => !placed.some((p) => boxesOverlap(p, box, pad));

    // NEW-1 — measure fit against the ring's real INTERIOR when the caller gave us one. The
    // fitter works in feet; (cx, cy) is where `ringOrigin` lands on screen, and the frame is a
    // pure scale+translate (worldToScreen), so a feet point maps back with one multiply.
    const fitter = it.ring ? interiorFitter(it.ring) : null;
    const ppf = it.ringPpf, org = it.ringOrigin;
    const usableInterior = fitter && ppf > 0 && org;
    const interiorSpots = (w, h, want) => {
      if (!usableInterior) {
        // No ring (a rect element): the bounding box IS the interior, and the only spot is centre.
        return w <= halfW * 2 && h <= halfH * 2 ? [{ x: it.cx, y: it.cy }] : [];
      }
      return fitter.spots(w / ppf, h / ppf, want)
        .map((s) => ({ x: it.cx + (s.x - org.x) * ppf, y: it.cy + (s.y - org.y) * ppf }));
    };

    // ---- the ladder: inline → stacked → abbrev, each tried INSIDE the shape ------------------
    // Candidate order matters and is the owner-specified ladder: REFLOW the label before you
    // DROP information from it. So we sweep the ladder at full detail first, and only then start
    // shedding the lowest-priority line — one drop level at a time, re-walking the rungs at each.
    const forms = labelForms(it.lines);
    if (!forms.length) continue;
    // Trailer parking is the one strip label whose identity is stable in the label itself. Keep
    // this fallback at the shared-engine boundary because older/export callers may not yet carry
    // the explicit flag through their candidate projection.
    const hideOverflow = it.hideOverflow || forms.some((f) => f.lines.some((line) => /Trailer Parking/.test(line)));
    const capped = forms.map((f) => ({ rung: f.rung, lines: fitLines(f.lines, it.lh, halfH * 2) })); // LOD height cap
    const candidates = [];
    const seenForm = new Set();
    const deepest = Math.max(...capped.map((f) => f.lines.length));
    for (let drop = 0; drop < deepest; drop++) {
      for (const f of capped) {
        const lines = f.lines.slice(0, Math.max(1, f.lines.length - drop));
        const key = `${lines.length}|${lines.join(" ")}`;
        if (seenForm.has(key)) continue;
        seenForm.add(key);
        candidates.push({ rung: f.rung, lines });
      }
    }

    // The two axes are kept STRICTLY apart, because conflating them is what blanked a pond:
    //   FIT      — is there room inside the shape? A failure here may only relocate or shorten.
    //   COLLISION — is that room already taken? A failure here MAY still declutter (hide), which
    //               is a deliberate cartographic decision and the engine's original job.
    // `fittedSomewhere` records that the interior had room at some rung even if every position
    // was contested — i.e. this label lost a COLLISION, not a fit.
    let chosen = null, overflow = null, fittedSomewhere = false;
    for (const cand of candidates) {
      const { w, h } = screenSize(cand.lines);
      if (it.noLeader) {
        // Strip labels never leader out. Some legacy callers allow controlled overflow in place;
        // `hideOverflow` callers (trailer parking) instead disappear at this zoom when even their
        // shortest readable form no longer fits inside the strip.
        const box = boxOf(it.cx, it.cy, w, h);
        if (free(box)) {
          if (w <= halfW * 2 && h <= halfH * 2) { chosen = { box, lines: cand.lines, x: it.cx, y: it.cy, leader: null, rung: cand.rung }; break; }
          if (!hideOverflow && !overflow) overflow = { box, lines: cand.lines, x: it.cx, y: it.cy, leader: null, rung: cand.rung };
        }
        continue;
      }
      const spots = interiorSpots(w, h, 5);
      if (spots.length) fittedSomewhere = true;  // there WAS room; anything below is a collision
      for (const s of spots) {
        const box = boxOf(s.x, s.y, w, h);
        if (free(box)) { chosen = { box, lines: cand.lines, x: s.x, y: s.y, leader: null, rung: cand.rung }; break; }
      }
      if (chosen) break;
    }

    // ---- the terminal rung: OUTSIDE the shape, with a leader --------------------------------
    // Reached when nothing FIT inside (`!fittedSomewhere`) — this is the rung that makes a fit
    // failure non-terminal, so "too wide" can never blank a label. A label that DID fit and merely
    // lost the spot to a neighbour is not sent out here: that is declutter, and hiding it stays
    // correct (B121/B951) — unless it is `mustLabel`, which may never go silent at all.
    // It uses the FULLEST (inline) form — out on the paper there is no width to conserve — and
    // walks outward, and for a `mustLabel` element around the shape, until it clears.
    if (!chosen && !it.noLeader && (!fittedSomewhere || it.mustLabel)) {
      const lines = fitLines(forms[0].lines, it.lh, Infinity);
      const { w, h } = screenSize(lines);
      const anchor = { x: it.cx, y: it.cy };
      const dirs = it.mustLabel ? [[0, -1], [0, 1], [1, 0], [-1, 0]] : [[0, -1]];
      const steps = it.mustLabel ? [1, 1.5, 2.2, 3.2, 4.5] : [1];
      let last = null;
      outer: for (const k of steps) {
        for (const [dx, dy] of dirs) {
          const reachW = (Number.isFinite(halfW) ? halfW : 0) + w / 2 + gap;
          const reachH = (Number.isFinite(halfH) ? halfH : 0) + h / 2 + gap;
          const spot = { x: it.cx + dx * reachW * k, y: it.cy + dy * reachH * k };
          const box = boxOf(spot.x, spot.y, w, h);
          last = { box, lines, x: spot.x, y: spot.y, leader: anchor, rung: "outside" };
          if (free(box)) { chosen = last; break outer; }
        }
      }
      // mustLabel: an element that may never go silent commits the last attempt even contested.
      // Present-and-slightly-crowded beats a pond the map refuses to name.
      if (!chosen && it.mustLabel) chosen = last;
    }

    if (!chosen) chosen = overflow;             // undefined for hideOverflow; otherwise controlled overflow in place
    // `box` (the committed screen rect) is returned too so the dimension-callout layer (B121 r3) can
    // test itself against the placed labels and hide any red dimension that would overprint one.
    if (chosen) { placed.push(chosen.box); out.set(it.id, { lines: chosen.lines, x: chosen.x, y: chosen.y, leader: chosen.leader, rot, box: chosen.box, rung: chosen.rung }); }
  }
  return out;
};

/* =============================================================================================
 * B217539 — THE COLLISION PASS RESOLVES ONCE PER DISTINCT QUESTION, NOT ONCE PER FRAME.
 *
 * THE DEFECT. `layoutLabelsSolve` above is a greedy O(labels × candidates × spots) sweep over
 * EVERY label on the plan, and it is called straight from the planner's render body — twice, once
 * for the measurement chips and once for the element labels. Measured by the VIEW-INDEPENDENT-ONCE
 * detector on the Goose Creek reference plan: **372 calls, 88.6 ms, for three distinct answers**
 * during a single pure pan. Its dependants inherited it — `labelFitLadder.labelForms` 5,208× and
 * `inlineLines` 2,604×.
 *
 * WHY A PAN CANNOT CHANGE THE ANSWER. Every input here is a SCREEN box baked at the pan ANCHOR
 * (B1440): during a gesture the emitted geometry is pinned at an anchor view and one group
 * transform carries it, so `cx`/`cy` (from `f2p`), the type metrics, the obstacles and the ring
 * questions (asked in FEET — B221761) are bit-for-bit identical frame to frame. The pass was
 * re-deriving the same placements sixty times a second and returning them in a fresh Map, which
 * then missed every memo downstream.
 *
 * WHY THE MEMO LIVES HERE AND NOT AT THE TWO CALL SITES. Two reasons, and the second is the one
 * that matters. (1) A `useMemo` in the component cannot work: its inputs (`labelCands`,
 * `parcelChipBoxes`, the obstacle arrays) are FRESH ARRAYS every render holding identical values,
 * so `Object.is` reports "changed" on 100% of renders — the exact trap B221763 documented. A VALUE
 * signature is the only key that can hit. (2) A third caller — an export pass, a future overlay —
 * would reintroduce the defect with nothing to notice. Keyed to the FUNCTION, every call site is
 * covered, including ones not written yet.
 *
 * ⛔ BYTE-IDENTICAL BY CONSTRUCTION, NOT BY APPROXIMATION. Same pure function, same arguments,
 * same output, moved from once-per-frame to once-per-distinct-question. No threshold, no
 * tolerance, no level-of-detail decision — so PERCEPTUAL-PARITY has nothing to measure and no
 * pixel argument is made: byte-identical is the stronger claim and it is the true one. A hit
 * returns the SAME Map instance, which is half the point — a fresh object holding equal values
 * still invalidates every memo downstream.
 *
 * ⚠ THE RETURNED MAP IS SHARED. Read-only, like every memo in this tree. Both call sites only
 * `.get()` / `.values()` it; a future caller that mutates it would corrupt a later frame.
 *
 * THE CARE THE ITEM CALLED FOR — `ring`. It is a model array reference, so it is keyed by
 * IDENTITY (a WeakMap token), never by contents: hashing thousands of vertices per frame would
 * cost more than the scan it saves. The precondition is the one `pureCache`'s `identityCache`
 * states — the planner replaces `points` wholesale on edit and never mutates in place — so an
 * edited pond arrives as a NEW array, takes a new token, and CANNOT be served its old placement.
 * The token also cannot go stale if the ring changes without the screen anchor moving, which is
 * the precise failure the item named.
 * ============================================================================================= */

/* Ring identity → a short stable token. A WeakMap holds nothing alive: when the ring array is
 * collected, so is its token. */
const ringTokens = new WeakMap();
let ringSeq = 0;
const ringToken = (ring) => {
  if (!ring || typeof ring !== "object") return "-";
  let t = ringTokens.get(ring);
  if (t == null) { t = ++ringSeq; ringTokens.set(ring, t); }
  return t;
};

/* A line is either a plain string/number or a reflow spec {parts, sep, keep, stack} — the ladder
 * reads all four, so all four are keyed. Never key the JOINED string: two specs that inline to the
 * same text can still have different rungs available, which changes the placement. */
const lineSig = (l) => {
  if (l == null) return "~";
  if (typeof l === "string" || typeof l === "number") return `s${l}`;
  return `r${(l.parts || []).join("")}${l.sep}${l.keep}${l.stack}`;
};

/* Numbers go in via String(), which round-trips a double exactly — no rounding, because a
 * half-pixel is a real difference to a collision test and this key must never merge two frames
 * that would place differently. */
const itemSig = (it) => [
  it.id, it.cx, it.cy, it.lh, it.charW, it.halfW, it.halfH, it.maxH,
  /* B548818 — measured widths are an INPUT to placement, so they belong in the memo key: two
     frames with identical text but different measured widths must not be merged. */
  it.textW ? Object.entries(it.textW).map(([k, v]) => `${k}=${v}`).join("|") : "-",
  it.rot || 0, it.noLeader ? 1 : 0, it.hideOverflow ? 1 : 0, it.mustLabel ? 1 : 0, it.importance,
  ringToken(it.ring), it.ringPpf, it.ringOrigin ? `${it.ringOrigin.x},${it.ringOrigin.y}` : "-",
  (it.lines || []).map(lineSig).join(""),
].join("");

const layoutSignature = (items, opts) => {
  const head = `${opts.pad == null ? 2 : opts.pad}${opts.gap == null ? 4 : opts.gap}`;
  const obs = (opts.obstacles || []).map((o) => (o ? `${o.x},${o.y},${o.w},${o.h}` : "-")).join("");
  return `${head}${obs}${(items || []).map(itemSig).join("")}`;
};

/* Two live signatures in the steady state (measure chips + element labels). The cap is generous
 * because a ZOOM legitimately mints a new signature per ppf step, and `boundedCache` CLEARS at the
 * cap rather than evicting — the price of a clear is one recomputation, never a wrong answer. */
const layoutCache = boundedCache(24);

/* Counters for the guard. `calls` tracks how often the pass was ASKED (once per render, by design);
 * `solves` tracks how often it actually RAN, and that is the number this item is about. Two integer
 * increments — the cost is not measurable, and a guard with no counter is a guard that rots. */
export const __labelLayoutProbe = {
  calls: 0, solves: 0,
  /* Clears the CACHE as well as the counters. A guard that reset only the counters would measure
   * the previous case's cache: "a changed pad re-solves" reads 0 solves if some earlier scene
   * already cached the unchanged one, so the assertion would pass or fail for the wrong reason.
   * Clearing a cache is always safe — the worst case is one recomputation, never a wrong answer. */
  reset() { this.calls = 0; this.solves = 0; layoutCache.clear(); },
};

export const layoutLabels = (items, opts = {}) => {
  __labelLayoutProbe.calls++;
  const key = layoutSignature(items, opts);
  const hit = layoutCache.get(key);
  if (hit) return hit;
  __labelLayoutProbe.solves++;
  return layoutCache.set(key, layoutLabelsSolve(items, opts));
};

// B121 (round 3) — fold the red per-edge dimension callouts into the label collision pool. The
// dimension NUMBER is the lowest label tier: it must never overprint a committed centred name/area
// label. Given each dimension's screen box (dimNumberBox, lib/dimSlide) and the boxes of the labels
// already placed by layoutLabels this frame, return the SET of element ids whose dimension should be
// HIDDEN (it overlaps a label). We only HIDE — never move the dimension off its footprint (B592 pins
// it there). Lowest-tier, so it yields to ANY committed label box. Pure + tested.
export const suppressedDimIds = (dimItems, labelBoxes, pad = 2) => {
  const out = new Set();
  for (const d of (dimItems || [])) {
    if (!d || !d.box) continue;
    if ((labelBoxes || []).some((lb) => lb && boxesOverlap(d.box, lb, pad))) out.add(d.id);
  }
  return out;
};

// B123 — the building label as a priority-ordered stack (highest priority first, matching
// fitLines/layoutLabels which drop from the END): name → square footage → "(incl. N
// bump-outs)" → dimensions. So on zoom-out the dimensions drop first, then the bump-out
// note, leaving the square footage and finally just the name — i.e. the square footage
// survives far longer than it did when the whole label just shrank. The parenthetical
// line appears only when the building actually has bump-outs.
export const buildingLabelLines = ({ name, sqft, bumpCount = 0, dims }) => {
  const out = [name];
  if (sqft) out.push(sqft); // B121: omitted when the "Show areas" toggle is off (sqft passed null)
  if (bumpCount > 0) out.push(`(incl. ${bumpCount} bump-out${bumpCount > 1 ? "s" : ""})`);
  if (dims) out.push(dims);
  return out;
};

// B121 (round 2) — the red per-edge dimension callouts ("300′" ticks, drawn per element in
// renderElPx) are a separate layer from the centred name labels. Zoomed out they shrink to
// illegible ticks that pile onto the names, so gate them by zoom: show at working zoom,
// hide once the view is zoomed out past DIM_CALLOUT_MIN_PPF (they return as you zoom in).
// Mirrors how the label engine thins labels on zoom-out, keeping the dimension layer out of
// the name pile. Pure + tested; the threshold is a screening default, tune in-browser.
export const DIM_CALLOUT_MIN_PPF = 0.18; // px per foot (default working zoom is ~0.35)
export const dimCalloutVisible = (ppf) => ppf >= DIM_CALLOUT_MIN_PPF;

// B149 — level-of-detail TIER gate for fine-infrastructure width callouts: a sidewalk /
// landscape / buffer WIDTH label ("5′ Sidewalk"), and a drive-aisle or road WIDTH dimension.
// At site-overview zoom the feature these measure is only a pixel or two across, so the number
// is illegible clutter that piles onto the real labels. This is the "detail" tier — it sits
// BELOW the "site" tier (building-footprint dims, which stay on dimCalloutVisible) and the
// "overview" tier (building name/SF + the site-summary chip, never zoom-gated).
//
// Self-tuning, resolution-independent rule (B149): the measured feature must project to at
// least ~DETAIL_LABEL_MIN_PX on screen before its width label draws — so a 5′ strip stays
// unlabelled until you zoom in enough to actually see it as a band, and a wider buffer / aisle
// reveals sooner, with no hand-tuned per-zoom breakpoints. We REUSE dimCalloutVisible as the
// shared zoom FLOOR (so a very wide feature still can't show below the global declutter point)
// rather than standing up a parallel gate — one source of truth with the dimension layer.
//
// Threshold calibrated in-browser (B149 says tune it live): the planner hard-caps zoom at
// ppf 8 (zoomAround/pinchZoom clamp). At 40px the narrowest real strip — a 5′ sidewalk —
// would only reveal at 40/5 = 8.0 ppf, i.e. the EXACT max zoom (no headroom, and it flickers
// at the float boundary). 30px puts the 5′ reveal at ppf 6, so it appears with room to spare
// when you zoom in to inspect, while a 5′ strip at site-overview (~0.2–0.5 ppf ⇒ 1–3px) and
// at working zoom (0.35 ⇒ 1.75px) stays well hidden. Wider strips reveal proportionally sooner.
export const DETAIL_LABEL_MIN_PX = 30; // min on-screen length (px) of the measured feature
export const detailLabelVisible = (featureFt, ppf) =>
  dimCalloutVisible(ppf) && featureFt * ppf >= DETAIL_LABEL_MIN_PX;

// B911 — shared zoom-scaled font size (px) for on-canvas dimension NUMBERS: the building / paving /
// road footprint dims AND the selected parcel's per-edge length labels. ONE formula so both layers
// shrink together on zoom-out. Before B911 the parcel-edge length labels were a FIXED 11px with no
// zoom gate, so zooming the site fully out shrank the parcels to nothing while the red length boxes
// stayed large and dominated the view (owner report: "I can see nothing on my site but I can still
// see the dimensions"). Now the parcel-edge labels ride detailLabelVisible (keyed off each edge's
// on-screen length) AND this font scale, exactly like the building-dim layer.
//
// Base 11px at working zoom (ppf ~0.45+); scales linearly DOWN with zoom toward DIM_FONT_MIN_SCALE.
// The floor is deliberately LOW — the old inline 0.34 parked the number relatively-huge as the map
// kept shrinking — so the number keeps scaling right up to the point where its declutter gate
// (dimCalloutVisible / detailLabelVisible) hides it, never a fixed-size number over a pinhead shape.
// (For the building-dim layer, which is hidden below ppf 0.18, the practical range is ~0.4→1.0, so
// this reproduces the prior building behaviour exactly; the lower floor only ever matters for a
// still-visible long parcel edge near its own drop point.)
export const DIM_FONT_BASE_PX = 11;
export const DIM_FONT_MIN_SCALE = 0.26;
export const dimFontScale = (ppf) => Math.max(DIM_FONT_MIN_SCALE, Math.min(1, ppf / 0.45));
export const dimFontPx = (ppf) => DIM_FONT_BASE_PX * dimFontScale(ppf);

/* ⛔ NEW-6 — A FEATURE'S NAME LABEL MAY NEVER RENDER WIDER THAN THE FEATURE IT NAMES.
 *
 * Owner report with a screenshot, 8 South / Concept A at whole-site zoom: the easement label
 * `CONVEYANCE CHANNEL 2 DIVERSION` drawn across the plan in large type while every other label on
 * the drawing was microscopic. Measured live on that frame (`data-view-ppf` === `data-render-ppf`,
 * so not a stale-frame artifact): at ppf 0.04159 the easement's own geometry rendered **21 × 3 CSS
 * px** and its label rendered **font-size 10.5 px, 199 px wide** — 9.5× wider than the 513 ft
 * feature it names — while its neighbours computed to 1.54 / 2.38 / 2.72 / 3.74 / 4.08 px. The
 * label also inflated the feature's own `getBoundingClientRect` from 21×3 to 199×13.
 *
 * ⛔ THIS IS NOT A FOURTH ZOOM THRESHOLD, and it deliberately introduces no new constant of its
 * own. The owner's instruction was to reuse the gate work rather than invent another number, and
 * the honest finding is that **the abstraction already existed and had been built three times** —
 * B149's `detailLabelVisible`, B911's `dimFontPx`, and the pond-parameter tier — each pairing the
 * same two defences: a VISIBILITY gate keyed on how big the measured thing is on screen, and a
 * SIZE that rides `dimFontScale`. The easement centroid label was simply not using either: it was
 * a bare `fontSize={10.5 * labelK}` with `(isSel || dimCalloutVisible(ppf))` in front of it, and
 * `isSel` bypassed even that. So the floor here IS `dimCalloutVisible` and the ramp IS
 * `dimFontScale`; nothing below is tunable.
 *
 * WHAT IS GENUINELY NEW is the third question, which none of the three existing tiers asks: **is
 * the LABEL narrower than its feature?** The other tiers gate on the feature alone, which is enough
 * when the text is a short generated number ("300′", "berm 8.2 ft"). It is not enough here, because
 * an easement's label is arbitrary user text (`labelOverride`) of any length: this 513 ft easement
 * clears `detailLabelVisible` at ppf 0.0585, where 30 characters still measure ~64 px against 30 px
 * of feature. A long name must therefore wait longer than a short one, on the same feature.
 *
 * ⛔ AND THE SELECTION BYPASS IS PART OF THE DEFECT, not a nicety to preserve. The reported label
 * only draws when the easement is selected, and the old `isSel ||` short-circuit is exactly why a
 * 199 px label sat over a 21 px object. Selecting something you cannot see does not make its name
 * legible — it makes the name the only thing on screen. Selection no longer lifts this gate.
 *
 * ── The character-width ratio is MEASURED, not guessed ──────────────────────────────────────────
 * A per-frame `getComputedTextLength()` is a layout read per label per frame and is not affordable
 * in the render body, so the width is estimated — and the estimate is calibrated against the real
 * thing rather than assumed. Measured in Chromium against this app's own built stylesheet (Inter,
 * `font-weight: 700`, via `getBBox().width`), at font sizes 4 / 6 / 8 / 10.5 / 14 px:
 *
 *     CONVEYANCE CHANNEL 2 DIVERSION   0.6250 … 0.6444   (the owner's own label; 201 px at 10.5,
 *                                                          against the 199 px he measured live)
 *     LATERAL 10 (PHASE 2 MDP)         0.5764 … 0.6146
 *     60′ Storm Sewer Esmt             0.5313 … 0.5583
 *     Drainage Easement                0.5294 … 0.5686
 *     50′ Utility Esmt                 0.4531 … 0.4896
 *
 * `LABEL_CHAR_W_RATIO` is 0.68 — ABOVE the widest realistic label measured (0.644), so the estimate
 * over-predicts and the gate errs toward hiding a label slightly longer than strictly necessary,
 * which is the safe direction for a rule whose whole purpose is "never wider than its feature".
 * ⚠ It is NOT an upper bound for every possible string: a pathological all-caps run of the widest
 * glyph measures 1.0125 … 1.0714 (asserted in the unit suite, so the bound is recorded rather than
 * assumed). Such a label reveals slightly early; it can never be the 9.5× case above.
 *
 * ── What "the feature's length" means ───────────────────────────────────────────────────────────
 * The label is drawn HORIZONTALLY at the feature's centroid, so the intuitive reading would be the
 * feature's horizontal extent — but that would make a VERTICAL easement of the same length wait far
 * longer for its name than a horizontal one, which is a size rule masquerading as an orientation
 * rule. `featureFt` is therefore the feature's GREATEST extent (the owner's own words: "the
 * rendered length of the feature it labels"), so two easements of one length gate identically
 * whichever way they run.
 */
export const LABEL_CHAR_W_RATIO = 0.68;
export const labelTextWidthPx = (text, fontPx) =>
  (typeof text === "string" ? text.length : 0) * (Number.isFinite(fontPx) ? fontPx : 0) * LABEL_CHAR_W_RATIO;

/* The greatest extent, in feet, of a point set — the quantity the fit rule calls "the feature's
 * length". Returns 0 for anything unusable, which reads as "cannot fit" and hides the label. */
export const featureExtentFt = (pts) => {
  if (!Array.isArray(pts) || !pts.length) return 0;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  if (!Number.isFinite(x0) || !Number.isFinite(y0)) return 0;
  return Math.max(x1 - x0, y1 - y0);
};

/* The font a feature NAME label renders at — the shared dimension-number ramp, so a name and the
 * dimension beside it shrink together. `basePx` is the label's own size at working zoom. */
export const featureNameFontPx = (ppf, basePx) =>
  (Number.isFinite(basePx) ? basePx : DIM_FONT_BASE_PX) * dimFontScale(ppf);

/* Three conditions, all of which must hold, in cost order:
 *   (1) the shared declutter FLOOR  — nothing below it, same as every dimension on the drawing;
 *   (2) the feature is a BAND rather than a tick — B149's rule, reused, not re-derived;
 *   (3) the label FITS its feature — the new question, and the one the owner's guard test asserts.
 * `sheet: true` lifts only (1), the pure screen-declutter gate; (2) and (3) are re-evaluated at the
 * sheet's own scale by exportLabelScale, so a wide-zoom PDF still cannot print a name across a plan.
 * (The rule is in the workspace pointer: does the gate ask "is the user zoomed in enough" — lift it
 * on the sheet — or "is there physical room" — keep it?) */
export const featureNameLabelVisible = (text, featureFt, ppf, basePx, { sheet = false } = {}) => {
  if (!sheet && !dimCalloutVisible(ppf)) return false;
  if (!Number.isFinite(featureFt) || !Number.isFinite(ppf) || ppf <= 0) return false;
  const featurePx = featureFt * ppf;
  if (featurePx < DETAIL_LABEL_MIN_PX) return false;
  return labelTextWidthPx(text, featureNameFontPx(ppf, basePx)) <= featurePx;
};

// NEW-1 — POND DESIGN-PARAMETER tier: the engineering numbers that annotate a pond's grading
// section in plan view — the berm-height tag ("berm 8.2 ft"), the water-surface / floor
// elevation callouts ("Floor 145.1"), and the stage-storage line ("Holds … · 16.2′ rim to
// floor"). These are INSPECT-zoom information: you read them while looking at one pond, never
// while scanning the whole site. They are NOT the pond's identity (its name + footprint acreage
// stay on the normal overview label stack, exactly like a building's name + sf).
//
// Owner report (2026-07-26): at site-overview zoom the berm tag and the floor elevation painted
// at a FIXED size with a heavy halo, so they out-shouted the building dimension numbers on a
// view where the pond's grading detail isn't legible anyway — "that stuff is bigger than the
// building numbers … does not need to be that big or even visible at that zoom."
//
// Two defences, both self-tuning (no per-zoom breakpoints), mirroring B149 + B911:
//   (1) VISIBILITY — the vertical thing the number measures has to project to a readable BAND
//       on screen first. `featureFt` is that band's plan-view width in feet: the berm's
//       exterior face run (extSlope × berm height) for the berm tag, and the interior side-slope
//       run (slope × depth below top of bank) for an elevation / storage callout. A taller berm
//       or a deeper basin therefore reveals sooner — the number appears exactly when the grading
//       it describes is actually visible. The floor is deliberately ABOVE the detail tier's
//       (DETAIL_LABEL_MIN_PX): a pond parameter is a rung quieter than a sidewalk width.
//   (2) SIZE — the font rides the shared dimension-number zoom scale, so a big feature that does
//       reveal early can never paint a full-size number over a small-on-screen pond.
export const POND_PARAM_LABEL_MIN_PX = 40; // min on-screen width (px) of the band being measured
export const pondParamLabelVisible = (featureFt, ppf) =>
  dimCalloutVisible(ppf) && Number.isFinite(featureFt) && featureFt * ppf >= POND_PARAM_LABEL_MIN_PX;
export const pondParamFontPx = (ppf, basePx) => basePx * dimFontScale(ppf);

/* ══ GEOMETRY level-of-detail (NEW-2) ═════════════════════════════════════════════════════════
 *
 * Every tier above gates a LABEL. Nothing has ever gated GEOMETRY, and geometry is where the
 * node count actually is. Counted in the live DOM on the owner's real Goose Creek plan, at the
 * whole-site zoom he works from (ppf 0.02, so a 9′ stall is 0.18 px wide):
 *
 *     parking   10 elements → 1,135 nodes, of which 1,088 are <line> stall dividers
 *     trailer    8 elements →   527 nodes, of which   486 are <line>
 *     building  20 elements →   460 <rect>, ~432 of them dock-door leaves
 *     ───────────────────────────────────────────────────────────────────────
 *     ~2,100 nodes from 38 elements, out of a 2,481-node canvas — roughly 85%.
 *
 * Every one of those 1,088 dividers is drawn, laid out and reconciled on every frame, at a
 * spacing five times finer than one screen pixel. (The column-grid gate FEAT_BTN_MIN_PX DOES
 * fire here — the grid lines only appear from ppf 0.2 — so the grid is not part of this.)
 *
 * ⚠ THIS IS NOT DECIMATION, AND IT MUST NOT BECOME DECIMATION. Nothing is dropped, thinned,
 * merged or approximated. The run of N separate <line>/<rect> elements is re-expressed as ONE
 * <path> carrying the SAME N subpaths — identical coordinates, identical stroke, rasterised by
 * the same rasteriser in the same pass. The gates below decide only WHEN to switch
 * representation; they never decide whether something is drawn.
 *
 * ⚠ AND IT IS DELIBERATELY NOT AN SVG <pattern>, WHICH IS WHAT WAS TRIED FIRST AND MEASURED AS
 * WRONG. Tiling one divider at the run's pitch looks equivalent on paper and is not: Chromium
 * rasterises a pattern tile once and repeats it, so a non-integer pitch accumulates sub-pixel
 * phase error across the band. Measured against the explicit render on this plan, the pattern
 * build differed on 0.02%–1.51% of canvas pixels with a worst channel delta of 30/255, growing
 * with zoom — small, but a real visible shift in the stripes, i.e. exactly the downgrade the
 * owner's constraint forbids. The single-path form is byte-identical instead of nearly so, and
 * "nearly" is not a thing this change is allowed to be. (ui-audit/verify-stall-lod-parity.mjs
 * is the instrument; it fails on any non-identical rung.)
 *
 * WHY GATE AT ALL, IF THE TWO ARE IDENTICAL. Blast radius. At detail zoom the node count is not
 * the problem and the explicit path is what every existing pixel test was written against, so
 * it stays element-for-element unchanged there. The collapse applies exactly where the marks
 * are too fine to resolve individually and the node count is doing the damage.
 *
 * MEASURED IN LABEL-FRAME PX, never raw canvas px — `px / lfK`, the FEAT_BTN_MIN_PX precedent.
 * On screen lfK is 1. On an export pass it converts to the SHEET's scale, so a plan exported
 * while zoomed out makes the same decision a working-zoom export of the same plan makes. Get
 * this wrong and a wide-zoom PDF silently loses its stalls — the exact bug the comment above
 * the export label-frame warns about.
 */

// Stall dividers collapse into one path below this on-sheet pitch. A 9′ stall clears it at
// ppf 0.67 — well inside detail zoom — so the per-element path still owns every zoom at which a
// driver could count the stalls, and the collapse owns the site-overview and working zooms where
// 1,088 dividers are being drawn 0.18–3.15 px apart.
export const STALL_PITCH_MIN_PX = 6;
export const stallStripesExplicit = (pitchPx, lfK = 1) => !(pitchPx / (lfK || 1) < STALL_PITCH_MIN_PX);

/* ⛔ THE DOCK-DOOR LEAVES: REJECTED THREE TIMES, AND THE THIRD IS THE ONLY ONE THAT MEANS ANYTHING.
 * Read this before attempting a fourth.
 *
 * WHAT THE FIRST TWO ESTABLISHED, and it still stands as fact: folding N leaf <rect>s into one
 * <path> shifts the picture by 12–23/255 on 0.02–0.41% of canvas pixels, at EVERY zoom rung,
 * INCLUDING ppf 3 where a leaf is 24 px wide and its neighbours are hundreds of px away. It is NOT
 * the semi-transparent fill — that was the recorded cause until 2026-07-31 and it is refuted (force
 * both arms fully OPAQUE and the difference does not move: 12/255 over 8,446 px transparent,
 * 12/255 over 8,453 px opaque). The instrument is ui-audit/diagnose-dock-leaf-fold.mjs.
 *
 * ⛔ THE THIRD ATTEMPT, 2026-08-06, IS THE INFORMATIVE ONE, BECAUSE THE BAR CHANGED. The owner
 * retired byte-identity (B1345) and replaced it with PERCEPTUAL-PARITY (/CLAUDE.md): imperceptible
 * to him at working zoom, measured as CIEDE2000 on an acuity-filtered pair. The fold was therefore
 * BUILT, ARMED and RE-MEASURED against the new bar — two builds differing only in the gate,
 * ui-audit/verify-perceptual-parity.mjs:
 *
 *   ppf 0.02  940 → 516 nodes   perceived ΔE00 2.188      (bar 1.0)
 *   ppf 0.10  976 → 552         perceived ΔE00 1.568
 *   ppf 0.35  1213 → 789        perceived ΔE00 1.749      <- working zoom
 *   ppf 1.20  1560 → 1332       perceived ΔE00 1.196
 *   ppf 3.00  980 → 980         byte-identical (gate off — the control)
 *
 * It recovers exactly the 424 nodes B1350 named, and it FAILS at every armed rung. WHY, and this is
 * the part worth carrying: N 95%-opacity <rect>s each fill-then-stroke, whereas one <path> fills
 * every subpath and THEN strokes them all. At these zooms a door run is a band of overlapping
 * sub-pixel marks, so that ordering is a genuine change of picture — ink landing somewhere else —
 * not the antialiasing seam the new bar was built to forgive. The bar told the two apart, which is
 * what it is for.
 *
 * ⛔ THE BAR WAS NOT MOVED TO MAKE THIS PASS. The single modelling parameter the verdict turns on is
 * PERCEPTUAL-PARITY's PERCEIVED_ARCMIN (6 — the half-period at the contrast-sensitivity peak;
 * 12, the full period, would roughly halve every number above and this would clear). It was set at
 * the strict end BEFORE this was measured and deliberately left alone AFTER, because choosing a
 * threshold to suit a result you have already seen is not a measurement. That is an owner decision
 * with a price of 424 nodes on it; it is on B1350 and on OWNER-TODO.
 * Do not try a fourth time without either that decision, or a Chromium that does
 * rasterise a rect and a rectangular path alike (<rect> → <path> is the primitive change, not the opacity). */

/** One `d` string for N disjoint segments — the same lines, as subpaths of a single path. */
export const segmentsPath = (segs) =>
  segs.map(([x1, y1, x2, y2]) => `M${x1} ${y1}L${x2} ${y2}`).join("");
