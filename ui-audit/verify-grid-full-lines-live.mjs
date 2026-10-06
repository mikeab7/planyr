/* B2160464 / V1575712 — live signed-in check that the Schedule grid draws one light full grid on a deploy.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-grid-full-lines-live.mjs [https://planyr.io] [expectedBuildPrefix]
 * Signs in as the test account, reads /version.json IN THE SAME CALL as the assertions, imports a throwaway
 * fixture schedule into the grid (test account only — never a real plan) and samples the PAINTED pixel on each
 * row's bottom edge under ID / TASK / START / NOTES: all must be the same line colour (and differ from the fill). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
const base = process.argv[2] || "https://planyr.io", want = process.argv[3] || "";
const task = o => ({ start: "2026-01-05", end: "2026-01-09", duration: 5, predecessors: [], health: "gray", percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 5, predUnresolved: [], ...o });
const tasks = [task({ id: 1, name: "Summary" }), task({ id: 2, name: "Plain", parentId: 1 }), task({ id: 3, name: "Red", parentId: 1, health: "red" }), task({ id: 4, name: "Yellow", parentId: 1, health: "yellow" }), task({ id: 5, name: "Green", parentId: 1, health: "green" }), task({ id: 6, name: "Plain 2" })];
const fixture = { aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects", projects: { 1: { id: 1, name: "Grid Lines Live Check", tasks, colConfig: { visible: ["id","name","start","end","duration","predecessors","successors","health","status","responsibleParty","cost","notes"], widths: {} } } } };
const results = []; const ok = (n, c, x = "") => { results.push(!!c); console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? " :: " + x : ""}`); };
const s = await openSignedIn({ base, viewport: { width: 1600, height: 800 } });
const page = await s.page.context().newPage(); await page.setViewportSize({ width: 1600, height: 800 });
page.on("dialog", d => d.accept());
await page.goto(base + "/sequence/", { waitUntil: "domcontentloaded" });
await page.waitForSelector("[data-task-row]", { timeout: 40000 });
await assertMeasurable(page, "verify-grid-full-lines-live");
await page.locator('[data-testid="open-history-desktop"]').click(); await pacedWait(page, 250);
await page.setInputFiles('input[type="file"][accept=".json"]', { name: "f.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(fixture)) });
await pacedWait(page, 700); await page.locator('[data-testid="history-panel"] button:has-text("Close")').click(); await pacedWait(page, 1500);
await page.locator('.hdr-view button:has-text("Grid")').click(); await pacedWait(page, 800);
// build read in the SAME call as the assertions
const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then(r => r.json()));
console.log("signed in as", s.proof.email, "| build", JSON.stringify(build));
if (want) ok(`served build matches ${want}`, JSON.stringify(build).includes(want));
const geo = await page.evaluate(() => [...document.querySelectorAll("[data-task-row]")].slice(0, 6).map(r => {
  const rr = r.getBoundingClientRect(); const x = k => { const c = r.querySelector(`[data-col-key="${k}"]`).getBoundingClientRect(); return Math.round(c.left + c.width * 0.62); };
  return { bottom: Math.round(rr.bottom), mid: Math.round(rr.top + rr.height / 2), xs: { id: x("id"), name: x("name"), start: x("start"), notes: x("notes") } }; }));
const png = decodePng(await page.screenshot());
const px = (x, y) => { const i = (y * png.width + x) * png.channels; return `${png.data[i]},${png.data[i+1]},${png.data[i+2]}`; };
ok(`${geo.length} fixture rows rendered`, geo.length === 6);
geo.forEach((g, n) => { const ref = px(g.xs.start, g.bottom - 1);
  ok(`row ${n + 1}: bottom line differs from the fill`, ref !== px(g.xs.name, g.mid), `line=${ref}`);
  for (const k of ["id", "name", "notes"]) ok(`row ${n + 1}: painted line under ${k.toUpperCase()} equals START's`, px(g.xs[k], g.bottom - 1) === ref, `${k}=${px(g.xs[k], g.bottom - 1)} start=${ref}`); });
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await page.close(); await s.close();
console.log(results.filter(Boolean).length + "/" + results.length + " passed");
process.exit(results.every(Boolean) ? 0 : 1);
