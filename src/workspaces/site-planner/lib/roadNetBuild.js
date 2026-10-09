/* roadNetBuild — the DISSOLVED ROAD NETWORK of a plan, as a pure function of (els, settings), in two shapes: run to completion (the render's `roadNet` memo) or run in slices
 * (the plan-open warm-up). Moved out of SitePlanner.jsx (B2233521, round 5) so the equivalence of the two — and that a warm-up primes exactly what the render asks for —
 * can be unit-tested against the owner's real plans. Nothing here reads component state.
 */
import { elHidden } from "./contentVisibility.js";
import { weldCoverPolygon, rectEdges } from "./roadGeometry.js";
import {
  roadNetworkStats, dissolveRingsSteps, clipPolylineOutside, clusterIds, regionEdgeSegments, rectOutlineCutSegments, polygonOutlineCutSegments,
} from "./roadNetwork.js";
import { teeJunctionsOf, driveJunctionsOf } from "./roadJunctions.js";
import {
  isCenterlineRoad, roadCurbWidth, roadStripRing, roadCurbLines, TEE_COINCIDE_FT, roadJunctionVerticesOf, roundaboutsForSite, driveJunctionCurbStripes,
} from "./siteGeometry.js";

// B960/NEW-2 — road↔road END-TO-END weld junctions for the seamless-weld render. A weld = one
// road's ENDPOINT coincident with ANOTHER road's ENDPOINT (a plain weld or the two ends of a loop),
// as opposed to a tee (endpoint on an interior vertex, handled by teeJunctionsOf). Each such join
// otherwise shows a seam — two flat end caps butting, each drawing its back-of-curb edge stroke
// across the join. Returns [{ ids, P, cover }] with an opaque cover patch (weldCoverPolygon) that
// unifies the pavement. Pure over (els); memoized at the call site.
export const roadOuterHalf = (el) => Math.max(0, (+el.travelW || 0) / 2) + roadCurbWidth(el); // centerline → back-of-curb
export function weldJunctionsOf(els) {
  const roads = (els || []).filter((x) => isCenterlineRoad(x) && !x.attachedTo);
  const armAt = (R, ei) => {                                         // road R's endpoint ei → { dir(neighbor→P), halfW }
    const P = R.pts[ei];
    const nb = R.pts[ei === 0 ? 1 : R.pts.length - 2];
    return { dir: { x: P.x - nb.x, y: P.y - nb.y }, halfW: roadOuterHalf(R) };
  };
  const out = [];
  const seen = new Set();
  for (let a = 0; a < roads.length; a++) {
    const A = roads[a];
    for (const aei of [0, A.pts.length - 1]) {
      const PA = A.pts[aei];
      // gather every OTHER endpoint (incl. A's own other end for a loop close) coincident with PA
      const arms = [armAt(A, aei)];
      const members = [`${A.id}:${aei}`];
      for (let b = 0; b < roads.length; b++) {
        const B = roads[b];
        for (const bei of [0, B.pts.length - 1]) {
          if (B.id === A.id && bei === aei) continue;
          if (Math.hypot(B.pts[bei].x - PA.x, B.pts[bei].y - PA.y) <= TEE_COINCIDE_FT) {
            arms.push(armAt(B, bei));
            members.push(`${B.id}:${bei}`);
          }
        }
      }
      if (arms.length < 2) continue;
      const key = [...members].sort().join("|");                    // dedupe: found once per member endpoint
      if (seen.has(key)) continue;
      seen.add(key);
      const cover = weldCoverPolygon({ x: PA.x, y: PA.y }, arms);
      if (cover) out.push({ ids: members.map((m) => m.split(":")[0]), P: { x: PA.x, y: PA.y }, cover });
    }
  }
  return out;
}
/* B2233521 (NEW-1, round 5) — THE DISSOLVED ROAD NETWORK, as steps. This is the body of SitePlanner's `roadNet` memo moved here VERBATIM (indent aside)
 * plus `yield;` between its units of work (one road's strip ring, one cluster's dissolve, one road's curb stripes). Two drivers, one body: the render's memo drives
 * it to completion in one go (`driveSteps`), and the plan-open seed drives it in ~8 ms MessageChannel slices BEFORE the seed renders (`warmRoadNet`), so the
 * clipper work — ~130 ms of the first render of a plan this device has never drawn, ~330 of Richfield's — is already in the by-value caches
 * (`dissolveRings` / `clipPolylineOutside` / `roadSurfaceRing`) when the render asks. A warm that disagrees with the render only misses the cache; it can never
 * change an answer. Pure: nothing here reads component state. */
