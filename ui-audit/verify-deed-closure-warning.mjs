/* NEW-1 (2026-10-04) — a deed that doesn't close WARNS on every surface, by one rule (deedGap.js).
 * Drives the real title reader logged-out with the REAL Grand Port Tract 1 calls (31.4 ft miss; the 50 ft
 * screening test calls it "closed") plus a known-good exact-closing square (known-good arm: it must read
 * "closes" with no warning — a run where it doesn't is VOID).
 *   npm run build && npx vite preview --port 4173 &  then  node ui-audit/verify-deed-closure-warning.mjs */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium/chrome-linux/chrome";
const AZ = [[87.07111111111111, 1773.49], [87.2625, 763.87], [180, 445.02], [270, 825.06], [290.05944444444447, 17.15], [290.0761111111111, 41.13], [180.26, 60], [90, 39.94], [180.04777777777778, 1023.21], [173.37583333333333, 233.99], [168.3925, 307.5], [251.4011111111111, 1790.01], [357.3377777777778, 2477.79]];
const dms = (d) => { const a = Math.floor(d), m = Math.floor((d - a) * 60), s = Math.round(((d - a) * 60 - m) * 60 * 100) / 100; return `${a}°${String(m).padStart(2, "0")}'${s.toFixed(2).padStart(5, "0")}"`; };
const bearing = (az) => { const q = az % 360; if (q === 0) return `North 00°00'00" East`; if (q === 90) return `North 90°00'00" East`; if (q === 180) return `South 00°00'00" East`; if (q === 270) return `South 90°00'00" West`;
  if (q < 90) return `North ${dms(q)} East`; if (q < 180) return `South ${dms(180 - q)} East`; if (q < 270) return `South ${dms(q - 180)} West`; return `North ${dms(360 - q)} West`; };
const text = (rows) => ["BEGINNING at a point for corner;", ...rows.map(([az, d]) => `THENCE ${bearing(az)}, ${d.toFixed(2)} feet to a point for corner;`)].join("\n");
const SQUARE = text([[90, 300], [180, 200], [270, 300], [0, 200]]);
const TRACT1 = text(AZ);
let fails = 0;
const check = (n, ok, d = "") => { if (!ok) fails++; console.log(`${ok ? "✅" : "❌"} ${n}${d ? ` — ${d}` : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(`(() => { try { window.__PLANYR_E2E = true; localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s1: { id: "s1", groupId: "s1", site: "Deed closure", name: "P", origin: null, county: "waller", parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() } })); localStorage.setItem('planarfit:currentSite:v1', 's1'); } catch (e) {} })();`);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-deed-closure-warning");
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);
await page.getByRole("button", { name: /^Site$/ }).first().click().catch(() => {});
await page.locator('svg[aria-label="Site plan canvas"]').waitFor({ timeout: 30000 });
await page.locator('button.rbtn:has-text("Parcel tools")').first().click();
await page.waitForTimeout(400);
await page.locator('[data-testid="boundary-menu-mb"]').click();
await page.waitForTimeout(900);
const ta = page.locator("textarea").first();
const summary = () => page.locator('[data-testid="deed-reader-summary"]').innerText();

await ta.fill(SQUARE); await page.waitForTimeout(600);
let s = await summary();
check("KNOWN-GOOD ARM: exact-closing square reads 'closes' (else run is VOID)", /closes/.test(s) && !/NOT/.test(s), s);

await ta.fill(TRACT1); await page.waitForTimeout(700);
s = await summary();
check("Tract 1 reader summary does NOT say 'closes' and carries the ⚠ wording", /⚠ does NOT close — misses by 31\.\d ft/.test(s) && !/\bcloses\b/.test(s), s);
const color = await page.locator('[data-testid="deed-reader-summary"]').evaluate((e) => getComputedStyle(e).color);
check("summary reads in the danger colour (reddish)", (() => { const m = color.match(/\d+/g).map(Number); return m[0] > m[1] + 40 && m[0] > m[2] + 40; })(), color);

await page.getByRole("button", { name: /^Plot on canvas/ }).click();
await page.waitForTimeout(600);
const box = await page.locator('svg[aria-label="Site plan canvas"]').boundingBox();
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(900);
const body = await page.evaluate(() => document.body.innerText);
check("plot raises the ⚠ does-not-close warning", /⚠ This description does not close — it misses by 31\.\d ft \(1:/.test(body) && !/Boundary placed/.test(body.split("⚠ This description")[0].slice(-60)), (body.match(/⚠ This description[^\n]*/) || [""])[0].slice(0, 160));
await page.screenshot({ path: "/tmp/deed-closure-warning.png" });
await browser.close();
console.log(fails ? `${fails} FAILED` : "ALL PASS"); process.exit(fails ? 1 : 0);
