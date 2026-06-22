/**
 * One-off mockup: compare candidate status-marker SHAPES side by side, all in the
 * same redesign treatment (coral Pursuit + white halo + flag; and a small gray
 * Completed + check) over a busy aerial-style background to test halo legibility.
 * Output: ui-audit/screens/b362/shape-options.png
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const OUT = new URL("./screens/b362/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const COR = "#D85A30", GRY = "#888780";
function darken(hex, f = 0.28) {
  const n = parseInt(String(hex).slice(1), 16), m = 1 - f;
  const ch = (c) => Math.max(0, Math.min(255, Math.round(c * m))).toString(16).padStart(2, "0");
  return `#${ch((n >> 16) & 255)}${ch((n >> 8) & 255)}${ch(n & 255)}`;
}
// flag / check glyphs centered on (0,0), then translated to a shape's body center.
const flag = (gx, gy) => `<g transform="translate(${gx},${gy})"><path d="M-1.6,6 L-1.6,-6.6" stroke="#fff" stroke-width="1.5" stroke-linecap="round"/><path d="M-1.6,-6.1 L5.3,-3.9 L-1.6,-1.7 Z" fill="#fff"/></g>`;
const check = (gx, gy) => `<g transform="translate(${gx},${gy})"><polyline points="-4,0 -1,3.2 5.2,-4.6" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>`;

const SHAPES = [
  { key: "current",  label: "Current",       sub: "building / hex",   body: "M14,35 L5,29 L5,15 L14,9 L23,15 L23,29 Z", gx: 14, gy: 19, note: "points at the spot" },
  { key: "flattop",  label: "Flat-top",      sub: "shield badge",     body: "M14,34 L4,22 L4,11 L24,11 L24,22 Z",       gx: 14, gy: 17, note: "points at the spot" },
  { key: "teardrop", label: "Classic pin",   sub: "teardrop",         body: "M14,34 C8.3,23 6,19.5 6,13.5 A8,8 0 1 1 22,13.5 C22,19.5 19.7,23 14,34 Z", gx: 14, gy: 13.5, note: "points at the spot" },
  { key: "badge",    label: "Rounded badge", sub: "speech-pin",       body: "M9,7 H19 A5,5 0 0 1 24,12 V19 A5,5 0 0 1 19,24 H17 L14,31 L11,24 H9 A5,5 0 0 1 4,19 V12 A5,5 0 0 1 9,7 Z", gx: 14, gy: 15.5, note: "points at the spot" },
  { key: "circle",   label: "Plain dot",     sub: "disc",             circle: { cx: 14, cy: 16, r: 9 }, gx: 14, gy: 16, note: "centered, no point" },
];

function pin(s, fill, glyph, scale, halo) {
  const inner = s.body
    ? `<path d="${s.body}" fill="#fff" stroke="#fff" stroke-width="${halo * 2}" stroke-linejoin="round"/>` +
      `<path d="${s.body}" fill="${fill}" stroke="${darken(fill)}" stroke-width="0.75" stroke-linejoin="round"/>`
    : `<circle cx="${s.circle.cx}" cy="${s.circle.cy}" r="${s.circle.r}" fill="#fff" stroke="#fff" stroke-width="${halo * 2}"/>` +
      `<circle cx="${s.circle.cx}" cy="${s.circle.cy}" r="${s.circle.r}" fill="${fill}" stroke="${darken(fill)}" stroke-width="0.75"/>`;
  return `<svg width="${28 * scale}" height="${36 * scale}" viewBox="0 0 28 36" style="overflow:visible;display:block">${inner}${glyph}</svg>`;
}

const cols = SHAPES.map((s) => `
  <div style="display:flex;flex-direction:column;align-items:center;width:150px;gap:14px">
    <div style="background:rgba(20,22,26,.72);color:#fff;font:600 13px/1.3 system-ui,Segoe UI,Roboto,sans-serif;padding:5px 10px;border-radius:7px;text-align:center">
      ${s.label}<div style="font-weight:400;font-size:10.5px;opacity:.8">${s.sub}</div></div>
    <div style="height:96px;display:flex;align-items:flex-end;justify-content:center">${pin(s, COR, flag(s.gx, s.gy), 2.4, 3)}</div>
    <div style="height:50px;display:flex;align-items:flex-end;justify-content:center">${pin(s, GRY, check(s.gx, s.gy), 1.3, 2)}</div>
    <div style="background:rgba(20,22,26,.62);color:#fff;font:400 10px/1.2 system-ui,sans-serif;padding:3px 7px;border-radius:6px;text-align:center">${s.note}</div>
  </div>`).join("");

const html = `<!doctype html><html><body style="margin:0">
  <div style="width:830px;padding:22px 20px 18px;box-sizing:border-box;
    background:
      radial-gradient(circle at 10% 28%, #6b7a4e 0 70px, transparent 72px),
      radial-gradient(circle at 26% 78%, #3c4a30 0 95px, transparent 96px),
      radial-gradient(circle at 50% 22%, #bdb6a4 0 78px, transparent 80px),
      radial-gradient(circle at 70% 72%, #57727e 0 105px, transparent 106px),
      radial-gradient(circle at 88% 30%, #8d8260 0 80px, transparent 82px),
      radial-gradient(circle at 40% 50%, #4f5d3b 0 60px, transparent 62px),
      #7d7355;">
    <div style="background:rgba(20,22,26,.66);color:#fff;font:700 15px/1.3 system-ui,sans-serif;padding:7px 12px;border-radius:8px;display:inline-block;margin-bottom:18px">
      Pursuit marker — shape options &nbsp;<span style="font-weight:400;font-size:12px;opacity:.85">(top: coral Pursuit + flag · bottom: small gray Completed + check)</span></div>
    <div style="display:flex;justify-content:space-between;gap:6px">${cols}</div>
  </div>
</body></html>`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.setContent(html, { waitUntil: "load" });
const el = await page.$("body > div");
await el.screenshot({ path: OUT + "shape-options.png" });
await browser.close();
console.log("saved shape-options.png");
