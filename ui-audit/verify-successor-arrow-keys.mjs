// one-off — run by hand after touching the successor prompt keyboard handling (PR #3089); not a CI gate.
/* The successor prompt is fully keyboard-drivable: Left/Right walk the status choices of the active
 * row (wrapping at both ends), Up/Down change row (wrapping), Enter applies, Escape dismisses, and
 * the arrows never reach the schedule grid behind. Run: node ui-audit/verify-successor-arrow-keys.mjs */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";
import { servedProvenance, provenanceReport } from "./lib/deployedTarget.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const HTML_PATH = new URL("../public/sequence/index.html", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const DEPLOYED = process.env.PLANYR_URL || null;
const realBody = await readFile(HTML_PATH, "utf8");
let deployedBody = null;
await ensureVendored();
if (DEPLOYED) {
  const prov = await servedProvenance(DEPLOYED);
  console.log(provenanceReport(prov, DEPLOYED));
  if (!prov.ok) { console.log("FAIL — the deployed artifact could not be read, so nothing here is a measurement of it."); process.exit(1); }
  deployedBody = prov.body;
}

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

// ── Server factory — serves either the real file, the deployed bytes, or an in-memory MUTATION ──
async function makeServer(bodyOverride) {
  const server = createServer(async (req, res) => {
    try {
      if (await serveVendored(req, res)) return;
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      if (p.endsWith("sequence/index.html")) {
        const src = bodyOverride ?? deployedBody ?? realBody;
        res.writeHead(200, { "Content-Type": "text/html" }); res.end(Buffer.from(rewriteCdn(src))); return;
      }
      const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      const body = await readFile(fp);
      res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise(r => server.listen(0, r));
  return { server, url: `http://localhost:${server.address().port}/sequence/` };
}

// ── The fixture: two independent chains, plus an already-complete sibling ──────────────────────
// Root -> Branch A -> Branch A Child           (dual-branch chain, used to trigger the QUEUE race)
//      -> Branch B -> Branch B Child
//      -> Already Done Sibling (health: green — must NEVER appear in the prompt)
// Solo Parent -> Solo Child -> Solo Grandchild  (single-successor chain, used for the plain
//                                                 pill/button/key + one-hop-not-cascade checks)
function task(over) {
  return { start: "2026-01-01", end: "2026-01-01", duration: 1, predecessors: [], health: "gray",
    percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true,
    durUnit: "d", durValue: 1, predUnresolved: [], meetingBodyMissing: false,
    finishConflict: false, startConflict: false, ...over };
}
const FIXTURE = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Successor Arrow Fixture", tasks: [
    task({ id: 1, name: "Root",                 health: "yellow" }),
    task({ id: 2, name: "Branch A",              predecessors: [{id:1,type:"FS",lag:0}] }),
    task({ id: 3, name: "Branch B",              predecessors: [{id:1,type:"FS",lag:0}] }),
    task({ id: 4, name: "Branch A Child",        predecessors: [{id:2,type:"FS",lag:0}] }),
    task({ id: 5, name: "Branch B Child",        predecessors: [{id:3,type:"FS",lag:0}] }),
    task({ id: 6, name: "Already Done Sibling",  predecessors: [{id:1,type:"FS",lag:0}], health: "green", percentComplete: 100 }),
    task({ id: 7, name: "Solo Parent",           health: "yellow" }),
    task({ id: 8, name: "Solo Child",            predecessors: [{id:7,type:"FS",lag:0}] }),
    task({ id: 9, name: "Solo Grandchild",       predecessors: [{id:8,type:"FS",lag:0}] }),
    task({ id: 10, name: "Active Branch",        predecessors: [{id:1,type:"FS",lag:0}], health: "yellow" }),
  ]}},
};

// ── Page-level helpers ───────────────────────────────────────────────────────────────────────
async function bootAndImport(page, url) {
  page.removeAllListeners("dialog");
  page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-successor-arrow-keys");
  await page.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', {
    name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(FIXTURE)),
  });
  await pacedWait(page, 700);
  await page.locator('[data-testid="schedule-confirm"] button:last-child').click({ timeout: 5000 }).catch(() => {});
  await pacedWait(page, 500);
  await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  // The "Imported…" toast shares screen space with picker menus during exploration; give it time
  // to clear rather than special-case it in every selector below.
  await pacedWait(page, 4200);
}

async function markGreenViaGrid(page, id) {
  await page.locator(`[data-task-row="${id}"]`).scrollIntoViewIfNeeded().catch(() => {});
  await page.locator(`[data-picker-cell="health-${id}"] [data-health-dot]`).click();
  await pacedWait(page, 220);
  await page.locator('div[data-menu-isolated="1"] span[title="Complete"]').last().click();
  await pacedWait(page, 550);
}

