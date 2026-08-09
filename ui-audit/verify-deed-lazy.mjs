/* The deed workflow still works after its parser + alignment solver moved behind a dynamic import.
 *
 * WHY THIS EXISTS: `lib/deedParse.js` and `lib/deedAlign.js` were split out of the boot path and are
 * now reached through `lib/deedLazy.js` (a cached `import()` + a synchronous accessor). Everything
 * downstream — the title reader's LIVE preview while you type, "Plot on canvas", the POB click that
 * builds the encumbrance — used to call those functions synchronously at module scope. A unit test
 * cannot see any of that, so this drives it in a real browser, logged out, on a blank site.
 *
 *   node ui-audit/verify-deed-lazy.mjs
 * Exits non-zero on any failed check.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE || "http://localhost:4173/";
const OUT = new URL("./screens/deed-lazy/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// A small real-shaped Texas traverse that closes: 300' E, 200' S, 300' W, 200' N.
const DEED = [
  "BEGINNING at a point for corner;",
  "THENCE North 90°00'00\" East, 300.00 feet to a point for corner;",
  "THENCE South 00°00'00\" East, 200.00 feet to a point for corner;",
  "THENCE South 90°00'00\" West, 300.00 feet to a point for corner;",
  "THENCE North 00°00'00\" West, 200.00 feet to the POINT OF BEGINNING.",
].join("\n");

const fails = [];
const check = (name, ok, detail = "") => {
  (ok ? console.log : (m) => { console.log(m); fails.push(name); })(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
const SITE_ID = "deed-lazy";
await ctx.addInitScript(`(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [SITE_ID]: {
    id: SITE_ID, groupId: SITE_ID, site: "Deed check", name: "Lazy", origin: null, county: "waller",
    parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
    parcelDrawings: [], updatedAt: Date.now(),
  } })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SITE_ID)});
} catch (e) {} })();`);
const page = await ctx.newPage();
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-deed-lazy");
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 });
await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 30000 });

// The deed chunks must NOT be on the boot path — that is the whole point of the split.
const bootChunks = await page.evaluate(() =>
  [...document.querySelectorAll("script[src], link[rel=modulepreload]")].map((n) => n.src || n.href));
check("the deed parser is NOT fetched at boot",
  !bootChunks.some((u) => /deedParse|deedAlign/.test(u)), bootChunks.filter((u) => /deed/.test(u)).join(","));

// Open the title reader: Parcel rail button → its menu → "Deed / Title — metes & bounds…".
await page.locator('button.rbtn:has-text("Parcel tools")').first().click();
await page.waitForTimeout(400);
await page.locator('[data-testid="boundary-menu-mb"]').click();
await page.waitForTimeout(900);
const modal = await page.evaluate(() => {
  const h = [...document.querySelectorAll("h2")].find((x) => /metes-and-bounds/i.test(x.textContent || ""));
  return !!h;
});
check("the title reader / metes-and-bounds modal opens", modal);

if (modal) {
  // Typing into the textarea drives a SYNCHRONOUS preview that now reads the lazily-loaded module.
  const ta = page.locator("textarea").first();
  await ta.fill(DEED);
  await page.waitForTimeout(700);
  const text = await page.evaluate(() => {
    const h = [...document.querySelectorAll("h2")].find((x) => /metes-and-bounds/i.test(x.textContent || ""));
    return h ? h.closest("div").parentElement.innerText : "";
  });
  check("the live preview counts the calls once the parser lands", /\b4\b/.test(text), text.replace(/\n/g, " / ").slice(0, 180));
  check("the traverse is reported as closing", /clos/i.test(text), text.replace(/\n/g, " / ").slice(0, 180));
  await page.screenshot({ path: `${OUT}title-reader.png` });

  // Plot it: arm POB placement, then click the canvas to anchor.
  // "Plot on canvas →" specifically — "Plot as easement →" sits beside it and spawns a
  // first-class Easement instead of the encumbrance markup this check is about.
  await page.getByRole("button", { name: /^Plot on canvas/ }).click();
  await page.waitForTimeout(600);
  const box = await page.locator('[data-testid="planner-canvas"]').boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.waitForTimeout(900);
  const plotted = await page.evaluate(() => {
    const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const mk = (Object.values(m)[0]?.markups || []).filter((x) => x.kind === "encumbrance");
    return mk.map((x) => ({ n: (x.pts || []).length, closed: x.closed, label: x.label }));
  });
  check("clicking the point of beginning plots the deed as an encumbrance",
    plotted.length === 1 && plotted[0].n === 4 && plotted[0].closed === true, JSON.stringify(plotted));
  await page.screenshot({ path: `${OUT}plotted.png` });
}

check("no uncaught page errors", errs.length === 0, errs.join(" | "));
await ctx.close();
await browser.close();
console.log(`\nScreens → ${OUT}`);
if (fails.length) { console.log(`\n${fails.length} FAILED:\n - ${fails.join("\n - ")}`); process.exit(1); }
console.log("\nAll checks passed.");
