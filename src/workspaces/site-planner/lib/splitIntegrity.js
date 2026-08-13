/* ⛔ NEW-9 (B472049) — WHAT A SPLIT MUST CONSERVE, AND THE COLUMN THAT MAKES THE ASSERTION HONEST.
 *
 * THE REPORT: *"I have a parent parcel and I used the split parcel to split it in two. However it
 * seems like the tool now just leaves the parent parcel and creates a new parcel almost with the
 * split tool."* Bain / Concept A - Quiddity DIA, site `smsqi16s9ej4`, 2026-08-13.
 *
 * ⛔ TWO CLAIMS IN THE ORIGINAL DIAGNOSIS ARE REFUTED BY THE ROWS, and they are recorded here so
 * nobody re-derives them:
 *   (1) "it wrote the REMAINDER to a NEW parcel instead of back onto the parent" — that IS the
 *       design (a split SUPERSEDES the parent and emits every piece as a child), and the
 *       through-cut that works did exactly the same thing. `e1455073` is not the parent re-cut; it
 *       is a new 41-point parcel, and the original `e1454855` is still present at 35 points.
 *   (2) "209.597 acres of parcel sitting on 105.122 acres of land" — no. The superseded parent
 *       carries `active:false` and counts nowhere.
 *
 * ⛔ AND THE CLAIM THAT SURVIVES, WHICH THE FIRST READING OF `active` ALONE MISSED. Both small
 * pieces are `active:true` AND `deleted_at` non-null:
 *
 *     e1455071mkspvo  active=false  deleted_at=null                          105.122 ac  (parent)
 *     e1455075mkspvo  active=true   deleted_at=null                          104.475 ac  (remainder)
 *     e1455076mkspvo  active=TRUE   deleted_at=2026-08-13 18:59:49.847+00      0.647 ac  (the notch)
 *
 * So the set that is ACTIVE **AND NOT DELETED** is the remainder alone: **104.475 against a
 * 105.122 parent — 0.647 ac short.** Same shape at 18:58:34, where a 3.883 ac piece was created and
 * deleted. **A conservation assertion that reads `active` and ignores `deleted_at` PASSES while a
 * piece silently vanishes** — which is precisely the failure that was reported. That is why every
 * function here takes the live set, and why `liveActive` is not a convenience helper but the
 * definition the invariant is stated over.
 *
 * ⛔ WHO DELETED THE PIECE IS NOT KNOWN AND IS NOT ASSUMED. The gap between the split write
 * (18:59:46.182687) and the deletion (18:59:49.847236) is 3.66 s — long enough to be either the
 * tool dropping its own output or the user removing a sliver they did not want. The rows cannot
 * distinguish those, and neither can any reading of them: one account, no operation id, no session
 * id. That un-answerability is exactly what the operation envelope (`operationEnvelope.js`) exists
 * to remove, and until it ships the honest statement is that this is unattributable.
 *
 * WHAT IS ASSERTED HERE IS THEREFORE A PROPERTY OF THE OUTCOME, NOT AN ACCUSATION: whoever caused
 * it, a split whose piece does not survive its own operation window has not delivered what a split
 * promises, and that is checkable without knowing the cause.
 *
 * ⛔ MODEL-INDEPENDENT ON PURPOSE. Whether a completed split should leave the superseded parent
 * DRAWN on the plan is an owner decision that is still open, so nothing here depends on it: the
 * invariant is stated over the live-active set, which is identical under either answer. Only the
 * APPEARANCE decision is held.
 *
 * Pure — no DOM, no storage, no clock. Unit-tested in `test/splitIntegrity.test.js`.
 */
import ClipperLib from "clipper-lib";

/* Shoelace area (absolute) of a ring in the planner's feet frame. */
export function ringAreaSqft(pts) {
  if (!Array.isArray(pts) || pts.length < 3) return 0;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    const p = pts[i], q = pts[j];
    if (!p || !q || !Number.isFinite(p.x) || !Number.isFinite(q.y)) return 0;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
}

export const SQFT_PER_ACRE = 43560;
export const ringAreaAcres = (pts) => ringAreaSqft(pts) / SQFT_PER_ACRE;

