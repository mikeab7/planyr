/* Capture frames during a continuous zoom-OUT from a building, and flag any frame
 * that is mostly the dark backdrop (#3f3f3f) = a black flash. B65 follow-up. */
import { chromium } from "playwright";
import { PNG } from "pngjs";
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = new URL("./screens/", import.meta.url).pathname;
const site = {
  id: "flash-demo", groupId: "flash-demo", site: "Flash Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -440, y: -160 }, { x: 440, y: -160 }, { x: 440, y: 300 }, { x: -440, y: 300 }] }],
  els: [{ id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

// fraction of pixels that are near the dark backdrop colour (#3f3f3f)
function darkFraction(buf) {
  const png = PNG.sync.read(buf);
  let dark = 0, n = 0;
  for (let i = 0; i < png.data.length; i += 4 * 37) { // sample every ~37th pixel
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    if (Math.abs(r - 63) < 12 && Math.abs(g - 63) < 12 && Math.abs(b - 63) < 12) dark++;
    n++;
  }
  return dark / n;
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(2800);
const box = await page.locator("svg[role=application]").boundingBox();
const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

let worst = 0;
const fracs = [];
for (let i = 0; i < 14; i++) {
  await page.mouse.move(cx, cy);
  await page.mouse.wheel(0, 300); // zoom OUT
  await page.waitForTimeout(30);
  const buf = await page.screenshot();
  const f = darkFraction(buf);
  fracs.push(f.toFixed(3));
  if (f > worst) worst = f;
}
console.log("dark-fraction per frame:", fracs.join(" "));
console.log("WORST dark fraction during zoom-out:", worst.toFixed(3), worst > 0.25 ? "  <-- BLACK FLASH" : "  (ok, no full-screen black)");
await browser.close();
