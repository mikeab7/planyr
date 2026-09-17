/* Self-verification for B1718656 (NEW-1 — Sites list: the org/entity badge landed on top of the
 * "no boundary" status chip). Repro: on the owner's real account (build 3b6756c), hovering a row
 * carrying both the grey "no boundary" chip (B845089/B1424624's `rowFlagGroupStyle`) and the
 * orange org/team badge (B885136/B1614656's `sharedWithDisplay` chip) painted the badge over the
 * chip's right-hand end. Root cause: the badge was a zero-width, absolutely-positioned overlay
 * anchored at a fixed x (right before the "locate" slot) that grew LEFT regardless of what else
 * sat there — B1614656 only ever measured it against the site NAME, so a second sibling sharing
 * that same edge (the status-flag group) was never accounted for. The fix puts the badge back IN
 * SEQUENCE as a real (non-zero-width) flex item after the flags and before the locate slot, so
 * the browser's own flex-shrink pass keeps every sibling clear of it.
 *
 * This sandbox is signed out, so `myTeams` never resolves a real team — `sharedWithDisplay` always
 * answers "unknown" here (the plain share glyph, ~12px), never "team" (the up-to-3-letter initials
 * pill, ~30-36px) — the same structural limit already documented on V466400/B845088. Both variants
 * share the exact same layout wrapper (this item's fix touches the wrapper, not the pill), so the
 * glyph case fully exercises the mechanism under test; the wider pill's own on-screen width is a
 * live-verify item (see VERIFICATION.md).
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:5173/") + "#/site";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => { (cond ? pass++ : fail++); console.log(`  ${cond ? "PASS" : "FAIL"} — ${name}${extra ? " · " + extra : ""}`); };

const now = Date.now();
const parcelAt = (w = 200, h = 200) => [{ id: "pp1", active: true, points: [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }] }];
const mk = (id, name, status, ageMs, lat, lon, opts = {}) => ({
  id, groupId: id, site: name, name: "Plan 1", status, origin: { lat, lon }, county: "harris",
  // No parcels ⇒ siteBoundaryInfo reads acres:0 ⇒ the "no boundary" flag renders (B845089).
  parcels: opts.parcels !== undefined ? opts.parcels : [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: now - ageMs, teamId: opts.teamId || null,
});
const sites = {
  // The owner's exact repro shape: a short name ("Untitled site") so B1614656's name-truncation
  // guard never engages — isolates the chip-vs-badge collision from the name-vs-badge one.
  s1: mk("s1", "Untitled site", "pursuit", 1 * 86400_000, 29.78, -95.39, { teamId: "team-hip" }),
  // A long name on the SAME flag+badge combination — re-checks B1614656's original concern
  // (the badge must still never cover the name) under the new in-sequence layout.
  s2: mk("s2", "A Very Long Site Name That Should Truncate Eventually", "pursuit", 2 * 86400_000, 29.80, -95.40, { teamId: "team-hip" }),
  // Adjacent case: a status chip with NO entity badge (unshared site, no boundary).
  s3: mk("s3", "Chip Only Site", "pursuit", 3 * 86400_000, 29.82, -95.41, {}),
  // Adjacent case: an entity badge with NO status chip (shared site, has a boundary).
  s4: mk("s4", "Badge Only Site", "pursuit", 4 * 86400_000, 29.84, -95.42, { teamId: "team-hip", parcels: parcelAt() }),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
  localStorage.removeItem('planarfit:sitesGroups:v1');
  localStorage.removeItem('planarfit:sitesPanelClosed:v1');
} catch (e) {} })();`;

// Sub-pixel antialiasing/rounding slack, never a tolerance for a real overlap.
const EPS = 0.5;

async function measureRow(page, nameText) {
  const row = page.locator('div[title*="Open site"]').filter({ hasText: nameText }).first();
  if (!(await row.count())) return null;
  await row.hover();
  await page.waitForTimeout(250);
  const chip = row.locator('span[title="No boundary drawn yet"]').first();
  const badge = row.locator('span[title="Shared"], span[title^="Shared with"]').first();
  const nameSpan = row.locator("span").first();
  const [chipBox, badgeBox, nameBox] = await Promise.all([
    chip.boundingBox().catch(() => null),
    badge.boundingBox().catch(() => null),
    nameSpan.boundingBox().catch(() => null),
  ]);
  return { chipBox, badgeBox, nameBox };
}

async function runAtWidth(width, height, label, expandPanel) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-sites-badge-chip-collision");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2000);
  if (expandPanel) {
    await page.locator('button[title="Expand the sites panel"]').first().click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(400);
  }

  const short = await measureRow(page, "Untitled site");
  ok(`[${label}] the "Untitled site" row (short name, no boundary, shared) renders`, !!short);
  if (short) {
    const { chipBox, badgeBox, nameBox } = short;
    console.log(`  [${label}] name  x=${nameBox?.x.toFixed(1)} w=${nameBox?.width.toFixed(1)} right=${(nameBox.x + nameBox.width).toFixed(1)}`);
    console.log(`  [${label}] chip  x=${chipBox?.x.toFixed(1)} w=${chipBox?.width.toFixed(1)} right=${(chipBox.x + chipBox.width).toFixed(1)}`);
    console.log(`  [${label}] badge x=${badgeBox?.x.toFixed(1)} w=${badgeBox?.width.toFixed(1)} right=${(badgeBox.x + badgeBox.width).toFixed(1)}`);
    ok(`[${label}] the "no boundary" chip's right edge is at or before the badge's left edge`,
      chipBox && badgeBox && (chipBox.x + chipBox.width) <= badgeBox.x + EPS,
      `chip.right=${(chipBox.x + chipBox.width).toFixed(1)} badge.left=${badgeBox.x.toFixed(1)} gap=${(badgeBox.x - (chipBox.x + chipBox.width)).toFixed(1)}`);
  }

  const long = await measureRow(page, "A Very Long Site Name");
  ok(`[${label}] the long-name row (long name, no boundary, shared) renders`, !!long);
  if (long) {
    const { chipBox, badgeBox, nameBox } = long;
    console.log(`  [${label}] long-name name  x=${nameBox?.x.toFixed(1)} w=${nameBox?.width.toFixed(1)} right=${(nameBox.x + nameBox.width).toFixed(1)}`);
    console.log(`  [${label}] long-name chip  x=${chipBox?.x.toFixed(1)} w=${chipBox?.width.toFixed(1)} right=${(chipBox.x + chipBox.width).toFixed(1)}`);
    console.log(`  [${label}] long-name badge x=${badgeBox?.x.toFixed(1)} w=${badgeBox?.width.toFixed(1)} right=${(badgeBox.x + badgeBox.width).toFixed(1)}`);
    ok(`[${label}] on a long name, the site name still collides with neither the chip nor the badge (B1614656)`,
      nameBox && chipBox && badgeBox && (nameBox.x + nameBox.width) <= chipBox.x + EPS && (chipBox.x + chipBox.width) <= badgeBox.x + EPS,
      `name.right=${(nameBox.x + nameBox.width).toFixed(1)} chip.left=${chipBox.x.toFixed(1)} chip.right=${(chipBox.x + chipBox.width).toFixed(1)} badge.left=${badgeBox.x.toFixed(1)}`);
  }

  // Adjacent case: a status chip with no entity badge — the chip alone must still render with
  // nothing to collide with (no badge span at all on this row).
  const chipOnlyRow = page.locator('div[title*="Open site"]').filter({ hasText: "Chip Only Site" }).first();
  ok(`[${label}] "Chip Only Site" row renders`, await chipOnlyRow.count() > 0);
  if (await chipOnlyRow.count()) {
    await chipOnlyRow.hover();
    await page.waitForTimeout(200);
    const chipOnly = chipOnlyRow.locator('span[title="No boundary drawn yet"]').first();
    const badgeOnRow = chipOnlyRow.locator('span[title="Shared"], span[title^="Shared with"]').first();
    ok(`[${label}] "Chip Only Site" shows the chip and no badge`, await chipOnly.count() > 0 && await badgeOnRow.count() === 0);
  }

  // Adjacent case: an entity badge with no status chip (a real boundary) — the badge alone.
  const badgeOnlyRow = page.locator('div[title*="Open site"]').filter({ hasText: "Badge Only Site" }).first();
  ok(`[${label}] "Badge Only Site" row renders`, await badgeOnlyRow.count() > 0);
  if (await badgeOnlyRow.count()) {
    await badgeOnlyRow.hover();
    await page.waitForTimeout(200);
    const chipOnRow = badgeOnlyRow.locator('span[title="No boundary drawn yet"]').first();
    const badgeOnly = badgeOnlyRow.locator('span[title="Shared"], span[title^="Shared with"]').first();
    ok(`[${label}] "Badge Only Site" shows the badge and no chip`, await badgeOnly.count() > 0 && await chipOnRow.count() === 0);
  }

  await page.screenshot({ path: new URL(`./screens/sites-badge-chip-${label}.png`, import.meta.url) }).catch(() => {});
  ok(`[${label}] no uncaught page errors`, errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();
  await browser.close();
}

async function run() {
  // "Narrow": the Sites panel's real fixed desktop width (232px — MapFinder.jsx's own comments
  // name this exact figure). "Wide": the phone-narrow layout, which opens at up to 320px
  // (`min(320px, calc(100vw - 16px))`) — a genuinely wider container for the same row.
  await runAtWidth(1290, 900, "narrow-232", false);
  await runAtWidth(500, 900, "wide-320", true);

  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(2); });
