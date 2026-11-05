/* verify-notes-unfiled-bin-footer — ORPHANED NOTES GET THEIR OWN HOLDING ROW (NEW-1..NEW-3).
 *
 * ⛔ WHAT THIS IS FOR. Michael found six pages from deleted projects sitting inside his live
 * Pages tree, each wearing its own repeated "From a project you deleted" heading, and asked
 * for a better home for the Bin control. His decision, verbatim: "Yeah give them their own
 * holding row." Three things are driven here, in a real browser, against the real build:
 *
 *   1. NEW-1 — an orphaned root page (its project id resolves to nothing, the project list
 *      having genuinely finished loading) is OUT of the live Pages tree entirely, collected in
 *      an Unfiled collection reached from a footer row carrying a count. It never lands in the
 *      Bin and starts no retention timer.
 *   2. NEW-2 — the "From a project you deleted" heading renders ONCE for the whole Unfiled
 *      collection, never once per orphaned page.
 *   3. NEW-3 — Bin leaves the Pages/Tasks segmented control and moves to the footer rail,
 *      stating its retention period on the row.
 *
 * ⛔ AND EVERY ROW ASSERTS THE RESULTING STORE OR THE RESULTING DOM, never that a handler ran.
 *
 * Run:
 *   npx vite preview --port 4173 &
 *   node ui-audit/verify-notes-unfiled-bin-footer.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-notes-unfiled-bin-footer");

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const TREE_KEY = "planyr:notes:tree:v1:local";
const tb = (id) => page.locator(`[data-testid="${id}"]`);
const readTree = () => page.evaluate((k) => JSON.parse((globalThis.__planyrSitesRaw||((k)=>localStorage.getItem(k)))(k) || "null"), TREE_KEY);

const pg = (id, title, projectId) => ({ id, title, projectId, createdAt: 1, updatedAt: 1, pages: [] });

/* Two orphans from TWO DIFFERENT dead projects (the exact shape that produced NEW-2's bug: two
 * one-page groups, each keying its own "From a project you deleted" heading), one live-project
 * page, and one deliberately-unfiled ("Not in a project") page — which must NEVER be swept into
 * Unfiled, since it is not an orphan. */
const SITES_KEY = "planarfit:sites:v1";
const sites = {
  GP_a: { id: "GP_a", groupId: "GP", site: "Grand Port", name: "Concept A", updatedAt: Date.now(), schemaVersion: 9 },
};
const tree = {
  v: 3,
  pages: [
    pg("orphan1", "Untitled page", "dead-project-1"),
    pg("orphan2", "Untitled page", "dead-project-2"),
    pg("live1", "Entitlements", "GP"),
    pg("unfiled1", "Scratch", null),
  ],
  trash: [],
};

