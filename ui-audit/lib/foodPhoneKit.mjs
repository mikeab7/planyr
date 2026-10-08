/* foodPhoneKit — the pieces a Food phone harness needs that are not the assertions: a painted stand-in for
 * satellite tiles (so a covered pin is visible in a screenshot), the iOS keyboard model (visualViewport
 * shrinks, innerHeight follows it, as WebKit does — see verify-food-ios-screens.mjs for the telemetry behind
 * that model), safe-area injection for Chromium, and `openFood`. First used by verify-food-landscape (B2046224 ×4). */
import { deflateSync } from "node:zlib";
import { assertMeasurable } from "./tabTiming.mjs";
import { makeFixture, installFixture, STORAGE_KEY } from "./foodFixture.mjs";

function crc32(buf) { let c, crc = 0xffffffff; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xffffffff) >>> 0; }
function chunk(type, data) { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td)); return Buffer.concat([len, td, crc]); }
export const TILE = (() => {
  const W = 256, raw = Buffer.alloc((W * 3 + 1) * W);
  for (let y = 0; y < W; y++) {
    raw[y * (W * 3 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const n = (Math.sin(x * 0.11) + Math.cos(y * 0.07) + Math.sin((x + y) * 0.05)) * 18;
      const road = (x % 64 < 3 || y % 80 < 3) ? 60 : 0;
      const o = y * (W * 3 + 1) + 1 + x * 3;
      raw[o] = 70 + n + road; raw[o + 1] = 92 + n + road; raw[o + 2] = 58 + n * 0.6 + road;
    }
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
})();

/** Runs in the page before anything else. `kbPx` is a function of orientation so one context can rotate. */
export const IOS_MODEL = ({ kbPortrait, kbLandscape }) => {
  const ihDesc = Object.getOwnPropertyDescriptor(window, "innerHeight") || Object.getOwnPropertyDescriptor(Window.prototype, "innerHeight");
  const layoutH = () => ihDesc.get.call(window);
  const vv = new EventTarget();
  let kb = 0;
  Object.defineProperties(vv, {
    width: { get: () => innerWidth }, height: { get: () => layoutH() - kb },
    offsetTop: { get: () => 0 }, offsetLeft: { get: () => 0 }, scale: { get: () => 1 }, pageTop: { get: () => 0 }, pageLeft: { get: () => 0 },
  });
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  Object.defineProperty(window, "innerHeight", { get: () => layoutH() - kb, configurable: true });
  const fire = () => { vv.dispatchEvent(new Event("resize")); vv.dispatchEvent(new Event("scroll")); };
  const opens = (el) => el && ((el.tagName === "INPUT" && !/^(range|button|submit|checkbox|radio|reset|file|color)$/i.test(el.type)) || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
  const height = () => (innerWidth > layoutH() ? kbLandscape : kbPortrait);
  window.__kb = { band: () => ({ top: 0, bottom: layoutH() - kb }), get open() { return kb > 0; }, get px() { return kb; }, set: (px) => { kb = px; fire(); } };
  document.addEventListener("focusin", (e) => { if (opens(e.target)) setTimeout(() => { if (!window.__kb.open) window.__kb.set(height()); }, 60); });
  document.addEventListener("focusout", () => setTimeout(() => { if (!opens(document.activeElement)) window.__kb.set(0); }, 60));
};

/** A Chromium context with synthetic safe-area insets (WebKit cannot; its env() is 0 — docs/PHONE-TESTING.md #2). */
export async function setSafeAreas(context, page, insets) {
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setSafeAreaInsetsOverride", { insets });
  return cdp;
}
export const readSafeAreas = (page) => page.evaluate(() => {
  const d = document.createElement("div");
  d.style.cssText = "position:fixed;visibility:hidden;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)";
  document.body.appendChild(d);
  const cs = getComputedStyle(d);
  const r = { top: parseFloat(cs.paddingTop), right: parseFloat(cs.paddingRight), bottom: parseFloat(cs.paddingBottom), left: parseFloat(cs.paddingLeft) };
  d.remove();
  return r;
});

export async function openFood(browser, contextOptions, { base, harness, kbPortrait = 380, kbLandscape = 240, insets = null, fixture = { aburi: true }, signedOut = false }) {
  const ctx = await browser.newContext({ ...contextOptions, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  const state = makeFixture(fixture);
  await installFixture(page, state);
  await page.route("**/*", (route) => {
    const req = route.request();
    let u; try { u = new URL(req.url()); } catch (_) { return route.fallback(); }
    if (req.resourceType() === "image" && !/localhost|127\.0\.0\.1|supabase/.test(u.hostname)) return route.fulfill({ status: 200, contentType: "image/png", body: TILE, headers: { "access-control-allow-origin": "*" } });
    return route.fallback();
  });
  if (signedOut) await page.addInitScript((k) => { try { window.localStorage.removeItem(k); } catch (_) {} }, STORAGE_KEY); // after installFixture's own seeding
  await page.addInitScript(IOS_MODEL, { kbPortrait, kbLandscape });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  if (insets) await setSafeAreas(ctx, page, insets);
  await page.goto(`${base}/#/food`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="food-map"]', { timeout: 20000 });
  await assertMeasurable(page, harness);
  await page.waitForTimeout(1200);
  return { ctx, page, errs, state };
}
