/* auto-update-name verification — renaming the CURRENT project in the switcher must live-update
 * the Row-1 header crumb in the REVIEW workspace.
 *
 * The bug (owner report, screenshot): the switcher dropdown row updated to the new name but the
 * breadcrumb above it kept the OLD name. Review derives its `currentProject` from the URL route id
 * and never re-derived the NAME from the store on a same-tab rename, so the crumb went stale.
 *
 * Logged-out (the sandbox can't sign in): seed one site into the legacy local store, deep-link to
 * that project's Review route (#/project/<gid>/markup), rename the current project via the switcher,
 * and assert the store, the dropdown row, AND the header crumb all show the new name.
 * Run: vite preview on :4173, then  node ui-audit/verify-review-rename-header.mjs */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SITES_KEY = "planarfit:sites:v1";
const now = Date.now();

// One single-plan site (group gr1) named the OLD name we'll rename away from.
const sites = {
  gr1: { id: "gr1", groupId: "gr1", site: "8 South", name: "Concept A", status: "active",
         origin: { lat: 29.78, lon: -95.55 }, county: "harris",
         parcels: [{ id: "p1", points: [{ x: -600, y: -400 }, { x: 600, y: -400 }, { x: 600, y: 400 }, { x: -600, y: 400 }] }],
         els: [], updatedAt: now },
};
const seedScript = `(() => { try {
  if (localStorage.getItem("__rev_rename_seeded__")) return;
  localStorage.setItem(${JSON.stringify(SITES_KEY)}, ${JSON.stringify(JSON.stringify(sites))});
  localStorage.setItem("__rev_rename_seeded__", "1");
} catch (e) {} })();`;

const results = [];
const check = (name, pass, detail = "") => { results.push({ name, pass }); console.log(`  ${pass ? "✅ PASS" : "❌ FAIL"} — ${name}${detail ? "  · " + detail : ""}`); };
const nameInStore = (page, id) => page.evaluate(([k, sid]) => { try { const o = JSON.parse(localStorage.getItem(k)) || {}; return (o[sid] || {}).site || ""; } catch (_) { return "<parse-error>"; } }, [SITES_KEY, id]);

const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const pageErrors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
await ctx.addInitScript(seedScript);
const page = await ctx.newPage();
page.on("pageerror", (e) => pageErrors.push(String(e)));

// Deep-link straight into Review for the seeded project.
await page.goto(BASE + "#/project/gr1/markup", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(3500);

const crumb = page.locator('button[title="Switch project"]').first();
const bootText = await crumb.innerText().catch(() => "");
check("booted into Review with the current-project crumb showing the OLD name", (await crumb.count()) > 0 && /8 South/.test(bootText), `crumb="${bootText.replace(/\s+/g, " ").trim()}"`);

await crumb.click();
await page.waitForTimeout(500);
await page.locator('[data-testid="project-row-gr1"]').hover();
await page.waitForTimeout(150);
await page.locator('[data-testid="project-kebab-gr1"]').click();
await page.waitForTimeout(250);
await page.locator('[data-testid="project-rename"]').click();
await page.waitForTimeout(250);
await page.keyboard.press("Control+A");
await page.keyboard.type("Eight South");
await page.keyboard.press("Enter");
await page.waitForTimeout(900);

const store = await nameInStore(page, "gr1");
const rowText = await page.locator('[data-testid="project-row-gr1"]').innerText().catch(() => "");
const crumbText = await crumb.innerText().catch(() => "");
check("store persisted the new name", store === "Eight South", `store="${store}"`);
check("the dropdown row shows the NEW name", /Eight South/.test(rowText), `row="${rowText.replace(/\s+/g, " ").trim()}"`);
check("the header crumb LIVE-UPDATED to the new name (the fix)", /Eight South/.test(crumbText) && !/8 South(?!\w)/.test(crumbText.replace("Eight South", "")), `crumb="${crumbText.replace(/\s+/g, " ").trim()}"`);
await page.screenshot({ path: OUT + "review-rename-header.png" });

// Close the dropdown; the crumb must STILL read the new name (not just while the list is open).
await page.keyboard.press("Escape");
await page.waitForTimeout(400);
const afterClose = await crumb.innerText().catch(() => "");
check("crumb keeps the new name after the switcher closes", /Eight South/.test(afterClose), `crumb="${afterClose.replace(/\s+/g, " ").trim()}"`);

check("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ").slice(0, 300));

await ctx.close();
await browser.close();
const passed = results.filter((r) => r.pass).length;
console.log(`\nreview-rename-header: ${passed}/${results.length} checks passed. Screens in ui-audit/screens/`);
process.exit(passed === results.length ? 0 : 1);
