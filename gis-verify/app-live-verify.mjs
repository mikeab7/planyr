// End-to-end check of the REAL deployed app: does toggling "Wetlands (NWI)" on planyr.io
// request the new crisp VECTOR source and paint it? Captures the export requests (new
// Wetlands_gdb_split vs old Wetlands_Raster — also a deploy-freshness check) + screenshots.
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
const EXEC = "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const APP = process.env.APP || "https://planyr.io/";

const reqs = [];
const browser = await chromium.launch({ executablePath: EXEC, headless: true, args: ["--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, ignoreHTTPSErrors: true });
page.on("response", (r) => {
  const u = r.url();
  if (/Wetlands_gdb_split|Wetlands_Raster/.test(u)) {
    reqs.push({ which: u.includes("Wetlands_gdb_split") ? "VECTOR(new)" : "RASTER(old)", status: r.status(), ct: (r.headers()["content-type"]||"").slice(0,20), bytes: Number(r.headers()["content-length"]||0) });
  }
});

await page.goto(APP, { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(6000); // map + panel boot

// Toggle "Wetlands (NWI)" on (checkbox inside the label with that text)
let toggled = false;
try {
  const cb = page.locator('label:has-text("Wetlands (NWI)") input[type="checkbox"]').first();
  await cb.waitFor({ timeout: 15000 });
  if (!(await cb.isChecked())) await cb.check({ force: true });
  toggled = await cb.isChecked();
} catch (e) { reqs.push({ note: "toggle failed: " + e.message.slice(0,80) }); }

// Max the wetland opacity so polygons pop over the aerial (the slider appears once it's on)
try {
  const op = page.locator('input[aria-label="Wetlands (NWI) opacity"]').first();
  await op.waitFor({ timeout: 5000 });
  await op.fill("1");
} catch (e) {}

// Zoom into NE Houston (Greens Bayou / Sheldon — wetland-rich) by wheel-zooming toward the
// upper-right; stop at ~zoom 14 (3 steps) so the view stays broad and polygons are visible.
const map = page.locator(".leaflet-container").first();
const box = await map.boundingBox();
if (box) {
  const cx = box.x + box.width * 0.74, cy = box.y + box.height * 0.30; // upper-right → drift NE
  await page.mouse.move(cx, cy);
  // 2 steps: z11 -> ~z13 (past the layer's 1:250k min-scale, but broad enough to show many polygons)
  for (let i = 0; i < 2; i++) { await page.mouse.wheel(0, -260); await page.waitForTimeout(1800); }
}
await page.waitForTimeout(7000); // let the export tile for the new view paint
await page.screenshot({ path: "gis-verify/app-wetlands-planyrio.png" });
await browser.close();

console.log(JSON.stringify({ app: APP, toggledOn: toggled, wetlandRequests: reqs, screenshot: "gis-verify/app-wetlands-planyrio.png" }, null, 2));
