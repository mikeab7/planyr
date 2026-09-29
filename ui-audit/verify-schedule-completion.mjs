/* B1953795 (S2) — "Complete" has ONE answer, measured against the real Scheduler (logged out, on the
 * app's own in-memory seed schedule — a throwaway document that is never saved anywhere).
 *
 * The harness rewrites the served seed document (never a real account's schedule) to build the exact
 * configurations the audit named, then reads what the grid actually PAINTS:
 *   R1  a task with the Complete pill but stored 0%  -> the % column reads 100%           (main: 0%)
 *   R2  an overdue task typed to 100% with a stale gray pill -> Status dot is GREEN, not red (main: red)
 *   R3  a parent row's % is derived from its tasks, not its stale stored leftover           (main: stale)
 * and drives the real writers with REAL pointer + key input (never a synthetic KeyboardEvent):
 *   W1  pick Complete on a leaf  -> % cell reads 100%
 *   W2  pick In Progress on it   -> % cell reads 0% (the cascade-set 100 is cleared)
 * KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): before scoring, the harness proves it can SEE a
 * % cell change at all (W1) and that an untouched control row does not move; otherwise the run is VOID.
 *
 * Run:  node ui-audit/verify-schedule-completion.mjs [PW_CHROME=<chrome>]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const isoDaysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const FIX = {};   // filled while rewriting the seed

/* Rewrite the seed document: add the % column, one overdue red rule (unless Complete/Paused), and
 * three constructed leaf tasks + one parent, chosen from the seed's own leaves. */
function rewriteSeed(html) {
  const tag = "window.__PLANAR_DATA__=";
  const a = html.indexOf(tag); const b = html.indexOf(";</script>", a);
  const doc = JSON.parse(html.slice(a + tag.length, b));
  const proj = doc.projects[doc.aPid];
  const tasks = proj.tasks;
  const parents = new Set(tasks.map(t => t.parentId).filter(x => x != null));
  const leaves = tasks.filter(t => !parents.has(t.id));
  const [r1, r2, ctrl, wr] = leaves.slice(10, 14);
  Object.assign(r1, { health: "green", percentComplete: 0, end: isoDaysAgo(3) });
  Object.assign(r2, { health: "gray", percentComplete: 100, end: isoDaysAgo(20), start: isoDaysAgo(25) });
  Object.assign(ctrl, { health: "gray", percentComplete: 0, end: "2099-01-01", start: "2098-12-01" });
  Object.assign(wr, { health: "gray", percentComplete: 0, end: "2099-01-01", start: "2098-12-01" });
  // an existing seed parent (Phase 1 ESA, id 4) with its two leaf children (ids 5, 6) made equal-duration:
  // one complete-by-pill, one at 50% -> derived 75%, while the parent's own stored % is a stale 0.
  const byId = Object.fromEntries(tasks.map(t => [t.id, t]));
  const P = byId[4], C1 = byId[5], C2 = byId[6];
  Object.assign(P, { health: "gray", percentComplete: 0 });
  Object.assign(C1, { health: "green", percentComplete: 0, duration: 4, durValue: 4, durUnit: "d" });
  Object.assign(C2, { health: "gray", percentComplete: 50, duration: 4, durValue: 4, durUnit: "d" });
  Object.assign(FIX, { r1: r1.id, r2: r2.id, ctrl: ctrl.id, wr: wr.id, parent: P.id, r1name: r1.name, r2name: r2.name, wrname: wr.name, ctrlname: ctrl.name });
  doc.settings = { ...(doc.settings || {}), healthRules: [{ id: "h1", when: [{ field: "finish", op: "pastDueAtLeast", value: 1 }], whenCombinator: "AND", color: "red", unless: [{ field: "status", op: "is", value: "green" }, { field: "status", op: "is", value: "paused" }], unlessCombinator: "OR" }] };
  proj.colConfig = { visible: ["id", "name", "start", "end", "duration", "health", "percentComplete"], widths: {} };
  return html.slice(0, a + tag.length) + JSON.stringify(doc) + html.slice(b);
}

await ensureVendored();
const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (p.endsWith("sequence/index.html")) body = Buffer.from(rewriteSeed(rewriteCdn(body.toString("utf8"))));
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;

