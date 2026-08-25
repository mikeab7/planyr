/* featureTarget.js — WHICH FEATURE a canvas double-click is about, resolved at the SVG ROOT (NEW-2).
 *
 * ⛔ A CLICK'S TARGET IS THE COMMON ANCESTOR OF ITS DOWN AND UP TARGETS. That one DOM rule is why
 * every per-node `onDoubleClick` in the planner was dead in exactly the case it existed to cover.
 *
 * Measured on the owner's machine, ONE double-click on an easement (2026-08-06):
 *
 *     pointerdown#1 → polygon[easement hatch]
 *     click#1       → polygon
 *     pointerdown#2 → polygon
 *     click#2 (detail:2) → svg          ← the node the browser was holding is GONE
 *     dblclick      → svg
 *
 * Press 1 SELECTS the feature. React re-renders it. The node that took press 2's `pointerdown` is
 * no longer in the tree by the time the pointer comes up, so the browser walks up for a common
 * ancestor and lands on the root `<svg>`. Both `click#2` and `dblclick` therefore fire on the bare
 * root — a `<g>`-level `onDoubleClick` never sees them. (The old source comments called that path a
 * "fallback for when pointer capture doesn't suppress the native dblclick". It is not a fallback:
 * for a feature that re-renders on selection — i.e. all of them — it is unreachable.)
 *
 * WHY THE ROOT + HIT-TEST, AND NOT "KEEP THE NODE IDENTITY STABLE". Both were considered. Holding
 * the hit node's identity across a selection re-render means promising that NOTHING in a feature's
 * subtree remounts when it becomes selected — but selection is exactly when this canvas grows
 * chrome (grips move into the handle layer, the dimension grab band appears, halos and outlines
 * mount), and every future render change would silently re-break the gesture with no test able to
 * see it. Resolving at the root depends on no render behaviour at all: the root is always there, and
 * WHAT was double-clicked is answered by asking the browser what is under the point — the same
 * hit-test that decided the press targets in the first place. That is why the identity here is read
 * off the live DOM stack rather than recomputed from geometry: a second, geometric hit-test would be
 * free to disagree with the one the browser actually used.
 *
 * THE CONTRACT WITH THE RENDER: every feature's outermost group carries `data-feature="<kind>:<id>"`
 * (`el` · `markup` · `callout` · `parcel`, and `measure:<index>`), and the always-on-top handle layer
 * carries `data-handle-layer`. This module is the pure half — it takes the already-flattened stack
 * (top-most first) and returns the target — so the decision is Node-testable without a DOM.
 *
 * ⛔ B233153 — A VERTEX HANDLE IS CHROME BELONGING TO THE SELECTED FEATURE, NOT A FEATURE. THE HANDLE
 * LAYER IS THEREFORE TRANSPARENT TO FEATURE IDENTIFICATION. This REPLACES the rule that shipped here
 * first — "a handle on top owns the press, return null" — which was wrong for the one case that
 * matters, and it was wrong in a way no fixture in this repo could see.
 *
 * Captured live on the owner's machine (planyr.io, Bain / "Concept A — Quiddity Hydrologic"), one
 * double-click on a detention pond's water, from a capture-phase listener at the svg root:
 *
 *     pointerdown#1 → path[fill=url(#grad-water)]     ← the pond's own fill; it SELECTS (grips 4 → 16)
 *     pointerup#1, click#1 → same path
 *     pointerdown#2 → rect[data-testid="vtx-handle"]  ← 18×18 transparent, inside [data-handle-layer]
 *     click#2, dblclick → that same rect
 *
 * Press 1 mounted the pond's OWN handle layer (41 nodes) and one hit square landed exactly on the
 * point that had just been pressed. Press 2 therefore never reached the pond: the double-tap could
 * not pair, the native dblclick retargeted, and the root resolver — asked what was double-clicked —
 * saw a handle on top and answered "nothing". Silent, every time, on that pond. THE FIRST PRESS
 * SUMMONS THE THING THAT BLOCKS THE SECOND.
 *
 * WHY IT WAS INVISIBLE, and the lesson that generalises: the variable is not the SHAPE, it is VERTEX
 * COUNT against HANDLE SIZE AT THE PROBE POINT. Six realistic pond variants (bare rect · irregular
 * polygon · rect+detention · polygon+detention · polygon+expansion-baseline · grouped) were seeded
 * and driven headless and every one passed, because a four-vertex ring puts its handles at the
 * corners, far from anywhere a centre probe presses. A surveyed ring has dozens, so its basin is
 * peppered with them. This is CHROME-NEVER-EATS-A-PRESS's third instance (after B1174's measurement
 * chips and B1327's acreage badge), and its corollary: CHROME MOUNTED BY THE FIRST PRESS IS INVISIBLE
 * TO ANY CHECK THAT READS THE DOM BEFORE THE INTERACTION.
 *
 * FIXED AT THE RESOLVER, NOT ON THE POND — deliberately. The pond is where it was reported; the
 * defect belongs to every element type that renders vertex handles (a polygon element, a parcel) and
 * to every kind of grip. One rule here closes all of them at once and cannot be re-opened by a new
 * element type. A pond-shaped special case would have closed one report.
 *
 * ⛔ AND IT DOES NOT TOUCH DRAGGING. Handles keep their own `pointerEvents` and their own
 * `onPointerDown`, so a grip still takes its press and a vertex still reshapes. What changed is only
 * the question "WHICH FEATURE was double-clicked" — identification, never delivery. If a grip ever
 * wants its own double-click gesture, it belongs on the grip's handler (which receives the press
 * first), never in blanking this answer: blanking it is what made the feature underneath unopenable.
 *
 * Pure + Node-testable (test/featureTarget.test.js).
 */
