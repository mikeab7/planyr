/* Verification for B732 + B733 (owner follow-up on the NEW-1..6 batch):
 *   B732 — the on-canvas Yield KPI strip is REVERTED (owner didn't want numbers over the drawing),
 *          and the Standards rail icon is no longer the gear that read as a "sun" (now sliders).
 *   B733 — a Properties tab is added to the left rail as the docked HOME for the selected-element
 *          inspector: it sits between Yield and References, shows an empty state with nothing
 *          selected, and shows the element's fields once something is selected.
 *
 * Logged-out against the built app (vite preview). A full site is seeded via localStorage so a
 * building exists to select; no network needed.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";

const site = {
  id: "uiaudit-b733", groupId: "uiaudit-b733", site: "Properties Demo Tract", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [{ id: "pcA", locked: true, active: true, points: [{ x: -400, y: -220 }, { x: 400, y: -220 }, { x: 400, y: 220 }, { x: -400, y: 220 }] }],
  els: [{ id: "e1", type: "building", cx: 0, cy: 0, w: 460, h: 240, rot: 0 }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: [],
  updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${site.id}': ${JSON.stringify(site)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
let pass = 0, fail = 0;
const ok = (c, label) => { if (c) { pass++; console.log("  ✅", label); } else { fail++; console.log("  ❌", label); } };

const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("  ⚠ pageerror:", e.message));
await page.addInitScript(seed);
await page.goto(BASE, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);
try { await page.getByRole("button", { name: /site planner/i }).first().click({ timeout: 1500 }); } catch {}
await page.waitForTimeout(1500);

// ---------- B733 — rail has a Properties tab between Yield and References ----------
const railLabels = await page.evaluate(() => {
  const wanted = ["Parcel", "Analysis", "Yield", "Properties", "References", "Standards"];
  const seen = new Set(); const out = [];
  for (const b of document.querySelectorAll("button[title]")) {
    const t = b.getAttribute("title");
    if (wanted.includes(t) && b.querySelector("svg") && !seen.has(t)) { seen.add(t); out.push(t); }
  }
  return out;
});
ok(railLabels.slice(0, 6).join(",") === "Parcel,Analysis,Yield,Properties,References,Standards",
  `B733 rail order = Parcel,Analysis,Yield,Properties,References,Standards (got: ${railLabels.join(",")})`);

// ---------- B732 — Standards icon is sliders (3 lines + filled knobs), NOT the sun-gear ----------
const stdSvg = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button[title="Standards"]')].find((x) => x.querySelector("svg"));
  return b ? b.querySelector("svg").innerHTML : "";
});
ok((stdSvg.match(/<line/g) || []).length >= 3 && /fill="currentColor"/.test(stdSvg) && !/r="3\.4"/.test(stdSvg),
  "B732 Standards icon is sliders (≥3 lines + filled knobs), not the old gear/sun");

// ---------- B732 — the on-canvas KPI strip is gone ----------
ok(!(await page.locator('[data-testid="yield-kpi-strip"]').count()), "B732 the on-canvas Yield KPI strip is gone");

// ---------- B733 — Properties tab shows an empty state with nothing selected ----------
await page.locator('button[title="Properties"]').first().click();
await page.waitForTimeout(500);
const menuPanel = page.locator('[data-testid="left-menu-panel"]');
let ptxt = (await menuPanel.innerText()).replace(/\s+/g, " ");
ok(/Nothing selected/i.test(ptxt), `B733 Properties empty state shows with nothing selected (“${ptxt.slice(0, 80)}…”)`);

// ---------- B733 — selecting an element fills the Properties inspector ----------
// The seeded building spans the site centre; click the canvas centre to select it.
// The canvas SVG is the largest SVG on the page (rail/panel icons are tiny).
const box = await page.evaluate(() => {
  let best = null, area = 0;
  for (const s of document.querySelectorAll("svg")) {
    const r = s.getBoundingClientRect(); const a = r.width * r.height;
    if (a > area) { area = a; best = { x: r.x, y: r.y, width: r.width, height: r.height }; }
  }
  return best;
});
await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
await page.waitForTimeout(600);
ptxt = (await menuPanel.innerText()).replace(/\s+/g, " ");
const propPanel = page.locator('[data-testid="property-panel"]').first();
const selectedShows = (await propPanel.count()) > 0 && !/Nothing selected/i.test(ptxt) && /Element/i.test(ptxt);
ok(selectedShows, `B733 selecting an element fills the Properties inspector (“${ptxt.slice(0, 90)}…”)`);

// ---------- B733 — the companion still auto-rides above ANOTHER panel (B656 preserved) ----------
await page.locator('button[title="Yield"]').first().click();
await page.waitForTimeout(500);
const ytxt = (await menuPanel.innerText()).replace(/\s+/g, " ");
ok(/Element/i.test(ytxt) && /Site Yield/i.test(ytxt), "B733 companion still rides above the Yield panel when an element is selected (B656 intact)");

console.log(`\nB732–B733: ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
