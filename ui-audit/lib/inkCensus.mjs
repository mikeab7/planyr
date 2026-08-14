/* inkCensus — WHAT IS ACTUALLY PAINTED ON THE DRAWING, AND WHICH FEATURE IT BELONGS TO (NEW-1).
 *
 * ⛔ THE BLIND SPOT THIS EXISTS TO CLOSE, and it certified a broken feature green for a release.
 *
 * `verify-content-visibility` asked the right question of the wrong nouns. It counts DISTINCT
 * `data-feature` / `data-el-id` keys, per COUNT-EVERY-KIND, and hiding Roads takes every road's
 * `[data-el-id]` node off the canvas — so it read `4 drawn → 0` and scored ✓ while the owner was
 * looking at four unbroken grey ribbons. The pavement is not drawn by the roads. It is drawn ONCE,
 * for the whole connected cluster, by the dissolved road network (`roadNetwork.js`), from a memo
 * over `els` that no visibility filter ever reached — a `<path>` with no feature key on it at all.
 *
 * The general shape of the mistake: **a feature census counts REGISTRATIONS, not INK.** Any render
 * path that draws on behalf of several features at once — a dissolved region, a merged outline, a
 * union — is invisible to it by construction, and this codebase has a stated preference for exactly
 * that kind of path (roadNetwork's union, the parcel dissolve, the curb outline). So a census that
 * cannot see unowned ink will keep certifying this class of bug, on whichever surface adopts a
 * union next.
 *
 * ── WHAT THIS COUNTS ────────────────────────────────────────────────────────────────────────────
 * Every PAINTED node inside the drawing's own feet-space group, attributed to the feature it draws
 * for, by walking up to the nearest ancestor that names one:
 *
 *   data-feature="<kind>:<id>"   the canonical key every feature's outermost group stamps
 *   data-el-id="<id>"            the element tier
 *   data-road-cluster="a,b,c"    the dissolved network's own member list — the attribute that makes
 *                                unowned ink attributable AT ALL, and the reason it is read here
 *
 * Anything painted that resolves to NONE of those is reported as `unowned`, BY SELECTOR, and never
 * silently dropped. An honest "I could not attribute 3 nodes, here they are" is the whole value:
 * the failure mode being guarded against is ink nobody registered, so ink nobody can attribute is
 * precisely the thing that must reach the report rather than the floor.
 *
 * ── WHAT IS DELIBERATELY EXCLUDED, and why each is not a hole ────────────────────────────────────
 *  · the handle layer (`[data-handle-layer]`) — chrome for the CURRENT selection, not content, and
 *    hiding a group clears any selection into it, which is asserted separately.
 *  · `[data-export="skip"]` — editing affordances, by the export path's own definition.
 *  · the drafting grid, the setback ring and the sheet furniture — plan-level ornament that belongs
 *    to no content group and has its own settings keys (`showGrid`, `showSetback`).
 *  · nodes with no paint: `fill:none` AND `stroke:none`, zero opacity, `display:none`. A node that
 *    cannot put ink on the screen is not ink.
 *
 * ⛔ IT READS COMPUTED STYLE, NOT ATTRIBUTES. `fill="none"` and a stylesheet rule that paints it are
 * not the same statement, and a check that reads the attribute believes the first one.
 */

/** The in-page collector. Serialised into the browser; keep it dependency-free. */
export const INK_CENSUS_FN = () => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  if (!svg) return { error: "no planner canvas" };

  const PAINTABLE = new Set(["path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "text", "image", "use"]);
  const skip = (n) => n.closest('[data-handle-layer], [data-export="skip"], [data-ink-ignore]');

  const paints = (n) => {
    const cs = window.getComputedStyle(n);
    if (cs.display === "none" || cs.visibility === "hidden") return false;
    if (Number(cs.opacity) === 0) return false;
    const hasFill = cs.fill && cs.fill !== "none" && Number(cs.fillOpacity) !== 0;
    const hasStroke = cs.stroke && cs.stroke !== "none" && Number(cs.strokeOpacity) !== 0 && parseFloat(cs.strokeWidth) > 0;
    if (n.tagName === "text" || n.tagName === "image" || n.tagName === "use") return true;
    return !!(hasFill || hasStroke);
  };

  /* An ancestor chain walk rather than `closest()` per attribute, so the NEAREST naming ancestor
   * wins whichever attribute it carries — a `data-feature` inside a `data-road-cluster` must
   * attribute to the feature, not to the cluster. */
  const ownersOf = (n) => {
    for (let el = n; el && el !== svg.parentNode; el = el.parentElement) {
      if (el.hasAttribute && el.hasAttribute("data-feature")) return [el.getAttribute("data-feature")];
      if (el.hasAttribute && el.hasAttribute("data-el-id")) return [`el:${el.getAttribute("data-el-id")}`];
      if (el.hasAttribute && el.hasAttribute("data-road-cluster")) {
        return String(el.getAttribute("data-road-cluster")).split(",").filter(Boolean).map((id) => `el:${id}`);
      }
    }
    return null;
  };

  const selectorOf = (n) => {
    const bits = [];
    for (let el = n; el && el.tagName && bits.length < 4; el = el.parentElement) {
      const t = el.getAttribute && (el.getAttribute("data-testid") || el.getAttribute("data-export"));
      bits.unshift(el.tagName.toLowerCase() + (t ? `[${t}]` : ""));
      if (t) break;
    }
    return bits.join(">");
  };

  const byOwner = {};      // "el:<id>" → painted node count
  const unowned = {};      // selector → count
  let painted = 0;

  for (const n of svg.querySelectorAll("*")) {
    if (!PAINTABLE.has(n.tagName)) continue;
    if (skip(n)) continue;
    if (!paints(n)) continue;
    painted++;
    const owners = ownersOf(n);
    if (!owners) { const s = selectorOf(n); unowned[s] = (unowned[s] || 0) + 1; continue; }
    for (const o of owners) byOwner[o] = (byOwner[o] || 0) + 1;
  }
  return { painted, byOwner, unowned };
};

/** Run the census in a page. */
export const inkCensus = (page) => page.evaluate(INK_CENSUS_FN);

/**
 * Ink still on the drawing for features that are supposed to be hidden.
 *
 * @param {object} census   the result of `inkCensus`
 * @param {string[]} keys   owner keys ("el:<id>" / "markup:<id>" / …) that must have NO ink
 */
export function leakedInk(census, keys) {
  const out = [];
  for (const k of keys) {
    const n = (census.byOwner || {})[k] || 0;
    if (n > 0) out.push({ key: k, nodes: n });
  }
  return out;
}
