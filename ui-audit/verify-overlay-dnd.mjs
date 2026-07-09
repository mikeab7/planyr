/* Self-verification for B445 (affordance) + B736 (depth counter + window reset) —
 * Site-plan overlay drag-and-drop.
 * B445: the overlay panel said "Drop a PDF onto the map" but dropping gave zero feedback and
 * the panel itself wasn't a drop target, so it read as broken.
 * B736: the drag highlight could stick ON after a drag left the window (no window-level reset),
 * and the light-theme fill was opaque (covered geometry). The highlight is now driven by a
 * dragenter/dragleave DEPTH COUNTER (per zone) + a window dragleave/drop safety net.
 *
 * This boots the planner logged-out (this-device mode), opens the References panel, and
 * simulates file drags (a real OS file-drag can't be fired headless, so we dispatch native
 * dragenter/dragleave/drop events carrying a DataTransfer with a real PNG File):
 *   1. dragenter on the PANEL dropzone → the "Drop to add this reference" highlight shows.
 *   2. dragenter on the CANVAS → the "Drop site plan to place it on the map" hint mounts.
 *   3. drop on the panel → preventDefault fires (no browser navigation) AND a new overlay
 *      is added (a row with the file name appears).
 *   4. dragleave → the canvas hint clears.
 *   B736a. enter×2 (wrapper + bubbled child SVG) then ONE child dragleave keeps the hint
 *          (counter > 0, no child-crossing flicker); clears only when depth returns to 0.
 *   B736b. a stuck highlight (unbalanced enter, simulating an OS window-exit whose final
 *          dragleave misses the wrapper) is cleared by a window dragleave that left the window.
 *   B736c. a window drop (missed / aborted) preventDefaults + resets the hint.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const DEMO_ID = "verify-overlay-dnd";
const parcel = { id: "pc1", locked: false, points: [{ x: -700, y: -450 }, { x: 700, y: -450 }, { x: 700, y: 450 }, { x: -700, y: 450 }] };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify Overlay DnD", name: "Plan 1",
  origin: null, county: null, parcels: [parcel], els: [], measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1400);

// Open the References panel via its rail button (B654 merged Aerial + Overlay → "References").
try { await page.locator('[title="References"]').first().click({ timeout: 5000 }); } catch (e) { console.warn("references-tab warn", e.message); }
await page.waitForTimeout(400);

// In-page helper: dispatch a native drag event carrying a DataTransfer (+ optional PNG file)
// at the target element, and report whether the handler called preventDefault. We assign
// .dataTransfer onto a plain Event (robust across Chromium versions) so React's synthetic
// event exposes e.dataTransfer / e.dataTransfer.files exactly as a real drag would.
const fire = (selectorKind, type, withFile) => page.evaluate(({ selectorKind, type, withFile }) => {
  const target = selectorKind === "canvas"
    ? document.querySelector('svg[aria-label="Site plan canvas"]')?.parentElement
    : [...document.querySelectorAll("button")].find((b) => /Add reference|Add site plan/i.test(b.textContent || ""))?.parentElement;
  if (!target) return { ok: false, reason: "target-not-found:" + selectorKind };
  const dt = new DataTransfer();
  if (withFile) {
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    dt.items.add(new File([arr], "plan.png", { type: "image/png" }));
  } else {
    // A file-less drag still must advertise the "Files" type so our guard engages.
    try { dt.items.add("x", "text/plain"); } catch (e) {}
  }
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: dt });
  target.dispatchEvent(ev);
  return { ok: true, prevented: ev.defaultPrevented, types: Array.from(dt.types || []) };
}, { selectorKind, type, withFile });

// B736 superset of `fire`: can target the child <svg>, the canvas wrapper, the panel, and the
// window, and can set relatedTarget:null / clientX / clientY so the window "left the window?"
// net (relatedTarget==null AND coords at/past a viewport edge) can be exercised. A File is added
// by default (so the "Files" type is present); pass { withFile: false } to omit it.
const fireDnD = (kind, type, opts = {}) => page.evaluate(({ kind, type, opts }) => {
  const svg = document.querySelector('svg[aria-label="Site plan canvas"]');
  const target =
    kind === "window" ? window :
    kind === "svg"    ? svg :
    kind === "canvas" ? svg?.parentElement :
    [...document.querySelectorAll("button")].find((b) => /Add reference|Add site plan/i.test(b.textContent || ""))?.parentElement;
  if (!target) return { ok: false, reason: "target-not-found:" + kind };
  const dt = new DataTransfer();
  if (opts.withFile !== false) {
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const bin = atob(b64); const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    dt.items.add(new File([arr], "plan.png", { type: "image/png" }));
  } else { try { dt.items.add("x", "text/plain"); } catch (e) {} }
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "dataTransfer", { value: dt });
  if ("relatedNull" in opts) Object.defineProperty(ev, "relatedTarget", { value: null });
  if ("clientX" in opts) Object.defineProperty(ev, "clientX", { value: opts.clientX });
  if ("clientY" in opts) Object.defineProperty(ev, "clientY", { value: opts.clientY });
  target.dispatchEvent(ev);
  return { ok: true, prevented: ev.defaultPrevented };
}, { kind, type, opts });

const seesText = (re) => page.evaluate((src) => {
  const rx = new RegExp(src, "i");
  return [...document.querySelectorAll("body *")].some((el) => el.children.length === 0 && rx.test(el.textContent || ""));
}, re.source);

// The overlay row is a button whose title is `${name} — right-click for …` (B654 panel), so
// match the filename PREFIX rather than an exact title.
const overlayRowCount = () => page.evaluate(() =>
  [...document.querySelectorAll('button[title^="plan.png"]')].length);

let fail = 0;
const check = (name, cond, extra = "") => { console.log(`${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!cond) fail++; };

// 1. Panel dropzone highlight on dragenter (dragover no longer sets the flag — depth counter).
const r1 = await fire("panel", "dragenter", true);
await page.waitForTimeout(150);
const panelHi = await seesText(/Drop to add this reference/);
await page.screenshot({ path: OUT + "overlay-dnd-panel-hover.png" });
check("panel dragenter engages (preventDefault)", r1.ok && r1.prevented, JSON.stringify(r1));
check("panel shows 'Drop to add this reference' highlight", panelHi);

// 2. Canvas "drop to place" hint on dragenter.
const r2 = await fire("canvas", "dragenter", true);
await page.waitForTimeout(150);
const canvasHint = await seesText(/Drop site plan to place it on the map/);
await page.screenshot({ path: OUT + "overlay-dnd-canvas-hint.png" });
check("canvas dragenter engages (preventDefault)", r2.ok && r2.prevented, JSON.stringify(r2));
check("canvas shows 'Drop site plan to place it on the map' hint", canvasHint);

// 4 (tested before the drop): a balanced dragleave (carrying Files) clears the canvas hint.
await fire("canvas", "dragleave", true);
await page.waitForTimeout(150);
const hintCleared = !(await seesText(/Drop site plan to place it on the map/));
check("canvas hint clears on dragleave", hintCleared);

// 3. Drop a real PNG on the panel → preventDefault + a new overlay row appears.
const before = await overlayRowCount();
const r3 = await fire("panel", "drop", true);
await page.waitForTimeout(2000); // addOverlayFile rasterizes the image asynchronously
const after = await overlayRowCount();
await page.screenshot({ path: OUT + "overlay-dnd-after-drop.png" });
check("panel drop calls preventDefault (no browser navigation)", r3.ok && r3.prevented, JSON.stringify(r3));
check("dropping a file ADDS an overlay (row appears)", after > before, `rows ${before}→${after}`);

// ── B736 Part B: depth-counter robustness + window-level reset ──────────────────
// (a) Two dragenters (wrapper + bubbled child SVG) then ONE child dragleave must NOT clear —
//     the child's own bubbling drag events would otherwise flicker the hint off mid-hover.
await fireDnD("canvas", "dragenter");           // wrapper enter → depth 1
await fireDnD("svg", "dragenter");              // child enter (bubbles) → depth 2
await page.waitForTimeout(120);
const nestedShown = await seesText(/Drop site plan to place it on the map/);
await fireDnD("svg", "dragleave");             // child leave (bubbles) → depth 1
await page.waitForTimeout(120);
const stillShown = await seesText(/Drop site plan to place it on the map/);
check("counter: enter×2 then one child leave keeps the hint (no child-crossing flicker)", nestedShown && stillShown);
await fireDnD("canvas", "dragleave");          // wrapper leave → depth 0
await page.waitForTimeout(120);
const clearedAtZero = !(await seesText(/Drop site plan to place it on the map/));
check("counter: hint clears only when depth returns to 0", clearedAtZero);

// (b) A stuck highlight (unbalanced enter — the OS window-exit whose final dragleave misses
//     the wrapper) is cleared by a window dragleave that left the window entirely.
await fireDnD("canvas", "dragenter");           // depth 1, hint on — no matching wrapper leave
await page.waitForTimeout(80);
const stuckOn = await seesText(/Drop site plan to place it on the map/);
await fireDnD("window", "dragleave", { relatedNull: true, clientX: 0, clientY: 0 });
await page.waitForTimeout(120);
const clearedByWindow = !(await seesText(/Drop site plan to place it on the map/));
check("window dragleave (relatedTarget=null, coords outside) clears the stuck hint", stuckOn && clearedByWindow);

// (c) A drop reaching the window (missed / aborted) preventDefaults + resets the hint.
await fireDnD("canvas", "dragenter");           // hint on again
await page.waitForTimeout(80);
const onBeforeWinDrop = await seesText(/Drop site plan to place it on the map/);
const rWinDrop = await fireDnD("window", "drop");
await page.waitForTimeout(120);
const clearedByDrop = !(await seesText(/Drop site plan to place it on the map/));
check("window drop calls preventDefault + resets the hint", rWinDrop.prevented && onBeforeWinDrop && clearedByDrop);

console.log(fail === 0 ? "\n✓ ALL OVERLAY-DND CHECKS PASSED" : `\n✗ ${fail} CHECK(S) FAILED`);
await ctx.close();
await browser.close();
process.exit(fail === 0 ? 0 : 1);