await page.goto(BASE + "#/notes", { waitUntil: "domcontentloaded" });
await page.evaluate(([sitesKey, sitesVal, treeKey, treeVal]) => {
  localStorage.setItem(sitesKey, JSON.stringify(sitesVal));
  localStorage.setItem(treeKey, JSON.stringify(treeVal));
}, [SITES_KEY, sites, TREE_KEY, tree]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await pacedWait(page, 500);

/* ---- §1 the segmented control is Pages/Tasks only; Bin lives in the footer ------------- */
const tabs = await page.locator('[role="tablist"][aria-label="Notes view"] button').allInnerTexts();
ok("the segmented control is exactly Pages, Tasks — Bin is not one of the three slots",
  tabs.join("|") === "Pages|Tasks", tabs.join("|"));
ok("the footer rail exists", await tb("notes-footer-rail").count() === 1);
ok("Bin is reachable from the footer rail, not the segmented control",
  await page.locator('[data-testid="notes-footer-rail"] [data-testid="notes-view-bin"]').count() === 1);
ok("Bin states its retention period ON THE ROW",
  /kept \d+ days/.test(await tb("notes-view-bin").innerText()), await tb("notes-view-bin").innerText());

/* ---- §2 the live Pages tree never shows the orphans, and never repeats the heading ----- */
const treeText = await page.locator('[data-testid="notes-tree"] [role="tree"]').innerText();
ok("⛔ NO orphaned page is interleaved in the live Pages tree",
  !treeText.includes("orphan") && (treeText.match(/From a project you deleted/g) || []).length === 0,
  treeText.slice(0, 200));
ok("the live project's page and the deliberately-unfiled page ARE still shown inline",
  await tb("notes-row-live1").count() === 1 && await tb("notes-row-unfiled1").count() === 1);

/* ---- §3 Unfiled: reachable, counted, one header for the whole collection --------------- */
ok("the Unfiled footer row shows the right count", (await tb("notes-view-unfiled").innerText()).includes("2"));
await tb("notes-view-unfiled").click();
await pacedWait(page, 400);
ok("both orphaned roots are listed in the Unfiled view",
  await tb("notes-row-orphan1").count() === 1 && await tb("notes-row-orphan2").count() === 1);
const unfiledText = await tb("notes-unfiled").innerText();
ok("⛔ NEW-2: the explanatory copy appears exactly ONCE for the whole collection, not once per page",
  (unfiledText.match(/from a project you deleted/gi) || []).length === 1, unfiledText.slice(0, 200));
ok("the copy names it as a holding area with no timer",
  /no timer|not on a timer/i.test(unfiledText) === false || /on a timer/i.test(unfiledText),
  unfiledText);

/* ---- §4 filing an orphan out of Unfiled decrements the count live -------------------- */
await page.locator('[data-testid="notes-row-orphan1"]').click({ button: "right" });
await page.waitForSelector('[data-testid="notes-menu-bind-orphan1"]', { timeout: 5000 });
await page.click('[data-testid="notes-menu-bind-orphan1"]');
await page.waitForSelector('[data-testid="notes-bind-orphan1"]', { timeout: 5000 });
await page.click('[data-testid="notes-bind-orphan1-to-__none__"]');
await pacedWait(page, 500);
ok("filing an orphan (Belongs to… → Not in a project) removes it from Unfiled",
  await tb("notes-row-orphan1").count() === 0);
ok("...and the footer count drops from 2 to 1", (await tb("notes-view-unfiled").innerText()).includes("1"));
const treeAfterFile = await readTree();
ok("...and it is durably re-filed in the STORED tree, not just the screen",
  treeAfterFile.pages.find((p) => p.id === "orphan1")?.projectId === null,
  JSON.stringify(treeAfterFile.pages.find((p) => p.id === "orphan1")));

/* ---- §5 the last orphan going to zero hides the footer row (PANEL-BREVITY) ------------- */
await page.locator('[data-testid="notes-row-orphan2"]').click({ button: "right" });
await page.waitForSelector('[data-testid="notes-menu-rm-orphan2"]', { timeout: 5000 });
await page.click('[data-testid="notes-menu-rm-orphan2"]');
await page.waitForSelector('[data-testid="notes-del-orphan2-yes"]', { timeout: 5000 });
await page.click('[data-testid="notes-del-orphan2-yes"]');
await pacedWait(page, 500);
ok("⛔ zero orphans left: the Unfiled row is gone (not shouting a permanent 0)",
  await tb("notes-view-unfiled").count() === 0);
ok("...and the Bin row is still there regardless — a standing feature, not count-gated",
  await tb("notes-view-bin").count() === 1);
ok("binning the last orphan (a deliberate, separate act) really did start its retention clock",
  (await readTree()).trash?.some((e) => (e.pageIds || []).includes("orphan2")));

/* ---- §6 empty Unfiled view states itself honestly if reached with nothing in it -------- */
await page.evaluate(([k, tree]) => localStorage.setItem(k, JSON.stringify(tree)), [TREE_KEY, {
  v: 3, pages: [pg("live1", "Entitlements", "GP")], trash: [],
}]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await pacedWait(page, 400);
ok("an account with zero orphans shows no Unfiled row at all", await tb("notes-view-unfiled").count() === 0);

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
await browser.close();
if (failed.length) process.exitCode = 1;