import { pairsWithLastTap } from "./doubleTap.js";

/* ⛔ NEW-1 — AND THE CLAUSE B233153 DID NOT REACH: #963 TAUGHT THE RESOLVER TO LOOK *THROUGH* THE
 * HANDLE LAYER; IT DID NOT TEACH IT THAT PRESS 2 IS STILL ABOUT WHATEVER PRESS 1 SELECTED.
 *
 * Captured live on the owner's Bain plan, on a road stub whose whole rendered body is 6×12 CSS px:
 *
 *     press 1  → path, owner e79463haroul. It SELECTS. Handle layer becomes 15×22 px, 7 grips.
 *     between  → elementFromPoint is a circle[data-road-endpoint], r=6, inside [data-handle-layer].
 *     press 2  → the handle layer becomes 189×127 px with 28 grips, and the panel is GONE.
 *                Press 2 addressed a DIFFERENT, LARGER road than press 1 did.
 *
 * The control that rules out the general case, run for exactly that reason: on a large road, a point
 * where press 1 mounts an endpoint handle directly over the press point still resolves to the road
 * and still opens Properties. Looking through the handle layer works. The endpoint handle is not the
 * differentiator.
 *
 * THE DIFFERENTIATOR IS THAT THE FEATURE IS SMALLER THAN ITS OWN CHROME. A 6×12 body wearing a 12 px
 * endpoint handle has no pixel left uncovered once it is selected, so press 2 can only resolve to
 * whatever lies under the chrome — and what lies under it there is a different road. Skipping the
 * handle (B233153) answers "what is beneath this grip"; it cannot answer "what is this GESTURE
 * about". Those are the same question only while the feature is bigger than the chrome it mounts.
 *
 * SO A DOUBLE-CLICK IN FLIGHT IS ANCHORED. Press 1 selected a feature at a point; press 2 lands at
 * the SAME point inside the SAME budget the double-tap itself uses — by construction it is the same
 * gesture, and it is about the same thing. The anchor wins outright rather than merely being
 * preferred: a rule that only breaks ties still loses to whatever the stack puts on top, which is
 * the failure being closed. It is also NARROW — the gates are the native double-click's own
 * thresholds (`pairsWithLastTap`), so one press outside the window or 15 px away is not a gesture
 * and resolves off the stack exactly as before.
 *
 * ⛔ AND IT IS IDENTIFICATION ONLY, like the handle rule beside it. Nothing here changes which node
 * takes a press, so a grip still drags and a vertex still reshapes. */
