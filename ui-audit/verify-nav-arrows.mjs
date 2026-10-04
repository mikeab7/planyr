/* NAV-ARROWS — phone header strip chevrons must PAGE and CLAMP.
 * Owner report 2026-10-03 (iPhone): the module tab strip's left arrow "took him too far over".
 * For each header row that shows chevrons, at 390 and 430 CSS px (+ a desktop control that must
 * show none): tap RIGHT until the chevron disappears, assert scrollLeft === max and the last
 * child is fully inside the strip; tap LEFT back until it disappears, assert scrollLeft === 0 and
 * the first child is fully inside. Also taps twice rapidly (smooth-scroll stacking) and asserts
 * the landing is still within [0,max]. Known-good arm: the desktop run must report ZERO chevrons.
 * Run: npx vite --port 5199 & BASE_URL=http://localhost:5199/ node ui-audit/verify-nav-arrows.mjs */
import { chromium, webkit } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5199/";
const EXEC = process.env.PW_CHROME || undefined;
const results = [];
const check = (n, p, d = "") => { results.push(p); console.log(`  ${p ? "✅ PASS" : "❌ FAIL"} — ${n}${d ? "  · " + d : ""}`); };

const WK = process.env.ENGINE === "webkit"; // say "WebKit", never "iPhone" — see docs/PHONE-TESTING.md
const browser = WK ? await webkit.launch() : await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });

async function strips(page) {
  // Every horizontally scrolling header strip that owns chevrons: the scroller is the previous
  // sibling's scroll container of a "Scroll left/right" button pair's wrapper.
  return page.evaluate(() => [...document.querySelectorAll("header .no-hscrollbar")].map((el, i) => { el.dataset.navStrip = String(i); return i; }));
}
const read = (page, i) => page.evaluate((i) => {
  const el = document.querySelector(`[data-nav-strip="${i}"]`);
  const r = el.getBoundingClientRect();
  const kids = [...el.querySelectorAll("button")].filter((b) => !b.getAttribute("aria-label")?.startsWith("Scroll"));
  const first = kids[0]?.getBoundingClientRect(), last = kids[kids.length - 1]?.getBoundingClientRect();
  const wrap = el.parentElement;
  const has = (side) => !!wrap.querySelector(`button[aria-label="Scroll ${side}"]`);
  return { sl: el.scrollLeft, max: el.scrollWidth - el.clientWidth, left: has("left"), right: has("right"),
    firstIn: first ? first.left >= r.left - 0.5 : true, lastIn: last ? last.right <= r.right + 0.5 : true };
}, i);
const tap = async (page, i, side) => {
  await page.evaluate((i) => document.querySelector(`[data-nav-strip="${i}"]`).parentElement.querySelector("button[aria-label^='Scroll']")?.scrollIntoView?.(), i);
  await page.evaluate(([i, side]) => document.querySelector(`[data-nav-strip="${i}"]`).parentElement.querySelector(`button[aria-label="Scroll ${side}"]`).click(), [i, side]);
};

for (const [w, mobile] of [[390, true], [430, true], [1280, false]]) {
  console.log(`\n== ${w}px ${mobile ? "phone" : "desktop (control)"} ==`);
  const ctx = await browser.newContext({ viewport: { width: w, height: 844 }, deviceScaleFactor: 3, isMobile: mobile, hasTouch: mobile });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("header", { timeout: 30000 });
  await pacedWait(page, 1500);
  await assertMeasurable(page, "verify-nav-arrows");
  const ids = await strips(page);
  let chevStrips = 0;
  for (const i of ids) {
    let s = await read(page, i);
    if (!s.left && !s.right) continue;
    chevStrips++;
    console.log(`  strip ${i}: scrollLeft ${s.sl} / max ${s.max}`);
    // Rapid double tap first (stacking), from the start.
    for (let n = 0; n < 12 && (await read(page, i)).right; n++) { await tap(page, i, "right"); await pacedWait(page, 700); }
    s = await read(page, i);
    check(`${w}/strip${i}: right end → scrollLeft == max`, Math.abs(s.sl - s.max) <= 1 && !s.right, `sl=${s.sl} max=${s.max}`);
    check(`${w}/strip${i}: last tab unclipped at right end`, s.lastIn);
    for (let n = 0; n < 12 && (await read(page, i)).left; n++) { await tap(page, i, "left"); await pacedWait(page, 700); }
    s = await read(page, i);
    check(`${w}/strip${i}: left end → scrollLeft == 0`, s.sl === 0 && !s.left, `sl=${s.sl}`);
    check(`${w}/strip${i}: first tab unclipped at left end`, s.firstIn);
    // Stacked rapid taps must still land inside [0,max] and keep arrows truthful after settling.
    await tap(page, i, "right"); await tap(page, i, "right"); await pacedWait(page, 1200);
    s = await read(page, i);
    check(`${w}/strip${i}: two rapid taps stay in range`, s.sl >= 0 && s.sl <= s.max + 1, `sl=${s.sl}`);
    check(`${w}/strip${i}: arrows match position after settle`, s.left === (s.sl > 1) && s.right === (s.sl < s.max - 1), `sl=${s.sl} max=${s.max} L=${s.left} R=${s.right}`);
    // One left tap from the far right: must never go below 0 and never strand a gap.
    await page.evaluate((i) => { const e = document.querySelector(`[data-nav-strip="${i}"]`); e.scrollLeft = e.scrollWidth; }, i);
    await pacedWait(page, 300);
    for (let n = 0; n < 12 && (await read(page, i)).left; n++) { await tap(page, i, "left"); await pacedWait(page, 700); const t = await read(page, i); if (t.sl < 0) check(`${w}/strip${i}: never below 0`, false); }
    s = await read(page, i);
    check(`${w}/strip${i}: back to exactly 0`, s.sl === 0, `sl=${s.sl}`);
  }
  if (mobile) check(`${w}: at least one chevron strip was exercised (non-vacuous)`, chevStrips > 0, `${chevStrips} strips`);
  else check(`${w}: desktop shows NO chevrons (known-good arm)`, chevStrips === 0);
  await ctx.close();
}
await browser.close();
const bad = results.filter((p) => !p).length;
console.log(`\n${bad ? "❌" : "✅"} ${results.length - bad}/${results.length} checks passed`);
process.exit(bad ? 1 : 0);
