/* waitRelease — wait for a selector WITHOUT stranding a protocol handle. (B1439)
 *
 * ⛔ WHY THIS EXISTS, AND IT IS NOT A STYLE PREFERENCE.
 *
 * `page.waitForSelector(sel)` RETURNS an ElementHandle. An ElementHandle is backed by a V8 **global
 * handle in the inspector's object group** — a genuine, strong GC root that the browser must honour
 * until the handle is released. Playwright does not release it for you; ignoring the return value
 * does not dispose it, it only throws away your ability to.
 *
 * And in Blink a `Node` holds a STRONG reference to its PARENT. So one undisposed handle on one
 * `<svg>` pins that element's entire ancestor chain, up to and including a detached tree's root —
 * and the root holds every descendant. **One ignored return value retains a whole app shell.**
 *
 * THAT IS THE ENTIRETY OF B1439. Four attempts, `docs/PERF-PLAN-SWITCH.md`: "~2,342 nodes, ~391 KB
 * and ~106 listeners per round trip, released never … every plan the owner has ever opened in a
 * session is still there." Every one of those numbers came from this line, in the harness, twice per
 * A→B→A round trip:
 *
 *     await page.waitForSelector('[data-testid="planner-canvas"]');   // handle never disposed
 *
 * Disposing it takes the detached count to ZERO and `rendererNodes` and `jsEventListeners` to
 * byte-identical before/after. No app code is involved at any point.
 *
 * Two ways to be safe, both fine, and `test/harnessHandles.test.js` accepts either:
 *   • this helper, or
 *   • `page.locator(sel).waitFor(...)`, which returns no handle at all.
 * Use `waitForSelectorReleased` when you want the selector-wait semantics; use `withElement` when
 * you actually need the element for a moment and want it released afterwards no matter what.
 */

/** Wait for `selector`, then release the handle. Returns whether it appeared — never the handle,
 *  because handing one back is how this bug gets reintroduced. */
export async function waitForSelectorReleased(page, selector, options) {
  let handle = null;
  try {
    handle = await page.waitForSelector(selector, options);
    return !!handle;
  } catch (_) {
    return false;
  } finally {
    /* Dispose in a `finally` so a timeout or a navigation mid-wait cannot strand it either — the
     * failure paths are exactly where a hand-written dispose gets forgotten. */
    if (handle) await handle.dispose().catch(() => {});
  }
}

/** Borrow the element for the duration of `fn`, then release it unconditionally. */
export async function withElement(page, selector, fn, options) {
  let handle = null;
  try {
    handle = await page.waitForSelector(selector, options);
    return await fn(handle);
  } finally {
    if (handle) await handle.dispose().catch(() => {});
  }
}
