/* Verify B321 — the Stitcher pan crash ("Cannot read properties of null (reading 'panX')").
 *
 * The pan setView updater used to read drag.current INSIDE the deferred updater; an aborted
 * gesture (pointerup / pointercancel / the blur/visibility recovery) nulled the ref before
 * React ran the updater → null deref in the render phase → the whole Document Review subtree
 * hit the error boundary ("Document Review hit an error and couldn't load"). The fix captures
 * the origin into a local and closes over it (panTo). No PDF needed — panning works on the
 * empty world canvas (onDown sets drag.current for tool 'pan' regardless of placed sheets).
 *
 * Asserts on the REAL built app (logged-out): (1) a normal pan moves the world transform;
 * (2) firing blur / visibilitychange / pointercancel mid-pan never trips the error boundary
 * and never throws a 'panX' page error, across many iterations; (3) pan still works after.
 *
 * Run:  npm run build && npx vite preview --port 4173   (one shell)
 *       node ui-audit/verify-b317-pan.mjs               (another)
 */
const pw = await import("/opt/node22/lib/node_modules/playwright/index.js");
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fails = [];
const check = (cond, msg) => { console.log((cond ? "  ✓ " : "  ✗ ") + msg); if (!cond) fails.push(msg); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await sleep(1200);

// Enter Document Review (Markup), then switch to the Stitch view.
await page.locator('button:has-text("Markup")').first().click({ timeout: 8000 });
await sleep(700);
await page.locator('button:has-text("Stitch")').first().click({ timeout: 8000 }); // "Stitch ▸"
await sleep(800);

const bodyText = () => page.evaluate(() => document.body.innerText);
const panXErrors = () => pageErrors.filter((e) => /reading 'panX'|reading "panX"|panX/.test(e));

// The world canvas = the largest <svg> in the stitcher. Read its pan/zoom transform group.
const canvasRect = () => page.evaluate(() => {
  const s = [...document.querySelectorAll("svg")].map((el) => ({ el, r: el.getBoundingClientRect() }))
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
  if (!s) return null; const r = s.r; return { x: r.x, y: r.y, w: r.width, h: r.height };
});
const worldTransform = () => page.evaluate(() => {
  const svg = [...document.querySelectorAll("svg")].map((el) => ({ el, r: el.getBoundingClientRect() }))
    .sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
  if (!svg) return null;
  const g = svg.el.querySelector("g[transform^='translate']");
  return g ? g.getAttribute("transform") : null;
});

const rect = await canvasRect();
check(!!rect && rect.w > 300, `stitcher world canvas is present (${rect ? Math.round(rect.w) + "x" + Math.round(rect.h) : "none"})`);
const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;

/* (1) a normal pan moves the world transform */
const before = await worldTransform();
await page.mouse.move(cx, cy); await page.mouse.down();
await page.mouse.move(cx + 60, cy + 45, { steps: 4 });
await page.mouse.move(cx + 120, cy + 90, { steps: 4 });
await page.mouse.up();
await sleep(150);
const after = await worldTransform();
check(before && after && before !== after, `a normal pan changes the world transform (\n      before: ${before}\n      after:  ${after})`);

/* (2) abort the gesture mid-pan, many times, with blur / visibilitychange / pointercancel */
console.log("\nB321 — mid-pan aborts must NOT crash the stitcher:");
for (let i = 0; i < 12; i++) {
  await page.mouse.move(cx, cy); await page.mouse.down();
  await page.mouse.move(cx + 20 + i, cy + 15, { steps: 2 });
  // fire the discrete aborts that null drag.current, interleaved with more continuous moves
  await page.evaluate(() => {
    const svg = [...document.querySelectorAll("svg")].sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    window.dispatchEvent(new Event("blur"));
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
    if (svg) svg.dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }));
  });
  await page.mouse.move(cx + 40 + i, cy + 30, { steps: 2 }); // a move AFTER the abort (ref now null)
  await page.mouse.up();
  await page.evaluate(() => Object.defineProperty(document, "hidden", { configurable: true, get: () => false }));
  await sleep(40);
}
const txt = await bodyText();
check(!/hit an error and couldn't load/i.test(txt), "error boundary did NOT appear after 12 mid-pan aborts");
check(panXErrors().length === 0, `no 'panX' null-deref page error (saw ${panXErrors().length})`);

/* (3) pan still works after all the aborts */
const before2 = await worldTransform();
await page.mouse.move(cx, cy); await page.mouse.down();
await page.mouse.move(cx - 70, cy - 40, { steps: 4 }); await page.mouse.up();
await sleep(150);
const after2 = await worldTransform();
check(after2 && before2 !== after2, "pan still works after the aborts (transform changed again)");

console.log("\n" + (fails.length ? `✗ ${fails.length} FAILED` : "✓ ALL PASSED") + `  (page errors: ${pageErrors.length})`);
if (pageErrors.length) console.log("  pageerrors:\n   " + pageErrors.slice(0, 6).join("\n   "));
await browser.close();
process.exit(fails.length ? 1 : 0);