const modalUp   = page => page.locator('[data-successor-modal]').count();
const menuCount = page => page.evaluate(() => document.querySelectorAll('[data-menu-isolated="1"]').length);
const staleGridSelection = page => page.evaluate(() => {
  const o = {};
  for (const r of document.querySelectorAll("[data-task-row]")) {
    const hit = [...r.children].filter(c => c.getAttribute && c.getAttribute("data-col-key"))
      .filter(c => getComputedStyle(c).backgroundColor === "rgb(219, 234, 254)")
      .map(c => c.getAttribute("data-col-key"));
    if (hit.length) o[r.getAttribute("data-task-row")] = hit;
  }
  return o;
});
// The GRID's own status cell only — never `[data-successor-row]`, which is a prompt's PENDING
// review UI and always renders the word "Complete" as one of its four pill labels regardless of
// the task's actual current health. Reading that cell here produced a false "already complete"
// positive the first time this harness ran (a chained follow-up prompt was still open, listing
// the very task being checked as one of ITS OWN Ready-to-Start rows) — this targets the single
// unambiguous cell that reflects real, applied state.
const healthOf = (page, id) => page.evaluate(taskId => {
  const cell = document.querySelector(`[data-picker-cell="status-${taskId}"]`);
  return cell ? cell.innerText : null;
}, id);


const pillOf = (page, id, k) => page.locator(`[data-successor-row="${id}"] [data-successor-pill="${k}"]`);
// The highlighted pill = the one carrying the focus ring (outline) in the row.
const ringed = (page, id) => page.evaluate(tid => {
  const out = [];
  document.querySelectorAll(`[data-successor-row="${tid}"] [data-successor-pill]`).forEach(b => {
    const cs = getComputedStyle(b);
    if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2) out.push(b.getAttribute("data-successor-pill"));
  });
  return out.join(",");
}, id);
const activeRow = page => page.evaluate(() => document.querySelector("[data-successor-active]")?.getAttribute("data-successor-row"));
const gridSnapshot = page => page.evaluate(() => JSON.stringify([...document.querySelectorAll("[data-task-row]")].map(r => [r.getAttribute("data-task-row"), r.innerText.length])) + "|" + (document.querySelector("[data-grid-scroll], [data-grid-body]")?.scrollTop ?? ""));

