/* SCHEDULE GRID — INSERT ADDS THE ROW DIRECTLY ABOVE THE SELECTION, WITHOUT OPENING HIDDEN ROWS (NEW-1).
 *
 * Owner report (Baytown schedule): rows "Baytown Approval" and "P&Z" (children of the Focus-filtered
 * Baytown Platting group, its finished children hidden), then "TIA" (a top-level summary, itself
 * Focus-filtered). Select TIA → Insert: the old code un-focused Baytown Platting (its hidden rows
 * reappeared) and placed the new row below them. Expected (Excel / MS Project): the new row sits
 * directly below P&Z and above TIA, last child of Baytown Platting, and nothing hidden is shown.
 *
 * Runs against the LOCAL public/sequence/index.html (fixture imported through the History panel) —
 * the same harness shape as verify-schedule-indent-outdent-delete.mjs. Pass a base URL as argv[2]
 * to run against a served copy instead (e.g. https://planyr.io/sequence/ — signed-out local mode).
 *
 * Run: node ui-audit/verify-schedule-insert-above.mjs [baseUrl]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const HTML_PATH = new URL("../public/sequence/index.html", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || undefined;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

async function localServer() {
  const realBody = await readFile(HTML_PATH, "utf8");
  await ensureVendored();
  const server = createServer(async (req, res) => {
    try {
      if (await serveVendored(req, res)) return;
      let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
      if (p.endsWith("sequence/index.html")) { res.writeHead(200, { "Content-Type": "text/html" }); res.end(Buffer.from(rewriteCdn(realBody))); return; }
      const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      const body = await readFile(fp);
      res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
    } catch { res.writeHead(404); res.end("not found"); }
  });
  await new Promise(r => server.listen(0, r));
  return { server, url: `http://localhost:${server.address().port}/sequence/` };
}

const task = over => ({ start: "2026-01-05", end: "2026-01-05", duration: 1, predecessors: [], health: "yellow",
  percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, durUnit: "d", durValue: 1, ...over });
const FIXTURE = {
  aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects",
  projects: { 1: { id: 1, name: "Insert Above Fixture", tasks: [
    task({ id: 1, name: "Kickoff" }),
    task({ id: 2, name: "Baytown Platting" }),
    task({ id: 3, name: "Baytown Approval", parentId: 2 }),
    task({ id: 4, name: "P&Z Consideration & Approval", parentId: 2 }),
    ...[5, 6, 7, 8, 9].map(i => task({ id: i, name: "Done step " + i, parentId: 2, health: "green" })),
    task({ id: 10, name: "TIA" }),
    task({ id: 11, name: "TIA scoping", parentId: 10 }),
    ...[12, 13, 14].map(i => task({ id: i, name: "TIA done " + i, parentId: 10, health: "green" })),
    task({ id: 15, name: "Closing" }),
  ]}},
};

const rows = page => page.evaluate(() => [...document.querySelectorAll("[data-task-row]")].map(r => ({
  id: Number(r.getAttribute("data-task-row")),
  name: ([...r.querySelectorAll('[data-col-key="name"] span[title]')].map(e => e.getAttribute("title")).find(t => !/^(Collapse|Expand|Focus: hide|Show all tasks)/.test(t)) || "").trim(),
  pad: parseFloat(getComputedStyle(r.querySelector('[data-col-key="name"] > span') || r).paddingLeft) || 0,
})));
const idOf = async (page, name) => (await rows(page)).find(r => r.name === name)?.id;

async function boot(page, url) {
  page.on("dialog", d => d.accept());
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await page.waitForSelector("[data-task-row]", { timeout: 40000 });
  await assertMeasurable(page, "verify-schedule-insert-above");
  await page.locator('[data-testid="open-history-desktop"]').click();
  await pacedWait(page, 250);
  await page.setInputFiles('input[type="file"][accept=".json"]', { name: "fixture.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(FIXTURE)) });
  await pacedWait(page, 700);
  await page.locator('[data-testid="history-panel"] button:has-text("Close")').click();
  await pacedWait(page, 2500);
  if (process.env.DBG) console.log(JSON.stringify(await rows(page)));
  // Focus both groups (the owner's state: finished rows hidden behind the filter chip).
  for (const g of ["Baytown Platting", "TIA"]) {
    const id = await idOf(page, g);
    await page.locator(`[data-task-row="${id}"] [title^="Focus: hide"]`).click();
    await pacedWait(page, 250);
  }
}

const NAMES = ["Kickoff", "Baytown Platting", "Baytown Approval", "P&Z Consideration & Approval", "TIA", "TIA scoping", "Closing"];

async function scenario(browser, url, label, act) {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await boot(page, url);
  const before = await rows(page);
  ok(`${label}: precondition — finished rows hidden behind Focus`, before.map(r => r.name).join("|") === NAMES.join("|"), before.map(r => r.name).join(" | "));
  await act(page);
  await pacedWait(page, 500);
  const after = await rows(page);
  const names = after.map(r => r.name);
  const iNew = names.indexOf("");
  ok(`${label}: new row directly below P&Z, directly above TIA`, names[iNew - 1] === "P&Z Consideration & Approval" && names[iNew + 1] === "TIA", names.join(" | "));
  ok(`${label}: nothing hidden was opened`, after.length === before.length + 1 && !names.some(n => /^Done step|^TIA done/.test(n)));
  const pz = after.find(r => r.name === "P&Z Consideration & Approval");
  ok(`${label}: same indent as P&Z (child of Baytown Platting)`, Math.abs(after[iNew].pad - pz.pad) < 0.5, `${after[iNew].pad} vs ${pz.pad}`);
  // Selected + ready to type: typing straight away (no click) must name the new row.
  await page.keyboard.type("Inserted row");
  await page.keyboard.press("Enter");
  await pacedWait(page, 400);
  const typed = (await rows(page)).map(r => r.name);
  ok(`${label}: new row is selected — typing names it`, typed[iNew] === "Inserted row", typed.join(" | "));
  await page.keyboard.press("Escape");
  for (let k = 0; k < 2; k++) { await page.keyboard.press("Control+z"); await pacedWait(page, 500); }
  const undone = (await rows(page)).map(r => r.name);
  ok(`${label}: undo removes it cleanly`, undone.join("|") === NAMES.join("|"), undone.join(" | "));
  await page.close();
}

const base = process.argv[2];
const srv = base ? null : await localServer();
const url = base || srv.url;
const browser = await chromium.launch(EXEC ? { executablePath: EXEC } : {});
try {
  await scenario(browser, url, "Insert key", async page => {
    const id = await idOf(page, "TIA");
    await page.locator(`[data-task-row="${id}"] [data-col-key="id"]`).click();
    await pacedWait(page, 150);
    await page.keyboard.press("Insert");
  });
  await scenario(browser, url, "Right-click Insert Row Above", async page => {
    const id = await idOf(page, "TIA");
    await page.locator(`[data-task-row="${id}"] [data-col-key="id"]`).click({ button: "right" });
    await pacedWait(page, 150);
    await page.locator("i.ti-row-insert-top").locator("..").click();
  });
} finally {
  await browser.close(); srv?.server.close();
}
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
