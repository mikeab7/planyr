/* B1873360/B1873361 — MasterView's "Group by project" merged two DIFFERENTLY-OWNED schedules
 * that happen to share a bare name (the owner's own account holds two schedules both named
 * "Master Schedule", one under Goose Creek and one under Grand Port) into ONE section with a
 * summed count badge — because the grouping keyed off `t.projName` (the bare name) instead of
 * `t.projId`. Same root cause as NEW-1's crossScheduleLabel work (PR #1741): a schedule named to
 * a human without also naming which project owns it is ambiguous the moment two schedules share
 * a name.
 *
 * RED-PROOF (performed by hand while fixing this item, not re-run here): reverting the
 * `groupRowsByProject`/`projLabel` changes and re-running this fixture reproduces exactly the
 * reported symptom — ONE "Master Schedule" header with a summed count (1+3=4) instead of two.
 *
 * Drives the embedded scheduler (public/sequence/index.html) headlessly against a rewritten
 * __PLANAR_DATA__ seed shaped like the owner's real account (two same-named schedules under
 * different sites, three schedules under one project, an org-owned schedule, and a site-owned
 * schedule with a null linkedSiteName) — logged out, offline-fallback boot, no live GIS
 * (ATTEMPT-BEFORE-YOU-PARK: Claude-doable in the sandbox).
 *
 * Same CDN caveat as verify-schedule-output-bugs.mjs: SEQ_VENDOR=/dir/with/{react,react-dom,babel,supabase}.js
 * pre-downloads the CDN libs if this sandbox's proxy ever closes them off.
 *
 * Run:  PW_CHROME=<chrome> [SEQ_VENDOR=<dir>] node ui-audit/verify-master-group-by-project.mjs
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

// A minimal task — only the fields MasterView's `rows` pass and the health filter read.
const task = (id, name, health) => ({
  id, name, start: "2026-12-27", end: "2026-12-28", duration: 2, predecessors: [],
  health, percentComplete: 0, parentId: null, responsibleParty: "", notes: [], isExpanded: true,
});

// Shaped after the owner's real account (see the B1873360/B1873361 backlog items): two
// "Master Schedule"s under different sites, three schedules under one project (adjacency, (f)),
// an org-owned schedule, and a site-owned schedule whose linkedSiteName is null (never bare).
const SEED = {
  nPid: 6, nTid: {}, aPid: 1, view: "grid", section: "projects", editProjId: null,
  healthColStyle: "stoplight",
  settings: { defaultSplit: 60, snapDefault: true, holidays: {}, customHealth: [], healthLabelOverrides: {} },
  masterHealthFilter: false, // "All Statuses" — every seeded row stays visible regardless of health
  projects: {
    1: { id: 1, name: "Master Schedule", ownerKind: "site", linkedSiteId: "gc1", linkedSiteName: "Goose Creek", tasks: [task(1, "GC-MS-1", "red")] },
    22: { id: 22, name: "TAS Land Sale", ownerKind: "site", linkedSiteId: "gc1", linkedSiteName: "Goose Creek", tasks: [task(1, "GC-TAS-1", "yellow")] },
    30: { id: 30, name: "MUD v PID", ownerKind: "site", linkedSiteId: "gc1", linkedSiteName: "Goose Creek", tasks: [task(1, "GC-MUD-1", "green")] },
    2: { id: 2, name: "Master Schedule", ownerKind: "site", linkedSiteId: "gp1", linkedSiteName: "Grand Port", tasks: [task(1, "GP-MS-1", "red"), task(2, "GP-MS-2", "yellow"), task(3, "GP-MS-3", "gray")] },
    5: { id: 5, name: "Pursuits", ownerKind: "org", tasks: [task(1, "Org-1", "gray")] },
    24: { id: 24, name: "Untitled site", ownerKind: "site", linkedSiteId: "zz1", linkedSiteName: null, tasks: [task(1, "Untitled-1", "gray")] },
  },
};
const rewriteSeed = html => html.replace(
  /<script id="planar-data">window\.__PLANAR_DATA__=(.*?);<\/script>/s,
  `<script id="planar-data">window.__PLANAR_DATA__=${JSON.stringify(SEED)};</script>`,
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
      text = rewriteSeed(text);
      body = Buffer.from(text);
    }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;
console.log("serving", url, VENDOR ? "(vendored libs)" : "(CDN libs)");

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"], acceptDownloads: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-master-group-by-project");
const consoleErrors = [];
page.on("pageerror", e => consoleErrors.push(e.message));
page.on("console", m => { if (m.type() === "error") consoleErrors.push(m.text()); });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => consoleErrors.push("GOTO: " + e.message));
const booted = await page.waitForSelector("[data-task-row]", { timeout: 30000 }).then(() => true).catch(() => false);
ok("board boots with the multi-schedule fixture", booted);

const clickGroupBySegment = label => page.evaluate((label) => {
  const spans = [...document.querySelectorAll("span")];
  const marker = spans.find(s => s.textContent.trim() === "Group by");
  const seg = marker && [...marker.parentElement.querySelectorAll("span")].find(s => s.textContent.trim() === label);
  if (seg) { seg.click(); return true; }
  return false;
}, label);
const groupHeaderTexts = () => page.evaluate(() => [...document.querySelectorAll("td[colspan]")].map(td => td.textContent.trim()));

if (booted) {
  await page.click('button:has-text("Dashboard")', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);

  // ── Group by = Project ──
  ok("'Group by → Project' segment is clickable", await clickGroupBySegment("Project"));
  await page.waitForTimeout(300);
  const groups = await groupHeaderTexts();

  ok("six distinct group sections — one per schedule, never merged by bare name",
    groups.length === 6, JSON.stringify(groups));
  ok("Goose Creek's and Grand Port's same-named 'Master Schedule's are SEPARATE sections, each with its OWN count",
    groups.some(g => g.startsWith("Goose Creek / Master Schedule") && g.endsWith("1")) &&
    groups.some(g => g.startsWith("Grand Port / Master Schedule") && g.endsWith("3")),
    JSON.stringify(groups));
  ok("Goose Creek's three schedules are ADJACENT (grouped by owner, not insertion order)", (() => {
    const idxs = groups.map((g, i) => (/^Goose Creek \//.test(g) ? i : -1)).filter(i => i >= 0);
    return idxs.length === 3 && idxs[idxs.length - 1] - idxs[0] === 2;
  })(), JSON.stringify(groups));
  ok("org-owned schedule reads 'Organization / Pursuits', never a bare name",
    groups.some(g => g.startsWith("Organization / Pursuits")), JSON.stringify(groups));
  ok("a site-owned schedule with a null linkedSiteName still gets its OWN labelled section (never bare, never merged)",
    groups.some(g => g.startsWith("an unnamed project / Untitled site")), JSON.stringify(groups));

  // ── Group by = None: the Project column shows the qualified label, not the bare name ──
  ok("'Group by → None' segment is clickable", await clickGroupBySegment("None"));
  await page.waitForTimeout(300);
  const projCells = await page.evaluate(() =>
    [...document.querySelectorAll("td")].map(td => td.textContent.trim())
      .filter(t => /Master Schedule|Pursuits|Untitled site|TAS Land Sale|MUD v PID/.test(t)));
  ok("Group by = None: every Project-column cell is qualified (contains ' / ')",
    projCells.length > 0 && projCells.every(t => t.includes(" / ")), JSON.stringify(projCells.slice(0, 6)));

  // ── PDF-PARITY: the "Web Snapshot" export (exportHTML — the always-every-schedule download,
  // distinct from the PDF exhibit's per-project-selectable one) must mirror the same fix ──
  try {
    const dlPromise = page.waitForEvent("download", { timeout: 8000 });
    await page.click('button[title="Export — PDF exhibit or web snapshot"]', { timeout: 5000 });
    await page.click('text=Web Snapshot', { timeout: 5000 });
    const download = await dlPromise;
    const fp = await download.path();
    const html = await readFile(fp, "utf8");
    const h2s = [...html.matchAll(/<h2>([^<]*)<\/h2>/g)].map(m => m[1]);
    ok("PDF-PARITY: the Web Snapshot export's per-schedule <h2> headers are qualified, matching the on-screen fix",
      h2s.length === 6 && h2s.filter(h => h.startsWith("Goose Creek /")).length === 3 &&
      h2s.some(h => h === "Grand Port / Master Schedule") && h2s.some(h => h === "Organization / Pursuits") &&
      h2s.some(h => h === "an unnamed project / Untitled site"),
      JSON.stringify(h2s));
  } catch (e) { ok("PDF-PARITY: Web Snapshot export ran", false, e.message); }

  // ── React must never warn about a duplicate key across any of the above ──
  const dupKeyWarnings = consoleErrors.filter(m => /duplicate key|same key/i.test(m));
  ok("no React duplicate-key warnings", dupKeyWarnings.length === 0, JSON.stringify(dupKeyWarnings));
} else {
  console.log("boot errors:", consoleErrors.slice(0, 5));
}

await browser.close(); server.close();
const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