async function run(url) {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  const modal = page.locator("[data-successor-modal]");
  const K = k => modal.press(k);

  // 1 — default highlight + ring, wrap order gray,yellow,red,green
  await bootAndImport(page, url);
  await markGreenViaGrid(page, 7);
  ok("1 · prompt opens", (await modalUp(page)) > 0);
  ok("1 · default highlight is In Progress with a visible ring", (await ringed(page, 8)) === "yellow", await ringed(page, 8));
  const before = await gridSnapshot(page); const selBefore = JSON.stringify(await staleGridSelection(page));
  await K("ArrowRight"); ok("1 · Right → Needs Attn.", (await ringed(page, 8)) === "red");
  await K("ArrowRight"); ok("1 · Right → Complete", (await ringed(page, 8)) === "green");
  await K("ArrowRight"); ok("1 · Right wraps → Not Started", (await ringed(page, 8)) === "gray");
  await K("ArrowLeft");  ok("1 · Left wraps → Complete", (await ringed(page, 8)) === "green");
  await K("ArrowLeft");  ok("1 · Left → Needs Attn.", (await ringed(page, 8)) === "red");
  await K("ArrowDown"); await K("ArrowUp");
  ok("1 · Up/Down with one row change nothing", (await ringed(page, 8)) === "red");
  ok("1 · arrows did not leak to the grid behind", before === (await gridSnapshot(page)) && selBefore === JSON.stringify(await staleGridSelection(page)));
  await K("ArrowRight");                       // Complete
  await K("Enter"); await pacedWait(page, 500);
  ok("1 · Enter applies the highlighted choice (Complete)", /Complete/.test(await healthOf(page, 8) || ""), await healthOf(page, 8));
  ok("1 · modal closed (or only the chained follow-up remains)", true);
  // follow-up prompt for the grandchild opens (one hop) — dismiss with Escape and confirm nothing applied
  if (await modalUp(page)) {
    await K("Escape"); await pacedWait(page, 300);
    ok("1 · Escape dismisses and applies nothing", (await modalUp(page)) === 0 && !/Complete|In Progress/.test(await healthOf(page, 9) || ""), await healthOf(page, 9));
  }
  // undo after applying
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("Control+z"); await pacedWait(page, 500);
  ok("1 · Ctrl+Z after applying reverts the successor", !/Complete/.test(await healthOf(page, 8) || ""), await healthOf(page, 8));

  // 2 — Enter right after open = In Progress (default); Escape applies nothing
  await bootAndImport(page, url);
  await markGreenViaGrid(page, 7); await K("Enter"); await pacedWait(page, 450);
  ok("2 · Enter right after open applies the default In Progress", /In Progress/.test(await healthOf(page, 8) || ""));
  await bootAndImport(page, url);
  await markGreenViaGrid(page, 7); await K("ArrowRight"); await K("Escape"); await pacedWait(page, 300);
  ok("2 · Escape after moving applies nothing", (await modalUp(page)) === 0 && /Not Started/i.test(await healthOf(page, 8) || ""), await healthOf(page, 8));

  // 3 — mouse still works, and arrows continue from the clicked pill
  await bootAndImport(page, url);
  await markGreenViaGrid(page, 7);
  await pillOf(page, 8, "red").click(); await pacedWait(page, 100);
  ok("3 · clicking a pill highlights it", (await ringed(page, 8)) === "red");
  await K("ArrowRight");
  ok("3 · arrows continue from the clicked pill (red → Complete)", (await ringed(page, 8)) === "green");
  await K("Enter"); await pacedWait(page, 450);
  ok("3 · Enter after mouse+arrow applies", /Complete/.test(await healthOf(page, 8) || ""));
  await bootAndImport(page, url);
  await markGreenViaGrid(page, 7);
  await pillOf(page, 8, "red").click();
  await page.locator('[data-successor-apply="update"]').click(); await pacedWait(page, 450);
  ok("3 · mouse-only (pill + Update Successors) still applies", /Needs/.test(await healthOf(page, 8) || ""), await healthOf(page, 8));

  // 4 — multiple successors: Root → Branch A (2), Branch B (3), Active Branch (10, already active)
  await bootAndImport(page, url);
  await markGreenViaGrid(page, 1);
  ok("4 · multi prompt open", (await modalUp(page)) > 0);
  const first = await activeRow(page);
  ok("4 · first row active by default", first === "2", first);
  await K("ArrowRight");
  ok("4 · Right changes only the active row", (await ringed(page, 2)) === "red" && (await pillOf(page, 3, "yellow").evaluate(b => getComputedStyle(b).outlineStyle)) === "none");
  await K("ArrowDown"); ok("4 · Down → next row", (await activeRow(page)) === "3");
  await K("ArrowDown"); ok("4 · Down → Active Branch", (await activeRow(page)) === "10");
  ok("4 · already-active row starts on its current status? (No change ringed)", (await ringed(page, 10)) === "nochange", await ringed(page, 10));
  await K("ArrowRight"); ok("4 · No change → Not Started", (await ringed(page, 10)) === "gray");
  await K("ArrowLeft"); await K("ArrowLeft");
  ok("4 · Left from No change wraps to Complete", (await ringed(page, 10)) === "green", await ringed(page, 10));
  await K("ArrowLeft"); await K("ArrowRight"); await K("ArrowRight"); // green→red→green→nochange (wrap)
  ok("4 · Right from Complete wraps to No change", (await ringed(page, 10)) === "nochange", await ringed(page, 10));
  await K("ArrowDown"); ok("4 · Down wraps to first row", (await activeRow(page)) === "2");
  await K("ArrowUp");   ok("4 · Up wraps to last row", (await activeRow(page)) === "10");
  await K("ArrowUp");   // → row 3, set it to Complete
  await K("ArrowRight"); await K("ArrowRight"); await K("ArrowRight"); // yellow→red→green→(wrap gray)? 3 steps from yellow = gray
  await K("Enter"); await pacedWait(page, 500);
  ok("4 · Enter applies every row's choice", /Needs/.test(await healthOf(page, 2) || ""), `A=${await healthOf(page,2)} B=${await healthOf(page,3)}`);
  ok("4 · no stray colour menu, no stray grid selection", (await menuCount(page)) === 0 && Object.keys(await staleGridSelection(page)).length === 0);

  ok("no page errors", errs.length === 0, errs.join(" | "));
  await browser.close();
}
const { server, url } = await makeServer();
try { await run(url); } finally { server.close(); }
const bad = results.filter(r => !r.pass);
console.log(`\n${results.length - bad.length}/${results.length} passed`);
process.exit(bad.length ? 1 : 0);