export function gestureAnchorTarget(anchor, at) {
  if (!anchor || !anchor.key || !at) return null;
  /* The SAME budget the reconstructed double-tap uses, borrowed rather than re-declared: a second
   * copy of DBLTAP_MS/DBLTAP_PX here would let the anchor and the pair disagree about what a
   * double-click IS, and the disagreement would be invisible (both answers look reasonable). */
  const held = pairsWithLastTap(
    { id: "gesture", t: anchor.t, x: anchor.x, y: anchor.y },
    { id: "gesture", t: at.t, x: at.x, y: at.y },
  );
  return held ? parseFeatureKey(anchor.key) : null;
}

/* The kinds a double-click can address. `measure` is addressed BY INDEX (that is how the planner's
 * own selection stores it: `sel = { kind: "measure", i }`); everything else by id. */
export const FEATURE_KINDS = ["el", "markup", "callout", "parcel", "measure"];

/* `"el:e17abc"` → `{ kind: "el", id: "e17abc" }`; `"measure:3"` → `{ kind: "measure", i: 3 }`.
 * Anything malformed, unknown, or empty-suffixed returns null — an unrecognised marker must never
 * resolve to a half-built target that the dispatcher then acts on. */
export function parseFeatureKey(key) {
  if (typeof key !== "string") return null;
  const cut = key.indexOf(":");
  if (cut <= 0) return null;
  const kind = key.slice(0, cut), rest = key.slice(cut + 1);
  if (!rest || !FEATURE_KINDS.includes(kind)) return null;
  if (kind === "measure") {
    const i = Number(rest);
    return Number.isInteger(i) && i >= 0 ? { kind, i } : null;
  }
  return { kind, id: rest };
}

/* Resolve the double-click's target from the hit stack.
 *
 * `entries` is the stack TOP-MOST FIRST, one per node the point is inside:
 *   { feature: string|null, handle: boolean }
 * where `feature` is the nearest enclosing `data-feature` value (null if the node is not inside a
 * feature) and `handle` marks a node inside the always-on-top handle layer.
 *
 * `opts.anchor` / `opts.at` carry the in-flight gesture (see `gestureAnchorTarget`): what press 1
 * selected, and where/when this press landed. Omit them and the resolution is purely the stack's.
 *
 * Three rules, and all three are deliberate:
 *
 *  0. A DOUBLE-CLICK IN FLIGHT IS ANCHORED TO WHAT PRESS 1 SELECTED (NEW-1; see the header). Asked
 *     FIRST, because the whole point is that it must not lose to whatever the stack puts on top —
 *     on a feature smaller than its own chrome, the stack has nothing left of the feature to find.
 *  1. A HANDLE IS TRANSPARENT — skip it and keep looking (B233153; see the header). A grip is chrome
 *     belonging to the selected feature, so it can never be the answer to "which feature was
 *     double-clicked", and it must not stand in the way of the answer either. Handles are SIBLINGS of
 *     the features (the one `data-handle-layer` group, per the handle-layer rule), so they are never
 *     confused FOR a feature — they simply are not one. This is the same rule
 *     `pressIsOverElementBody` below has always applied.
 *  2. OTHERWISE THE TOP-MOST FEATURE WINS, and non-feature nodes above it (the basemap host, the
 *     GIS bands, an un-tagged decoration) are skipped rather than blocking. This is the same
 *     top-most-first order the browser used to pick the press target, so the double-click resolves
 *     to whatever the user was pressing on.
 */
export function resolveDoubleClickTarget(entries, opts = {}) {
  const anchored = gestureAnchorTarget(opts.anchor, opts.at);
  if (anchored) return anchored;
  if (!Array.isArray(entries)) return null;
  for (const en of entries) {
    if (!en) continue;
    if (en.handle) continue;   // chrome above the feature, not a feature — B233153
    const t = parseFeatureKey(en.feature);
    if (t) return t;
  }
  return null;
}

/* Flatten a live DOM hit stack (`document.elementsFromPoint`) into the entries above.
 *
 * Kept here beside the pure half so the attribute names live in ONE place — a render that renames
 * `data-feature` breaks a unit test rather than silently returning "nothing was double-clicked".
 * Takes the node list so the caller owns the `elementsFromPoint` call (and its null-guarding).
 *
 * ONE flattener, carrying every flag either consumer reads. There were two — this one and an
 * `elementStackEntries` that differed only by also stamping `dim` — which meant the attribute
 * names and the null-guarding were written twice and the caller had to pick the right one by
 * passing a function. `resolveDoubleClickTarget` simply ignores `dim`, so the extra `closest` per
 * hit node (a handful of nodes, once per double-click) buys back a duplicated body and a
 * parameter that existed only to choose between two shapes of the same thing. */
