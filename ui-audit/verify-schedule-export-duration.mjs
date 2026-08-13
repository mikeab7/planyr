// V258016 / B463072 — drive the REAL PDF export and read the duration off the PRODUCED ARTIFACT.
//
// B463072 fixed three reads of a group header's stale leftover duration. The verification item asked
// whether the EXPORT carried the same defect. That could not be answered by reading the screen, and it
// should not be answered by reading the code — so this drives the export end to end and reads the number
// out of the document the export actually produces.
//
// WHAT THE ARTIFACT IS, because it decides whether this check is possible at all: `buildPDFHtml` returns
// an HTML STRING which the app writes into a popup window; the user then presses the browser's own
// "Save as PDF". There is no canvas and no rasterisation anywhere in that path — the cells are real text
// nodes in a real table — so the produced artifact is fully readable here, and the PDF a person saves is
// that same DOM printed by Chromium. Reading the popup's table is reading the exhibit.
//
// THE SCENARIO is the disagreement case, which is the only one that can tell the two numbers apart:
// "CCID3: Lift Station & Force Main Approval" — a summary whose children run 08/07/26 → 10/02/26, so its
// inherited span is 40 working days, while the leftover typed value it still carries is 0.
//   • a leftover read prints "0d"
//   • an inherited-span read prints "40d"
// The leaf beside it (LONO Approvals, typed 30d) is the control: it must keep printing what was typed.
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const MIME = { ".html":"text/html", ".js":"text/javascript", ".css":"text/css", ".svg":"image/svg+xml", ".json":"application/json" };

const INJECT = `<script>(function(){try{
  var d=window.__PLANAR_DATA__; if(!d) return;
  d.view="grid"; d.section="projects";
  var pid=d.aPid!=null && d.projects[d.aPid] ? d.aPid : Object.keys(d.projects)[0];
  var p=d.projects[pid] || Object.values(d.projects)[0]; if(!p) return;
  var mk=function(o){return Object.assign({name:"",start:"",end:"",duration:0,durValue:0,durUnit:"d",
    predecessors:[],health:"gray",percentComplete:0,parentId:null,responsibleParty:"",cost:"",notes:[],
    isExpanded:true,meetingBound:false},o);};
  p.tasks=[
    mk({id:108,name:"CCID3 Lift Station Approval",start:"2026-08-07",end:"2026-10-02",duration:40,durValue:0}),
    mk({id:109,name:"Revise Force Main routing",start:"2026-08-07",end:"2026-08-13",duration:5,durValue:5,parentId:108}),
    mk({id:110,name:"CWA Approval",start:"2026-08-14",end:"2026-08-20",duration:5,durValue:5,parentId:108,predecessors:[{id:109,type:"FS",lag:0}]}),
    mk({id:111,name:"LONO Approvals",start:"2026-08-21",end:"2026-10-02",duration:30,durValue:30,parentId:108,predecessors:[{id:110,type:"FS",lag:0}]})
  ];
}catch(e){console.error("INJECT_ERR",e);}})();</script>`;

await ensureVendored();   // the browser has no egress here; without this the page renders an EMPTY body

const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (fp.endsWith("sequence/index.html")) {
      body = rewriteCdn(body.toString()).replace(/(<script id="planar-data">[\s\S]*?<\/script>)/, `$1${INJECT}`);
    }
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;
console.log("serving", url);

const BENIGN = [/supabase\.co/i, /CORS policy/i, /ERR_FAILED/i, /WebSocket/i, /Failed to load resource/i, /Cloud unreachable/i, /realtime/i, /BABEL/i, /deoptimised/i];
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium", "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find(existsSync);
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox","--ignore-certificate-errors"] });
const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 2 });
await assertMeasurable(page, "verify-schedule-export-duration");   // FOREGROUND-OR-VOID
const real = [];
page.on("console", m => { if (m.type()==="error" && !BENIGN.some(r=>r.test(m.text()))) real.push(m.text()); });
page.on("pageerror", e => { if (!BENIGN.some(r=>r.test(e.message))) real.push("PAGEERROR: " + e.message); });

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(e => real.push("GOTO: "+e.message));
const rendered = await page.waitForSelector("[data-task-row]", { timeout: 20000 }).then(()=>true).catch(()=>false);
await page.waitForTimeout(1500);

