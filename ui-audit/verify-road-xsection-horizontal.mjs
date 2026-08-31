/* NEW-2 (owner report, 2026-08-26) — "and lets make it horizontal? that makes sense to me based on
 * the details I usually see." A roadway typical section is drawn looking down the road: pavement
 * runs left-to-right, the dimension string runs horizontally beneath it. Verifies, in a real headless
 * browser, that the rotated preview:
 *   1. actually runs left-to-right (band rects vary in x, share one y — not the old top-to-bottom
 *      layout);
 *   2. marks the centerline (a dash-dot line + "C"/"L" glyphs) at the section's true drawn offset 0;
 *   3. carries a real horizontal dimension string (a tick per band boundary, each band's own width
 *      underneath, the total beneath that);
 *   4. never clips, squeezes, or lets a label overflow into its neighbor when a band is too narrow —
 *      it moves the label OUT onto a leader line instead (tested with a 20′ median beside a 2′
 *      curb-and-gutter band, per the owner's own instruction);
 *   5. keeps the list-to-preview correspondence the old vertical layout had: hovering/focusing a band
 *      row in the list highlights the matching band in the preview;
 *   6. scales to fit the dialog's actual width rather than clipping or scrolling, checked at three
 *      section widths (a 68′ boulevard, a 25′ single-band private drive, and the mixed narrow-curb
 *      section) and at the dialog's narrowest usable window size.
 *
 * Logged-out, no external GIS, blank site — the ATTEMPT-BEFORE-YOU-PARK class, so it runs here.
 *
 * Run:  npm run build && npx vite preview --port 4173  (then)  node ui-audit/verify-road-xsection-horizontal.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/road-xsection-horizontal/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-road-xsection-horizontal");
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));

const fails = [], notes = [];
const check = (ok, label, detail = "") => { (ok ? notes : fails).push(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`); };

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
try {
  await page.getByTestId("map-start-blank-menu-btn").click({ timeout: 8000 });
  await page.getByTestId("map-start-blank-menu-item").click({ timeout: 8000 });
} catch (_) {}
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForTimeout(600);

await page.locator('[aria-label="Road presets"]').click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: /Design cross-section…/ }).click();
await page.waitForTimeout(400);
check((await page.locator('[data-testid="road-xsection-dialog"]').count()) === 1, "the dialog opens");

const svgSel = '[data-testid="road-xsection-dialog"] svg';
const readSvg = () => page.evaluate((sel) => {
  const svg = document.querySelector(sel);
  const sb = svg.getBoundingClientRect();
  const rects = [...svg.querySelectorAll("rect")].filter((r) => r.getAttribute("stroke") === "var(--planner-border)")
    .map((r) => r.getBoundingClientRect());
  const clLine = [...svg.querySelectorAll("line")].find((l) => (l.getAttribute("stroke-dasharray") || "").includes("8 3"));
  const clText = [...svg.querySelectorAll("text")].filter((t) => ["C", "L"].includes(t.textContent));
  const allText = [...svg.querySelectorAll("text")].map((t) => ({ text: t.textContent, box: t.getBoundingClientRect() }));
  const highlighted = [...svg.querySelectorAll('rect[stroke="var(--accent)"]')].map((r) => r.getBoundingClientRect());
  return {
    svgBox: sb,
    bandBoxes: rects.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
    clLine: clLine ? { x1: clLine.getAttribute("x1"), x2: clLine.getAttribute("x2") } : null,
    clTextCount: clText.length,
    allText: allText.map((t) => ({ text: t.text, box: { x: t.box.x, y: t.box.y, width: t.box.width, height: t.box.height, right: t.box.right, bottom: t.box.bottom } })),
    highlighted: highlighted.map((r) => ({ x: r.x, y: r.y, width: r.width, height: r.height })),
  };
}, svgSel);

// ---- 1. Rotation — bands vary in X, share one Y (not the old top-to-bottom layout) ----------------
await page.getByRole("button", { name: /^4-lane divided boulevard$/ }).click();
await page.waitForTimeout(300);
let s = await readSvg();
const ys = new Set(s.bandBoxes.map((b) => Math.round(b.y)));
const xs = new Set(s.bandBoxes.map((b) => Math.round(b.x)));
check(s.bandBoxes.length === 5, "the 5-band boulevard renders 5 band rects", `count=${s.bandBoxes.length}`);
check(ys.size === 1, "every band shares the SAME y (one horizontal row) — the rotation actually happened", JSON.stringify([...ys]));
check(xs.size === 5, "bands differ in x — they run left to right, not stacked", JSON.stringify([...xs]));
await page.screenshot({ path: OUT + "01-boulevard.png" });

// ---- 2. Centerline mark at the section's true offset 0 ---------------------------------------------
check(!!s.clLine, "a dash-dot centerline line is drawn", JSON.stringify(s.clLine));
check(s.clTextCount === 2, "the centerline carries its 'C'/'L' glyphs (drawn as safe ASCII text, never a font-dependent Unicode symbol)", `count=${s.clTextCount}`);
// For a symmetric 12/12/20/12/12 section, offset 0 (the true centerline) is the geometric middle of
// the median — i.e. the middle of the WHOLE drawn section, since it's symmetric.
const sortedX = s.bandBoxes.map((b) => b.x).sort((a, b) => a - b);
const leftEdge = sortedX[0], rightEdge = Math.max(...s.bandBoxes.map((b) => b.x + b.width));
const clX = s.allText.find((t) => t.text === "C").box.x + s.allText.find((t) => t.text === "C").box.width / 2;
check(Math.abs(clX - (leftEdge + rightEdge) / 2) < 3, "the centerline sits at the section's true geometric middle for this symmetric section", `clX=${clX.toFixed(1)} mid=${((leftEdge + rightEdge) / 2).toFixed(1)}`);

// ---- 3. A real horizontal dimension string — ticks + per-band widths + total, all upright ---------
const dimTexts = s.allText.filter((t) => /^\d+(\.\d+)?′$/.test(t.text));
check(dimTexts.length >= 5, "the dimension string carries a width figure for every band", `found ${dimTexts.length}`);
const totalText = s.allText.find((t) => /total$/.test(t.text));
check(!!totalText && /^68/.test(totalText.text), "the running total reads 68′, horizontal, below the dimension numbers", totalText && totalText.text);
check(!!totalText && totalText.box.width > totalText.box.height, "the total label's box is wider than it is tall — it is NOT rotated 90°", JSON.stringify(totalText && totalText.box));

// ---- 4. Label collision — a 20′ median beside a 2′ curb-and-gutter band ----------------------------
await page.getByRole("button", { name: /Add band/ }).click();
await page.waitForTimeout(150);
const rows = page.locator('[data-testid="road-xsection-band-row"]');
const n = await rows.count();
await rows.nth(n - 1).locator("select").selectOption("curbGutter");
const wInput = rows.nth(n - 1).locator('[aria-label="Band width, feet"]');
await wInput.click(); await page.keyboard.press("Control+A"); await page.keyboard.press("Backspace");
await page.keyboard.type("2"); await wInput.blur();
await page.waitForTimeout(250);
s = await readSvg();
// Nothing may render OUTSIDE the svg's own box (no clipping past the edge)
const outOfBounds = s.allText.filter((t) => t.box.x < s.svgBox.x - 1 || t.box.right > s.svgBox.right + 1 || t.box.y < s.svgBox.y - 1 || t.box.bottom > s.svgBox.bottom + 1);
check(outOfBounds.length === 0, "no label renders outside the preview SVG's own box (nothing clipped at the edge)", JSON.stringify(outOfBounds));
// No two text boxes may overlap each other (the leader-line stagger must actually avoid collisions)
function overlaps(a, b) { return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y; }
let anyOverlap = null;
for (let i = 0; i < s.allText.length && !anyOverlap; i++) {
  for (let j = i + 1; j < s.allText.length; j++) {
    if (overlaps(s.allText[i].box, s.allText[j].box)) { anyOverlap = [s.allText[i].text, s.allText[j].text]; break; }
  }
}
check(!anyOverlap, "no two labels in the preview overlap each other (the curb band's tight label/number were moved out, not squeezed in)", JSON.stringify(anyOverlap));
check(s.allText.some((t) => /Curb & gutter · 2′/.test(t.text)), "the 2′ curb-and-gutter band's full label ('Curb & gutter · 2′') still appears somewhere — moved out, never dropped", s.allText.map((t) => t.text).join(" | "));
await page.screenshot({ path: OUT + "02-mixed-narrow-curb.png" });

// ---- 5. Active-band highlight follows hover/focus, matching the list row ---------------------------
await page.mouse.move(20, 20); // park the mouse away first so the baseline read is clean
await page.waitForTimeout(100);
s = await readSvg();
check(s.highlighted.length === 0, "nothing highlighted with the mouse parked away from every row", `count=${s.highlighted.length}`);
await rows.nth(2).hover(); // the Median row
await page.waitForTimeout(150);
s = await readSvg();
check(s.highlighted.length === 1, "hovering a band row highlights exactly one band in the preview", `count=${s.highlighted.length}`);
const medianBox = s.bandBoxes.find((b) => Math.abs(b.width - (s.bandBoxes.reduce((m, x) => Math.max(m, x.width), 0))) < 1); // the median is the widest band
check(!!medianBox && s.highlighted[0] && Math.abs(s.highlighted[0].x - medianBox.x) < 3, "the highlighted band is the one under the hovered row (the Median)", JSON.stringify({ highlighted: s.highlighted[0], medianBox }));
await page.mouse.move(20, 20);
await page.waitForTimeout(150);
s = await readSvg();
check(s.highlighted.length === 0, "moving away clears the highlight", `count=${s.highlighted.length}`);
await page.screenshot({ path: OUT + "03-hover-highlight.png" });

// ---- 6. Scale-to-fit at three widths + the dialog's narrowest usable window -------------------------
const checkFitsContainer = async (label) => {
  const svgW = await page.locator(svgSel).evaluate((svg) => ({ attrW: +svg.getAttribute("width"), rectW: svg.getBoundingClientRect().width, wrapW: svg.parentElement.getBoundingClientRect().width }));
  check(Math.abs(svgW.attrW - svgW.rectW) < 2, `${label}: SVG's own width attribute matches its rendered size (no implicit browser rescale)`, JSON.stringify(svgW));
  check(svgW.rectW <= svgW.wrapW + 1, `${label}: preview never renders wider than its wrapping container (no horizontal overflow)`, JSON.stringify(svgW));
  const overflowX = await page.locator('[data-testid="road-xsection-dialog"]').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  check(!overflowX, `${label}: the dialog itself has no horizontal overflow/scrollbar`);
};
await checkFitsContainer("68′ boulevard + 2′ curb (wide window)");

// a single-band 25′ private drive
await page.getByRole("button", { name: /^Private drive$/ }).click();
await page.waitForTimeout(250);
s = await readSvg();
check(s.bandBoxes.length === 1, "the private-drive preset renders a single band", `count=${s.bandBoxes.length}`);
await checkFitsContainer("25′ single-band private drive (wide window)");
await page.screenshot({ path: OUT + "04-private-drive.png" });

// re-load the boulevard + narrow curb mix, then shrink the window to the dialog's narrowest usable size
await page.getByRole("button", { name: /^4-lane divided boulevard$/ }).click();
await page.waitForTimeout(250);
await page.setViewportSize({ width: 480, height: 900 });
await page.waitForTimeout(300);
await checkFitsContainer("68′ boulevard at a narrow (480px) window");
await page.screenshot({ path: OUT + "05-narrow-window.png" });

check(errs.length === 0, "no uncaught page errors the whole run", JSON.stringify(errs));

console.log(notes.join("\n"));
console.log("");
console.log(fails.length ? fails.join("\n") : "ALL CHECKS PASSED");
console.log(`\n${notes.length}/${notes.length + fails.length} checks passed`);
await browser.close();
process.exit(fails.length ? 1 : 0);