/* ⛔ THE DEFINITION THE WHOLE INVARIANT RESTS ON. A parcel counts toward the land the plan claims
 * only when it is BOTH active AND not soft-deleted. Reading either half alone is a silent pass:
 *   `active` alone   — the vanished 0.647 ac piece is active:true, so it counts and the sum balances.
 *   `!deleted` alone — the superseded parent is live, so it counts and the sum DOUBLES.
 * Both halves, always. */
export const isLiveActive = (p) => !!(p && p.active !== false && !p.deletedAt && !p.deleted_at);
export const liveActive = (parcels) => (parcels || []).filter(isLiveActive);

/* Tolerance. These are surveyed rings in feet; the split engine is exact to floating point, so the
 * only legitimate residual is float noise. 1 sqft on a 100-acre tract is ~2e-7 relative — generous
 * for the arithmetic and far tighter than any real loss (the reported one is 28,178 sqft). */
export const AREA_TOLERANCE_SQFT = 1;

/* ── The invariant ────────────────────────────────────────────────────────────────────────────
 *
 * After a split, the live-active set must cover exactly the land the parent covered. Returns a
 * verdict rather than throwing, so a runtime caller can report it and a test can assert it. */
export function splitConservation({ parentRing, resulting = [], toleranceSqft = AREA_TOLERANCE_SQFT }) {
  const before = ringAreaSqft(parentRing);
  const live = liveActive(resulting);
  const after = live.reduce((s, p) => s + ringAreaSqft(p.points || p.pts), 0);
  const residualSqft = after - before;
  return {
    ok: Math.abs(residualSqft) <= toleranceSqft,
    beforeSqft: before,
    afterSqft: after,
    residualSqft,
    residualAcres: residualSqft / SQFT_PER_ACRE,
    liveCount: live.length,
    /* Named so a failure says which way it went — a SHORTFALL is land that vanished (the reported
     * bug); an EXCESS is double-counted land (what the refuted reading claimed). */
    direction: Math.abs(residualSqft) <= toleranceSqft ? "balanced" : (residualSqft < 0 ? "shortfall" : "excess"),
    message: Math.abs(residualSqft) <= toleranceSqft
      ? null
      : residualSqft < 0
        ? `A split lost ${(Math.abs(residualSqft) / SQFT_PER_ACRE).toFixed(3)} ac: the parent covered ${(before / SQFT_PER_ACRE).toFixed(3)} ac and the parcels left on the plan cover ${(after / SQFT_PER_ACRE).toFixed(3)} ac.`
        : `A split double-counts ${(residualSqft / SQFT_PER_ACRE).toFixed(3)} ac: the parcels left on the plan cover ${(after / SQFT_PER_ACRE).toFixed(3)} ac over a ${(before / SQFT_PER_ACRE).toFixed(3)} ac parent.`,
  };
}

/* ── No two live parcels may overlap ──────────────────────────────────────────────────────────
 *
 * A cheap, exact-enough screen: sum of parts against the area of the union. Rather than pull a
 * boolean engine in for a guard, this uses the fact the invariant above already establishes — if
 * the live set conserves the parent's area AND every piece is inside the parent, any overlap shows
 * as an excess. The separate BBOX test below catches the gross case (two near-identical rings)
 * without any boolean geometry, which is the case that was reported.
 *
 * ⛔ It is deliberately a SCREEN, not a proof: a pair of pieces could in principle overlap by
 * exactly as much as another pair leaves uncovered. That cannot arise from a planar-arrangement
 * splitter (its faces partition by construction), and stating the limit is better than implying a
 * completeness the check does not have. */
export function overlappingPairs(parcels, { toleranceSqft = AREA_TOLERANCE_SQFT } = {}) {
  const live = liveActive(parcels);
  const boxes = live.map((p) => ({ p, b: bboxOf(p.points || p.pts), a: ringAreaSqft(p.points || p.pts) }));
  const out = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const ov = bboxOverlapSqft(boxes[i].b, boxes[j].b);
      if (ov <= toleranceSqft) continue;
      // A bbox overlap is not itself an overlap of the rings — report it with the fraction so a
      // caller can rank, and let the test assert on the gross case the report is about.
      const smaller = Math.min(boxes[i].a, boxes[j].a) || 1;
      out.push({ a: boxes[i].p.id, b: boxes[j].p.id, bboxOverlapSqft: ov, fractionOfSmaller: ov / smaller });
    }
  }
  return out;
}

