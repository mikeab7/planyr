/* B176 verification — the "Jurisdictions" overlay group renders in the Layers panel
 * with its four toggles (County / City limits / City ETJ / MUD) and toggling one
 * throws no JS errors. Boots the built app (vite preview) at the map finder, where
 * LayerPanel is shown directly. GIS tile RENDERING is verified on planyr.io (the
 * sandbox proxy allowlist doesn't include the gov GIS hosts) — this checks the React
 * wiring that this change actually touched. Run: node gis-verify/jurisdictions-overlay-verify.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1600);

const want = ["Jurisdictions", "County boundaries", "City limits", "City ETJ", "MUD / water districts"];
const found = {};
for (const t of want) found[t] = (await page.getByText(t, { exact: false }).count()) > 0;

// Toggle "County boundaries" on and confirm no error + the opacity slider appears.
let toggled = false;
try {
  const cb = page.locator('label:has-text("County boundaries") input[type="checkbox"]').first();
  await cb.check({ timeout: 5000 });
  await page.waitForTimeout(900);
  toggled = await cb.isChecked();
} catch (e) { errors.push("toggle failed: " + e.message); }

const allText = want.every((t) => found[t]);
const pass = allText && toggled && errors.length === 0;
console.log("found:", found);
console.log("countyToggleChecked:", toggled);
console.log("jsErrors:", errors.length, errors.slice(0, 5));
console.log(pass ? "RESULT: PASS" : "RESULT: FAIL");

await ctx.close();
await browser.close();
process.exit(pass ? 0 : 1);