export const FEATURE_ATTR = "data-feature";
export const HANDLE_ATTR = "data-handle-layer";
export const EL_DIM_ATTR = "data-el-dim";
/* ⛔ NEW-1 (B280402) — CHROME THAT LIVES OUTSIDE THE HANDLE LAYER BUT IS STILL A MANIPULATION
 * AFFORDANCE. `data-handle-layer` marks the ONE always-on-top group; this marks the strays that
 * cannot live in it and are nonetheless grips, not features. They are IDENTITY-TRANSPARENT by the
 * same rule and for the same reason: a grip is chrome belonging to something, never the answer to
 * "which feature was double-clicked".
 *
 * THE CASE: the parcel ACREAGE BADGE. B1327 made it a hit target only while HOVERED so it could be
 * dragged, and a hover latch is armed by the cursor merely RESTING on it — which is what a cursor
 * does between the two presses of a double-click. Measured on the owner's Bain plan and reproduced
 * here: at one point, with nothing selected, the stack reads `["el:<stub>"]` after touching another
 * feature and `["parcel:<lot>", "el:<stub>"]` after touching the stub. **The parcel does not move
 * above the element — IT ENTERS**, and the element is still there, second, unchanged. So the second
 * double-click resolved to the LOT, which opens the Parcel panel and therefore took Properties away.
 * (His first report called it "a different, larger road"; the instrument proved it a parcel.) */
export const CHROME_ATTR = "data-chrome";
export function stackEntries(nodes) {
  const out = [];
  for (const n of nodes || []) {
    if (!n || typeof n.closest !== "function") continue;
    const fg = n.closest(`[${FEATURE_ATTR}]`);
    out.push({
      feature: fg ? fg.getAttribute(FEATURE_ATTR) : null,
      handle: !!n.closest(`[${HANDLE_ATTR}], [${CHROME_ATTR}]`),
      dim: !!n.closest(`[${EL_DIM_ATTR}]`),
    });
  }
  return out;
}

/* ⛔ NEW-2 — EVERY FEATURE UNDER THE POINT, TOP-MOST FIRST, not just the winner.
 *
 * THE DEFECT THIS EXISTS FOR. Sending a markup behind the buildings is a ONE-WAY DOOR from the
 * user's seat: the building paints over it, so the building's node takes every press across the
 * whole overlap, and the markup can only be grabbed on whatever sliver no element covers. Measured
 * on the owner's plan — right-click the markup anywhere it overlaps the building and you get the
 * BUILDING's menu, with nothing in it that mentions the markup. On a markup drawn to cover a
 * building there is no sliver at all, and the object is simply unreachable.
 *
 * `resolveDoubleClickTarget` answers "which ONE feature is this press about", which is the right
 * question for a gesture and the wrong one for "what did I put under here". Same stack, same
 * skip-the-chrome rule (a handle or a `data-chrome` affordance belongs to a feature and is never
 * one), read all the way down instead of stopping at the first hit. Deduped, because one feature
 * contributes as many stack entries as it has painted nodes at that point.
 *
 * Pure — the caller owns the `elementsFromPoint` call, exactly as above.
 */
export function featureStack(entries) {
  const out = [], seen = new Set();
  for (const en of entries || []) {
    if (!en) continue;
    if (en.handle) continue;                 // chrome belonging to a feature, not a feature
    if (!en.feature || seen.has(en.feature)) continue;
    const target = parseFeatureKey(en.feature);
    if (!target) continue;
    seen.add(en.feature);
    out.push({ key: en.feature, target });
  }
  return out;
}

/* The features BELOW the top-most one at this point — i.e. what the press could not reach. */
export function featuresBeneath(entries) {
  return featureStack(entries).slice(1);
}

/* Is `key` (a `data-feature` value) anywhere in this stack at all? The selected-annotation
 * priority rule below needs exactly this and nothing more: not "is it on top" — it is under an
 * element BY DESIGN — but "does it paint here", so the press can be handed back to it. */