function bboxOf(pts) {
  if (!Array.isArray(pts) || !pts.length) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of pts) {
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  return Number.isFinite(x0) ? { x0, x1, y0, y1 } : null;
}

function bboxOverlapSqft(a, b) {
  if (!a || !b) return 0;
  const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
  const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  return w > 0 && h > 0 ? w * h : 0;
}

/* ── Did the split's own outputs survive the operation? ───────────────────────────────────────
 *
 * ⛔ THE OWNER'S SECOND REQUIREMENT, AND IT IS DELIBERATELY BLIND TO CAUSE: *"If a split emits a
 * piece and that piece is soft-deleted inside the same op window, that is a bug regardless of who
 * pressed what."*
 *
 * `emittedIds` are the pieces the split created. `rows` are those parcels as the database now has
 * them. A piece that is soft-deleted within `windowMs` of the split is reported — whether the tool
 * dropped it or the user removed it is NOT decided here, and the report says so. Outside the
 * window it is an ordinary later edit and is not this check's business.
 *
 * The default window is 10 s: the reported gaps are 3.66 s and ~0 s, and a deliberate human
 * "that's not what I wanted" delete typically lands inside that too — which is why the verdict is
 * `unattributed` rather than `bug`, and why the message names both possibilities. */
export const SPLIT_SURVIVAL_WINDOW_MS = 10_000;

export function splitOutputsSurvived({ emittedIds = [], rows = [], splitAtMs = null, windowMs = SPLIT_SURVIVAL_WINDOW_MS }) {
  const byId = new Map((rows || []).filter(Boolean).map((r) => [r.id, r]));
  const casualties = [];
  for (const id of emittedIds || []) {
    const r = byId.get(id);
    if (!r) { casualties.push({ id, reason: "never-persisted", deletedAtMs: null, gapMs: null }); continue; }
    const del = r.deletedAt || r.deleted_at;
    if (!del) continue;
    const delMs = typeof del === "number" ? del : Date.parse(del);
    const gapMs = Number.isFinite(splitAtMs) && Number.isFinite(delMs) ? delMs - splitAtMs : null;
    if (gapMs == null || (gapMs >= 0 && gapMs <= windowMs)) {
      casualties.push({ id, reason: "deleted-in-window", deletedAtMs: Number.isFinite(delMs) ? delMs : null, gapMs });
    }
  }
  return {
    ok: casualties.length === 0,
    casualties,
    /* ⛔ NEVER "the tool deleted it". The rows cannot say, and asserting a cause here would be the
     * same confident-wrong-story failure the operation envelope exists to end. */
    message: casualties.length === 0 ? null
      : `A split emitted ${emittedIds.length} piece${emittedIds.length === 1 ? "" : "s"} and ${casualties.length} did not survive the operation` +
        `${casualties[0].gapMs != null ? ` (${(casualties[0].gapMs / 1000).toFixed(2)}s later)` : ""}. ` +
        `Whether the tool dropped it or someone removed it cannot be told from the rows — that is what the operation envelope records.`,
  };
}

/* The whole check, for a caller that has all three facts. */
export function auditSplit({ parentRing, resulting = [], emittedIds = [], rows = [], splitAtMs = null }) {
  const conservation = splitConservation({ parentRing, resulting });
  const outline = unionOutlineMatches({ parentRing, resulting });
  const overlaps = overlappingPairs(resulting);
  const survival = splitOutputsSurvived({ emittedIds, rows, splitAtMs });
  return {
    ok: conservation.ok && outline.ok && survival.ok,
    conservation,
    outline,
    overlaps,
    survival,
    messages: [conservation.message, outline.message, survival.message].filter(Boolean),
  };
}