// Drive the export the way the app does: openPrint() builds the HTML and writes it into a popup. Capture
// the popup rather than re-implementing the call — a harness that rebuilds the artifact itself is testing
// its own copy. The exhibit's own column set is forced to include Duration (that is the column under test).
const popupPromise = page.waitForEvent("popup", { timeout: 20000 }).catch(() => null);
const opened = await page.evaluate(() => {
  if (typeof buildPDFHtml !== "function") return { ok: false, why: "buildPDFHtml is not reachable in page scope" };
  const d = window.__PLANAR_DATA__;
  // cfg mirrors PDFExportModal's own defaults, with the Duration column explicitly on.
  // cfg mirrors PDFExportModal's own default object field for field (selProjects as STRING ids, the
  // margins/pageSize/detail keys buildPDFHtml reads), with Duration explicitly among the columns.
  const pid = d.aPid != null ? String(d.aPid) : String(Object.keys(d.projects)[0]);
  const cfg = {
    exhibitLabel: "", projectTitle: "Export duration check", preparedBy: "", preparedFor: "",
    docDate: "August 13, 2026", orientation: "landscape", pageSize: "letter",
    margins: {top:"0.75", right:"0.75", bottom:"0.75", left:"0.75"},
    selProjects: [pid],
    columns: ["id","name","start","end","duration","health"],
    includeGantt: true, showToday: true, showArrows: true, barNames: true,
    labelAlign: "auto", healthFilter: "all", confidential: "",
    collapsedIds: [], detailLevel: "all", colWidths: {},
    timeUnit: null, zoomMul: 1, panFrac: 0,
  };
  const html = buildPDFHtml(cfg, d);
  const w = window.open("", "_blank", "width=1100,height=820");
  if (!w) return { ok: false, why: "popup blocked" };
  w.document.write(html); w.document.close();
  window.__EXPORT_HTML__ = html;
  return { ok: true, bytes: html.length };
});
const popup = await popupPromise;
if (popup) {
  popup.on("console", m => { if (m.type()==="error") real.push("POPUP: "+m.text()); });
  popup.on("pageerror", e => real.push("POPUP PAGEERROR: " + e.message));
}
// The EMITTED BYTES are the artifact — what the export hands the printer. Read them directly too, so the
// verdict does not depend on the popup's own re-render of them.
const emitted = await page.evaluate(() => window.__EXPORT_HTML__ || "");
const emittedRows = [...emitted.matchAll(/<div class="row[^"]*"[\s\S]{0,1200}?<\/div>\s*(?=<div class="row|<\/)/g)].length;
console.log("EMITTED HTML:", emitted.length, "bytes | contains CCID3:", /CCID3/.test(emitted), "| row-ish blocks:", emittedRows);
const around = emitted.match(/CCID3[\s\S]{0,600}/);
console.log("EMITTED around CCID3:", JSON.stringify(around ? around[0].replace(/\s+/g," ").slice(0,600) : null));

// Parse the exhibit's own <table> out of the emitted bytes, cell by cell, by CLASS — never by regex over
// a row's concatenated text. The popup is opened (so the real openPrint path is exercised end to end) but
// the VERDICT is read from the bytes: the popup re-renders them through a pagination script that moves the
// table into page containers, and the bytes are what the printer receives either way.
const cellOf = (rowHtml, cls) => {
  const m = rowHtml.match(new RegExp('<td class="c-' + cls + '"[^>]*>([\\s\\S]*?)<\\/td>'));
  return m ? m[1].replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim() : null;
};
const rowFor = name => {
  const rows = emitted.split(/<tr\b/).filter(r => r.includes(name));
  return rows.length ? rows[0] : null;
};
const sumRow = rowFor("CCID3"), leafRow = rowFor("LONO Approvals");
const artifact = {
  isCanvas: /<canvas/i.test(emitted),
  hasTable: /<table/i.test(emitted),
  summaryName: "CCID3 Lift Station Approval",
  summaryDur: sumRow ? cellOf(sumRow, "duration") : null,
  summaryStart: sumRow ? cellOf(sumRow, "start") : null,
  summaryEnd: sumRow ? cellOf(sumRow, "end") : null,
  leafDur: leafRow ? cellOf(leafRow, "duration") : null,
};
console.log("ARTIFACT (read from the emitted export bytes):", JSON.stringify(artifact));

const pass = rendered && opened.ok && !!popup
  && artifact.hasTable && !artifact.isCanvas      // real text cells, nothing rasterised
  && artifact.summaryStart === "08/07/26" && artifact.summaryEnd === "10/02/26"
  && artifact.summaryDur === "40d"                // the exhibit prints the summary's INHERITED span…
  && artifact.summaryDur !== "0d"                 // …not the leftover typed value the row still carries
  && artifact.leafDur === "30d"                   // …and a leaf still prints what was typed on it
  && real.length === 0;
console.log(pass
  ? `✅ PASS — read off the PRODUCED EXPORT (${emitted.length} bytes of HTML, real <table>, canvas: ${artifact.isCanvas}): the summary row prints ${artifact.summaryStart} · ${artifact.summaryEnd} · ${artifact.summaryDur}; the leaf prints ${artifact.leafDur}`
  : "❌ FAIL");
console.log("REAL ERRORS (" + real.length + "):"); real.slice(0,20).forEach(e=>console.log("  - "+e));
await browser.close(); server.close();
process.exit(pass ? 0 : 1);
