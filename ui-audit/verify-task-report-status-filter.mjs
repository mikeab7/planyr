/* NEW-1 — Task Report: a real status filter (In Progress / Needs Attention, independently selectable) replaces the fixed
 * "In Progress + Needs Attn." chip.
 *
 * Drives the embedded scheduler (public/sequence/index.html) headlessly on a seeded account (logged out, offline-fallback boot,
 * ATTEMPT-BEFORE-YOU-PARK: Claude-doable in the sandbox). It carries its OWN independent ground truth: it first reads, with the
 * control on "All", the status pill every task shows (the same pill that paints the row), then asserts for every combination that
 * the rows left on screen are exactly the tasks whose pill is in the selection — and that the header pill, each group pill and
 * the rows all agree.
 *
 * RED-PROOF: on the pre-change build there is no [data-status-seg] control at all, so the first assertion fails and the run
 * ends VOID rather than scoring (known-good arm = the "All" capture must list every seeded task before anything is scored).
 *
 * Run:  node ui-audit/verify-task-report-status-filter.mjs        (PW_CHROME=<chrome>, SEQ_VENDOR=<dir> as the sibling harnesses)
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const VENDOR = process.env.SEQ_VENDOR || "";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };
const VENDOR_MAP = { "/__vendor/react.js": "react.js", "/__vendor/react-dom.js": "react-dom.js", "/__vendor/babel.js": "babel.js", "/__vendor/supabase.js": "supabase.js" };
const rewriteForVendor = html => html
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react\/[^"']*react\.production\.min\.js/, "/__vendor/react.js")
  .replace(/https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/react-dom\/[^"']*react-dom\.production\.min\.js/, "/__vendor/react-dom.js")
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@babel\/standalone@7\/babel\.min\.js/, "/__vendor/babel.js")
  .replace(/https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/supabase-js@2/, "/__vendor/supabase.js");

const task = (id, name, health, extra = {}) => ({
  id, name, start: "2026-12-27", end: "2026-12-28", duration: 2, predecessors: [],
  health, percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true, ...extra,
});
// Group A mixes every status; B has red+yellow; C is ALL green/gray (empties out under any single-status pick); D holds a
// parent whose only child is red (the parent's ROLLED status is what the report classifies — no stored health says red).
const projectsFull = () => ({
  1: { id: 1, name: "Master Schedule", ownerKind: "site", linkedSiteId: "gc1", linkedSiteName: "Alpha Site",
    tasks: [task(1, "A-red", "red"), task(2, "A-yellow", "yellow"), task(3, "A-gray", "gray"), task(4, "A-green", "green"), task(5, "A-paused", "paused"), task(6, "A-red-2", "red")] },
  2: { id: 2, name: "Master Schedule", ownerKind: "site", linkedSiteId: "gp1", linkedSiteName: "Bravo Site",
    tasks: [task(1, "B-yellow", "yellow"), task(2, "B-yellow-2", "yellow"), task(3, "B-red", "red")] },
  3: { id: 3, name: "Master Schedule", ownerKind: "site", linkedSiteId: "cc1", linkedSiteName: "Charlie Site",
    tasks: [task(1, "C-green", "green"), task(2, "C-gray", "gray")] },
  4: { id: 4, name: "Master Schedule", ownerKind: "site", linkedSiteId: "dd1", linkedSiteName: "Delta Site",
    tasks: [task(1, "D-parent", "gray", { isExpanded: true }), task(2, "D-child", "red", { parentId: 1 })] },
});
const projectsNoActive = () => ({
  1: { id: 1, name: "Master Schedule", ownerKind: "site", linkedSiteId: "gc1", linkedSiteName: "Alpha Site",
    tasks: [task(1, "Z-green", "green"), task(2, "Z-gray", "gray")] },
});
let SEED_PROJECTS = projectsFull;
let SEED_FILTER = true;   // legacy boolean — what an account that never touched the chip holds
const makeSeed = () => ({
  nPid: 6, nTid: {}, aPid: 1, view: "grid", section: "projects", editProjId: null, healthColStyle: "stoplight",
  settings: { defaultSplit: 60, snapDefault: true, holidays: {}, customHealth: [], healthLabelOverrides: {} },
  masterHealthFilter: SEED_FILTER, projects: SEED_PROJECTS(),
});
const rewriteSeed = html => html.replace(
  /<script id="planar-data">window\.__PLANAR_DATA__=(.*?);<\/script>/s,
  () => `<script id="planar-data">window.__PLANAR_DATA__=${JSON.stringify(makeSeed())};</script>`,
);

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
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
const url = `http://localhost:${server.address().port}/sequence/`;
console.log("serving", url, VENDOR ? "(vendored libs)" : "(CDN libs)");

let failed = 0, voided = false;
const ok = (name, cond, extra = "") => { if (!cond) failed++; console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); return !!cond; };
const sameSet = (a, b) => a.length === b.length && [...a].sort().join("|") === [...b].sort().join("|");

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

async function openReport(ctx, { group = true } = {}) {
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-task-report-status-filter");
  const errs = []; page.on("pageerror", e => errs.push(e.message));
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForSelector("[data-task-row]", { timeout: 30000 });
  await page.click('button:has-text("Dashboard")', { timeout: 5000 });
  await page.waitForFunction(() => /TASK REPORT/.test(document.body.innerText), null, { timeout: 15000 });
  if (group) await setGroup(page, "Project");
  page.__errs = errs;
  return page;
}
const setGroup = async (page, label) => {
  await page.evaluate((label) => {
    const m = [...document.querySelectorAll("span")].find(s => s.textContent.trim() === "Group by");
    const seg = m && [...m.parentElement.querySelectorAll("span")].find(s => s.textContent.trim() === label);
    if (seg) seg.click();
  }, label);
  await page.waitForTimeout(250);
};
// What is on screen: header pill, per-group (label, pill, rows), and every data row with its own status pill text.
const snapshot = (page) => page.evaluate(() => {
  const ths = [...document.querySelectorAll("thead th")].map(t => t.textContent.trim());
  const ti = ths.findIndex(t => t.startsWith("Task")), si = ths.findIndex(t => t.startsWith("Status"));
  const headerPill = (() => { const s = [...document.querySelectorAll("span")].find(x => x.textContent.trim() === "TASK REPORT"); return s ? Number(s.nextElementSibling.textContent) : NaN; })();
  const groups = []; const rows = [];
  let cur = null;
  [...document.querySelectorAll("tbody tr")].forEach(tr => {
    const tds = tr.querySelectorAll("td");
    if (tr.hasAttribute("data-grp-site")) {
      const num = [...tds[0].querySelectorAll("span")].map(p => p.textContent.trim()).filter(t => /^\d+$/.test(t));
      cur = { label: tds[0].textContent.replace(/[⠿⋯]/g, "").trim(), pill: Number(num[num.length - 1]), rows: 0 };
      groups.push(cur); return;
    }
    if (tds.length < 4) return;
    const r = { name: tds[ti].textContent.trim(), status: tds[si].textContent.trim() };
    rows.push(r); if (cur) cur.rows++;
  });
  const segs = Object.fromEntries([...document.querySelectorAll("[data-status-seg]")].map(b => [b.dataset.statusSeg, b.getAttribute("aria-pressed") === "true"]));
  const empty = document.querySelector("[data-status-empty]")?.textContent.trim() || null;
  return { headerPill, groups, rows, segs, empty, hasControl: !!document.querySelector("[data-status-filter]") };
});
const click = async (page, seg) => { await page.click(`[data-status-seg="${seg}"]`); await page.waitForTimeout(220); };
const LABEL = { yellow: "In Progress", red: "Needs Attn." };

// ═══ 1. the full seed, legacy `true` stored → both on ═══
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await openReport(ctx);
  let s = await snapshot(page);
  if (!ok("the Status filter control exists (3 segments: All · In Progress · Needs Attention)", s.hasControl && Object.keys(s.segs).length === 3, JSON.stringify(s.segs))) { voided = true; }
  else {
    ok("legacy stored `true` opens as BOTH on (today's behaviour is the default)", s.segs.yellow && s.segs.red && !s.segs.all, JSON.stringify(s.segs));
    // ground truth: switch to All and read every task's own status pill
    await click(page, "all");
    const all = await snapshot(page);
    const truth = Object.fromEntries(all.rows.map(r => [r.name, r.status]));
    const SEEDED = ["A-red", "A-yellow", "A-gray", "A-green", "A-paused", "A-red-2", "B-yellow", "B-yellow-2", "B-red", "C-green", "C-gray", "D-parent", "D-child"];
    if (!ok("known-good arm: 'All' lists every seeded task (13) and the header pill says 13", sameSet(Object.keys(truth), SEEDED) && all.headerPill === 13 && all.segs.all && !all.segs.yellow && !all.segs.red, `rows=${all.rows.length} pill=${all.headerPill} ${JSON.stringify(all.segs)}`)) voided = true;
    ok("the parent's ROLLED status is what it shows (D-parent reads Needs Attn., though its stored health is gray)", truth["D-parent"] === "Needs Attn.", truth["D-parent"]);

    const check = async (label, want, sel) => {
      const sn = await snapshot(page);
      const wantNames = SEEDED.filter(n => want.has(truth[n]));
      const rowsOk = sameSet(sn.rows.map(r => r.name), wantNames);
      const hdrOk = sn.headerPill === sn.rows.length;
      const grpOk = sn.groups.every(g => g.pill === g.rows) && sn.groups.reduce((n, g) => n + g.pill, 0) === sn.rows.length;
      const noEmptyGroup = sn.groups.every(g => g.rows > 0);
      const pressedOk = sameSet(Object.entries(sn.segs).filter(([, v]) => v).map(([k]) => k), sel);
      ok(`${label}: rows = exactly the tasks whose pill matches (${wantNames.length})`, rowsOk, `got ${sn.rows.map(r => r.name).join(",")}`);
      ok(`${label}: header pill ${sn.headerPill} = rows ${sn.rows.length}; every group pill = its rows; no empty group header`, hdrOk && grpOk && noEmptyGroup, JSON.stringify(sn.groups));
      ok(`${label}: pressed segments = ${JSON.stringify(sel)}`, pressedOk, JSON.stringify(sn.segs));
      return sn;
    };
    const IP = new Set(["In Progress"]), NA = new Set(["Needs Attn."]), BOTH = new Set(["In Progress", "Needs Attn."]), EVERY = new Set(Object.values(truth));

    await click(page, "yellow");  await check("only In Progress", IP, ["yellow"]);
    await click(page, "yellow");  await check("In Progress toggled off → falls to All (never an empty dead end)", EVERY, ["all"]);
    await click(page, "red");     const na = await check("only Needs Attention", NA, ["red"]);
    ok("a group with no matching task disappears (Charlie Site has only green/gray)", !na.groups.some(g => /Charlie/.test(g.label)), na.groups.map(g => g.label).join(" | "));
    await click(page, "yellow");  await check("both", BOTH, ["yellow", "red"]);
    await click(page, "red");     await check("both → Needs Attention off → only In Progress", IP, ["yellow"]);
    await click(page, "red");     await check("both again", BOTH, ["yellow", "red"]);
    await click(page, "all");     await check("All clears both", EVERY, ["all"]);
    await click(page, "all");     await check("All is idempotent", EVERY, ["all"]);

    // switching repeatedly: a fixed pseudo-random walk, every step verified against ground truth
    let sel = new Set(), walk = [];
    let seed = 7; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let walkOk = true, detail = "";
    for (let i = 0; i < 24 && walkOk; i++) {
      const pick = ["yellow", "red", "all"][Math.floor(rnd() * 3)];
      walk.push(pick); await click(page, pick);
      if (pick === "all") sel = new Set(); else { sel.has(pick) ? sel.delete(pick) : sel.add(pick); }
      const want = sel.size ? new Set([...sel].map(k => LABEL[k])) : EVERY;
      const sn = await snapshot(page);
      const wantNames = SEEDED.filter(n => want.has(truth[n]));
      const g = sn.groups.every(gr => gr.pill === gr.rows && gr.rows > 0);
      if (!(sameSet(sn.rows.map(r => r.name), wantNames) && sn.headerPill === wantNames.length && g)) { walkOk = false; detail = `step ${i} after [${walk.join(",")}]: got ${sn.rows.map(r => r.name)} pill ${sn.headerPill}`; }
    }
    ok("24 random switches in a row: rows, header pill and group pills agree with the pills every time", walkOk, detail);

    // ungrouped list agrees too
    await setGroup(page, "None");
    await click(page, "all"); await click(page, "red");
    const ung = await snapshot(page);
    ok("Group by None: only Needs Attention → header pill = rows = 4 (A-red, A-red-2, B-red, D-child + D-parent = 5)", ung.rows.length === ung.headerPill && ung.rows.length === 5 && ung.rows.every(r => r.status === "Needs Attn."), `${ung.rows.length}: ${ung.rows.map(r => r.name)}`);
    await setGroup(page, "Project");

    // sort still works inside a selection: Task header ascending then descending, ungrouped, over the 8 rows of "both"
    await setGroup(page, "None");
    await click(page, "all"); await click(page, "yellow"); await click(page, "red");
    const clickTh = async () => { await page.evaluate(() => { [...document.querySelectorAll("thead th")].find(t => t.textContent.trim().startsWith("Task")).click(); }); await page.waitForTimeout(250); };
    await clickTh();
    const asc = (await snapshot(page)).rows.map(r => r.name);
    await clickTh();
    const desc = (await snapshot(page)).rows.map(r => r.name);
    const exp = [...asc].sort((x, y) => x.toLowerCase() < y.toLowerCase() ? -1 : 1);
    ok("column sort still works inside a selection (Task ascending, then descending; 8 rows)", asc.length === 8 && asc.join() === exp.join() && desc.join() === [...exp].reverse().join(), `asc=${asc} desc=${desc}`);
    await setGroup(page, "Project");

    // reload keeps the selection (stored in the saved view preferences)
    await click(page, "all"); await click(page, "red");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /TASK REPORT/.test(document.body.innerText), null, { timeout: 30000 });   // the tab reopens on the report it was on
    const rl = await snapshot(page);
    ok("reload keeps 'only Needs Attention' (pressed + rows)", sameSet(Object.entries(rl.segs).filter(([, v]) => v).map(([k]) => k), ["red"]) && rl.rows.every(r => r.status === "Needs Attn.") && rl.rows.length === 5, JSON.stringify(rl.segs) + " rows=" + rl.rows.length);
    ok("no page errors in the whole run", page.__errs.length === 0, page.__errs.join(" | "));
  }
  await ctx.close();
}

// ═══ 2. legacy stored `false` (the old "All Statuses") opens on All ═══
if (!voided) {
  SEED_FILTER = false;
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await openReport(ctx);
  const s = await snapshot(page);
  ok("legacy stored `false` ('All Statuses') opens on All with every task listed", s.segs.all && !s.segs.yellow && !s.segs.red && s.rows.length === 13, JSON.stringify(s.segs) + " rows=" + s.rows.length);
  await ctx.close();
}

// ═══ 3. nothing qualifies: the default selection is empty → a plain message and a one-click way out ═══
if (!voided) {
  SEED_FILTER = true; SEED_PROJECTS = projectsNoActive;
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await openReport(ctx, { group: false });
  let s = await snapshot(page);
  ok("no In Progress / Needs Attention tasks → empty state names the selection (not 'no tasks in this project')", !!s.empty && /No tasks are In Progress or Needs Attention/.test(s.empty), String(s.empty));
  ok("empty state: header pill reads 0 and no rows", s.headerPill === 0 && s.rows.length === 0);
  await page.click("[data-status-empty] button"); await page.waitForTimeout(250);
  s = await snapshot(page);
  ok("'Show all statuses' in the empty state selects All and lists both tasks", s.segs.all && s.rows.length === 2 && s.headerPill === 2, JSON.stringify(s.segs) + " rows=" + s.rows.length);
  await click(page, "red");
  s = await snapshot(page);
  ok("only Needs Attention with none qualifying → names just that status", /No tasks are Needs Attention\./.test(s.empty || ""), String(s.empty));
  await ctx.close();
  SEED_PROJECTS = projectsFull;
}

// ═══ 4. phone width (Chromium at a phone size — EMULATED, not a device): the header wraps, nothing overflows or overlaps ═══
if (!voided) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await openReport(ctx);
  const geo = await page.evaluate(() => {
    const el = document.querySelector("[data-status-filter]"); const r = el.getBoundingClientRect();
    const hdr = el.parentElement; const sibs = [...hdr.children].filter(c => c !== el).map(c => c.getBoundingClientRect()).filter(b => b.width > 0);
    const overlap = sibs.some(b => !(b.right <= r.left + 0.5 || b.left >= r.right - 0.5 || b.bottom <= r.top + 0.5 || b.top >= r.bottom - 0.5));
    return { left: r.left, right: r.right, vw: innerWidth, overlap, pageScrollsSideways: document.documentElement.scrollWidth > innerWidth + 1, segs: [...el.querySelectorAll("button")].map(b => { const q = b.getBoundingClientRect(); return { t: b.textContent.trim(), h: Math.round(q.height), w: Math.round(q.width) }; }) };
  });
  ok("phone width: the Status control sits fully inside the screen", geo.left >= 0 && geo.right <= geo.vw + 0.5, JSON.stringify({ l: geo.left, r: geo.right, vw: geo.vw }));
  ok("phone width: it overlaps nothing else in the header, and the page does not scroll sideways", !geo.overlap && !geo.pageScrollsSideways, JSON.stringify(geo));
  await page.tap('[data-status-seg="all"]'); await page.waitForTimeout(250);   // opens on both-on; All first, then ONE tap to a single status
  await page.tap('[data-status-seg="red"]'); await page.waitForTimeout(250);
  const ph = await snapshot(page);
  ok("phone width: a tap on 'Needs Attention' narrows the list the same way", ph.rows.length > 0 && ph.rows.every(r => r.status === "Needs Attn.") && ph.headerPill === ph.rows.length, `rows=${ph.rows.length}`);
  await page.screenshot({ path: process.env.SHOT_DIR ? join(process.env.SHOT_DIR, "task-report-status-phone.png") : "/tmp/task-report-status-phone.png" });
  await ctx.close();
}

await browser.close(); server.close();
if (voided) { console.log("\nVOID ❌ — the known-good arm did not hold (no Status control on this build); nothing was scored"); process.exit(2); }
console.log(failed ? `\n${failed} check(s) FAILED ❌` : "\nALL PASS ✅");
process.exit(failed ? 1 : 0);