/* read-only diagnostic: the by-value road caches' hit/miss counters (the plan-open harness reads them to prove the warm-up primed what the render asks) */
if (typeof window !== "undefined") window.__roadNetStats = () => ({ ...roadNetworkStats });
export function* roadNetSteps(inp) {
  const { els, settings, hiddenGroups, teeJunctions, driveJunctions, weldJunctions, sharpFor, roadJunctionVerts, roundabouts } = inp;
  /* ⛔ B1788912 (NEW-1) — THE COMPOSITE'S ORDERING RULE, stated per NO-ONE-OWNS-A-COMPOSITE
     (/CLAUDE.md): a dissolved road network is ONE painted region built from several roads that
     may each carry a DIFFERENT creation-order `z` now that elements stack Bluebeam-style instead
     of by type. One region needs one paint position, so a single scalar has to stand in for the
     whole cluster — see `zKey` below for which one and why. (The old `bandForceOf` exclusion —
     a road forced out of its type band painted its own strip instead of joining the dissolve —
     is gone with the type-band rule itself; every centerline road is a network member again,
     even a lone one, exactly as it was before that escape hatch existed.) */
  /* ⛔ NEW-1 — HIDDEN ROADS LEAVE THE DISSOLVED NETWORK, AND THIS ONE FILTER IS THE WHOLE DEFECT.
   *
   * The owner unchecked Roads in the View panel, the banner said "6 groups hidden", and the roads
   * were still on the drawing as grey ribbons. `drawEls` was filtered correctly — every road's own
   * `[data-el-id]` node left the canvas — but a road's PAVEMENT is not drawn by the road. It is
   * drawn ONCE per connected cluster, here, from a memo over `els` that no visibility filter ever
   * reached. Hiding removed the hit target and the label and left the ink.
   *
   * ⚠ THIS IS NOT THE CULL, AND IT MUST NOT BECOME THE CULL. `roadNet` reads `els` rather than
   * `drawEls` on purpose (see `elNeighbors` above): a road scrolled off screen still shapes the
   * curb return of one that is on screen, so culling here would change the drawn geometry. HIDING
   * is a different statement — a hidden road contributes nothing at all, including its junctions —
   * so it is filtered, and the two filters stay distinct. */
  const roads = (els || []).filter((x) => isCenterlineRoad(x) && !x.attachedTo && !elHidden(hiddenGroups, x));
  if (!roads.length) return { regions: [], stripes: new Map(), outlineCuts: new Map(), memberIds: new Set(), junctionVerts: roadJunctionVerts, trims: roundabouts.trims, roundabouts: roundabouts.geoms };
  const byId = new Map(roads.map((r) => [r.id, r]));
  const strip = new Map();
  for (const r of roads) { strip.set(r.id, roadStripRing(r, settings, sharpFor(r), roundabouts.trims.get(r.id))); yield; }
  // Extra pavement contributed by each junction, indexed by the road that owns the junction.
  const extra = new Map(roads.map((r) => [r.id, []]));
  // Stripe-only cutters: regions that must INTERRUPT a curb stripe without adding pavement. The one
  // case is the through road's near face-of-curb stripe, which otherwise draws a curb line straight
  // across the throat between the two returns — the strip of the side road only covers the middle of
  // that span, so clipping against pavement alone leaves a stub under each return.
  const stripeCut = [];
  const pairs = [];
  const addExtra = (id, polys) => { const a = extra.get(id); if (a) for (const p of polys || []) if (p && p.length >= 3) a.push(p); };
  for (const tj of teeJunctions) {
    /* A junction between two roads is only a junction while BOTH are on the drawing. `addExtra`
     * already no-ops for a hidden side road (it has no `extra` entry), but `stripeCut` below is
     * unconditional — leave it in and a visible road's curb stripe is interrupted by a road that
     * is not there, which reads as a gap in the kerb for no visible reason. */
    if (!byId.has(tj.sideId) || !byId.has(tj.throughId)) continue;
    addExtra(tj.sideId, tj.geom.wedges);
    pairs.push([tj.sideId, tj.throughId]);
    const G = byId.get(tj.throughId), n = tj.geom.nTee, [t1, t2] = tj.geom.throughTangents || [];
    const depth = G ? roadOuterHalf(G) : 0;                 // back-of-curb → centerline: near stripe only
    if (t1 && t2 && n && depth > 0) stripeCut.push([t1, t2, { x: t2.x - n.x * depth, y: t2.y - n.y * depth }, { x: t1.x - n.x * depth, y: t1.y - n.y * depth }]);
  }
  for (const dj of driveJunctions) addExtra(dj.sideId, dj.geom.wedges);   // target is a rect element, not a road
  /* 2026-09-22 — the pad a road tees into is SUBTRACTED from that road's cluster (see
     dissolveRings' `subtract`): the road's pavement ends at the court face instead of running
     under (now: over) the court. Map<roadId, [pad rings]>, pad rings in world feet. */
  const padRingOf = (T) => {
    if (!T) return null;
    if (Array.isArray(T.points) && T.points.length >= 3) return T.points;
    if (typeof T.cx === "number" && T.w > 0 && T.h > 0) return rectEdges(T.cx, T.cy, T.w, T.h, T.rot || 0).map((e) => e.a);
    return null;
  };
  const padCut = new Map();
  for (const dj of driveJunctions) {
    const ring = padRingOf((els || []).find((e) => e.id === dj.targetId));
    if (!ring) continue;
    if (!padCut.has(dj.sideId)) padCut.set(dj.sideId, []);
    padCut.get(dj.sideId).push(ring);
  }
  // NEW-5 — a roundabout's circulatory sectors + its curb returns are ADDITIVE pavement in exactly
  // the same sense a tee's wedges are, so they go through the SAME union: one region, one
  // continuous curb outline, and the central island falls out as a genuine PolyTree hole.
  for (const [rid, polys] of roundabouts.extraById) addExtra(rid, polys);
  for (const p of roundabouts.pairs) pairs.push(p);   // every leg clusters with its circle
  for (const wj of weldJunctions) {
    addExtra(wj.ids[0], [wj.cover]);
    for (let i = 1; i < wj.ids.length; i++) pairs.push([wj.ids[0], wj.ids[i]]);
  }
  /* A pair naming a road that is hidden is not a connection any more — drop it rather than let it
   * chain two visible clusters together through something nobody can see. */
  const cluster = clusterIds(roads.map((r) => r.id), pairs.filter(([a, b]) => byId.has(a) && byId.has(b)));
  const groups = new Map();
  for (const r of roads) {
    const k = cluster.get(r.id);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(r.id);
  }
  const regions = [];
  const fullRegions = [];
  const stripes = new Map();
  for (const ids of groups.values()) {
    const parts = [];
    for (const id of ids) { const s = strip.get(id); if (s && s.length >= 3) parts.push(s); parts.push(...extra.get(id)); }
    // Style from the WIDEST member (its surface reads as the merged pavement) — the same rule the
    // weld cover already used.
    const styleEl = ids.map((id) => byId.get(id)).filter(Boolean).sort((a, b) => roadOuterHalf(b) - roadOuterHalf(a))[0];
    /* ⛔ B1788912 (NEW-1) — THE COMPOSITE'S ORDERING RULE: a cluster paints at its NEWEST member's
       `z` — the MAX, not the min. Stated and chosen, not incidental (a MIN reading was harmless
       before this, since every road shared one type-band tier regardless of `zKey`; it stopped
       being harmless the moment `zKey` became the cluster's actual paint position among every
       other element). MAX matches the rest of the feature: "whatever you draw — or connect —
       last is on top." Connecting a new road segment to an older one is itself a fresh act, and
       the fused pavement should read as current with it, not sink to whichever member happens to
       be oldest. The trade, named rather than hidden: welding a brand-new road onto an old one
       can pull that old segment's ink up above something drawn in between (a network is one
       region, so it cannot paint "part new, part old") — the general cost NO-ONE-OWNS-A-COMPOSITE
       warns every composite carries, and no scalar choice here removes it. */
    const zKey = Math.max(...ids.map((id) => byId.get(id)?.z ?? 0));
    // The cluster's pads (drive targets of any member) are cut out of the painted region; the
    // UNCUT dissolve is kept only to interrupt the pad's own outline across the mouth (below).
    const subtract = ids.flatMap((id) => padCut.get(id) || []);
    const full = yield* dissolveRingsSteps(parts);
    const painted = subtract.length ? yield* dissolveRingsSteps(parts, { subtract }) : full;
    for (const region of painted) regions.push({ region, styleEl, zKey, ids, edge: regionEdgeSegments(region, subtract) });
    for (const region of full) fullRegions.push({ region, ids });
    // A road's inner curb stripes are trimmed against the OTHER pavement in its cluster, so a stripe
    // ends where it runs into the junction instead of drawing a curb straight through the intersection.
    for (const id of ids) {
      const others = [];
      for (const oid of ids) { if (oid === id) continue; const s = strip.get(oid); if (s && s.length >= 3) others.push(s); }
      for (const oid of ids) others.push(...extra.get(oid));
      others.push(...stripeCut);
      others.push(...(padCut.get(id) || []));   // a curb stripe stops at the court face too
      const clipped = roadCurbLines(byId.get(id), settings, sharpFor(byId.get(id)), roundabouts.trims.get(id)).flatMap((cl) => clipPolylineOutside(cl, others));
      // NEW-1 — a road ending at a drive junction (a paving/parking pad edge) left its inner
      // face-of-curb stripe clipped dead right at the fillet's own tangent point: the straight
      // body carried its curb detail, the curb-return fillet carried none, so the two painted as
      // visibly different treatments of what PR 1763 already proved is one continuous dissolved
      // surface — a seam of decoration, not of geometry. `driveJunctionCurbStripes`
      // (siteGeometry.js) continues the same line around the return; see its header.
      const filletStripes = driveJunctionCurbStripes(driveJunctions.filter((dj) => dj.sideId === id), roadCurbWidth(byId.get(id)));
      stripes.set(id, [...clipped, ...filletStripes]);
      yield;
    }
  }
  regions.sort((a, b) => a.zKey - b.zKey);
  // NEW-4 — a road that TEES INTO A RECT (a parking field, a truck court) leaves that rect's own
  // outline drawn straight across the drive opening: the owner's screenshot, and the same defect the
  // road↔road case already fixed, one layer out. A junction reads as one continuous curb around the
  // entrance, never a line ruled across it. Road↔road dissolves because both sides are pavement; a
  // court is a different element with its own fill, so instead of merging we INTERRUPT the target's
  // outline where the drive's pavement crosses it. Map<targetId, cutter rings>.
  const outlineCuts = new Map();
  for (const dj of driveJunctions) {
    const cutters = fullRegions.filter((r) => r.ids.includes(dj.sideId)).map((r) => r.region.outer).filter(Boolean);
    if (!cutters.length) continue;
    outlineCuts.set(dj.targetId, [...(outlineCuts.get(dj.targetId) || []), ...cutters]);
  }
  return { regions, stripes, outlineCuts, memberIds: new Set(roads.map((r) => r.id)), junctionVerts: roadJunctionVerts, trims: roundabouts.trims, roundabouts: roundabouts.geoms };
}
export const driveSteps = (gen) => { for (;;) { const r = gen.next(); if (r.done) return r.value; } };

