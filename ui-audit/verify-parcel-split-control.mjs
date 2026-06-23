/* Regression guard for B416 — the "Split a parcel" control must stay PRESENT and
 * REACHABLE in the Site Planner. A silent "the control disappeared" regression
 * (silence-is-a-crash class) is exactly what this asserts can't recur uncaught.
 *
 * Split must be reachable from BOTH homes:
 *   • the right-rail "Boundary ▾" flyout  (the drafting-tools home), and
 *   • the Parcel panel, beside "Merge parcels"  (the panel home a user reaches for
 *     after B383 surfaced "＋ Add parcel" / parcel ops into the panel — Split is the
 *     inverse of Merge and belongs next to it).
 * Plus a full end-to-end smoke test: activate → capture cut points → finish
 * (Enter / double-click) → commit (performSplit) splits one parcel into two.
 *
 * Logged-out against the built app (vite preview on :4173). No network needed — the
 * parcel is seeded into localStorage; the external GIS hosts the planner probes are
 * CORS-blocked in the sandbox (environmental noise, filtered out below).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// A georeferenced site with ONE rectangular parcel, centred on the origin so the
// planner fits it near the canvas centre — a clean target for the cut line.
const parcel = { id: "pc1", locked: false, points: [{ x: -360, y: -240 }, { x: 360, y: -240 }, { x: 360, y: 240 }, { x: -360, y: 240 }] };
// NB: keep the site name free of the word "split"/"parcel" — Playwright text matching
// is case-insensitive substring, so such a name would collide with the button locators.
const site = {
  id: "uiaudit-b416", groupId: "uiaudit-b416", site: "Katy Tract Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [parcel], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};

const seedFor = (s) => `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify({ '${s.id}': ${JSON.stringify(s)} }));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(s.id)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log("  ✅", label); } else { fail++; console.log("  ❌", label); } };
// The sandbox egress proxy CORS-blocks the external GIS hosts the planner probes — that
// network noise is environmental, not an app bug. Count only genuine app errors.
const appErrors = (errs) => errs.filter((e) => !/CORS policy|Failed to load resource|net::ERR|ERR_FAILED|f=json|arcgis|hctx|houstontx|fema|usgs|esri|geogims/i.test(e));

const parcelCount = (page) => page.evaluate(() => {
  const el = [...document.querySelectorAll("*")].find((n) => /^Parcels · \d+$/.test((n.textContent || "").trim()) && n.children.length === 0);
  return el ? parseInt(el.textContent.replace(/\D/g, ""), 10) : null;
});

async function open() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seedFor(site));
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1700);
  return { ctx, page, errors };
}

// Open the Parcel panel (the rail tab TOGGLES, so guard on a panel-only marker).
async function openParcelPanel(page) {
  const marker = page.getByText(/^Parcels · \d+$/);
  if (!(await marker.first().isVisible().catch(() => false))) {
    try { await page.locator('button[title="Parcel"]').first().click({ timeout: 5000 }); } catch {}
    await page.waitForTimeout(400);
  }
}

const splitToolArmed = (page) => page.getByText(/Cut a parcel: click points/).count().then((n) => n > 0);

// ---------- A: reachable from the right-rail Boundary ▾ menu ----------
console.log("A — reachable from the right-rail Boundary ▾ menu:");
{
  const { ctx, page, errors } = await open();
  const boundaryBtn = page.locator('button[title="Draw or split a parcel boundary"]');
  ok(await boundaryBtn.count() > 0 && await boundaryBtn.first().isVisible(), "rail 'Boundary ▾' button present & visible");
  await boundaryBtn.first().click();
  await page.waitForTimeout(300);
  const railSplit = page.getByRole("button", { name: "Split a parcel", exact: true });
  ok(await railSplit.count() > 0 && await railSplit.first().isVisible(), "Boundary menu opens with a 'Split a parcel' item");
  await railSplit.first().click();
  await page.waitForTimeout(300);
  ok(await splitToolArmed(page), "clicking it arms the Split tool (status hint 'Cut a parcel: click points')");
  await page.screenshot({ path: OUT + "b416-rail-split.png" });
  const ae = appErrors(errors); ok(ae.length === 0, `no app console/page errors (saw ${ae.length}; ${errors.length - ae.length} env GIS lines ignored)`);
  if (ae.length) console.log("    app errors:", ae.slice(0, 5));
  await ctx.close();
}

// ---------- B: reachable from the Parcel panel (beside Merge) ----------
console.log("B — reachable from the Parcel panel (the post-B383 home, beside Merge):");
{
  const { ctx, page, errors } = await open();
  await openParcelPanel(page);
  const panelSplit = page.locator('button[title^="Split a parcel"]');
  const present = (await panelSplit.count()) > 0 && (await panelSplit.first().isVisible().catch(() => false));
  ok(present, "Parcel panel shows a 'Split a parcel' control");
  await page.screenshot({ path: OUT + "b416-panel-split.png" });
  if (present) {
    await panelSplit.first().click();
    await page.waitForTimeout(300);
    ok(await splitToolArmed(page), "clicking it arms the Split tool");
  } else {
    ok(false, "arm-the-tool check skipped — the panel control is absent (regression)");
  }
  const ae = appErrors(errors); ok(ae.length === 0, `no app console/page errors (saw ${ae.length}; ${errors.length - ae.length} env GIS lines ignored)`);
  if (ae.length) console.log("    app errors:", ae.slice(0, 5));
  await ctx.close();
}

// ---------- C: end-to-end split (activate → points → finish → commit) ----------
console.log("C — end-to-end: draw a cut across the parcel → it splits 1 → 2:");
{
  const { ctx, page, errors } = await open();
  await openParcelPanel(page);
  ok((await parcelCount(page)) === 1, "starts at Parcels · 1");

  // Arm split via the rail menu (proven path), then cut.
  await page.locator('button[title="Draw or split a parcel boundary"]').first().click();
  await page.waitForTimeout(250);
  await page.getByRole("button", { name: "Split a parcel", exact: true }).first().click();
  await page.waitForTimeout(250);

  // Find the parcel polygon's real screen rect (largest <polygon> on the canvas), then
  // cut a horizontal line through its vertical centre, from just outside the left edge
  // to just outside the right edge — crossing both side edges → a clean top/bottom split.
  const rect = await page.evaluate(() => {
    const polys = [...document.querySelectorAll('svg[aria-label="Site plan canvas"] polygon')];
    let best = null, bestA = 0;
    for (const p of polys) {
      const r = p.getBoundingClientRect();
      const a = r.width * r.height;
      if (a > bestA) { bestA = a; best = r; }
    }
    return best ? { x: best.x, y: best.y, w: best.width, h: best.height } : null;
  });
  ok(!!rect, "located the parcel polygon on the canvas");
  const midY = rect.y + rect.h / 2;
  await page.mouse.click(rect.x - 12, midY);          // point 1 — just left of the parcel
  await page.waitForTimeout(200);
  await page.mouse.dblclick(rect.x + rect.w + 12, midY); // point 2 + finish (double-click)
  await page.waitForTimeout(700);
  ok((await parcelCount(page)) === 2, "the cut splits the parcel → Parcels · 2");
  await page.screenshot({ path: OUT + "b416-split-done.png" });

  const ae = appErrors(errors); ok(ae.length === 0, `no app console/page errors (saw ${ae.length}; ${errors.length - ae.length} env GIS lines ignored)`);
  if (ae.length) console.log("    app errors:", ae.slice(0, 5));
  await ctx.close();
}

await browser.close();
console.log(`\nParcel-split control (B416) verification: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
