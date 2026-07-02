/* rename-revert verification — the two paths where a Site Planner rename used to snap back to
 * the old name after Enter:
 *
 *   Fix A (primary) — the HEADER breadcrumb dropdown in the PLANNER view. There `onRenameProject`
 *     is wired, and commitRename used to skip the local-list refresh on that branch, so the row you
 *     just edited (and the crumb) kept the OLD name → looked like the rename reverted.
 *   Fix B — the MAP's YOUR SITES list for a MULTI-PLAN site. The list passes a representative
 *     *plan* id; renameSiteGroup treated it as a group id and (for a non-anchor plan) matched no
 *     plans → nothing saved → revert. Now the id is resolved to its group first.
 *
 * Logged-out (the sandbox can't sign in): seed sites into localStorage, drive the real UI, assert
 * on the rendered name AND the persisted store. Each fix runs in its OWN browser context (Fix A
 * boots into the planner via currentSite; Fix B boots straight to the map) so a hidden second
 * header can't intercept clicks. Run: vite preview on :4173, then
 *   node ui-audit/verify-rename-revert.mjs */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SITES_KEY = "planarfit:sites:v1";
const CUR_KEY = "planarfit:currentSite:v1";
const now = Date.now();

// s1 — a single-plan site we open in the PLANNER (Fix A path: rename via the breadcrumb dropdown).
// g2/p3 — a MULTI-PLAN site (group g2): anchor g2 (older) + sibling p3 (NEWER, so the map picks p3
// as the row's representative — the exact shape that broke Fix B).
const sites = {
  s1: { id: "s1", groupId: "s1", site: "Schiel Rd", name: "Concept A", status: "active",
        origin: { lat: 29.78, lon: -95.55 }, county: "harris",
        parcels: [{ id: "p1", points: [{ x: -600, y: -400 }, { x: 600, y: -400 }, { x: 600, y: 400 }, { x: -600, y: 400 }] }],
        els: [], updatedAt: now },
  g2: { id: "g2", groupId: "g2", site: "Katy West", name: "Concept A", status: "pursuit",
        origin: { lat: 29.74, lon: -95.80 }, county: "harris",
        parcels: [{ id: "p2", points: [{ x: -300, y: -300 }, { x: 300, y: -300 }, { x: 300, y: 300 }, { x: -300, y: 300 }] }],
        els: [], updatedAt: now - 5000 },
  p3: { id: "p3", groupId: "g2", site: "Katy West", name: "Concept B", status: "pursuit",
        origin: { lat: 29.74, lon: -95.80 }, county: "harris",
        parcels: [{ id: "p3a", points: [{ x: -200, y: -200 }, { x: 200, y: -200 }, { x: 200, y: 200 }, { x: -200, y: 200 }] }],
        els: [], updatedAt: now }, // newest → the map's representative for group g2
};
// `withCurrent` controls whether we boot into the planner (s1 open) or the map. Guarded so a
// RELOAD (our persistence check) does NOT re-seed over the rename we just made.
const seedScript = (withCurrent) => `(() => { try {
  if (localStorage.getItem("__rrev_seeded__")) return;
  localStorage.setItem(${JSON.stringify(SITES_KEY)}, ${JSON.stringify(JSON.stringify(sites))});
  ${withCurrent ? `localStorage.setItem(${JSON.stringify(CUR_KEY)}, "s1");` : `localStorage.removeItem(${JSON.stringify(CUR_KEY)});`}
  localStorage.setItem("__rrev_seeded__", "1");
} catch (e) {} })();`;

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`  ${pass ? "✅ PASS" : "❌ FAIL"} — ${name}${detail ? "  · " + detail : ""}`); };
const nameInStore = (page, id) => page.evaluate(([k, sid]) => { try { const o = JSON.parse(localStorage.getItem(k)) || {}; return (o[sid] || {}).site || ""; } catch (_) { return "<parse-error>"; } }, [SITES_KEY, id]);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const pageErrors = [];

