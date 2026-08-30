/* Self-verification for B845088 (NEW-1 — shared-with shows the TEAM, never the people) and
 * B845089 (NEW-2 — the panel's right column is last-edited, never acreage). Owner reversed two
 * B859504 decisions after a live review; this is the sandbox half of proving the reversal shipped
 * correctly (logged-out / this-device mode — ATTEMPT-BEFORE-YOU-PARK).
 *
 * A signed-out build has no Supabase config here, so `teamId`/roster/element-recency network
 * reads never fire — `myTeams` resolves to [] immediately and the last-edited column falls back
 * to each seeded site's own `updatedAt`. Seeding a raw local record with a `teamId` is therefore a
 * SIMULATED "shared" row (teamId is normally a cloud-only concept) used to prove the render path
 * doesn't crash and falls back correctly (`kind:"unknown"` → the plain share glyph, per spec: "a
 * site whose team_id points at a team the viewer is no longer a member of"). Proving the chip
 * shows a REAL team NAME needs a signed-in roster, which this sandbox cannot reach — that half is
 * V466400/V466401 (Blocker: auth, real-data).
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/b845088-b845089/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

// A real parcel record — dissolvedParcelSqft (polyClip.js) needs `{ points, active }`, not a bare
// ring array (my first draft's mistake — a bare-array "parcel" silently fails isValidRing and the
// row reads "no boundary" even though a ring was supplied).
const parcelAt = (w = 200, h = 200) => [{ id: "pp1", active: true, points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] }];
const now = Date.now();
const mk = (id, groupId, site, status, lat, lon, opts = {}) => ({
  id, groupId, site, name: "Plan 1", status, origin: { lat, lon }, county: "harris",
  parcels: opts.parcels || [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: opts.updatedAt ?? now, teamId: opts.teamId || null,
});
// A1 (10 min ago, shared with an unresolvable team → plain glyph) / A2 (2h ago) / A3 (3d ago, no
// boundary drawn) — one status group, distinct edit times, so "Recently touched" order is checkable.
// P1/P2 share a groupId: P1 (the representative — highest updatedAt, sorted first by loadSitesList)
// carries no boundary; P2 (older, same group) is never rendered as its own row (folded into the
// group's one panel row per SitePlannerApp.jsx's siteGroups).
const sites = {
  a1: mk("a1", "a1", "Katy Recent", "active", 29.78, -95.39, { updatedAt: now - 10 * 60_000, teamId: "team-ghost", parcels: parcelAt() }),
  a2: mk("a2", "a2", "Brookshire Mid", "active", 29.77, -95.37, { updatedAt: now - 2 * 3600_000, parcels: parcelAt() }),
  a3: mk("a3", "a3", "Cypress Old, No Boundary", "active", 29.76, -95.40, { updatedAt: now - 3 * 86400_000 }),
  p1: mk("p1", "grp1", "Grouped Site", "pursuit", 29.75, -95.41, { updatedAt: now - 1 * 3600_000, parcels: parcelAt() }),
  p2: mk("p2", "grp1", "Grouped Site", "pursuit", 29.75, -95.41, { updatedAt: now - 5 * 3600_000, parcels: parcelAt() }),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
  localStorage.removeItem('planarfit:sitesGroups:v1');
  localStorage.removeItem('planarfit:sitesPanelClosed:v1');
} catch (e) {} })();`;

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`  ${cond ? "PASS" : "FAIL"} — ${name}${extra ? " · " + extra : ""}`); };

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-b845088-b845089-site-panel");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);

  // Expand the Pursuit group too (default collapse only closes complete/dead), so the grouped-site
  // row is on screen alongside the Active group.
  const activeSection = page.locator("div").filter({ hasText: "Katy Recent" }).first();
  ok("Sites panel rendered at all", await activeSection.count() > 0);

  // ---- B845089 — no acreage anywhere in a group header ----
  const headerRow = page.locator('button[title="Collapse"], button[title="Expand"]').filter({ hasText: "Active" }).first();
  const headerText = await headerRow.innerText().catch(() => "");
  ok("B845089 group header carries no acreage total ('AC')", !/\bAC\b/.test(headerText), JSON.stringify(headerText));
  ok("B845089 group header still carries its count", /\d/.test(headerText), JSON.stringify(headerText));

  // ---- B845089 — the right column reads as a compact last-edited label, never a bare acreage
  // number. Katy Recent (10 min old) should read minutes; Brookshire Mid (2h) should read hours.
  // `div[title*="Open site"]` is the OUTER row div specifically (the only div in a row carrying
  // that title) — a bare `div:has-text(name)` also matches the row's inner name-wrapper div, which
  // does NOT contain the last-edited column (a sibling, not a descendant), and Playwright's
  // document-order `.last()` picked that narrower inner div instead of the whole row.
  const rowText = async (name) => (await page.locator('div[title*="Open site"]').filter({ hasText: name }).first().innerText().catch(() => "")) || "";
  const katyRow = await rowText("Katy Recent");
  const brookRow = await rowText("Brookshire Mid");
  ok("B845089 recent row shows a minutes label ('Nm')", /\b\d+m\b/.test(katyRow), JSON.stringify(katyRow));
  ok("B845089 2h-old row shows an hours label ('Nh')", /\b\d+h\b/.test(brookRow), JSON.stringify(brookRow));
  ok("B845089 no decimal-acreage-shaped number on the recent row (e.g. '12.3')", !/\b\d+\.\d\b/.test(katyRow), JSON.stringify(katyRow));

  // ---- B845089 — "no boundary" moved next to the NAME, and a boundary-less site still shows a
  // last-edited value (never a blank cell) ----
  const cypressRow = await rowText("Cypress Old, No Boundary");
  ok("B845089 no-boundary flag still renders", /no boundary/i.test(cypressRow), JSON.stringify(cypressRow));
  ok("B845089 a boundary-less site still shows a last-edited value (days, here)", /\b\d+d\b/.test(cypressRow), JSON.stringify(cypressRow));

  // ---- B845089 — default sort is "Recently touched", and rows within the group actually order
  // by it (10m above 2h above 3d) ----
  const sortSelect = page.locator('select[aria-label="Sort sites within each group"]');
  ok("B845089 default sort is 'recent'", (await sortSelect.inputValue().catch(() => "")) === "recent");
  const namesInOrder = await page.locator('div[title*="Open site"]').evaluateAll((els) =>
    els.map((el) => el.querySelector("span")?.textContent || ""));
  const iKaty = namesInOrder.findIndex((t) => t.includes("Katy Recent"));
  const iBrook = namesInOrder.findIndex((t) => t.includes("Brookshire Mid"));
  const iCypress = namesInOrder.findIndex((t) => t.includes("Cypress Old"));
  ok("B845089 'Recently touched' actually orders rows (10m above 2h above 3d)",
    iKaty >= 0 && iBrook >= 0 && iCypress >= 0 && iKaty < iBrook && iBrook < iCypress,
    `Katy=${iKaty} Brookshire=${iBrook} Cypress=${iCypress}`);

  // ---- B845089 — a group's collapsed representative reflects the group's own most-recent edit
  // (grp1's p1 is 1h old, its sibling p2 3h older — the representative is p1, whose OWN updatedAt
  // already carries the group max here since loadSitesList sorts desc; this proves the wiring
  // renders that value correctly, i.e. an hours label, not a stale/blank one). ----
  await page.locator('button[title="Expand"]').filter({ hasText: "Pursuit" }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  const groupedRow = await rowText("Grouped Site");
  ok("B845089 grouped-site row shows an hours label (its group's own most-recent edit)", /\b\d+h\b/.test(groupedRow), JSON.stringify(groupedRow));

  await page.screenshot({ path: OUT + "sites-panel-default.png" });

  // ---- B845088 — no roster-monogram artifacts remain anywhere (the old circular initials badge) ----
  const circleBadges = await page.$$eval("span", (spans) =>
    spans.filter((s) => {
      const st = s.getAttribute("style") || "";
      return /border-radius:\s*50%/.test(st) && /width:\s*15px/.test(st) && /^[A-Z]{1,2}$/.test((s.textContent || "").trim());
    }).length);
  ok("B845088 no circular initials monogram remains in the DOM", circleBadges === 0, `${circleBadges} found`);

  // ---- B845088 — an unshared site (Brookshire Mid, no teamId) shows no shared indicator ----
  ok("B845088 unshared site's row carries no 'Shared' text", !/shared/i.test(brookRow), JSON.stringify(brookRow));

  // ---- B845088 — a site whose team can't be resolved (signed out here — same case as "the
  // viewer is no longer a member") shows the plain glyph, not a blank and not a crash ----
  const katySharedGlyph = await page.locator('div[title*="Open site"]').filter({ hasText: "Katy Recent" }).first().locator('span[title="Shared"] svg').count();
  ok("B845088 unresolvable-team row falls back to the plain share glyph (not blank, not a crash)", katySharedGlyph >= 1, `${katySharedGlyph} glyph(s)`);

  ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));

  // ---- Bonus (flagged as unverified in the brief): narrow/phone layout doesn't break either change ----
  await ctx.close();
  const narrowCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await narrowCtx.addInitScript(seed);
  const narrowPage = await narrowCtx.newPage();
  const narrowErrors = [];
  narrowPage.on("pageerror", (e) => narrowErrors.push(String(e)));
  await narrowPage.goto(BASE, { waitUntil: "load" });
  await narrowPage.waitForTimeout(2500);
  // The narrow rail starts collapsed (per MapFinder's own narrow behavior) — open it.
  await narrowPage.locator('button[title="Expand the sites panel"]').first().click().catch(() => {});
  await narrowPage.waitForTimeout(400);
  const narrowKatyRow = (await narrowPage.locator('div[title*="Open site"]').filter({ hasText: "Katy Recent" }).first().innerText().catch(() => "")) || "";
  ok("narrow layout: last-edited label still renders", /\b\d+m\b/.test(narrowKatyRow), JSON.stringify(narrowKatyRow));
  await narrowPage.screenshot({ path: OUT + "sites-panel-narrow.png" });
  ok("narrow layout: no uncaught page errors", narrowErrors.length === 0, narrowErrors.slice(0, 3).join(" | "));
  await narrowCtx.close();

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(2); });