/* ── THE OWNER'S OWN ARGUMENT, TURNED INTO THE ASSERTION ──────────────────────────────────────
 *
 * Asked whether a completed split should still draw the superseded parent, he answered:
 * *"no because the two new parcels would have the same exterior outline."*
 *
 * That is decisive, and it is a stronger statement than either option on the table: the union of a
 * split's children REPRODUCES the parent's exterior outline exactly — that is what a split IS. So
 * the retained parent adds no information to the drawing, only a second coincident boundary that
 * reads as a duplicate. Nothing is preserved by keeping it.
 *
 * ⛔ AND IT IS A BETTER GUARD THAN AREA CONSERVATION ALONE, which is why it is asserted rather than
 * just acted on. Area conservation is blind to a cut that balances the books while leaving a GAP or
 * a SLIT between the pieces — equal areas, wrong land. Outline equality catches that: it compares
 * the actual covered region, so any hole, sliver gap or protrusion shows up as symmetric difference.
 *
 * Implemented as clipper's symmetric difference (XOR) between the parent ring and the union of the
 * live-active children. A perfect split leaves zero; float noise leaves a few hundredths of a foot
 * squared. clipper-lib is already this repo's polygon engine (pondOffset, roadNetwork), so this
 * introduces no dependency.
 *
 * SCALE: clipper is integer-only, so coordinates are multiplied up. 100 = centi-feet, the same
 * scale `roadNetwork` uses — a hundredth of a foot is far below survey precision and keeps a
 * 2400 ft tract inside safe integer range.
 */
const CLIP_SCALE = 100;
const toPath = (pts) => (pts || []).map((p) => ({ X: Math.round(p.x * CLIP_SCALE), Y: Math.round(p.y * CLIP_SCALE) }));
const pathsArea = (paths) => Math.abs((paths || []).reduce((s, p) => s + ClipperLib.Clipper.Area(p), 0)) / (CLIP_SCALE * CLIP_SCALE);

/* Tolerance for the outline comparison. Rounding to centi-feet can move each vertex by up to half a
 * centi-foot, so a long boundary accumulates a little area; 25 sqft over a hundred-acre tract is
 * ~6e-6 relative — comfortably above the noise and thousands of times below any real gap. */
export const OUTLINE_TOLERANCE_SQFT = 25;

export function unionOutlineMatches({ parentRing, resulting = [], toleranceSqft = OUTLINE_TOLERANCE_SQFT }) {
  const live = liveActive(resulting).map((p) => toPath(p.points || p.pts)).filter((p) => p.length >= 3);
  const parent = toPath(parentRing);
  if (parent.length < 3 || !live.length) {
    return { ok: false, symmetricDiffSqft: null, message: "Cannot compare outlines: the parent ring or the resulting set is empty." };
  }
  // Union the children first — they abut, so a plain union is the covered region.
  const uni = new ClipperLib.Clipper();
  uni.AddPaths(live, ClipperLib.PolyType.ptSubject, true);
  const unioned = new ClipperLib.Paths();
  uni.Execute(ClipperLib.ClipType.ctUnion, unioned, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  // Symmetric difference against the parent: everything covered by one and not the other.
  const xor = new ClipperLib.Clipper();
  xor.AddPath(parent, ClipperLib.PolyType.ptSubject, true);
  xor.AddPaths(unioned, ClipperLib.PolyType.ptClip, true);
  const diff = new ClipperLib.Paths();
  xor.Execute(ClipperLib.ClipType.ctXor, diff, ClipperLib.PolyFillType.pftNonZero, ClipperLib.PolyFillType.pftNonZero);

  const symmetricDiffSqft = pathsArea(diff);
  const ok = symmetricDiffSqft <= toleranceSqft;
  return {
    ok,
    symmetricDiffSqft,
    unionSqft: pathsArea(unioned),
    parentSqft: pathsArea([parent]),
    message: ok ? null
      : `A split's pieces do not cover the same ground as the parent: ${symmetricDiffSqft.toFixed(1)} sf differs ` +
        `(a gap, a slit or an overhang). The union of a split's pieces must reproduce the parent's outline exactly.`,
  };
}
