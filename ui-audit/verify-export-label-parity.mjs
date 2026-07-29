/* NEW-1 / V481(f) headless gate — is an export sheet the SAME sheet whatever the zoom?
 *
 * The live finding (2026-07-29, owner's Sylvestri / Concept C on planyr.io) was that B1047's
 * culling fix covered the GEOMETRY only. Exported from a corner zoom the sheet carried 151
 * text nodes and all twelve building labels; exported from a wide zoom, same plan, no edits,
 * it carried 118 and "Building 12" had no label at all. Silent — the geometry was complete,
 * so the sheet looked finished.
 *
 * This drives the REAL export path in a real browser (no sign-in, no external GIS, nothing on
 * disk): it hooks URL.createObjectURL to capture the SVG payload `buildExportSvg` produces —
 * the same technique the owner used live — runs Export PNG from three very different zooms on
 * one seeded plan, and diffs the payloads. What it asserts:
 *
 *   1. every building label present at one zoom is present at every other zoom (the defect),
 *   2. the full label TEXT set is identical, not just the count,
 *   3. the geometry counts stay identical too (B1047's constraint, unregressed),
 *   4. the label FONT SIZES are identical — the sheet is sized by the paper, not by the zoom.
 *
 * Run: node ui-audit/verify-export-label-parity.mjs   (vite preview must be on :4173)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// A plan whose labels genuinely have to compete for room when the whole site is on screen —
// twelve buildings on a tight grid, the shape of the reference case.
const els = [];
for (let i = 0; i < 12; i++) {
  els.push({ id: `b${i}`, type: "building", cx: (i % 4) * 760, cy: Math.floor(i / 4) * 520, w: 620, h: 380, rot: 0, clearHeight: 36 });
}
const EXT = { cx: (3 * 760) / 2, cy: (2 * 520) / 2, w: 3 * 760 + 620 + 200, h: 2 * 520 + 380 + 200 };
const site = {
  id: "label-parity", groupId: "label-parity", site: "Label Parity", name: "Concept",
  parcels: [{ id: "pc1", locked: false, points: [
    { x: -500, y: -400 }, { x: 3 * 760 + 500, y: -400 },
    { x: 3 * 760 + 500, y: 2 * 520 + 400 }, { x: -500, y: 2 * 520 + 400 },
  ] }],
  els, measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: 1, data: { status: "active" },
};
const seed = `(() => { try {
  window.__PLANYR_E2E = true;
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

// Capture every blob handed to URL.createObjectURL and keep the SVG ones, so we read the
// exact bytes `buildExportSvg` produced instead of eyeballing a raster.
const hook = `(() => {
  window.__exportSvgs = [];
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => {
    try {
      if (b && typeof b.type === "string" && b.type.indexOf("svg") >= 0) {
        b.text().then((t) => window.__exportSvgs.push(t)).catch(() => {});
      }
    } catch (e) {}
    return real(b);
  };
  // Don't actually download anything — this must leave no file behind.
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download) return; return click.call(this); };
})();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(seed);
await ctx.addInitScript(hook);
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForSelector("svg[role=application]", { timeout: 20000 });
await page.waitForTimeout(1200);

// Parse one captured sheet into the facts a reviewer would diff.
const summarize = (svg) => {
  const count = (re) => (svg.match(re) || []).length;
  // A multi-line label is <text><tspan>…</tspan><tspan>…</tspan></text> with no whitespace
  // between the tspans, so join them with a separator rather than concatenating the words.
  const texts = [...svg.matchAll(/<text\b[^>]*>([\s\S]*?)<\/text>/g)]
    .flatMap((m) => (m[1].includes("<tspan") ? [...m[1].matchAll(/<tspan\b[^>]*>([\s\S]*?)<\/tspan>/g)].map((t) => t[1]) : [m[1]]))
    .map((t) => t.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  // Font sizes are authored in the CLONE's own units and the viewBox rescales the whole box
  // to the sheet, so the raw numbers legitimately differ between zooms — what has to match is
  // the size RELATIVE to the frame, i.e. how big the text lands on paper. Normalise by the
  // viewBox width before comparing.
  const vb = (svg.match(/viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/) || [])[1];
  const vbW = Number(vb) || 1;
  const fontSizes = [...svg.matchAll(/font-size="([\d.]+)"/g)].map((m) => Number((Number(m[1]) / vbW).toPrecision(4)));
  return {
    bytes: svg.length,
    // Count LINES and CIRCLES too, not just the closed shapes: the column grid, dock walls
    // and dimension ticks are <line>s, and a zoom-gated one vanishing from a wide-zoom sheet
    // is exactly the kind of silent omission a shape-only count walks straight past.
    paths: count(/<path\b/g), polygons: count(/<polygon\b/g), rects: count(/<rect\b/g),
    lines: count(/<line\b/g), circles: count(/<circle\b/g),
    images: count(/<image\b/g), texts: texts.length,
    buildings: [...new Set(texts.filter((t) => /^Building \d+$/.test(t)))].sort((a, b) => (+a.slice(9)) - (+b.slice(9))),
    labelSet: [...texts].sort(),
    fontSizes: [...new Set(fontSizes)].sort((a, b) => a - b),
    // Stroke weights are retargeted to a PHYSICAL drafting weight by restyleExportClone, so
    // the same normalisation applies: what must match is the weight relative to the frame.
    strokes: [...new Set([...svg.matchAll(/stroke-width="([\d.]+)"/g)]
      .map((m) => Number((Number(m[1]) / vbW).toPrecision(4))))].sort((a, b) => a - b),
    strokeTags: [...svg.matchAll(/<(\w+)\b[^>]*stroke-width="([\d.]+)"[^>]*>/g)]
      .map((m) => `${Number((Number(m[2]) / vbW).toPrecision(4))}  <${m[1]}> ${(m[0].match(/stroke="[^"]*"/) || [""])[0]} ${(m[0].match(/data-[\w-]+="[^"]*"/) || [""])[0]} ${(m[0].match(/stroke-dasharray="[^"]*"/) || [""])[0]}`),
  };
};

const exportAt = async (label, ppf) => {
  await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [EXT.cx, EXT.cy, ppf]);
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.__exportSvgs.length = 0; });
  await page.getByRole("button", { name: "File ▾" }).click();
  await page.getByRole("button", { name: "Export PNG" }).click();
  for (let i = 0; i < 80 && !(await page.evaluate(() => window.__exportSvgs.length)); i++) await page.waitForTimeout(250);
  const svgs = await page.evaluate(() => window.__exportSvgs);
  if (!svgs.length) throw new Error(`no export payload captured at ${label}`);
  const s = summarize(svgs[0]);
  const bar = await page.evaluate(() => {
    const t = [...document.querySelectorAll("svg[role=application] text")].map((n) => n.textContent || "");
    return t.find((x) => /^[\d,]+ ?(ft|′)$/.test(x.trim())) || "";
  });
  console.log(`\n${label}  (view ppf ${ppf}${bar ? `, scale bar ${bar}` : ""})`);
  console.log(`  bytes ${s.bytes} · paths ${s.paths} · polygons ${s.polygons} · rects ${s.rects} · lines ${s.lines} · texts ${s.texts} · images ${s.images} · buildings ${s.buildings.length} (${s.buildings.join(", ") || "none"})`);
  return s;
};

// Corner zoom (most of the plan off screen), wide zoom (whole plan), and hard zoom-in.
const corner = await exportAt("CORNER ZOOM", 0.4);
const wide = await exportAt("WIDE ZOOM  ", 0.025);
const inSide = await exportAt("ZOOMED IN  ", 1.6);

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fails = [];
const check = (name, ok, detail) => { console.log(`  ${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`); if (!ok) fails.push(name); };

console.log("\n── V481(f): is the sheet a function of the plan and the frame only? ──");
for (const [name, s] of [["wide", wide], ["zoomed-in", inSide]]) {
  check(`every building label survives the ${name} export`,
    eq(s.buildings, corner.buildings), `${s.buildings.length} vs ${corner.buildings.length} at the corner zoom`);
  check(`the ${name} export's label TEXT is identical`,
    eq(s.labelSet, corner.labelSet), `${s.texts} text nodes vs ${corner.texts}`);
  check(`the ${name} export's label SIZES are identical (paper-sized, not zoom-sized)`,
    eq(s.fontSizes, corner.fontSizes), `${s.fontSizes.length} distinct sizes vs ${corner.fontSizes.length}`);
  check(`the ${name} export's LINE WEIGHTS are identical (paper-weighted, not zoom-weighted)`,
    eq(s.strokes, corner.strokes), `${s.strokes.length} distinct weights vs ${corner.strokes.length}`);
  check(`B1047 unregressed — the ${name} export's geometry is identical`,
    s.rects === corner.rects && s.polygons === corner.polygons && s.paths === corner.paths
      && s.images === corner.images && s.lines === corner.lines && s.circles === corner.circles,
    `rects ${s.rects}/${corner.rects} · polygons ${s.polygons}/${corner.polygons} · paths ${s.paths}/${corner.paths} · lines ${s.lines}/${corner.lines}`);
}
check("no page errors", errors.length === 0, errors.join(" | "));
await browser.close();
console.log(fails.length ? `\n❌ ${fails.length} FAILED: ${fails.join("; ")}` : "\n✅ every export is byte-equivalent in label content, label size and geometry.");
process.exit(fails.length ? 1 : 0);
