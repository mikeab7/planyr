/* featureCensus — ⛔ WHAT IS ON THIS PLAN, COUNTED SO THAT FOUR FIFTHS OF IT CANNOT GO MISSING.
 *
 * ── THE MISS THIS FILE EXISTS TO CLOSE (NEW-2) ────────────────────────────────────────────────
 *
 * Every census in this repo counted `[data-el-id]`. That attribute is on ELEMENTS ONLY. The
 * planner draws FIVE kinds — the same five `CLIP_KINDS` names — and an element is one of them:
 *
 *     el · markup · measure · callout · parcel
 *
 * So a plan change that adds, moves or removes a markup, a measurement, a callout or a parcel is
 * INVISIBLE to an element count. It does not read as a smaller change; it reads as NO CHANGE.
 *
 * ⛔ THAT IS NOT A HYPOTHETICAL — IT NEARLY PRODUCED A FALSE BUG REPORT AGAINST A WORKING FEATURE.
 * Measured live on the owner's own signed-in Silvestri pair (V27088, 2026-08-09, build 7307342): a
 * cross-plan paste of a markup polygon landed three markup objects on the destination plan, the
 * toast correctly said "Pasted where it sat on the plan you copied from" — and the element count
 * read **120 before, 120 after**. A complete no-op. The paste was fine. The instrument was blind,
 * and "paste succeeds silently but writes nothing" was one keystroke from being filed against it.
 * The same plan reads **145 distinct features** against those 120 elements: 25 objects the census
 * could not see.
 *
 * ⛔ AND THE THING THAT RESCUED IT, WHICH IS THE GENERAL LESSON: **Ctrl+Z, then diff the feature
 * list. WHEN A COUNT SAYS NOTHING HAPPENED BUT THE APP SAYS IT DID, THE UNDO KNOWS.** An undo frame
 * exists only if something was actually committed to the model, and undoing it names exactly what
 * went in. A counter can be blind to a kind; the history cannot be — it is the model's own record.
 * Reach for it before you believe a null.
 *
 * ── THE CONTRACT WITH THE RENDER ──────────────────────────────────────────────────────────────
 *
 * Every feature's outermost group stamps `data-feature="<kind>:<id>"` (`measure` keys by index).
 * That is the SAME attribute `featureTarget.js` resolves a double-click against, so it is already
 * load-bearing in product code and cannot quietly rot: a render that stops stamping it breaks the
 * double-click contract audit as well as this census.
 *
 * ⛔ COUNT **DISTINCT KEYS**, NEVER NODES. `data-feature` is deliberately stamped on chrome too —
 * a pond's label carries its element's key, the parcel acreage badge carries its parcel's key, a
 * road's radius dot carries the road's — because CHROME-NEVER-EATS-A-PRESS makes that chrome
 * identity-transparent. Those are extra NODES for the same feature. A node count therefore drifts
 * with selection and hover state; a distinct-key count is the plan's contents and nothing else.
 *
 * ── WHERE `[data-el-id]` IS STILL CORRECT ─────────────────────────────────────────────────────
 *
 * Looking up ONE element you already know the id of (`[data-el-id="b3"]`), or deliberately
 * measuring the element tier alone. What is banned is a CENSUS of plan contents, and a "find me an
 * empty spot on the canvas" test that excludes only elements — that one is worse than a wrong
 * number, because a point that is merely free of ELEMENTS can still be on top of a markup or a
 * parcel, and a "pan" gesture started there DRAGS THAT FEATURE instead. Use `BLANK_POINT_EXCLUDE`.
 *
 * The guard against regression is `test/featureCensus.test.js` (pure + a source sweep) and the
 * live `e2e/feature-census.spec.js`, which draws one of each kind and requires the answer FIVE
 * while showing an element-only counter answering ONE on the same canvas.
 */

/** The drawn kinds a plan is made of — the render mirror of `CLIP_KINDS` in planClipboard.js. */
export const FEATURE_KINDS = ["el", "markup", "measure", "callout", "parcel"];

/** Every feature carries this; count DISTINCT VALUES of it. */
export const FEATURE_ATTR = "data-feature";

/** Any node inside a feature. Use this to pick a genuinely empty canvas point — never `[data-el-id]`,
 *  which leaves markups, measurements, callouts and parcels looking like blank canvas. */
export const BLANK_POINT_EXCLUDE = "[data-feature]";

/** The planner canvas root. */
export const CANVAS_SEL = '[data-testid="planner-canvas"]';

/* ── the pure half (Node-testable, no DOM) ─────────────────────────────────────────────────── */

/** Split `"markup:m7"` → `{ kind: "markup", id: "m7" }`; null for anything that is not a feature key. */
export function parseFeatureKey(key) {
  if (typeof key !== "string") return null;
  const i = key.indexOf(":");
  if (i <= 0 || i === key.length - 1) return null;
  const kind = key.slice(0, i);
  return FEATURE_KINDS.includes(kind) ? { kind, id: key.slice(i + 1) } : null;
}

