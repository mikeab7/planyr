/* deleteFeature — ⛔ A SYNTHETIC Delete KEYSTROKE DOES NOT DELETE. DRIVE IT, THEN RE-READ.
 *
 * ── WHY THIS FILE EXISTS ──────────────────────────────────────────────────────────────────────
 *
 * This has now cost two cleanup rounds on the owner's LIVE plans — a stray easement left on
 * Bain / "Concept - Original" (2026-08-08) and three pasted markups left on Silvestri
 * (V27088, 2026-08-09). Both times the harness "deleted" the object, reported success, and the
 * object was still on his plan. Both times a human had to go and finish it by hand.
 *
 * ── THE MECHANISM, MEASURED RATHER THAN REASONED (NEW-3, on build 7307342) ────────────────────
 *
 * The planner's keyboard handler is bound to **`window`** (`SitePlanner.jsx`, the `/* keyboard *\/`
 * effect). `new KeyboardEvent("keydown", { key: "Delete" })` defaults **`bubbles: false`** — a real
 * key event never does — so a synthetic event dispatched on `document` or `document.body` never
 * propagates to `window` and the app never hears it. Measured on a seeded blank plan, one selected
 * building, element count before → after:
 *
 *     document.dispatchEvent(new KeyboardEvent("keydown", {key:"Delete"}))                1 → 1  ✗
 *     document.body.dispatchEvent(new KeyboardEvent("keydown", {key:"Delete"}))           1 → 1  ✗
 *     window.dispatchEvent(new KeyboardEvent("keydown", {key:"Delete"}))                  1 → 0  ✓
 *     …any of the three with { bubbles: true }                                            1 → 0  ✓
 *     page.keyboard.press("Delete")   (a real, trusted key event through the driver)      1 → 0  ✓
 *
 * So the failure is not "the app ignores untrusted events" — it does not check `isTrusted` at all.
 * It is one missing option on the event, and it fails in **total silence**: no error, no warning,
 * nothing in the console, and the object sits there still looking selected.
 *
 * ⛔ AND THERE ARE TWO MORE GATES THAT SWALLOW THE KEY **BY DESIGN**, so a harness can do everything
 * right and still get a no-op:
 *   1. **A FOCUSED FIELD.** While `document.activeElement` is an `INPUT` / `SELECT` / `TEXTAREA` /
 *      contentEditable, the handler returns early so you can type — it even renders a one-shot hint
 *      saying so. Click a Properties field, then press Delete, and nothing happens. Correct product
 *      behaviour, invisible to a driver that did not blur first.
 *   2. **AN INACTIVE PLANNER.** `if (!active) return` — a keep-alive-mounted planner behind another
 *      workspace must never eat keys. Drive the module tab back first.
 *
 * ── THE RULE ──────────────────────────────────────────────────────────────────────────────────
 *
 * **Never dispatch a synthetic keystroke to mutate the plan.** Use the driver's real key input
 * (`page.keyboard.press` / CDP `Input.dispatchKeyEvent`), or press the UI control that does the job:
 * the Properties panel's **Delete element** button (`[data-testid="property-panel"]`), or the
 * right-click context menu's **Delete element**. All three go through `deleteSel`, which is the one
 * delete path and can never fail in silence.
 *
 * **And RE-READ BETWEEN ATTEMPTS.** The DOM read races the re-render: a check fired in the same
 * turn as the delete can still see the node that is on its way out, which is exactly how a pass was
 * reported for an object that was still there. One read is never an answer — poll until the feature
 * is genuinely ABSENT, and on a plan that matters, reload and confirm.
 *
 * The verdict table below is pure so CI can test it without a browser
 * (`test/deleteDrive.test.js`); `ui-audit/verify-delete-drive.mjs` is the live positive control —
 * it re-measures the table above every run, so the day the app's key handling changes, the rule
 * stops being folklore and the harness says so.
 */

/** Attempt outcomes, in the order the driver tries them. */
export const DELETE_ROUTES = ["key", "panel", "menu"];

/** Deliberately NOT a route. Named so the ban is greppable and testable. */
export const BANNED_ROUTE = "synthetic-keydown";

export const DEFAULTS = {
  /** Attempts before the driver gives up and reports a failure rather than a silent pass. */
  maxAttempts: 4,
  /** How long one attempt waits for the feature to actually leave the DOM. */
  settleMs: 2_000,
  /** Gap between re-reads. Never zero — the point is to re-read, not to spin. */
  pollMs: 120,
};

