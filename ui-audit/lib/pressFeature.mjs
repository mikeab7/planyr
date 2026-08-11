/* pressFeature — THE ONLY SUPPORTED WAY TO DRIVE A PRESS ON THE NOTES PAGE.
 *
 * ⛔ WHY THIS EXISTS. A harness reported that the placement gesture had stopped working
 * entirely: eight blocks an hour earlier, none now, same instrument, same coordinates. It was
 * a COMPARATIVE result and it was still an instrument artefact — and it took a real-input run
 * to say so, which is exactly the round trip this file exists to remove.
 *
 * THE CAUSE, and it is one word: the placement moved from `dblclick` to `mousedown`. A driver
 * that dispatches a synthetic `click` or `dblclick` never produces a `mousedown` at all, so it
 * reaches nothing — silently, with the right element under the cursor and the editor focused.
 * Every symptom of a broken feature and none of the cause.
 *
 * ⛔ SO THE RULE IS THE SAME ONE `deleteFeature.mjs` STATES FOR THE KEYBOARD: never dispatch a
 * synthetic event to drive a gesture. Use the driver's real mouse. `verify-press-drive.mjs`
 * re-measures the verdict table against the real app on every run, so "synthetic events do not
 * work here" is a measurement rather than folklore — and so the day the wiring changes, the
 * table says so instead of a harness quietly reporting a feature as broken.
 */

/** Where a document-space point is on the screen right now, at the live zoom. */
export const clientOf = (page, docX, docY) => page.evaluate(([dx, dy]) => {
  const dom = document.querySelector('[data-testid="note-body"]');
  if (!dom) return null;
  const r = dom.getBoundingClientRect();
  const scale = r.width / (dom.offsetWidth || 1) || 1;
  return { x: Math.round(r.left + dx * scale), y: Math.round(r.top + dy * scale) };
}, [docX, docY]);

/** Every anchored block on the page, in document space. */
export const blocksOn = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="note-anchor"]')].map((el) => ({
    left: parseFloat(el.style.left),
    top: parseFloat(el.style.top),
    empty: el.getAttribute("data-empty") === "1",
    text: el.innerText.trim(),
  })));

/**
 * Press at a document-space point with the REAL mouse, and return the block it made.
 *
 * ⛔ IT RE-READS RATHER THAN ASSUMING, and it THROWS rather than reporting a pass it did not
 * earn — the same discipline `deleteFeatureUntilGone` follows. A press that produced nothing is
 * a failure to report, never a silent null the caller folds into a count.
 */
export async function pressAt(page, docX, docY, { type = "", timeout = 2000 } = {}) {
  const c = await clientOf(page, docX, docY);
  if (!c) throw new Error("pressAt: there is no note body on this page");
  await page.mouse.click(c.x, c.y);
  const deadline = Date.now() + timeout;
  for (;;) {
    if (type) await page.keyboard.type(type);
    const blocks = await blocksOn(page);
    const hit = blocks.find((b) => b.left === docX && b.top === docY);
    if (hit) return hit;
    if (Date.now() > deadline) {
      throw new Error(`pressAt: no block at (${docX}, ${docY}) after a real press — ${blocks.length} block(s) on the page`);
    }
    await page.waitForTimeout(60);
  }
}