/**
 * Turn a raw list of `data-feature` values — nodes, duplicates and all — into a census.
 *
 * @param {string[]} keys  every `data-feature` value on the canvas, one per NODE
 * @returns {{total:number, byKind:Record<string,number>, keys:string[], unknown:string[]}}
 *   `total` is distinct FEATURES; `keys` is those distinct keys sorted; `unknown` is any key whose
 *   kind is not one of the five — reported rather than silently dropped, so a new drawn kind that
 *   forgets to join `FEATURE_KINDS` shows up as a name instead of vanishing from the count.
 */
export function censusFrom(keys) {
  const seen = new Set();
  const byKind = Object.fromEntries(FEATURE_KINDS.map((k) => [k, 0]));
  const unknown = new Set();
  for (const key of keys || []) {
    if (typeof key !== "string" || !key || seen.has(key)) continue;
    const t = parseFeatureKey(key);
    if (!t) { if (key.includes(":")) unknown.add(key); continue; }
    seen.add(key);
    byKind[t.kind] += 1;
  }
  return { total: seen.size, byKind, keys: [...seen].sort(), unknown: [...unknown].sort() };
}

/* ── the in-page half ──────────────────────────────────────────────────────────────────────── */

/* ⛔ AN EXPRESSION, argument-free, so it is safe to hand to `page.evaluate` as a STRING and to CDP
 * `Runtime.evaluate` alike. Playwright evaluates a string as an EXPRESSION and does NOT call it
 * with an argument (unlike Puppeteer) — the trap `lib/planFixture.mjs` records, which once made
 * every arm of a harness fault on a page rendering 1,307 nodes. Nothing here takes an argument, so
 * it may stay a string. Returns null when there is no canvas, so "no canvas" and "empty plan" can
 * never be confused for each other — an empty plan is `total: 0`. */
export const FEATURE_CENSUS_EXPR = `(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  if (!svg) return null;
  const keys = [];
  for (const n of svg.querySelectorAll("[data-feature]")) keys.push(n.getAttribute("data-feature"));
  return keys;
})()`;

/** Distinct-feature count as a single number for a counters row; null when there is no canvas. */
export const FEATURE_COUNT_EXPR = `(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  if (!svg) return null;
  const seen = new Set();
  for (const n of svg.querySelectorAll("[data-feature]")) seen.add(n.getAttribute("data-feature"));
  return seen.size;
})()`;

/* ⛔ ONE OBJECT-LITERAL FIELD, for the counter rows that are built as template literals and cannot
 * import anything. Interpolate it into a row that already has an `svg` binding in scope:
 *
 *     const READ_COUNTERS = `(() => {
 *       const svg = document.querySelector('[data-testid="planner-canvas"]');
 *       return { canvasNodes: …, ${FEATURE_COUNT_FIELD} };
 *     })()`;
 *
 * It exists so the counting RULE — distinct keys, not nodes — lives in exactly one place even in
 * the harnesses that cannot `import`. Contains no backticks, so it is safe inside a template
 * literal (see the warning in raster-arms.mjs). */
export const FEATURE_COUNT_FIELD =
  'featuresDrawn: (svg ? new Set([...svg.querySelectorAll("[data-feature]")].map((n) => n.getAttribute("data-feature"))).size : null)';

/** Elements only — kept NAMED so a harness that genuinely wants the element tier says so out loud
 *  (annotation-arms measures tiers separately and legitimately wants this one). */
export const ELEMENT_COUNT_EXPR = `(() => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  if (!svg) return null;
  return svg.querySelectorAll("[data-el-id]").length;
})()`;

/**
 * Read the census from a live Playwright page (or anything with `.evaluate`).
 * Returns `null` when the canvas is not mounted — callers must treat that as "could not measure",
 * never as an empty plan.
 */
export async function readFeatureCensus(page) {
  const keys = await page.evaluate(FEATURE_CENSUS_EXPR);
  return keys ? censusFrom(keys) : null;
}

/** Distinct-feature count, or `fallback` when the canvas is not mounted. */
export async function countFeatures(page, fallback = null) {
  const n = await page.evaluate(FEATURE_COUNT_EXPR);
  return n === null || n === undefined ? fallback : n;
}

/**
 * What changed between two censuses — the shape you want after a paste, a delete or an undo,
 * because it NAMES the features rather than reporting a delta that can cancel out.
 */
export function censusDiff(before, after) {
  const a = new Set(before?.keys || []);
  const b = new Set(after?.keys || []);
  const added = [...b].filter((k) => !a.has(k)).sort();
  const removed = [...a].filter((k) => !b.has(k)).sort();
  return { added, removed, changed: added.length > 0 || removed.length > 0 };
}