/**
 * Is this source text dispatching a synthetic Delete/Backspace keystroke at the app?
 *
 * Used by the source guard in `test/deleteDrive.test.js` so the rule is machine-enforced rather
 * than a paragraph nobody's code consults. Kept pure and deliberately narrow: it looks for a
 * `KeyboardEvent` construction naming Delete or Backspace that is handed to a `dispatchEvent`,
 * which is the exact shape that silently does nothing.
 *
 * @param {string} src
 * @returns {{hit:boolean, snippets:string[]}}
 */
export function findsSyntheticDelete(src) {
  const snippets = [];
  if (typeof src !== "string" || !src) return { hit: false, snippets };
  // A dispatchEvent call whose argument constructs a KeyboardEvent for Delete/Backspace. The two
  // may be split across lines, so match on a window that spans them.
  const re = /dispatchEvent\s*\(\s*new\s+KeyboardEvent\s*\([\s\S]{0,200}?\)/g;
  for (const m of src.matchAll(re)) {
    if (/["'`](?:Delete|Backspace)["'`]/.test(m[0])) snippets.push(m[0].replace(/\s+/g, " ").slice(0, 160));
  }
  // The other spelling: the event is built first, then dispatched.
  const built = /new\s+KeyboardEvent\s*\(\s*["'`]keydown["'`][\s\S]{0,200}?["'`](?:Delete|Backspace)["'`][\s\S]{0,200}?\)/g;
  for (const m of src.matchAll(built)) {
    const tail = src.slice(src.indexOf(m[0]) + m[0].length, src.indexOf(m[0]) + m[0].length + 200);
    if (/dispatchEvent\s*\(/.test(tail)) snippets.push(m[0].replace(/\s+/g, " ").slice(0, 160));
  }
  return { hit: snippets.length > 0, snippets: [...new Set(snippets)] };
}

/**
 * Should the driver try again, stop happy, or fail loudly?
 *
 * @param {{route:string, stillPresent:boolean}[]} attempts  what has been tried, in order
 * @param {number} maxAttempts
 * @returns {{done:boolean, ok:boolean, nextRoute:string|null, why:string}}
 *
 * The three outcomes, and the middle one is the whole point:
 *   • the last attempt left the feature ABSENT → done, ok.
 *   • attempts remain → keep going on the next route (never repeat the route that just failed
 *     silently — a second identical no-op is not new information).
 *   • out of attempts and the feature is still there → done, NOT ok, with a `why` that says which
 *     routes were tried. A driver that runs out of ideas must say so; reporting a pass here is the
 *     defect this module exists to prevent.
 */
export function deleteVerdict(attempts, maxAttempts = DEFAULTS.maxAttempts) {
  const list = Array.isArray(attempts) ? attempts : [];
  const last = list[list.length - 1];
  if (last && last.stillPresent === false) {
    return { done: true, ok: true, nextRoute: null, why: `gone after ${list.length} attempt(s) via ${last.route}` };
  }
  if (list.length >= maxAttempts) {
    return {
      done: true, ok: false, nextRoute: null,
      why: `still present after ${list.length} attempt(s): ${list.map((a) => a.route).join(", ") || "none"}`,
    };
  }
  const tried = new Set(list.map((a) => a.route));
  const nextRoute = DELETE_ROUTES.find((r) => !tried.has(r)) || DELETE_ROUTES[list.length % DELETE_ROUTES.length];
  return { done: false, ok: false, nextRoute, why: `attempt ${list.length + 1} → ${nextRoute}` };
}

/* ── the driver ────────────────────────────────────────────────────────────────────────────── */

const featureSel = (key) => `[data-feature="${key}"]`;

/** Is the feature still on the canvas? A live read, taken fresh every time it is asked. */
export async function featurePresent(page, key) {
  return page.evaluate((sel) => !!document.querySelector(sel), featureSel(key));
}

/** Poll until the feature is absent, or the budget runs out. Returns whether it went. */
export async function waitForFeatureGone(page, key, { settleMs = DEFAULTS.settleMs, pollMs = DEFAULTS.pollMs } = {}) {
  const deadline = Date.now() + settleMs;
  for (;;) {
    if (!(await featurePresent(page, key))) return true;
    if (Date.now() >= deadline) return false;
    await page.waitForTimeout(pollMs);
  }
}

/** Blur whatever field has focus, so the app's typing guard cannot swallow the key. */
export async function blurFields(page) {
  await page.evaluate(() => {
    const t = document.activeElement;
    if (t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "TEXTAREA" || t.isContentEditable)) t.blur();
  });
}

/** Click the feature so it is the live selection. Aims at its box centre, then its top edge —
 *  an unfilled shape (a markup polygon, a parcel ring) is selected by its OUTLINE and a click in
 *  the middle of one passes straight through. */
async function selectFeature(page, key) {
  const node = page.locator(featureSel(key)).first();
  const bb = await node.boundingBox();
  if (!bb) return false;
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.waitForTimeout(150);
  if (await page.evaluate((sel) => !!document.querySelector(`${sel} [data-handle-layer], [data-handle-layer]`), featureSel(key))) return true;
  await page.mouse.click(bb.x + bb.width / 2, bb.y + 1);
  await page.waitForTimeout(150);
  return true;
}

async function pressDeleteKey(page, key) {
  await blurFields(page);
  await selectFeature(page, key);
  await page.keyboard.press("Delete");           // a REAL key event through the driver — never dispatchEvent
}

async function pressPanelDelete(page, key) {
  await blurFields(page);
  const node = page.locator(featureSel(key)).first();
  const bb = await node.boundingBox();
  if (bb) { await page.mouse.dblclick(bb.x + bb.width / 2, bb.y + bb.height / 2); await page.waitForTimeout(400); }
  const btn = page.locator('[data-testid="property-panel"]').getByRole("button", { name: /^Delete/i }).first();
  if (await btn.count()) await btn.click({ timeout: 3_000 }).catch(() => {});
}

async function pressMenuDelete(page, key) {
  await blurFields(page);
  const node = page.locator(featureSel(key)).first();
  const bb = await node.boundingBox();
  if (!bb) return;
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2, { button: "right" });
  await page.waitForTimeout(300);
  const item = page.getByRole("button", { name: /^Delete/i }).first();
  if (await item.count()) await item.click({ timeout: 3_000 }).catch(() => {});
}

const ROUTE_FN = { key: pressDeleteKey, panel: pressPanelDelete, menu: pressMenuDelete };

/**
 * Delete one feature and PROVE it is gone — the only supported way to remove something from a plan
 * from a harness. Escalates key → Properties panel → context menu, re-reading between every
 * attempt, and THROWS rather than reporting a pass it did not earn.
 *
 * @param {import("playwright").Page} page
 * @param {string} key            the feature's `data-feature` value, e.g. `"markup:m7"`
 * @param {{maxAttempts?:number, settleMs?:number, pollMs?:number}} [opts]
 * @returns {Promise<{key:string, attempts:{route:string, stillPresent:boolean}[], why:string}>}
 */
export async function deleteFeatureUntilGone(page, key, opts = {}) {
  const { maxAttempts = DEFAULTS.maxAttempts, settleMs = DEFAULTS.settleMs, pollMs = DEFAULTS.pollMs } = opts;
  if (!(await featurePresent(page, key))) return { key, attempts: [], why: "already absent" };
  const attempts = [];
  for (;;) {
    const v = deleteVerdict(attempts, maxAttempts);
    if (v.done) {
      if (v.ok) return { key, attempts, why: v.why };
      throw new Error(`deleteFeatureUntilGone(${key}): ${v.why} — do NOT report this as deleted`);
    }
    const run = ROUTE_FN[v.nextRoute];
    if (run) await run(page, key);
    // ⛔ RE-READ, and never in the same turn as the action. The DOM read races the re-render.
    const gone = await waitForFeatureGone(page, key, { settleMs, pollMs });
    attempts.push({ route: v.nextRoute, stillPresent: !gone });
  }
}

/**
 * Delete several features and confirm the plan really lost exactly those — the cleanup shape.
 * Reloads at the end and re-reads, because a removal that did not reach storage comes back.
 *
 * @param {import("playwright").Page} page
 * @param {string[]} keys
 * @param {{reload?:boolean, expectAfter?:number|null}} [opts]
 */
export async function deleteFeaturesAndConfirm(page, keys, { reload = true, expectAfter = null } = {}) {
  const done = [];
  for (const key of keys) done.push(await deleteFeatureUntilGone(page, key));
  if (reload) {
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-testid="planner-canvas"]').first().waitFor({ state: "visible", timeout: 30_000 });
    for (const key of keys) {
      if (await featurePresent(page, key)) throw new Error(`${key} came back after a reload — the delete never reached storage`);
    }
  }
  if (expectAfter !== null) {
    const { countFeatures } = await import("./featureCensus.mjs");
    const n = await countFeatures(page);
    if (n !== expectAfter) throw new Error(`plan holds ${n} features after cleanup, expected ${expectAfter}`);
  }
  return done;
}