const checks = [];
const ok = (name, cond, extra = "") => { checks.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
await assertMeasurable(page, "verify-schedule-completion");
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => pageErrors.push("GOTO: " + e.message));
const booted = await page.waitForSelector("[data-task-row]", { timeout: 30000 }).then(() => true).catch(() => false);
ok("scheduler boots (the shared engine block compiles in the browser)", booted);
if (!booted) { console.log("VOID — app did not boot:", pageErrors.slice(0, 3)); await browser.close(); server.close(); process.exit(1); }
await pacedWait(page, 800);

const COL = { health: 5, pct: 6 };   // visible: id,name,start,end,duration,health,percentComplete
const cell = (rid, c) => page.locator(`[data-task-row="${rid}"] > div`).nth(c);
const pctOf = async rid => (await cell(rid, COL.pct).innerText()).trim();
const dotColor = rid => page.evaluate(id => {
  const c = document.querySelector(`[data-picker-cell="health-${id}"]`);
  const trig = c && c.querySelector("[data-health-dot]");
  const dot = trig && trig.firstElementChild && trig.firstElementChild.firstElementChild;
  return dot ? getComputedStyle(dot).backgroundColor : "<no dot>";
}, rid);
const rowExists = rid => page.locator(`[data-task-row="${rid}"]`).count();

ok("constructed rows are present", (await rowExists(FIX.r1)) && (await rowExists(FIX.r2)) && (await rowExists(FIX.wr)) && (await rowExists(FIX.parent)), JSON.stringify(FIX));

// ── readers
ok("R1 Complete pill with stored 0% reads 100% in the % column", (await pctOf(FIX.r1)) === "100%", await pctOf(FIX.r1));
const green = "rgb(22, 163, 74)", red = "rgb(220, 38, 38)";
const d2 = await dotColor(FIX.r2);
ok("R2 overdue task typed to 100% (stale gray pill) paints GREEN, not red Needs Attn.", d2 === green, d2 + (d2 === red ? "  (red = the old bug)" : ""));
ok("R2 its % column reads 100%", (await pctOf(FIX.r2)) === "100%", await pctOf(FIX.r2));
const pp = await pctOf(FIX.parent);
ok("R3 parent % is derived from its tasks (100% and 50% at equal duration = 75%), not the stale stored 0", pp === "75%", pp);

// ── known-good control + writers (real click + real keys)
const ctrlBefore = await pctOf(FIX.ctrl);
const HK = ["Not Started", "In Progress", "Needs Attn.", "Complete", "Paused"];   // BASE_HK order
async function pickStatus(rid, label) {
  await cell(rid, COL.health).click(); await pacedWait(page, 350);
  for (let i = 0; i < 5; i++) { await page.keyboard.press("ArrowUp"); await pacedWait(page, 40); }
  for (let i = 0; i < HK.indexOf(label); i++) { await page.keyboard.press("ArrowDown"); await pacedWait(page, 40); }
  await page.keyboard.press("Enter"); await pacedWait(page, 450);
  // Completing a task with successors opens the app's own successor prompt; dismiss it with a real Escape.
  if (await page.locator('[data-successor-modal="true"]').count()) { await page.keyboard.press("Escape"); await pacedWait(page, 350); }
}
const wrBefore = await pctOf(FIX.wr);
await pickStatus(FIX.wr, "Complete");
const wrDone = await pctOf(FIX.wr);
ok("known-good arm: the harness can SEE a % cell change (else VOID)", wrBefore === "0%" && wrDone === "100%", `${wrBefore} -> ${wrDone}`);
if (!(wrBefore === "0%" && wrDone === "100%")) { console.log("VOID"); await browser.close(); server.close(); process.exit(1); }
ok("known-good arm: an untouched control row does not move", (await pctOf(FIX.ctrl)) === ctrlBefore, ctrlBefore);
ok("W1 picking Complete leaves the % at 100%", wrDone === "100%");
await pickStatus(FIX.wr, "In Progress");
const wrAfter = await pctOf(FIX.wr);
ok("W2 leaving Complete clears the 100 (no stuck-complete task)", wrAfter === "0%", wrAfter);

const bad = pageErrors.filter(m => !/ResizeObserver|Script error/.test(m));
ok("no page errors", bad.length === 0, bad.slice(0, 2).join(" | "));

await browser.close(); server.close();
const failed = checks.filter(c => !c.pass);
console.log(failed.length ? `\n${failed.length} FAILED` : "\nALL PASS");
process.exit(failed.length ? 1 : 0);