export function stackHoldsFeature(entries, key) {
  if (typeof key !== "string" || !key) return false;
  return featureStack(entries).some((f) => f.key === key);
}

/* NEW-3 — did this press land on the element's own BODY, or only on its dimension chrome?
 *
 * The dimension NUMBER is a click target (single click selects, and historically a double-tap
 * opened the inline length editor). On a centerline road that number is anchored to the CENTRELINE
 * MIDPOINT — i.e. it sits ON the pavement — so a double-click aimed at the road could not miss it,
 * and the width editor swallowed a gesture the contract says opens Properties. The same trap is
 * waiting on every element whose number can sit under its body (a rect element's number is pinned
 * onto the footprint by the B592 slide clamp).
 *
 * So the dispatch asks the RIGHT question, once, for every type: is the element's own body painted
 * under this point, beneath the dimension chrome? If yes the press is on the BODY and the body's
 * action (Properties) wins. If no — the number has been dragged out into clear space, which a
 * road's free dimension drag allows — the number is genuinely what was aimed at and keeps its
 * inline editor. `entries` are as above, plus `dim: true` for a node inside that element's
 * `data-el-dim` chrome group.
 */
/* ⛔ B548822 — THE STACK PICKER: reach a feature buried under others without moving anything.
 *
 * A plain click always resolves to the TOP-most feature at a point (paint order is hit order in
 * SVG), so an object drawn under something else can only be grabbed on a sliver nothing covers —
 * and on one drawn entirely inside another (the owner's Richfield case: road `e1454053brxkkr`
 * geometrically inside pond `e1454052brxkkr`, both already at the bottom of their own bands so
 * Send-to-Back has nowhere left to send either of them), there is no sliver at all. B548065 already
 * solved this for the three ANNOTATION families sent behind an element (a "Behind this" menu group);
 * this is the general answer, for every family, without requiring anything be selected first.
 *
 * THE GESTURE (Bluebeam/Illustrator/Photoshop parity): Alt+click resolves to the TOP of the stack,
 * exactly like a plain click. Alt+click AGAIN at the SAME point steps one deeper. A click anywhere
 * else resets to the top — this is a way to REACH something, not a mode you can leave engaged by
 * accident. `nextPickIndex` is the whole rule, pure: same point (within `PICK_SAME_POINT_PX`,
 * matching this canvas's own click-tolerance idiom rather than inventing a second one) advances the
 * index (wrapping, so the last Alt+click cycles back to the top); anything else — no prior pick, a
 * different point, or a stack that shrank under the cursor — starts over at 0.
 *
 * `stackAtPoint` is a thin composition of the primitives above (`stackEntries` + `featureStack`) so
 * the picker reads the exact same hit stack `resolveDoubleClickTarget` does — one hit-test, several
 * questions asked of it, never a second geometric answer that could disagree with the first.
 */
export const PICK_SAME_POINT_PX = 4; // a deliberate re-click, not the same physical press wobbling

export function stackAtPoint(nodes) {
  return featureStack(stackEntries(nodes));
}

/**
 * @param {{x:number,y:number,index:number}|null} prev — the last Alt+click's point + chosen index
 * @param {{x:number,y:number}} at — this Alt+click's point
 * @param {number} stackLen — how many features are under `at` right now
 * @returns {number} the index into the stack to select — always `< stackLen` when `stackLen > 0`
 */
export function nextPickIndex(prev, at, stackLen) {
  if (!stackLen) return 0;
  const samePoint = !!prev && Math.hypot(prev.x - at.x, prev.y - at.y) <= PICK_SAME_POINT_PX;
  if (!samePoint) return 0;
  return (prev.index + 1) % stackLen;
}

export function pressIsOverElementBody(entries, id) {
  if (!Array.isArray(entries) || id == null) return false;
  for (const en of entries) {
    if (!en) continue;
    if (en.handle) continue;                 // chrome above the element: not the element's body, keep looking
    const t = parseFeatureKey(en.feature);
    if (!t) continue;                        // untagged decoration: keep looking
    if (t.kind !== "el" || t.id !== id) return false; // some OTHER feature is on top here
    if (en.dim) continue;                    // this element's own dimension chrome — that is what we are looking past
    return true;                             // the element's own body paints here
  }
  return false;
}

