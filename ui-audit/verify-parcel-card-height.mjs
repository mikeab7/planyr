/* NEW-1 — verify the address-search parcel card in a real browser: it is SHORT by default,
 * a monstrous Legal description cannot make it taller, and the folded data is all still
 * reachable. Drives the real component via ui-audit/parcel-card-harness.html.
 *
 * WHY PIXELS. The report was "fix how big this pop out is" — a height. A unit test can
 * prove which rows render; only a browser can prove how tall the result actually is, and
 * only a browser can CLICK the fold open. Both cases here are the same parcel; the only
 * difference is the length of the Legal text, which is precisely the variable that used to
 * blow the card up.
 *
 * The reference the owner used is the map controls beside the card, so the collapsed card
 * is also judged against the card's own header + three rows rather than an invented number.
 *
 * Run: npm run dev &  then  node ui-audit/verify-parcel-card-height.mjs
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const HARNESS_URL = `${BASE}/ui-audit/parcel-card-harness.html`;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1220, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await page.goto(HARNESS_URL, { waitUntil: "load" });
await page.waitForTimeout(600);

const checks = [];
const ok = (name, cond, detail = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

// The card is the stage's only absolutely-positioned child; measure IT, not the stage.
const card = (stage) => page.evaluate((s) => {
  const root = document.querySelector(`[data-stage="${s}"]`);
  const el = root.querySelector('div[style*="position: absolute"][style*="border-radius"]');
  const r = el.getBoundingClientRect();
  const rows = [...el.querySelectorAll("[data-parcel-row]")].map((n) => n.getAttribute("data-parcel-row"));
  return { h: Math.round(r.height), w: Math.round(r.width), rows, text: el.innerText };
}, stage);

const long = await card("long-legal");
const short = await card("short-legal");

console.log(`\nCollapsed card — long Legal: ${long.h}px tall · short Legal: ${short.h}px tall`);

ok("no page errors", errors.length === 0, errors[0] || "");
ok("shows exactly three rows, in the owner's order",
  JSON.stringify(long.rows) === JSON.stringify(["Owner", "Account / ID", "Acreage (measured)"]),
  long.rows.join(" · "));
ok("a monstrous Legal adds NO height", long.h === short.h, `${long.h}px vs ${short.h}px`);
ok("the Legal blob is not on screen", !long.text.includes("TPOB"));
// The pre-fix card printed 10 fields plus a ten-line Legal blob. A card that still fits in
// the top strip of the map is the outcome; this ceiling is the header + three rows + the
// fold + the button with room to spare, and it fails loudly if the rows creep back.
ok("card stays short (under the map's top strip)", long.h < 240, `${long.h}px`);
ok("card keeps its width", long.w === 348, `${long.w}px`);
ok("keeps the Plan this site button", long.text.includes("Plan this site"));

// Open the fold FOR REAL — the reachability half of the promise.
await page.click('[data-stage="long-legal"] button[aria-expanded="false"]');
await page.waitForTimeout(150);
const opened = await card("long-legal");
console.log(`Expanded card — ${opened.h}px tall`);

ok("expanding reveals every folded field, Legal included",
  ["Land value", "Improvement value", "Total value", "Land use", "Zoning", "Year built", "Legal"]
    .every((l) => opened.rows.includes(l)));
ok("the Legal text is reachable once expanded", opened.text.includes("TPOB"));
ok("even expanded, the card stays bounded", opened.h < 460, `${opened.h}px`);
ok("expanded is taller than collapsed (the fold does something)", opened.h > long.h);

// Phone layout still works — full-width card, same three rows.
const narrow = await card("narrow");
ok("narrow viewport branch still renders three rows", narrow.rows.length === 3, `${narrow.w}px wide`);
ok("narrow card spans the stage width", narrow.w > 1100, `${narrow.w}px`);

await page.screenshot({ path: "ui-audit/out/parcel-card-height.png", fullPage: true }).catch(() => {});
await browser.close();

const failed = checks.filter((c) => !c.pass);
console.log(`\n${failed.length ? `✗ ${failed.length} FAILED` : `✓ all ${checks.length} checks passed`}`);
process.exit(failed.length ? 1 : 0);
