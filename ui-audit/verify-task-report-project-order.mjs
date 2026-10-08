/* NEW-1 (2026-10-08, amends B2210992) — the Task Report's project groups follow the owner's project order,
 * with a grip + ⋯ menu on each group header. LOCAL acceptance (sandbox, logged out): the REAL embedded report
 * (public/sequence/index.html) runs inside a stand-in "shell" page that speaks the same postMessage protocol as
 * Scheduler.jsx and does its moves through the REAL pure module (src/shared/projects/projectOrder.js
 * `planProjectMove`) — so the report UI, the protocol and the move rule are all the shipped code; only the
 * account/storage half is faked (that half is proven live by verify-task-report-project-order-live.mjs).
 *
 * The fixture is shaped like the owner's account: "8 South" sorts FIRST alphabetically (a digit), Goose Creek
 * holds TWO schedules, Grand Port one, plus an org-owned schedule that is not a project. Known-good arm: with NO
 * saved order the report must show 8 South first (today's behaviour) — if it does not, the run is VACUOUS.
 *
 * Run:  PW_CHROME=<chrome> [SEQ_VENDOR=<dir>] node ui-audit/verify-task-report-project-order.mjs
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const SRC_ORDER = new URL("../src/shared/projects/projectOrder.js", import.meta.url).pathname;
const VENDOR = process.env.SEQ_VENDOR || "";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const VENDOR_MAP = { "/__vendor/react.js": "react.js", "/__vendor/react-dom.js": "react-dom.js", "/__vendor/babel.js": "babel.js", "/__vendor/supabase.js": "supabase.js" };
const rewriteForVendor = html => html
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react\/[^"']*react\.production\.min\.js/, "/__vendor/react.js")
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react-dom\/[^"']*react-dom\.production\.min\.js/, "/__vendor/react-dom.js")
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@babel\/standalone@7\/babel\.min\.js/, "/__vendor/babel.js")
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/, "/__vendor/supabase.js");

const task = (id, name, health, start = "2026-12-27") => ({
  id, name, start, end: "2026-12-28", duration: 2, predecessors: [],
  health, percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true,
});
const SEED = {
  nPid: 6, nTid: {}, aPid: 1, view: "grid", section: "projects", editProjId: null,
  healthColStyle: "stoplight",
  settings: { defaultSplit: 60, snapDefault: true, holidays: {}, customHealth: [], healthLabelOverrides: {} },
  masterHealthFilter: false,
  projects: {
    3: { id: 3, name: "Master Schedule", ownerKind: "site", linkedSiteId: "g-8s", linkedSiteName: "8 South", tasks: [task(1, "8S-1", "red", "2026-12-20"), task(2, "8S-2", "yellow", "2026-12-25")] },
    1: { id: 1, name: "Master Schedule", ownerKind: "site", linkedSiteId: "g-gc", linkedSiteName: "Goose Creek", tasks: [task(1, "GC-MS-1", "red")] },
    22: { id: 22, name: "TAS Land Sale", ownerKind: "site", linkedSiteId: "g-gc", linkedSiteName: "Goose Creek", tasks: [task(1, "GC-TAS-1", "yellow")] },
    2: { id: 2, name: "Master Schedule", ownerKind: "site", linkedSiteId: "g-gp", linkedSiteName: "Grand Port", tasks: [task(1, "GP-MS-1", "red"), task(2, "GP-MS-2", "yellow")] },
    5: { id: 5, name: "Pursuits", ownerKind: "org", tasks: [task(1, "Org-1", "gray")] },
  },
};
const rewriteSeed = html => html.replace(
  /<script id="planar-data">window\.__PLANAR_DATA__=(.*?);<\/script>/s,
  `<script id="planar-data">window.__PLANAR_DATA__=${JSON.stringify(SEED)};</script>`,
);

// The stand-in shell: the same protocol as Scheduler.jsx (planar:project-order push; -request / -move / -retry back).
const SHELL = `<!doctype html><meta charset="utf-8"><body style="margin:0"><iframe id="f" src="/sequence/" style="border:0;width:100vw;height:100vh"></iframe>
<script type="module">
import { planProjectMove, orderedIds, byNameToday } from "/__projectOrder.js";
const groups = [
  { groupId: "g-8s", name: "8 South", createdAt: Date.parse("2026-01-01") },
  { groupId: "g-gc", name: "Goose Creek", createdAt: Date.parse("2026-01-02") },
  { groupId: "g-gp", name: "Grand Port", createdAt: Date.parse("2026-01-03") },
];
let saved = null, error = null; window.__log = []; window.__failSave = false;
const f = document.getElementById("f");
const push = () => f.contentWindow.postMessage({ source: "planar-shell", type: "planar:project-order", ids: orderedIds(byNameToday(groups), saved), canOrder: true, error }, location.origin);
window.addEventListener("message", (e) => {
  const m = e.data; if (e.origin !== location.origin || !m || m.source !== "planar-seq") return;
  if (!String(m.type).startsWith("planar:project-order")) return;
  window.__log.push(m);
  if (m.type === "planar:project-order-request") return push();
  if (m.type === "planar:project-order-retry") { error = null; window.__failSave = false; return push(); }
  const dest = m.dest.to ? { to: m.dest.to } : { index: m.dest.index };
  const next = planProjectMove(groups, saved, m.groupId, dest, m.visibleIds);
  if (!next) return;
  saved = next; error = window.__failSave ? "network down" : null; push();
});
window.__nav = () => f.contentWindow.postMessage({ source: "planar-shell", type: "planar:nav-dashboard" }, location.origin);
window.__saved = () => saved;
</script>`;

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    if (p === "/__shell.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(SHELL); }
    if (p === "/__projectOrder.js") { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(await readFile(SRC_ORDER)); }
    if (VENDOR && VENDOR_MAP[p]) { res.writeHead(200, { "Content-Type": "text/javascript" }); return res.end(await readFile(join(VENDOR, VENDOR_MAP[p]))); }
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (p.endsWith("sequence/index.html")) {
      let text = body.toString("utf8");
      if (VENDOR) text = rewriteForVendor(text);
      body = Buffer.from(rewriteSeed(text));
    }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/__shell.html`;

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", e => errors.push(e.message));
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
await assertMeasurable(page, "verify-task-report-project-order");
const frame = await (await page.waitForSelector("#f")).contentFrame();
const booted = await frame.waitForSelector("[data-task-row]", { timeout: 30000 }).then(() => true).catch(() => false);
ok("board boots inside the stand-in shell", booted);

const heads = () => frame.evaluate(() => [...document.querySelectorAll("tr[data-grp-site]")].map(tr => tr.textContent.replace(/[⠿⋯]/g, "").trim()));
const projectsInOrder = () => heads().then(h => h.map(t => t.replace(/ \/ .*/, "")).filter((v, i, a) => a.indexOf(v) === i));
const savedIds = () => page.evaluate(() => window.__saved() && window.__saved().ids);
const vis = (sel) => frame.evaluate((s) => { const el = document.querySelector(s); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, vw: innerWidth, vh: innerHeight }; }, sel);
const openMenuAndPick = async (siteId, label) => {
  await frame.evaluate((id) => document.querySelector(`tr[data-grp-site="${id}"] [data-grp-menu-btn]`).scrollIntoView({ block: "center" }), siteId);
  await pacedWait(page, 150);
  await frame.click(`tr[data-grp-site="${siteId}"] [data-grp-menu-btn]`);
  await pacedWait(page, 150);
  await frame.click(`[role="menuitem"]:has-text("${label}")`);
  await pacedWait(page, 400);
};

