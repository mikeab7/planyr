/* B2285440 — the Schedule must never crash when the active project is missing/orphaned.
 * Loads public/sequence/index.html (served locally, or pass a base URL) with an embedded document whose
 * `projects` is empty / whose aPid dangles, and asserts: no render error, a visible empty state (or the
 * first real project) instead of "This view failed to load". Red on unmodified main, green after.
 *   node ui-audit/verify-schedule-no-active-project.mjs [http://localhost:4173]
 * Known-good arm: a normal document must load its grid. */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const base = process.argv[2] || "http://localhost:4173";
const mk = (projects, aPid) => ({ nPid: 5, nTid: {}, settings: {}, projects, aPid, view: "grid", section: "projects", _v6: true, _v7: true, _v8: true });
const task = (id) => ({ id, name: "T" + id, start: "2026-10-01", end: "2026-10-03", duration: 3, predecessors: [], health: "green", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true });
const CASES = [
  { name: "empty projects + dangling aPid (the test account)", doc: mk({}, 911625), expect: "empty" },
  { name: "empty projects + null aPid", doc: mk({}, null), expect: "empty" },
  { name: "dangling aPid, one real project", doc: mk({ 2: { id: 2, name: "Real One", tasks: [task(1)] } }, 911625), expect: "grid" },
  { name: "KNOWN-GOOD: valid aPid", doc: mk({ 2: { id: 2, name: "Real One", tasks: [task(1)] } }, 2), expect: "grid" },
];
const browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
let bad = 0;
for (const c of CASES) {
  const page = await browser.newPage();
  const errs = [];
  page.on("pageerror", e => errs.push(String(e).slice(0, 160)));
  page.on("console", m => { if (/View render error/.test(m.text())) errs.push(m.text().slice(0, 160)); });
  // The page's own inline <script id="planar-data"> assigns window.__PLANAR_DATA__ after any init script, so
  // the embedded document is swapped in the served HTML itself.
  await page.route("**/sequence/index.html", async route => {
    const res = await route.fetch();
    const html = (await res.text()).replace(/<script id="planar-data">[\s\S]*?<\/script>/, () => `<script id="planar-data">window.__PLANAR_DATA__=${JSON.stringify(c.doc)}</script>`);
    await route.fulfill({ response: res, body: html });
  });
  await page.goto(base + "/sequence/index.html", { waitUntil: "domcontentloaded" });
  await assertMeasurable(page, "verify-schedule-no-active-project");
  await page.waitForTimeout(3500);
  const body = await page.locator("body").innerText();
  const failed = /failed to load/i.test(body) || errs.length > 0;
  const empty = !!(await page.locator("[data-schedule-empty]").count());
  const grid = body.includes("Real One");
  const ok = !failed && (c.expect === "empty" ? empty : grid && !empty);
  if (!ok) bad++;
  console.log(ok ? "PASS" : "FAIL", c.name, JSON.stringify({ failed, empty, grid, errs: errs.slice(0, 1) }));
  await page.close();
}
await browser.close();
process.exit(bad ? 1 : 0);
