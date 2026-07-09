/* Verification for B718–B722 (owner "NEW-1..6" batch, sans the already-shipped References merge).
 *
 *  B718 — persistent Yield KPI strip on the canvas (Site/Bldg/Cover/Stalls), click → Yield panel,
 *         stays visible while another left panel is open, hidden on an empty canvas.
 *  B719 — always-visible "Detention storage  X.XX ac-ft" row in the Yield Stormwater group.
 *  B720 — Parcel panel ops row (Add ▾ · Split · Merge) + click-to-pick merge (plain clicks).
 *  B721 — left rail reordered Parcel/Analysis/Yield/References/Standards + inline SVG icons;
 *         Standards teaching lines.
 *  B722 — FAR row removed from the Yield Land group; Impervious row carries a definition tooltip.
 *
 * Logged-out against the built app (vite preview). GIS hosts are CORS-blocked in the sandbox —
 * that network noise is environmental; we seed a full site via localStorage so the geometry-
 * dependent readouts (KPI strip, detention volume, coverage) all render without the network.
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:4173/";

// Two parcels sharing the x=0 edge so Merge can fuse them; a building + parking (coverage/stalls)
// and a pond with det params (detention storage volume).
const site = {
  id: "uiaudit-b718", groupId: "uiaudit-b718", site: "Yield Demo Tract", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [
    { id: "pcA", locked: true, active: true, points: [{ x: -400, y: -200 }, { x: 0, y: -200 }, { x: 0, y: 200 }, { x: -400, y: 200 }] },
    { id: "pcB", locked: true, active: true, points: [{ x: 0, y: -200 }, { x: 400, y: -200 }, { x: 400, y: 200 }, { x: 0, y: 200 }] },
  ],
  els: [
    { id: "e1", type: "building", cx: 0, cy: -40, w: 420, h: 180, rot: 0 },
    { id: "e2", type: "parking", cx: -300, cy: 90, w: 150, h: 180, rot: 0 },
    { id: "e3", type: "pond", cx: 250, cy: 120, w: 200, h: 130, rot: 0, det: { depth: 8, freeboard: 1, slope: 3 } },
  ],
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
// The planner mounts and hydrates the seeded site; give it a beat + wait for the rail.
await page.waitForTimeout(3500);

// If a landing/workspace switch is needed, click into the Site Planner.
try { await page.getByRole("button", { name: /site planner/i }).first().click({ timeout: 1500 }); } catch {}
await page.waitForTimeout(1500);

// ---------- B721 — left rail order + SVG icons ----------
const railLabels = await page.evaluate(() => {
  // the rail buttons carry a title = the tab label and render a RailIcon <svg>
  const btns = [...document.querySelectorAll('button[title]')].filter((b) => {
    const t = b.getAttribute("title");
    return ["Parcel", "Analysis", "Yield", "References", "Standards"].includes(t) && b.querySelector("svg");
  });
  // de-dupe by title preserving DOM order
  const seen = new Set(); const out = [];
  for (const b of btns) { const t = b.getAttribute("title"); if (!seen.has(t)) { seen.add(t); out.push(t); } }
  return out;
});
ok(railLabels.slice(0, 5).join(",") === "Parcel,Analysis,Yield,References,Standards",
  `B721 rail order = Parcel,Analysis,Yield,References,Standards (got: ${railLabels.join(",")})`);
ok(railLabels.length >= 5, "B721 all five rail buttons render an inline SVG icon");

// ---------- B732 — the B718 KPI strip was REVERTED (owner didn't want numbers on the canvas) ----------
const strip = page.locator('[data-testid="yield-kpi-strip"]');
await page.waitForTimeout(600);
ok(!(await strip.count()), "B732 the on-canvas Yield KPI strip is gone (reverted)");

// Open the Parcel panel (needed for the B720 ops-row checks below).
await page.locator('button[title="Parcel"]').first().click();
await page.waitForTimeout(600);

// ---------- B720 — ops row + click-to-pick merge ----------
const menuPanel = page.locator('[data-testid="left-menu-panel"]');
const opsAdd = menuPanel.getByRole("button", { name: /^＋ Add/ });
ok(await opsAdd.isVisible().catch(() => false), "B720 ops row has an Add ▾ button");
const opsSplit = menuPanel.getByRole("button", { name: /✂ Split/ });
const opsMerge = menuPanel.getByRole("button", { name: /⧉ Merge/ });
ok(await opsSplit.isVisible().catch(() => false), "B720 ops row has a Split button");
ok(await opsMerge.isVisible().catch(() => false), "B720 ops row has a Merge button");
ok(await menuPanel.getByText("Active", { exact: true }).first().isVisible().catch(() => false),
  "B720 'Active' microlabel over the checkbox column");

// Enter pick mode, click two parcel rows, expect the banner + enabled Merge.
await opsMerge.click();
await page.waitForTimeout(300);
const rows = menuPanel.locator("button", { hasText: /^Parcel/ });
await rows.nth(0).click(); await page.waitForTimeout(150);
await rows.nth(1).click(); await page.waitForTimeout(250);
const bannerTxt = await page.locator("text=/parcels picked/").first().innerText().catch(() => "");
ok(/2 parcels picked/.test(bannerTxt), `B720 click-to-pick collected 2 parcels (banner: “${bannerTxt}”)`);

// ---------- B718/B719/B722 — open the Yield panel and read the rows ----------
await page.locator('button[title="Yield"]').first().click();
await page.waitForTimeout(700);
const panelTxt = (await menuPanel.innerText()).replace(/\s+/g, " ");
ok(/Detention storage/.test(panelTxt) && /ac-ft/.test(panelTxt), "B719 Yield shows a 'Detention storage … ac-ft' row");
ok(/Prismoidal, screening only/.test(panelTxt), "B719 detention-storage caveat note present");
ok(!/\bFAR\b/.test(panelTxt), "B722 the FAR row is gone from the Yield panel");
// Impervious row carries a title tooltip defining what it sums.
const impTitle = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[title]')].find((n) => /What counts as impervious/.test(n.getAttribute("title") || ""));
  return el ? el.getAttribute("title") : "";
});
ok(/building footprints/.test(impTitle) && /NOT counted as impervious/.test(impTitle),
  "B722 Impervious row has the definition tooltip");

// Clicking the strip opens Yield (verify wiring): switch away then click strip.
await page.locator('button[title="Standards"]').first().click();
await page.waitForTimeout(400);
// ---------- B721 — Standards teaching lines ----------
const stdTxt = (await menuPanel.innerText()).replace(/\s+/g, " ");
ok(/Defaults for new elements/.test(stdTxt), "B721 Standards intro reads 'Defaults for new elements…'");
// The setback caption lives inside the "Parcels" section, collapsed by default — expand it.
try { await menuPanel.getByText("Parcels", { exact: true }).first().click({ timeout: 1500 }); } catch {}
await page.waitForTimeout(400);
const stdTxt2 = (await menuPanel.innerText()).replace(/\s+/g, " ");
ok(/Per-edge setbacks live on the parcel/.test(stdTxt2), "B721 per-edge setback cross-link caption present (Parcels section)");

console.log(`\nB719–B722 (+B732 revert): ${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