if (booted) {
  await page.evaluate(() => window.__nav());
  await frame.waitForSelector("text=TASK REPORT", { timeout: 10000 }).catch(() => {});
  await frame.evaluate(() => { const m = [...document.querySelectorAll("span")].find(s => s.textContent.trim() === "Group by"); const seg = m && [...m.parentElement.querySelectorAll("span")].find(s => s.textContent.trim() === "Project"); if (seg) seg.click(); });
  await pacedWait(page, 600);
  await assertMeasurable(page, "verify-task-report-project-order");

  // known-good arm: today's behaviour with NO saved order is alphabetical → 8 South first
  const first = await projectsInOrder();
  ok("known-good arm: with no saved order the report is today's order — '8 South' first, org schedule last", first[0] === "8 South" && first[first.length - 1] === "Organization", first.join(" | "));
  ok("the shell was asked for the order when the report mounted", await page.evaluate(() => window.__log.some(m => m.type === "planar:project-order-request")));
  ok("every PROJECT group header has a grip and a ⋯ menu; the org-owned one has neither", await frame.evaluate(() =>
    ["g-8s", "g-gc", "g-gp"].every(id => document.querySelector(`[data-grp-grip="${id}"]`) && document.querySelector(`tr[data-grp-site="${id}"] [data-grp-menu-btn]`)) &&
    ![...document.querySelectorAll("tr[data-grp-site='']")].some(tr => tr.querySelector("[data-grp-grip],[data-grp-menu-btn]"))));

  // Move to top from the ⋯ menu
  await openMenuAndPick("g-gp", "Move to top");
  let o = await projectsInOrder();
  ok("⋯ → Move to top: Grand Port first, then 8 South, Goose Creek; org schedule still last", o.join() === "Grand Port,8 South,Goose Creek,Organization", o.join(" | "));
  const s1 = await savedIds();
  ok("the shell received a full saved order with Grand Port first", Array.isArray(s1) && s1[0] === "g-gp" && s1.length === 3, JSON.stringify(s1));

  // Move down / up / bottom
  await openMenuAndPick("g-gp", "Move down");
  o = await projectsInOrder();
  ok("⋯ → Move down: Grand Port drops one place", o.join() === "8 South,Grand Port,Goose Creek,Organization", o.join(" | "));
  await openMenuAndPick("g-gc", "Move up");
  o = await projectsInOrder();
  ok("⋯ → Move up: Goose Creek (two schedules) rises one place as ONE unit", o.join() === "8 South,Goose Creek,Grand Port,Organization", o.join(" | "));
  const gcHeads = (await heads()).filter(t => t.startsWith("Goose Creek"));
  ok("…and both its schedule headers stay adjacent", gcHeads.length === 2);
  await openMenuAndPick("g-8s", "Move to bottom");
  o = await projectsInOrder();
  ok("⋯ → Move to bottom: 8 South last among projects", o.join() === "Goose Creek,Grand Port,8 South,Organization", o.join(" | "));

  // disabled states
  await frame.click(`tr[data-grp-site="g-gc"] [data-grp-menu-btn]`);
  const dis = await frame.evaluate(() => [...document.querySelectorAll('[role="menuitem"]')].map(b => b.textContent + ":" + b.disabled));
  ok("the top project has Move to top / Move up disabled, Move down / bottom enabled", dis.join() === "Move to top:true,Move up:true,Move down:false,Move to bottom:false", dis.join());
  await page.keyboard.press("Escape");

  // grip drag: Grand Port (middle) above Goose Creek (top)
  const g = await vis(`[data-grp-grip="g-gp"]`);
  const t = await vis(`tr[data-grp-site="g-gc"]`);
  ok("grip and target header are both inside the viewport before the drag (no driver scroll)", g && t && g.y > 0 && t.y > 0 && g.y < g.vh && t.y < t.vh);
  const frameBox = await page.locator("#f").boundingBox();
  const gx = frameBox.x + g.x + g.w / 2, gy = frameBox.y + g.y + g.h / 2, ty = frameBox.y + t.y + 3;
  await page.mouse.move(gx, gy); await page.mouse.down();
  await page.mouse.move(gx, gy - 8, { steps: 3 }); await page.mouse.move(gx, ty, { steps: 8 });
  await pacedWait(page, 250);
  ok("a drop line shows while dragging", await frame.evaluate(() => !!document.querySelector("td[colspan][style*='inset']")));
  await page.mouse.up(); await pacedWait(page, 500);
  o = await projectsInOrder();
  ok("dragging Grand Port's grip above Goose Creek reorders the groups", o.join() === "Grand Port,Goose Creek,8 South,Organization", o.join(" | "));

  // Escape cancels a drag
  const g2 = await vis(`[data-grp-grip="g-8s"]`); const fb = frameBox;
  await page.mouse.move(fb.x + g2.x + g2.w / 2, fb.y + g2.y + g2.h / 2); await page.mouse.down();
  await page.mouse.move(fb.x + g2.x + g2.w / 2, fb.y + g2.y - 60, { steps: 5 });
  await page.keyboard.press("Escape"); await page.mouse.up(); await pacedWait(page, 300);
  o = await projectsInOrder();
  ok("Escape cancels a drag — order unchanged", o.join() === "Grand Port,Goose Creek,8 South,Organization", o.join(" | "));

  // Column sort sorts tasks WITHIN a group and never moves a group
  const before = (await projectsInOrder()).join();
  for (let i = 0; i < 2; i++) { await frame.evaluate(() => { const th = [...document.querySelectorAll("thead th")].find(t => /^TASK|^NAME/i.test(t.textContent.trim())); if (th) th.click(); }); await pacedWait(page, 250); }
  ok("clicking a column header (sort) leaves the group order alone", (await projectsInOrder()).join() === before);
  const taskNames = await frame.evaluate(() => {
    const ths = [...document.querySelectorAll("thead th")];
    const ci = ths.findIndex(t => /^TASK/i.test(t.textContent.trim()));
    const out = {}; let cur = null;
    document.querySelectorAll("tbody tr").forEach(tr => {
      if (tr.hasAttribute("data-grp-site")) { cur = tr.textContent.replace(/[⠿⋯]/g, "").trim(); out[cur] = []; }
      else if (cur && tr.children.length > ci) out[cur].push(tr.children[ci].textContent.trim());
    });
    return out;
  });
  const multi = Object.values(taskNames).filter(a => a.length > 1);
  ok("sorting happened INSIDE the groups: every multi-task group is in descending Task order after two header clicks", multi.length > 0 && multi.every(a => a.join() === [...a].sort().reverse().join()), JSON.stringify(taskNames));

  // failed save → banner + Retry, order kept on screen
  await page.evaluate(() => { window.__failSave = true; });
  await openMenuAndPick("g-8s", "Move to top");
  o = await projectsInOrder();
  ok("a failed save keeps the new order on screen", o[0] === "8 South", o.join(" | "));
  ok("…and shows 'Couldn't save your project order' with a Retry", await frame.evaluate(() => /Couldn't save your project order/.test(document.body.innerText) && !!([...document.querySelectorAll("button")].find(b => b.textContent.trim() === "Retry"))));
  await frame.click('button:has-text("Retry")'); await pacedWait(page, 400);
  ok("Retry clears the banner (the shell re-saved)", await frame.evaluate(() => !/Couldn't save your project order/.test(document.body.innerText)));

  // phone width: the ⋯ path works and its menu sits fully inside the screen
  await page.setViewportSize({ width: 390, height: 800 });
  await pacedWait(page, 500);
  await assertMeasurable(page, "verify-task-report-project-order");
  const b0 = (await projectsInOrder()).join();
  await frame.evaluate(() => document.querySelector(`tr[data-grp-site="g-gp"] [data-grp-menu-btn]`).scrollIntoView({ block: "center" }));
  await pacedWait(page, 200);
  await frame.click(`tr[data-grp-site="g-gp"] [data-grp-menu-btn]`);
  await pacedWait(page, 200);
  const menu = await vis('[role="menu"]');
  ok("phone width: the ⋯ menu opens fully inside the screen", menu && menu.x >= 0 && menu.x + menu.w <= menu.vw && menu.y >= 0 && menu.y + menu.h <= menu.vh, JSON.stringify(menu));
  await frame.click(`[role="menuitem"]:has-text("Move to top")`); await pacedWait(page, 400);
  o = await projectsInOrder();
  ok("phone width: Move to top works", o[0] === "Grand Port" && o.join() !== b0, o.join(" | "));
  const gripBox = await vis(`[data-grp-grip="g-gp"]`);
  ok("phone width: the grip is a real touch target", gripBox && gripBox.w >= 24 && gripBox.h >= 28);

  ok("no page errors", errors.length === 0, JSON.stringify(errors.slice(0, 3)));
} else {
  console.log("boot errors:", errors.slice(0, 5));
}
await browser.close(); server.close();
const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
