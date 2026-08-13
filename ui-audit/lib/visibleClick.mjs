/* B463922 — DRIVER-SCROLL IS NOT APP-SCROLL. A CLICK ON AN OFF-SCREEN TARGET MEASURES THE DRIVER.
 *
 * ⛔ WHY THIS EXISTS, and it is the sixth entry on the diagnose harness's own list of lies.
 * The committed reproduction of B463922 clicked `[title="Collapse"]` on the FIRST rendered row of
 * a VIRTUALISED grid. A virtualiser renders a buffer of rows ABOVE the viewport, so that toggle sat
 * 75px above the top edge — off screen. Playwright (like every browser driver) scrolls a target into
 * view before clicking it, through CDP, which no patched `scrollTop` setter can see. So the harness
 * scrolled the container itself, then reported the resulting movement as the app throwing the edited
 * row 477px down the screen, with "programmatic writes: 0" as corroboration.
 *
 * The three measurements that settle it, on the same build:
 *   Playwright click, toggle 75px ABOVE the viewport   → row moves +477px   scrollTop −501
 *   JS .click() on the SAME toggle (no driver scroll)  → row moves  −24px   scrollTop    0   ← correct
 *   Playwright click, a toggle INSIDE the viewport     → row moves  −48px   scrollTop    0   ← correct
 * and the direction follows the target: a toggle below the viewport moved the row the other way
 * (+459 scrollTop). It is the driver, every time.
 *
 * A human cannot click a control they cannot see. So a harness that clicks one is not driving the
 * product — and its numbers describe its own scrolling, in the safe-looking direction.
 *
 * THE RULE: inside a scroll container, click only what is genuinely visible. `visibleClick` proves
 * the target is inside the container's viewport BEFORE clicking and THROWS if it is not, naming how
 * far outside it sat. `assertNoDriverScroll` wraps any action and fails if the container's scroll
 * position moved during it without the app writing it — the same lie caught from the other side.
 */

/**
 * The verdict itself — PURE geometry, so it is unit-testable without a browser.
 * `box` is the target's {y, height}; `rect` is the scroll container's {top, bottom}.
 */
export function visibilityVerdict(box, rect) {
  if (!box) return { visible: false, reason: "the target has no box (not rendered)", offset: null };
  if (!rect) return { visible: false, reason: "no scroll container to measure against", offset: null };
  const above = rect.top - box.y;                       // >0 → the target starts above the viewport
  const below = (box.y + box.height) - rect.bottom;     // >0 → it ends below the viewport
  if (above > 0.5) return { visible: false, reason: `${Math.round(above)}px ABOVE the container viewport`, offset: -Math.round(above) };
  if (below > 0.5) return { visible: false, reason: `${Math.round(below)}px BELOW the container viewport`, offset: Math.round(below) };
  return { visible: true, reason: "inside the container viewport", offset: Math.round(box.y - rect.top) };
}

/** Where a locator sits relative to a scroll container. Geometry only; no clicking. */
export async function targetVisibility(page, containerSel, locator) {
  const box = await locator.boundingBox();
  const rect = await page.evaluate(sel => {
    const g = document.querySelector(sel); if (!g) return null;
    const r = g.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
  }, containerSel);
  if (box && !rect) return { visible: false, reason: `no scroll container matches ${containerSel}`, offset: null };
  return visibilityVerdict(box, rect);
}

/**
 * Click a locator ONLY if it is genuinely inside the scroll container's viewport.
 * Throws otherwise — a driver that scrolls to reach its target is measuring itself.
 */
export async function visibleClick(page, containerSel, locator, label = "target") {
  const v = await targetVisibility(page, containerSel, locator);
  if (!v.visible) {
    throw new Error(
      `visibleClick refused: ${label} is ${v.reason}. A driver scrolls an off-screen target into ` +
      `view before clicking it, and that scroll would be misread as the app moving the view ` +
      `(B463922). Scroll the container yourself, re-query, then click.`);
  }
  await locator.click();
  return v;
}

/**
 * Run `fn` and fail if the container's scroll position moved without the app writing it.
 * `installScrollWitness` must have run on the page first.
 */
export async function assertNoDriverScroll(page, containerSel, fn, label = "action") {
  const before = await page.evaluate(sel => document.querySelector(sel).scrollTop, containerSel);
  await page.evaluate(() => { window.__scrollWitness && (window.__scrollWitness.writes.length = 0); });
  await fn();
  const after = await page.evaluate(sel => document.querySelector(sel).scrollTop, containerSel);
  const writes = await page.evaluate(() => (window.__scrollWitness ? window.__scrollWitness.writes.slice() : null));
  if (writes === null) throw new Error("assertNoDriverScroll needs installScrollWitness(page, sel) first");
  const moved = Math.abs(after - before) > 1;
  const appMoved = writes.length > 0;
  if (moved && !appMoved) {
    throw new Error(
      `${label}: the container scrolled ${before} → ${after} with NO app write — that is the DRIVER ` +
      `scrolling (or the browser), not the product. Any measurement taken across it is void (B463922).`);
  }
  return { before, after, writes };
}

/** Record every programmatic scroll write on the container, so a browser/driver scroll is separable. */
export async function installScrollWitness(page, containerSel) {
  await page.evaluate(sel => {
    const g = document.querySelector(sel);
    if (!g) throw new Error("installScrollWitness: no container " + sel);
    const d = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
    const w = { writes: [], raw: () => Math.round(d.get.call(g)) };
    window.__scrollWitness = w;
    Object.defineProperty(g, "scrollTop", { configurable: true,
      get() { return d.get.call(this); },
      set(v) {
        const f = d.get.call(this);
        if (Math.abs(v - f) > 1) w.writes.push({ from: Math.round(f), to: Math.round(v) });
        return d.set.call(this, v);
      } });
  }, containerSel);
}
