/* NEW-1 — Task Report: ONE standard Filter dropdown (Status + Project checkboxes with counts) beside Group by / Show / Columns.
 * Amends B2631584 (#2800), whose Status segmented control it replaces.
 *
 * Drives the embedded scheduler (public/sequence/index.html) headlessly on a seeded account (logged out, offline-fallback boot,
 * ATTEMPT-BEFORE-YOU-PARK: Claude-doable in the sandbox). It carries its OWN independent ground truth: with Filter → Clear all it
 * reads, once, the status pill and project every task shows (the same pill that paints the row), then asserts for every
 * combination that the rows on screen are exactly the tasks whose pill/project are in the selection — and that the header pill,
 * each group pill, the rows, the Filter badge and every count in the dropdown agree.
 *
 * RED-PROOF: on the pre-change build there is no [data-tr-btn] toolbar at all, so the first assertion fails and the run ends
 * VOID rather than scoring (known-good arm = the Clear-all capture must list every seeded task before anything is scored).
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
const CUSTOM = [{ k: "cust1", label: "Blocked", dot: "#7c3aed", bar: "#ede9fe" }];
// Alpha mixes every built-in status; Bravo has red+yellow; Charlie is green/gray/CUSTOM (empties out under any In Progress /
// Needs Attention pick); Delta holds a parent whose only child is red (the parent's ROLLED status is what the report classifies).
const projectsFull = () => ({
  1: { id: 1, name: "Master Schedule", ownerKind: "site", linkedSiteId: "gc1", linkedSiteName: "Alpha Site",
    tasks: [task(1, "A-red", "red"), task(2, "A-yellow", "yellow"), task(3, "A-gray", "gray"), task(4, "A-green", "green"), task(5, "A-paused", "paused"), task(6, "A-red-2", "red")] },
  2: { id: 2, name: "Master Schedule", ownerKind: "site", linkedSiteId: "gp1", linkedSiteName: "Bravo Site",
    tasks: [task(1, "B-yellow", "yellow"), task(2, "B-yellow-2", "yellow"), task(3, "B-red", "red")] },
  3: { id: 3, name: "Master Schedule", ownerKind: "site", linkedSiteId: "cc1", linkedSiteName: "Charlie Site",
    tasks: [task(1, "C-green", "green"), task(2, "C-gray", "gray"), task(3, "C-custom", "cust1")] },
  4: { id: 4, name: "Master Schedule", ownerKind: "site", linkedSiteId: "dd1", linkedSiteName: "Delta Site",
    tasks: [task(1, "D-parent", "gray", { isExpanded: true }), task(2, "D-child", "red", { parentId: 1 })] },
});
const SEEDED = ["A-red", "A-yellow", "A-gray", "A-green", "A-paused", "A-red-2", "B-yellow", "B-yellow-2", "B-red", "C-green", "C-gray", "C-custom", "D-parent", "D-child"];
const projectsMany = () => Object.fromEntries(Array.from({ length: 40 }, (_, i) => [i + 1, { id: i + 1, name: "Master Schedule", ownerKind: "site", linkedSiteId: "m" + i, linkedSiteName: "Many Project " + String(i + 1).padStart(2, "0"),
  tasks: [task(1, "M" + (i + 1) + "-red", "red"), task(2, "M" + (i + 1) + "-green", "green")] }]));
let SEED_PROJECTS = projectsFull;
let SEED_FILTER = true;   // legacy boolean — what an account that never touched the chip holds
let SEED_PROJECT_FILTER;  // undefined = key absent (an account saved before this control existed)
const makeSeed = () => ({
  nPid: 60, nTid: {}, aPid: 1, view: "grid", section: "projects", editProjId: null, healthColStyle: "stoplight",
  settings: { defaultSplit: 60, snapDefault: true, holidays: {}, customHealth: CUSTOM, healthLabelOverrides: {} },
  masterHealthFilter: SEED_FILTER, ...(SEED_PROJECT_FILTER !== undefined ? { masterProjectFilter: SEED_PROJECT_FILTER } : {}), projects: SEED_PROJECTS(),
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
  page.__errs = errs;
  if (group && await page.$('[data-tr-btn="group"]')) await setGroup(page, "project");
  return page;
}
const menuOpen = (page, id) => page.evaluate((id) => !!document.querySelector(`[data-tr-panel="${id}"]`), id);
const openMenu = async (page, id) => { if (!(await menuOpen(page, id))) { await page.click(`[data-tr-btn="${id}"]`); await page.waitForSelector(`[data-tr-panel="${id}"]`); await page.waitForTimeout(80); } };
const closeAll = async (page) => { await page.keyboard.press("Escape"); await page.waitForTimeout(100); };
const setGroup = async (page, which) => {
  await openMenu(page, "group");
  await page.click(`[data-group-opt="${which}"]`);
  await page.waitForTimeout(250);
};
// What is on screen: header pill, per-group (label, pill, rows), every data row with its status pill + project column, and the Filter's own state.
const snapshot = (page) => page.evaluate(() => {
  const ths = [...document.querySelectorAll("thead th")].map(t => t.textContent.trim());
  const ti = ths.findIndex(t => t.startsWith("Task")), si = ths.findIndex(t => t.startsWith("Status")), pi = ths.findIndex(t => t.startsWith("Project"));
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
    rows.push({ name: tds[ti].textContent.trim(), status: tds[si].textContent.trim(), proj: (pi >= 0 ? tds[pi].textContent.trim() : "") || (cur ? cur.label : "") });   // the Project column is hidden while grouped → the group header names it
    if (cur) cur.rows++;
  });
  const badge = document.querySelector("[data-filter-badge]");
  const filterBtn = document.querySelector('[data-tr-btn="filter"]');
  return {
    headerPill, groups, rows,
    badge: badge ? badge.textContent.trim() : null,
    filterBtnOn: !!filterBtn && filterBtn.getAttribute("data-active") === "1",   // "filters in use" — distinct from the open state, which shares the accent class
    groupLabel: document.querySelector('[data-tr-btn="group"]')?.textContent.replace(/\s+/g, " ").trim() || null,
    empty: document.querySelector("[data-filter-empty]")?.textContent.replace(/\s+/g, " ").trim() || null,
    hasToolbar: !!document.querySelector("[data-report-toolbar]"),
  };
});
// The Filter panel's checkboxes and the count printed beside each.
const panel = (page) => page.evaluate(() => {
  const st = {}, pr = {}, labels = {};
  document.querySelectorAll("[data-filter-status]").forEach(i => { st[i.dataset.filterStatus] = { on: i.checked, n: Number(i.closest("label").querySelector("[data-filter-count]").textContent), label: i.closest("label").textContent.replace(/\d+$/, "").trim() }; });
  document.querySelectorAll("[data-filter-project]").forEach(i => { pr[i.dataset.filterProject] = { on: i.checked, n: Number(i.closest("label").querySelector("[data-filter-count]").textContent), label: i.closest("label").textContent.replace(/\d+$/, "").trim() }; });
  return { st, pr };
});
const tick = async (page, kind, key) => { await openMenu(page, "filter"); await page.click(kind === "s" ? `[data-filter-status="${key}"]` : `[data-filter-project="${key}"]`); await page.waitForTimeout(200); };
const clearAll = async (page) => { await openMenu(page, "filter"); await page.click("[data-filter-clear]"); await page.waitForTimeout(220); };
const PILL = { gray: "Not Started", yellow: "In Progress", red: "Needs Attn.", green: "Complete", paused: "Paused", cust1: "Blocked" };
const STATUS_ORDER = ["gray", "yellow", "red", "paused", "green", "cust1"];

// ═══ 1. the full seed, legacy `true` stored → In Progress + Needs Attention checked ═══
{
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await openReport(ctx);
  let s = await snapshot(page);
  const btns = await page.evaluate(() => [...document.querySelectorAll("[data-tr-btn]")].map(b => { const r = b.getBoundingClientRect(); return { id: b.dataset.trBtn, x: r.left, y: r.top, cls: b.className.replace(/\bact\b/, "").trim(), tag: b.tagName }; }));
  if (!ok("the toolbar has exactly Filter · Group by · Show · Columns, left to right, in that order", s.hasToolbar && btns.map(b => b.id).join() === "filter,group,show,columns" && btns.every((b, i) => i === 0 || (b.x > btns[i - 1].x && Math.abs(b.y - btns[0].y) < 3)), JSON.stringify(btns))) voided = true;
  else {
    ok("all four are the same button style (one class, real <button>s)", new Set(btns.map(b => b.cls)).size === 1 && btns.every(b => b.tag === "BUTTON"), JSON.stringify(btns.map(b => b.cls)));
    const toolbarKids = await page.evaluate(() => document.querySelector("[data-report-toolbar]").children.length);
    ok("nothing else in that row — and the Status segmented control + its label are gone", toolbarKids === 4 && !(await page.$("[data-status-seg]")) && !(await page.$("[data-status-filter]")), "kids=" + toolbarKids);
    ok("TASK REPORT title and count pill still sit on the left", await page.evaluate(() => { const t = [...document.querySelectorAll("span")].find(x => x.textContent.trim() === "TASK REPORT"); const f = document.querySelector('[data-tr-btn="filter"]'); return !!t && t.getBoundingClientRect().left < f.getBoundingClientRect().left && !!t.nextElementSibling && /^\d+$/.test(t.nextElementSibling.textContent.trim()); }));
    ok("Group by reads 'Group by: Project' (set by the harness) with a chevron", /^Group by: Project\s*▾$/.test(s.groupLabel || ""), s.groupLabel);

    await openMenu(page, "filter");
    let pn = await panel(page);
    ok("legacy stored `true` opens as In Progress + Needs Attention checked, nothing else (today's default)", STATUS_ORDER.every(k => pn.st[k] && pn.st[k].on === (k === "yellow" || k === "red")) && Object.values(pn.pr).every(p => !p.on), JSON.stringify(pn.st));
    ok("a checkbox for EVERY status in the approved order incl. the custom one, and one per project (4)", Object.keys(pn.st).join() === STATUS_ORDER.join() && Object.keys(pn.pr).length === 4, Object.keys(pn.st).join() + " / " + Object.keys(pn.pr).join());
    ok("status names are full words; the custom status is listed", pn.st.red.label.includes("Needs Attention") && pn.st.cust1.label.includes("Blocked") && pn.st.yellow.label.includes("In Progress"), JSON.stringify(Object.values(pn.st).map(x => x.label)));
    s = await snapshot(page);
    ok("badge shows 1 (only the Status type is in use) and the Filter button has the accent state", s.badge === "1" && s.filterBtnOn, JSON.stringify({ b: s.badge, on: s.filterBtnOn }));

    // ground truth: Clear all, then read every task's own status pill and project
    await clearAll(page);
    s = await snapshot(page);
    const truth = Object.fromEntries(s.rows.map(r => [r.name, { status: r.status, proj: (r.proj.match(/(Alpha|Bravo|Charlie|Delta)/) || [])[1] }]));
    if (!ok("known-good arm: Clear all lists every seeded task (14), header pill 14, and the badge disappears", sameSet(Object.keys(truth), SEEDED) && s.headerPill === 14 && s.badge === null && !s.filterBtnOn, `rows=${s.rows.length} pill=${s.headerPill} badge=${s.badge}`)) voided = true;
    ok("the parent's ROLLED status is what it shows (D-parent reads Needs Attn., stored gray); the custom status reads Blocked", truth["D-parent"].status === "Needs Attn." && truth["C-custom"].status === "Blocked", JSON.stringify([truth["D-parent"], truth["C-custom"]]));
    const projId = Object.fromEntries(Object.entries((await panel(page)).pr).map(([id, v]) => [(v.label.match(/(Alpha|Bravo|Charlie|Delta)/) || [])[1], id]));

    // ── one check = rows + header + groups + badge + every count in the (open) dropdown vs the independent truth ──
    let statusSel = new Set(), projSel = new Set();
    const check = async (label) => {
      const sn = await snapshot(page); await openMenu(page, "filter"); const pn2 = await panel(page);
      const pass = n => (statusSel.size === 0 || statusSel.has(Object.keys(PILL).find(k => PILL[k] === truth[n].status))) && (projSel.size === 0 || projSel.has(truth[n].proj));
      const wantNames = SEEDED.filter(pass);
      ok(`${label}: rows = exactly the tasks matching (${wantNames.length})`, sameSet(sn.rows.map(r => r.name), wantNames), `got ${sn.rows.map(r => r.name).join(",")}`);
      const hdrOk = sn.headerPill === sn.rows.length;
      const grpOk = sn.groups.length === 0 || (sn.groups.every(g => g.pill === g.rows && g.rows > 0) && sn.groups.reduce((n, g) => n + g.pill, 0) === sn.rows.length);
      ok(`${label}: header pill ${sn.headerPill} = rows ${sn.rows.length}; every group pill = its rows; no empty group header`, hdrOk && grpOk, JSON.stringify(sn.groups));
      const wantBadge = (statusSel.size ? 1 : 0) + (projSel.size ? 1 : 0);
      ok(`${label}: badge ${wantBadge || "absent"}`, (sn.badge === null ? 0 : Number(sn.badge)) === wantBadge && sn.filterBtnOn === (wantBadge > 0), JSON.stringify({ b: sn.badge, on: sn.filterBtnOn }));
      const boxesOk = STATUS_ORDER.every(k => pn2.st[k].on === statusSel.has(k)) && Object.entries(projId).every(([nm, id]) => pn2.pr[id].on === projSel.has(nm));
      ok(`${label}: ticked boxes = the selection`, boxesOk, JSON.stringify([...statusSel]) + JSON.stringify([...projSel]));
      // counts: status count = seeded tasks of that status inside the project selection; project count = tasks of that project inside the status selection
      const stWant = k => SEEDED.filter(n => PILL[k] === truth[n].status && (projSel.size === 0 || projSel.has(truth[n].proj))).length;
      const prWant = nm => SEEDED.filter(n => truth[n].proj === nm && (statusSel.size === 0 || statusSel.has(Object.keys(PILL).find(k => PILL[k] === truth[n].status)))).length;
      const cntOk = STATUS_ORDER.every(k => pn2.st[k].n === stWant(k)) && Object.entries(projId).every(([nm, id]) => pn2.pr[id].n === prWant(nm));
      ok(`${label}: every count in the dropdown equals the rows that box would show`, cntOk, JSON.stringify({ st: Object.fromEntries(STATUS_ORDER.map(k => [k, [pn2.st[k].n, stWant(k)]])), pr: Object.fromEntries(Object.entries(projId).map(([nm, id]) => [nm, [pn2.pr[id].n, prWant(nm)]])) }));
      ok(`${label}: the panel stayed open while ticking (no Apply button, no close)`, await menuOpen(page, "filter") && !(await page.$("[data-filter-apply]")));
      return sn;
    };
    const toggleS = async (k) => { await tick(page, "s", k); statusSel.has(k) ? statusSel.delete(k) : statusSel.add(k); };
    const toggleP = async (nm) => { await tick(page, "p", projId[nm]); projSel.has(nm) ? projSel.delete(nm) : projSel.add(nm); };

    await check("nothing checked (Clear all)");
    for (const k of STATUS_ORDER) { await toggleS(k); await check(`status alone: ${PILL[k]}`); await toggleS(k); }
    await toggleS("yellow"); await toggleS("red"); await check("two statuses: In Progress + Needs Attention (the default pair)");
    await toggleS("green"); await toggleS("paused"); await check("four statuses");
    await toggleS("cust1"); await toggleS("gray"); await check("every status checked (= everything)");
    await clearAll(page); statusSel = new Set(); projSel = new Set(); await check("Clear all after ticking statuses");
    for (const nm of ["Alpha", "Bravo", "Charlie", "Delta"]) { await toggleP(nm); await check(`project alone: ${nm}`); await toggleP(nm); }
    await toggleP("Alpha"); await toggleP("Delta"); await check("two projects: Alpha + Delta");
    await clearAll(page); statusSel = new Set(); projSel = new Set();
    await toggleS("yellow"); await toggleS("red"); await toggleP("Bravo"); const sp = await check("Status (In Progress + Needs Attention) + Project (Bravo)");
    ok("Status + Project: badge is 2", sp.badge === "2");
    await toggleS("red"); await toggleP("Alpha"); await check("In Progress + Alpha + Bravo");
    await clearAll(page); statusSel = new Set(); projSel = new Set();
    await toggleS("cust1"); await check("custom status alone (Blocked)");
    await toggleP("Charlie"); await check("Blocked in Charlie");
    await toggleP("Charlie"); await toggleS("cust1"); await toggleS("red");
    const na = await check("only Needs Attention");
    ok("a group with no matching task disappears (Charlie has no Needs Attention task)", !na.groups.some(g => /Charlie/.test(g.label)), na.groups.map(g => g.label).join(" | "));

    // a fixed pseudo-random walk over both sections, every step verified
    await clearAll(page); statusSel = new Set(); projSel = new Set();
    let seed = 11; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let walkOk = true, detail = "";
    for (let i = 0; i < 30 && walkOk; i++) {
      const r = rnd();
      if (r < 0.5) await toggleS(STATUS_ORDER[Math.floor(rnd() * STATUS_ORDER.length)]);
      else if (r < 0.93) await toggleP(["Alpha", "Bravo", "Charlie", "Delta"][Math.floor(rnd() * 4)]);
      else { await clearAll(page); statusSel = new Set(); projSel = new Set(); }
      const sn = await snapshot(page); await openMenu(page, "filter"); const pn2 = await panel(page);
      const wantNames = SEEDED.filter(n => (statusSel.size === 0 || statusSel.has(Object.keys(PILL).find(k => PILL[k] === truth[n].status))) && (projSel.size === 0 || projSel.has(truth[n].proj)));
      const g = sn.groups.every(gr => gr.pill === gr.rows && gr.rows > 0);
      const cnt = STATUS_ORDER.every(k => pn2.st[k].n === SEEDED.filter(n => PILL[k] === truth[n].status && (projSel.size === 0 || projSel.has(truth[n].proj))).length);
      if (!(sameSet(sn.rows.map(r => r.name), wantNames) && sn.headerPill === wantNames.length && g && cnt)) { walkOk = false; detail = `step ${i}: got ${sn.rows.map(r => r.name)} pill ${sn.headerPill}`; }
    }
    ok("30 random ticks/clears across both sections: rows, header pill, group pills and dropdown counts agree every time", walkOk, detail);

    // Group by with filters on
    await clearAll(page); statusSel = new Set(); projSel = new Set();
    await toggleS("red"); await toggleP("Alpha"); await toggleP("Delta");
    await closeAll(page);
    await setGroup(page, "none");
    let sn = await snapshot(page);
    ok("Group by: None with Status + Project on — a flat list of exactly the matching rows, and the button reads 'Group by: None'", sn.groups.length === 0 && sameSet(sn.rows.map(r => r.name), ["A-red", "A-red-2", "D-parent", "D-child"]) && sn.headerPill === 4 && /^Group by: None/.test(sn.groupLabel), JSON.stringify({ rows: sn.rows.map(r => r.name), l: sn.groupLabel }));
    await setGroup(page, "project");
    sn = await snapshot(page);
    ok("Group by: Project with the same filters — two groups (Alpha 2, Delta 2), pills agree", sn.groups.length === 2 && sn.groups.every(g => g.pill === 2 && g.rows === 2) && /^Group by: Project/.test(sn.groupLabel), JSON.stringify(sn.groups));
    // a group emptying out while ticking
    await toggleS("red"); await toggleS("green");     // Needs Attention off, Complete on → only Alpha has a Complete task among Alpha + Delta
    sn = await check("a group emptying out (Complete, Alpha + Delta)");
    ok("…Delta's group header is gone (it has no Complete task)", !sn.groups.some(g => /Delta/.test(g.label)) && sn.groups.length === 1, sn.groups.map(g => g.label).join("|"));
    await closeAll(page);

    // sort still works inside a selection, ungrouped
    await openMenu(page, "filter"); await clearAll(page); await toggleS("yellow"); await toggleS("red"); await closeAll(page);
    await setGroup(page, "none");
    const clickTh = async () => { await page.evaluate(() => { [...document.querySelectorAll("thead th")].find(t => t.textContent.trim().startsWith("Task")).click(); }); await page.waitForTimeout(250); };
    await clickTh();
    const asc = (await snapshot(page)).rows.map(r => r.name);
    await clickTh();
    const desc = (await snapshot(page)).rows.map(r => r.name);
    const exp = [...asc].sort((x, y) => x.toLowerCase() < y.toLowerCase() ? -1 : 1);
    ok("column sort still works inside a selection (Task ascending, then descending; 8 rows)", asc.length === 8 && asc.join() === exp.join() && desc.join() === [...exp].reverse().join(), `asc=${asc} desc=${desc}`);
    await setGroup(page, "project");

    // Show + Columns still do their jobs and Show feeds the Filter's counts
    await openMenu(page, "show");
    ok("Show keeps its contents (Which tasks to show · Action items only · outline levels · Show all)", await page.evaluate(() => { const t = document.querySelector('[data-tr-panel="show"]').innerText; return /Which tasks to show/i.test(t) && /Action items only/.test(t) && /Top-level phases/.test(t) && /Show all/.test(t); }));
    await page.evaluate(() => [...document.querySelectorAll('[data-tr-panel="show"] label')].find(l => /Action items only/.test(l.textContent)).querySelector("input").click());
    await page.waitForTimeout(250);
    sn = await snapshot(page);
    ok("Show › Action items only hides the parent (D-parent) — it still narrows with the Filter on", !sn.rows.some(r => r.name === "D-parent") && sn.rows.some(r => r.name === "D-child") && sn.headerPill === sn.rows.length, sn.rows.map(r => r.name).join());
    await openMenu(page, "filter");
    pn = await panel(page);
    ok("…and the Filter's counts follow it (Needs Attention now counts 4 leaves: A-red, A-red-2, B-red, D-child)", pn.st.red.n === 4, JSON.stringify(pn.st.red));
    await openMenu(page, "show");
    await page.evaluate(() => [...document.querySelectorAll('[data-tr-panel="show"] span')].find(l => l.textContent.trim() === "Show all").click());
    await page.waitForTimeout(250);
    await closeAll(page);
    await openMenu(page, "columns");
    const colsBefore = await page.evaluate(() => [...document.querySelectorAll("thead th")].map(t => t.textContent.trim()));
    ok("Columns keeps its contents (Show / Hide Columns · every column · Reset to default)", await page.evaluate(() => { const t = document.querySelector('[data-tr-panel="columns"]').innerText; return /Show \/ Hide Columns/i.test(t) && /Predecessors/.test(t) && /Reset to default/.test(t); }));
    await page.evaluate(() => [...document.querySelectorAll('[data-tr-panel="columns"] label')].find(l => /^Notes$/.test(l.textContent.trim())).querySelector("input").click());
    await page.waitForTimeout(250);
    const colsAfter = await page.evaluate(() => [...document.querySelectorAll("thead th")].map(t => t.textContent.trim()));
    ok("Columns › untick Notes removes the column", colsBefore.some(c => /^Notes/.test(c)) && !colsAfter.some(c => /^Notes/.test(c)), colsAfter.join());
    await page.evaluate(() => [...document.querySelectorAll('[data-tr-panel="columns"] span')].find(l => l.textContent.trim() === "Reset to default").click());
    await page.waitForTimeout(250);
    ok("Columns › Reset to default brings it back", (await page.evaluate(() => [...document.querySelectorAll("thead th")].map(t => t.textContent.trim()))).some(c => /^Notes/.test(c)));
    await closeAll(page);

    // dropdown mechanics: one closes another, outside press closes, Esc closes
    await openMenu(page, "filter");
    await page.click('[data-tr-btn="group"]'); await page.waitForTimeout(150);
    ok("opening Group by with Filter open → Filter closes and Group by opens, in ONE click", !(await menuOpen(page, "filter")) && await menuOpen(page, "group"));
    await page.click('[data-tr-btn="show"]'); await page.waitForTimeout(150);
    ok("…then Show replaces Group by", !(await menuOpen(page, "group")) && await menuOpen(page, "show"));
    await page.click('[data-tr-btn="columns"]'); await page.waitForTimeout(150);
    ok("…then Columns replaces Show", !(await menuOpen(page, "show")) && await menuOpen(page, "columns"));
    await page.click("tbody tr td:nth-child(3)"); await page.waitForTimeout(150);
    ok("a press outside (on the table) closes the open dropdown", !(await menuOpen(page, "columns")));
    await openMenu(page, "filter"); await page.keyboard.press("Escape"); await page.waitForTimeout(120);
    ok("Esc closes the Filter", !(await menuOpen(page, "filter")));
    await page.click('[data-tr-btn="filter"]'); await page.waitForTimeout(100); await page.click('[data-tr-btn="filter"]'); await page.waitForTimeout(100);
    ok("clicking the Filter button again toggles it shut", !(await menuOpen(page, "filter")));
    await openMenu(page, "group"); await page.click('[data-group-opt="none"]'); await page.waitForTimeout(200);
    ok("choosing in Group by applies and closes the list", !(await menuOpen(page, "group")) && /Group by: None/.test((await snapshot(page)).groupLabel));
    await setGroup(page, "project");

    // reload keeps both selections
    await clearAll(page); await toggleS("red"); await toggleP("Alpha"); await toggleP("Delta"); await closeAll(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForFunction(() => /TASK REPORT/.test(document.body.innerText), null, { timeout: 30000 });
    const rl = await snapshot(page); await openMenu(page, "filter"); const rp = await panel(page);
    ok("reload keeps 'Needs Attention' + 'Alpha, Delta' (boxes, badge 2, rows)", rp.st.red.on && STATUS_ORDER.filter(k => k !== "red").every(k => !rp.st[k].on) && rl.badge === "2" && sameSet(rl.rows.map(r => r.name), ["A-red", "A-red-2", "D-parent", "D-child"]), JSON.stringify({ b: rl.badge, rows: rl.rows.map(r => r.name) }));
    ok("no page errors in the whole run", page.__errs.length === 0, page.__errs.join(" | "));
  }
  await ctx.close();
}

// ═══ 2. MIGRATION — what the old control saved opens as the matching checkboxes ═══
async function savedAs(filter, projectFilter) {
  SEED_FILTER = filter; SEED_PROJECT_FILTER = projectFilter;
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await openReport(ctx, { group: false });
  await openMenu(page, "filter");
  const pn = await panel(page), sn = await snapshot(page);
  await ctx.close();
  return { pn, sn, on: Object.entries(pn.st).filter(([, v]) => v.on).map(([k]) => k), pOn: Object.entries(pn.pr).filter(([, v]) => v.on).map(([id]) => id) };
}
if (!voided) {
  let r = await savedAs(false);
  ok("migration: saved `false` ('All Statuses') → nothing checked, every task listed, no badge", r.on.length === 0 && r.sn.rows.length === 14 && r.sn.badge === null, JSON.stringify({ on: r.on, rows: r.sn.rows.length }));
  r = await savedAs(["red"]);
  ok("migration: saved ['red'] (only Needs Attention) → only that box, 5 rows", sameSet(r.on, ["red"]) && r.sn.rows.length === 5 && r.sn.badge === "1", JSON.stringify({ on: r.on, rows: r.sn.rows.length }));
  r = await savedAs(["yellow"]);
  ok("migration: saved ['yellow'] (only In Progress) → only that box, 3 rows", sameSet(r.on, ["yellow"]) && r.sn.rows.length === 3, JSON.stringify({ on: r.on, rows: r.sn.rows.length }));
  r = await savedAs(["yellow", "red"]);
  ok("migration: saved ['yellow','red'] (both) → both boxes, 8 rows", sameSet(r.on, ["yellow", "red"]) && r.sn.rows.length === 8, JSON.stringify({ on: r.on, rows: r.sn.rows.length }));
  r = await savedAs([]);
  ok("migration: saved [] (All) → nothing checked, 14 rows", r.on.length === 0 && r.sn.rows.length === 14);
  r = await savedAs(true);
  ok("migration: saved `true` (the old chip's default) → In Progress + Needs Attention", sameSet(r.on, ["yellow", "red"]) && r.pOn.length === 0 && r.sn.rows.length === 8);
  r = await savedAs("garbage");
  ok("migration: an unreadable saved value falls back to the default, not to 'nothing matches'", sameSet(r.on, ["yellow", "red"]) && r.sn.rows.length === 8);
  r = await savedAs(["red", "cust1"], ["99", "3"]);
  ok("a saved custom status maps to its box; a saved id of a deleted project is dropped (3 stays)", sameSet(r.on, ["red", "cust1"]) && sameSet(r.pOn, ["3"]) && r.sn.rows.length === 1 && r.sn.rows[0].name === "C-custom", JSON.stringify({ on: r.on, pOn: r.pOn, rows: r.sn.rows.map(x => x.name) }));
  SEED_FILTER = true; SEED_PROJECT_FILTER = undefined;
}

// ═══ 3. nothing matches: a plain message that names the filter and a one-click way back ═══
if (!voided) {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
  const page = await openReport(ctx, { group: false });
  await clearAll(page); await tick(page, "s", "green");
  const pn = await panel(page);
  const delta = Object.entries(pn.pr).find(([, v]) => /Delta/.test(v.label))[0];
  await tick(page, "p", delta); await closeAll(page);
  let s = await snapshot(page);
  ok("Complete + Delta matches nothing → the empty state names the filter (not the old 'No tasks are Needs Attention')", !!s.empty && /No tasks match the filter/.test(s.empty) && /Complete/.test(s.empty) && /Delta/.test(s.empty) && !/Show all statuses/.test(s.empty), String(s.empty));
  ok("empty state: header pill 0, no rows, badge 2", s.headerPill === 0 && s.rows.length === 0 && s.badge === "2");
  await page.click("[data-filter-empty-clear]"); await page.waitForTimeout(250);
  s = await snapshot(page);
  ok("'Clear filter' in the empty state shows every task again (no dead end)", s.rows.length === 14 && s.headerPill === 14 && s.badge === null, `rows=${s.rows.length}`);
  await ctx.close();
}

// ═══ 4. many projects: the panel scrolls INSIDE itself, stays inside the window, Clear all stays reachable ═══
if (!voided) {
  SEED_PROJECTS = projectsMany;
  for (const vp of [{ width: 1500, height: 700 }, { width: 390, height: 640 }]) {
    const ctx = await browser.newContext({ viewport: vp, ...(vp.width < 500 ? { deviceScaleFactor: 2, hasTouch: true, isMobile: true } : {}) });
    const page = await openReport(ctx, { group: false });
    await openMenu(page, "filter");
    const g = await page.evaluate(() => {
      const p = document.querySelector('[data-tr-panel="filter"]'), b = p.querySelector("[data-tr-panel-body]"), c = p.querySelector("[data-filter-clear]"), r = p.getBoundingClientRect(), cr = c.getBoundingClientRect();
      return { l: r.left, r: r.right, t: r.top, b: r.bottom, vw: innerWidth, vh: innerHeight, scrolls: b.scrollHeight > b.clientHeight + 2, clearVisible: cr.bottom <= innerHeight && cr.top >= 0, nProj: p.querySelectorAll("[data-filter-project]").length };
    });
    ok(`${vp.width}×${vp.height}: 40 projects → the panel stays inside the window (not clipped by the table or the frame edge)`, g.l >= 0 && g.r <= g.vw + 0.5 && g.b <= g.vh + 0.5 && g.t >= 0, JSON.stringify(g));
    ok(`${vp.width}×${vp.height}: the long list scrolls inside the panel and Clear all stays visible at the bottom`, g.nProj === 40 && g.scrolls && g.clearVisible, JSON.stringify(g));
    await page.evaluate(() => { const b = document.querySelector('[data-tr-panel="filter"] [data-tr-panel-body]'); b.scrollTop = b.scrollHeight; });
    await page.waitForTimeout(100);
    await page.click('[data-filter-project="40"]'); await page.waitForTimeout(200);
    const s = await snapshot(page);
    ok(`${vp.width}×${vp.height}: the last project (scrolled to) can be ticked → only its rows show`, s.rows.length === 1 && /^M40-/.test(s.rows[0].name), `rows=${s.rows.length} ${s.rows.map(r => r.name)}`);
    await ctx.close();
  }
  SEED_PROJECTS = projectsFull;
}

// ═══ 5. phone width (Chromium at a phone size — EMULATED, not a device): four buttons fit, the title is not crowded ═══
if (!voided) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await openReport(ctx);
  const geo = await page.evaluate(() => {
    const bs = [...document.querySelectorAll("[data-tr-btn]")].map(b => { const r = b.getBoundingClientRect(); return { id: b.dataset.trBtn, l: r.left, r: r.right, t: r.top, b: r.bottom }; });
    const title = [...document.querySelectorAll("span")].find(x => x.textContent.trim() === "TASK REPORT").getBoundingClientRect();
    const pill = [...document.querySelectorAll("span")].find(x => x.textContent.trim() === "TASK REPORT").nextElementSibling.getBoundingClientRect();
    const hit = (a, c) => !(a.r <= c.l + 0.5 || a.l >= c.r - 0.5 || a.b <= c.t + 0.5 || a.t >= c.b - 0.5);
    let overlap = false; bs.forEach((a, i) => bs.forEach((c, j) => { if (i < j && hit(a, c)) overlap = true; }));
    const tl = { l: title.left, r: title.right, t: title.top, b: title.bottom }, pl = { l: pill.left, r: pill.right, t: pill.top, b: pill.bottom };
    const crowd = bs.some(b => hit(b, tl) || hit(b, pl));
    return { bs, overlap, crowd, vw: innerWidth, inside: bs.every(b => b.l >= 0 && b.r <= innerWidth + 0.5), sideways: document.documentElement.scrollWidth > innerWidth + 1, rowsOfButtons: new Set(bs.map(b => Math.round(b.t))).size };
  });
  ok("phone width: all four buttons sit fully inside the screen", geo.inside, JSON.stringify(geo.bs));
  ok("phone width: no button overlaps another, none crowds TASK REPORT or its count, and the page does not scroll sideways", !geo.overlap && !geo.crowd && !geo.sideways, JSON.stringify({ o: geo.overlap, c: geo.crowd, s: geo.sideways }));
  console.log(`   (phone width: the four buttons occupy ${geo.rowsOfButtons} row(s))`);
  await page.tap('[data-tr-btn="filter"]'); await page.waitForTimeout(250);
  const inside = await page.evaluate(() => { const r = document.querySelector('[data-tr-panel="filter"]').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5; });
  ok("phone width: the open Filter panel is inside the screen", inside);
  await page.tap('[data-filter-status="red"]'); await page.waitForTimeout(250);   // Needs Attention off → only In Progress remains checked
  await page.tap('[data-filter-status="yellow"]'); await page.waitForTimeout(250); // In Progress off → nothing checked
  await page.tap('[data-filter-status="red"]'); await page.waitForTimeout(250);    // only Needs Attention
  const ph = await snapshot(page);
  ok("phone width: taps on the checkboxes narrow the list the same way (only Needs Attention → 5 rows)", ph.rows.length === 5 && ph.rows.every(r => r.status === "Needs Attn.") && ph.headerPill === 5 && ph.badge === "1", `rows=${ph.rows.length} badge=${ph.badge}`);
  await page.screenshot({ path: process.env.SHOT_DIR ? join(process.env.SHOT_DIR, "task-report-filter-phone.png") : "/tmp/task-report-filter-phone.png" });
  await ctx.close();
}

await browser.close(); server.close();
if (voided) { console.log("\nVOID ❌ — the known-good arm did not hold (no Filter toolbar, or Clear all did not list every task); nothing was scored"); process.exit(2); }
console.log(failed ? `\n${failed} check(s) FAILED ❌` : "\nALL PASS ✅");
process.exit(failed ? 1 : 0);