/** The inputs `roadNetSteps` needs, derived from (els, settings) by the same pure functions SitePlanner's own memos use (teeJunctions, driveJunctions, weldJunctions,
 *  roadJunctionVerts, sharpFor, roundabouts). `tick` (optional) is awaited between the derivations so a caller can slice them. */
export async function roadNetInputs(els, settings, tick = async () => {}) {
  const roadJunctionVerts = roadJunctionVerticesOf(els);
  const sharpFor = (el) => (el && el.id != null ? roadJunctionVerts.get(el.id) : undefined);
  const teeJunctions = teeJunctionsOf(els, settings); await tick();
  const driveJunctions = driveJunctionsOf(els, settings); await tick();
  const weldJunctions = weldJunctionsOf(els);
  const roundabouts = roundaboutsForSite(els, settings); await tick();
  return { els, settings, hiddenGroups: settings.hidden, teeJunctions, driveJunctions, weldJunctions, sharpFor, roadJunctionVerts, roundabouts };
}

/** Prime the by-value road caches for a plan, `tick()` (a macrotask yield) between units of work. A warm-up that disagrees with the render only misses the cache. */
export async function warmRoadNetFromEls(els, settings, tick) {
  const gen = roadNetSteps(await roadNetInputs(els, settings, tick));
  let net;
  for (;;) { const r = gen.next(); if (r.done) { net = r.value; break; } await tick(); }
  /* the drive-junction targets' interrupted outlines (an ElNode asks for them per rect / polygon pad — ~80 ms of Richfield's render at 2×) */
  if (net && net.outlineCuts) {
    const byId = new Map(els.map((e) => [e.id, e]));
    for (const [id, cutters] of net.outlineCuts) {
      const el = byId.get(id);
      if (!el) continue;
      if (el.points) polygonOutlineCutSegments(el, cutters); else rectOutlineCutSegments(el, cutters);
      await tick();
    }
  }
}