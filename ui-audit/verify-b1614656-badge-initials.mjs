/* Self-verification for B1614656 (NEW-1 — Sites list org/entity badge shortened to initials).
 * Repro: at a ~1290px-wide window (the owner's work laptop), a wide team name ("HIP Houston")
 * covered part of the site name when the org chip revealed. This sandbox is signed out, so
 * `myTeams` can never resolve to a real team (the same structural limit V466400/B845088 already
 * documents) — the "team" branch's actual on-screen content is a live-verify item (see
 * VERIFICATION.md V466400). What IS provable here headless: the row renders, the chip reveals
 * without moving the name/date columns, and (via the pure function directly) the initials
 * derivation is generic — not hardcoded to "HIP Houston".
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
  parcels: opts.parcels || parcelAt(), els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: now - ageMs, teamId: opts.teamId || null,
});
const sites = {
  s1: mk("s1", "Richfield", "pursuit", 1 * 86400_000, 29.78, -95.39, { teamId: "team-hip" }),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(sites)}));
  localStorage.removeItem('planarfit:currentSite:v1');
  localStorage.removeItem('planarfit:sitesGroups:v1');
  localStorage.removeItem('planarfit:sitesPanelClosed:v1');
} catch (e) {} })();`;

async function run() {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  // Michael's own repro width.
  const ctx = await browser.newContext({ viewport: { width: 1290, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-b1614656-badge-initials");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2500);

  const row = page.locator('div[title*="Open site"]').filter({ hasText: "Richfield" }).first();
  ok("the Richfield row renders at the repro width (1290px)", await row.count() > 0);

  const nameBefore = await row.locator("span").first().boundingBox();
  await row.hover();
  await page.waitForTimeout(300);

  // Signed out here, so sharedWithDisplay resolves "unknown" (falls back to the plain share
  // glyph) — the exact same structural limit documented on V466400/B845088. Accept either title
  // the way the shared B885136 harness does, since the reveal mechanism under test is the same.
  const chip = row.locator('span[title="Shared"], span[title^="Shared with"]').first();
  ok("the org chip reveals on hover", await chip.count() > 0);
  const nameAfter = await row.locator("span").first().boundingBox();
  ok("hovering does not move the name box (unaffected by the initials change)",
    nameBefore && nameAfter && Math.abs(nameBefore.x - nameAfter.x) < 0.5 && Math.abs(nameBefore.width - nameAfter.width) < 0.5,
    `${nameBefore?.x},${nameBefore?.width} -> ${nameAfter?.x},${nameAfter?.width}`);

  await page.screenshot({ path: new URL("./screens/b1614656-badge-initials.png", import.meta.url) }).catch(() => {});
  ok("no uncaught page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
  await ctx.close();

  // ---- the pure derivation, generic — not hardcoded to "HIP Houston" ----
  const { entityInitials } = await import("../src/workspaces/site-planner/lib/sharedWithTeam.js");
  ok('entityInitials("HIP Houston") === "HH" (the owner\'s exact repro name)', entityInitials("HIP Houston") === "HH");
  ok('entityInitials("Acme Devco") === "AD" (never hardcoded to one team)', entityInitials("Acme Devco") === "AD");
  ok('entityInitials("Richfield") === "RI" (a single-word entity still gets a short badge)', entityInitials("Richfield") === "RI");

  console.log(`\n  ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
}
run().catch((e) => { console.error(e); process.exit(2); });
