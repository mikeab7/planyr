/* NEW-1 — the setback CHIP's ink is decoupled from the setback LINE's colour, proven in pixels.
 *
 * Owner report, 2026-07-30, minutes after the green property-line default (B1192) went live: the
 * chip on the map came back WHITE PLATE / GREEN BORDER / GREEN TEXT, at high magnification on
 * https://planyr.io/#/project/sms7v3ua7ksy/site. It had read black since B1184–B1187 — but only
 * because nothing had set a setback colour yet. The render site resolved `sbStroke || chipInk`,
 * so the chip inherited whatever colour the line took, which is the coupling the owner asked to
 * be broken in the first place ("the setback is orange, and then the chip … the text is orange.
 * I'd like that to all be … black.").
 *
 * This harness asserts the PROPERTY, never the value of the day: it seeds one parcel with an
 * ARBITRARY setback colour (magenta — not the default, not black, not any colour in the app's
 * palette) and one with none, then reads the COMPUTED colours off the live canvas.
 *
 *   1  a parcel with NO setback colour — chip border + numerals are the ink token
 *   2  a parcel whose setback LINE is an arbitrary colour — chip border + numerals UNMOVED
 *   3  and the LINE still wears that arbitrary colour (B1100's override is not what was broken)
 *   4  the two chips are identical to each other, whatever their lines are doing
 *
 * Logged out, no external GIS, geometry seeded from localStorage — Claude-verifiable here.
 *
 * Run:  npm run build && npx vite preview --port 4181   (separate shell)
 *       BASE_URL=http://localhost:4181/ node ui-audit/verify-setback-chip-ink.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4181/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const now = Date.now();

const INK = "rgb(21, 23, 28)";       // --canvas-chip-ink #15171C, both themes
const WILD = "#FF00FF";              // deliberately not the default, not black, not in the palette
const WILD_RGB = "rgb(255, 0, 255)";

const rect = (x0, y0, w, h) => [
  { x: x0, y: y0 }, { x: x0 + w, y: y0 }, { x: x0 + w, y: y0 + h }, { x: x0, y: y0 + h },
];

const sites = {
  chipink: {
    id: "chipink", groupId: "chipink", site: "chipink", name: "Chip ink",
    origin: { lat: 29.7604, lon: -95.3698 }, county: "harris",
    parcels: [
      // A — untouched: the setback line takes the theme default.
      { id: "pA", points: rect(0, 0, 800, 500) },
      // B — an explicit, arbitrary setback colour, exactly as a user's saved choice is stored.
      { id: "pB", points: rect(1100, 0, 800, 500), sbStroke: WILD, stroke: WILD },
    ],
    els: [], measures: [], callouts: [], markups: [],
    settings: { showSetback: true, setback: 25 }, underlay: null, status: "active", updatedAt: now,
  },
};
// Boot straight into the seeded plan — the chooser is not what is under test here.
const seed = `(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(sites)}));localStorage.setItem('planarfit:currentSite:v1','chipink');}catch(e){}})();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const ok = (n, pass, d = "") => { results.push({ n, pass }); console.log(`  ${pass ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const jsErrors = [];
page.on("pageerror", (e) => jsErrors.push(String(e)));
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1800);

await page.locator('button[title="Zoom to fit"]').click().catch(() => {});
await page.waitForTimeout(800);

// Read the CHIP's computed colours (never its attributes — a stylesheet could still repaint it),
// plus every setback ring on the canvas so the line's own override is checked in the same pass.
const read = () => page.evaluate(() => {
  const chip = document.querySelector('rect[data-testid="setback-chip"]');
  const txt = document.querySelector('text[data-testid="setback-chip-text"]');
  const cs = (el, prop) => (el ? getComputedStyle(el)[prop] : null);
  return {
    chips: document.querySelectorAll('rect[data-testid="setback-chip"]').length,
    border: cs(chip, "stroke"),
    plate: cs(chip, "fill"),
    ink: cs(txt, "fill"),
    label: (txt?.textContent || "").trim(),
    rings: [...document.querySelectorAll('polygon[data-testid="setback-ring"]')].map((p) => getComputedStyle(p).stroke),
  };
});

// Select a parcel by clicking a midpoint of its own boundary ring (the fat invisible hit-stroke).
const outlines = () => page.evaluate(() => [...document.querySelectorAll('polygon[data-testid="parcel-outline"]')].map((p) => {
  const r = p.ownerSVGElement.getBoundingClientRect();
  const pts = p.getAttribute("points").trim().split(/\s+/).map((s) => { const [x, y] = s.split(",").map(Number); return { x: x + r.left, y: y + r.top }; });
  return pts;
}));

const selectNth = async (n) => {
  const all = await outlines();
  const pts = all[n] || [];
  for (let e = 0; e < pts.length; e++) {
    const a = pts[e], b = pts[(e + 1) % pts.length];
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    if (mid.y < 120 || mid.y > 860 || mid.x < 40 || mid.x > 1420) continue;
    await page.mouse.click(mid.x, mid.y);
    await page.waitForTimeout(350);
    if ((await read()).chips > 0) return true;
  }
  return false;
};

const shapes = await outlines();
ok("both seeded parcels render", shapes.length === 2, `${shapes.length} outlines`);

// --- 1: the untouched parcel ------------------------------------------------------------------
const gotA = await selectNth(0);
const a = await read();
await page.screenshot({ path: OUT + "setback-chip-ink-default-line.png" });
console.log(`  · A (no override): chip "${a.label}" border ${a.border} · text ${a.ink} · plate ${a.plate}`);
ok("1 · a chip is drawn on the untouched parcel", gotA && a.chips > 0, `${a.chips} chips`);
ok("1 · its border is the ink token", a.border === INK, a.border || "none");
ok("1 · its numerals are the ink token", a.ink === INK, a.ink || "none");
ok("1 · on a white plate", a.plate === "rgb(255, 255, 255)", a.plate || "none");

// --- 2 + 3: the parcel whose setback LINE is an arbitrary colour -------------------------------
const gotB = await selectNth(1);
const b = await read();
await page.screenshot({ path: OUT + "setback-chip-ink-wild-line.png" });
console.log(`  · B (line ${WILD}): chip "${b.label}" border ${b.border} · text ${b.ink} · rings ${b.rings.join(", ")}`);
ok("2 · a chip is drawn on the recoloured parcel", gotB && b.chips > 0, `${b.chips} chips`);
ok("2 · its border is STILL the ink token, not the line colour", b.border === INK, b.border || "none");
ok("2 · its numerals are STILL the ink token", b.ink === INK, b.ink || "none");
ok("3 · the setback LINE itself does wear the arbitrary colour (B1100 intact)",
   b.rings.includes(WILD_RGB), b.rings.join(", ") || "no ring");
ok("3 · and the other parcel's line still wears the theme default (they are genuinely different)",
   b.rings.some((r) => r !== WILD_RGB), b.rings.join(", "));

// --- 4: the two chips are the same, whatever their lines are doing -----------------------------
ok("4 · both chips are identical — the chip tracks nothing on the parcel",
   a.border === b.border && a.ink === b.ink && a.plate === b.plate,
   `${a.border}/${a.ink} vs ${b.border}/${b.ink}`);

ok("no JS errors during the whole run", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | "));

await ctx.close();
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed  ·  screenshots in ui-audit/screens/`);
if (failed.length) { console.log("FAILED:", failed.map((f) => f.n).join("; ")); process.exit(1); }
console.log("ALL PASS");
