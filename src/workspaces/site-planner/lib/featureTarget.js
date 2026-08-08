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
 * Two rules, and both are deliberate:
 *
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
export function resolveDoubleClickTarget(entries) {
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
export function stackEntries(nodes) {
  const out = [];
  for (const n of nodes || []) {
    if (!n || typeof n.closest !== "function") continue;
    const fg = n.closest(`[${FEATURE_ATTR}]`);
    out.push({
      feature: fg ? fg.getAttribute(FEATURE_ATTR) : null,
      handle: !!n.closest(`[${HANDLE_ATTR}]`),
      dim: !!n.closest(`[${EL_DIM_ATTR}]`),
    });
  }
  return out;
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