/* ───────────────────────── Fix A — planner breadcrumb dropdown rename ───────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(seedScript(true));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push("A: " + e));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  const crumb = page.locator('button[title="Switch project"]').first();
  check("Fix A — booted into the planner with the project crumb showing", (await crumb.count()) > 0 && /Schiel/.test(await crumb.innerText().catch(() => "")));
  await crumb.click();
  await page.waitForTimeout(500);

  // Reveal + open the per-row manage menu for s1, then click Rename.
  await page.locator('[data-testid="project-row-s1"]').hover();
  await page.waitForTimeout(150);
  await page.locator('[data-testid="project-kebab-s1"]').click();
  await page.waitForTimeout(250);
  await page.locator('[data-testid="project-rename"]').click();
  await page.waitForTimeout(250);
  // Inline input is autofocused & pre-filled. Replace + Enter.
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Schiel Road Logistics");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);

  const aStore = await nameInStore(page, "s1");
  const aRowText = await page.locator('[data-testid="project-row-s1"]').innerText().catch(() => "");
  const aCrumbText = await crumb.innerText().catch(() => "");
  check("Fix A — store persisted the new name", aStore === "Schiel Road Logistics", `store="${aStore}"`);
  check("Fix A — the dropdown row shows the NEW name (no revert)", /Schiel Road Logistics/.test(aRowText), `row="${aRowText.replace(/\s+/g, " ").trim()}"`);
  check("Fix A — the header crumb shows the NEW name", /Schiel Road Logistics/.test(aCrumbText), `crumb="${aCrumbText.replace(/\s+/g, " ").trim()}"`);
  await page.screenshot({ path: OUT + "rename-revert-A-planner.png" });

  // Persistence: a full RELOAD re-boots the planner from the store (seed is guarded, so the rename
  // survives). The crumb must come back as the NEW name — proving it actually persisted.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);
  const aReload = await page.locator('button[title="Switch project"]').first().innerText().catch(() => "");
  check("Fix A — the new name survives a reload (persisted)", /Schiel Road Logistics/.test(aReload), `crumb="${aReload.replace(/\s+/g, " ").trim()}"`);
  await ctx.close();
}

/* ───────────────────────── Fix B — map multi-plan rename via YOUR SITES ───────────────────────── */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await ctx.addInitScript(seedScript(false)); // no currentSite → boot straight to the map
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push("B: " + e));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);

  const rowOf = (label) => page.locator('div[title*="right-click for status"]').filter({ hasText: label }).first();
  check("Fix B — the map shows the multi-plan site row", (await rowOf("Katy West").count()) > 0);

  const kbox = await rowOf("Katy West").boundingBox();
  await page.mouse.click(kbox.x + kbox.width / 2, kbox.y + kbox.height / 2, { button: "right" });
  await page.waitForTimeout(400);
  await page.locator("text=/Rename/i").first().click();
  await page.waitForTimeout(300);
  await page.keyboard.press("Control+A");
  await page.keyboard.type("Katy West Commerce");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);

  const bAnchor = await nameInStore(page, "g2");
  const bSibling = await nameInStore(page, "p3");
  const bRow = (await page.locator('div[title*="right-click for status"]').filter({ hasText: "Katy West Commerce" }).count()) > 0;
  check("Fix B — the whole group renamed: anchor plan g2", bAnchor === "Katy West Commerce", `g2="${bAnchor}"`);
  check("Fix B — the whole group renamed: sibling plan p3 (the map's representative id)", bSibling === "Katy West Commerce", `p3="${bSibling}"`);
  check("Fix B — the map row shows the new name (no revert)", bRow, `rowShows=${bRow}`);
  await page.screenshot({ path: OUT + "rename-revert-B-map.png" });
  await ctx.close();
}

check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 300));

await browser.close();
const passed = results.filter((r) => r.pass).length;
console.log(`\nrename-revert: ${passed}/${results.length} checks passed. Screens in ui-audit/screens/`);
process.exit(passed === results.length ? 0 : 1);
