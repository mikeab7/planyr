// Headless verification for B613 — the rebuilt Scheduler task-notes panel (NotesModal).
//
// The Scheduler (public/sequence/index.html) is a standalone in-browser-Babel app that pulls
// React/Babel from CDNs at runtime — and this sandbox's Chromium cannot reach those CDNs. So this
// harness is SELF-BOOTSTRAPPING: it extracts the EXACT NotesModal block (+ its date-helper deps)
// straight from index.html by marker, vendors React/ReactDOM/Babel locally (curl, cached in a temp
// dir), serves a tiny self-contained page from localhost, mounts NotesModal in isolation with a
// spy updateTask, and drives the interactions the old panel got wrong.
//
// What it proves: editing a note's date or text NEVER dismisses the panel (the reported bug);
// the panel closes only on ✕ or a genuine backdrop click; notes render newest-first with compact
// M/D dates; add + delete work; no runtime errors. (Nothing is left in the repo's public/ dir.)
//
// Run:  node ui-audit/verify-b613-notes-panel.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INDEX = path.resolve(__dirname, "../public/sequence/index.html");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const TMP = path.join(os.tmpdir(), "b613-notes-harness");
fs.mkdirSync(path.join(TMP, "vendor"), { recursive: true });

const src = fs.readFileSync(INDEX, "utf8").split(/\r?\n/);
// --- marker-based extraction (resilient to line-number drift) ---
const lineWith = (pred, from = 0) => { for (let i = from; i < src.length; i++) if (pred(src[i])) return i; return -1; };
const grabDecl = (startPred) => {                 // a `const x = … {` … terminated by a lone `};`
  const s = lineWith(startPred);
  if (s < 0) throw new Error("marker not found: " + startPred);
  const e = lineWith(l => /^\};\s*$/.test(l), s + 1);
  return src.slice(s, e + 1).join("\n");
};
const grabBlock = (startSub, endSub) => {
  const s = lineWith(l => l.includes(startSub));
  const e = lineWith(l => l.includes(endSub), s + 1);
  if (s < 0 || e < 0) throw new Error("block markers not found");
  return src.slice(s, e).join("\n");
};
const fdLocal   = src[lineWith(l => l.startsWith("const fdLocal ="))];
const parseFlex = grabDecl(l => l.startsWith("const parseFlexDate ="));
const noteSizes = src[lineWith(l => l.startsWith("const NOTE_SIZES ="))];
const b613      = grabBlock("// ── NotesModal — per-task running log (B613 rebuild)", "// ── Supabase cloud storage");
for (const [n, v] of [["NotesModal", b613.includes("function NotesModal")], ["NoteRow", b613.includes("function NoteRow")], ["AddNoteComposer", b613.includes("function AddNoteComposer")]])
  if (!v) throw new Error("extracted block is missing " + n);

// --- vendor React/ReactDOM/Babel (cached) ---
const VENDOR = {
  "react.js": "https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.production.min.js",
  "react-dom.js": "https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.production.min.js",
  "babel.js": "https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js",
};
for (const [f, url] of Object.entries(VENDOR)) {
  const dest = path.join(TMP, "vendor", f);
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 1000) {
    console.log("vendoring", f, "…");
    execSync(`curl -s --max-time 60 -o ${JSON.stringify(dest)} ${JSON.stringify(url)}`, { stdio: "inherit" });
  }
}

const harnessHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
<script src="/vendor/react.js"></script>
<script src="/vendor/react-dom.js"></script>
<script src="/vendor/babel.js"></script>
<style>:root{--bg:#fff;--surf:#f6f8fa;--bd:#e1e4e8;--bd2:#d0d7de;--amber:#4f46e5;--blue:#0969da;--txt:#1f2328;--mut:#57606a;}*{box-sizing:border-box;}</style>
</head><body>
<script type="text/babel" data-presets="react">
const { useState, useEffect, useRef, useMemo, useCallback } = React;
let NOW = "2026-07-02";
${fdLocal}
${parseFlex}
${noteSizes}
${b613}
window.React = React; window.ReactDOM = ReactDOM;
window.NotesModal = NotesModal; window.NoteRow = NoteRow; window.AddNoteComposer = AddNoteComposer;
</script>
</body></html>`;

const server = http.createServer((req, res) => {
  const u = req.url.split("?")[0];
  if (u === "/" || u === "/index.html") { res.writeHead(200, { "Content-Type": "text/html" }); return res.end(harnessHtml); }
  const vp = path.join(TMP, u.replace(/^\//, ""));
  if (u.startsWith("/vendor/") && fs.existsSync(vp)) { res.writeHead(200, { "Content-Type": "application/javascript" }); return res.end(fs.readFileSync(vp)); }
  res.writeHead(404); res.end("nf");
});
await new Promise(r => server.listen(0, "127.0.0.1", r));
const PORT = server.address().port;
const BASE = `http://127.0.0.1:${PORT}/`;

const results = [];
const ok = (name, pass, extra = "") => { results.push({ pass }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); };

const pw = await import("/opt/node22/lib/node_modules/playwright/index.js");
const chromium = pw.chromium || (pw.default && pw.default.chromium);
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors", "--disable-background-networking"] });
const page = await browser.newContext({ viewport: { width: 1100, height: 850 } }).then(c => c.newPage());
const errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));

await page.goto(BASE, { waitUntil: "load", timeout: 45000 });
await page.waitForFunction(() => window.React && window.ReactDOM && typeof window.NotesModal === "function", null, { timeout: 45000 }).catch(() => {});
const ready = await page.evaluate(() => ({ react: !!window.React, dom: !!window.ReactDOM, notes: typeof window.NotesModal }));
ok("app boots: React + ReactDOM present", ready.react && ready.dom, JSON.stringify(ready));
ok("NotesModal is reachable for isolation mount", ready.notes === "function", `typeof=${ready.notes}`);

if (ready.notes === "function") {
  await page.evaluate(() => {
    const { React, ReactDOM } = window;
    window.__saves = []; window.__closed = 0;
    const task = { id: 42, name: "Due Diligence", notes: [
      { id: 1, date: "2026-06-12", text: "Older note — kickoff call" },
      { id: 2, date: "2026-06-30", text: "Newer note — survey received" },
    ] };
    const updateTask = (taskId, updates, projectId) => {
      window.__saves.push({ taskId, updates, projectId });
      if (updates && updates.notes) { task.notes = updates.notes; render(); }
    };
    const host = document.createElement("div"); host.id = "__notes_host"; document.body.appendChild(host);
    const root = ReactDOM.createRoot(host);
    function render() { root.render(React.createElement(window.NotesModal, { task, projectId: 7, updateTask, initChar: null, onClose: () => { window.__closed++; } })); }
    window.__render = render; render();
  });
  await page.waitForTimeout(300);

  const bodyOrder = await page.evaluate(() => Array.from(document.getElementById("__notes_host").querySelectorAll("div"))
    .map(d => d.childNodes.length === 1 && d.childNodes[0].nodeType === 3 ? d.textContent.trim() : "")
    .filter(t => t.startsWith("Older") || t.startsWith("Newer")));
  ok("both notes render", bodyOrder.length === 2, JSON.stringify(bodyOrder));
  ok("descending order — newest note first", bodyOrder[0] && bodyOrder[0].startsWith("Newer"), JSON.stringify(bodyOrder));

  const railDates = await page.evaluate(() => Array.from(document.getElementById("__notes_host").querySelectorAll("button")).map(b => b.textContent.trim()).filter(t => /^\d{1,2}\/\d{1,2}$/.test(t)));
  ok("compact M/D dates in rail (e.g. 6/30, 6/12)", railDates.includes("6/30") && railDates.includes("6/12"), JSON.stringify(railDates));

  await page.locator("#__notes_host button", { hasText: "6/30" }).first().click();
  await page.waitForTimeout(150);
  ok("clicking a date opens an inline date editor", await page.locator('#__notes_host input[type="date"]').count() >= 1);
  ok("clicking a date does NOT dismiss the panel (the reported bug)", (await page.evaluate(() => window.__closed)) === 0);

  const di = page.locator('#__notes_host input[type="date"]').first();
  await di.fill("2026-07-01"); await di.press("Enter"); await page.waitForTimeout(150);
  ok("editing a date saves via updateTask", await page.evaluate(() => window.__saves.some(s => s.updates.notes && s.updates.notes.some(n => n.date === "2026-07-01"))));
  ok("panel still open after a date edit", (await page.evaluate(() => window.__closed)) === 0);

  await page.locator('#__notes_host div', { hasText: "survey received" }).last().click();
  await page.waitForTimeout(150);
  await page.locator('#__notes_host textarea').last().fill("Newer note — survey received (rev A)");
  await page.locator('#__notes_host div', { hasText: "Due Diligence" }).first().click();  // blur inside panel content
  await page.waitForTimeout(150);
  ok("editing body text saves via updateTask", await page.evaluate(() => window.__saves.some(s => s.updates.notes && s.updates.notes.some(n => /rev A/.test(n.text)))));
  ok("panel still open after a body edit + blur-commit", (await page.evaluate(() => window.__closed)) === 0);

  await page.locator('#__notes_host textarea').first().fill("Fresh composer note");
  await page.locator('#__notes_host button', { hasText: "Add note" }).click();
  await page.waitForTimeout(150);
  ok("composer adds a new note via updateTask", await page.evaluate(() => window.__saves.some(s => s.updates.notes && s.updates.notes.some(n => n.text === "Fresh composer note"))));

  await page.evaluate(() => { window.__closed = 0; });
  await page.locator('#__notes_host div', { hasText: "Due Diligence" }).first().click();
  await page.waitForTimeout(80);
  ok("click inside the panel does NOT close it", (await page.evaluate(() => window.__closed)) === 0);
  await page.mouse.click(8, 8); await page.waitForTimeout(120);
  ok("clicking the backdrop closes the panel", (await page.evaluate(() => window.__closed)) >= 1);

  await page.evaluate(() => { window.__closed = 0; window.__render(); });
  await page.waitForTimeout(120);
  await page.locator('#__notes_host span', { hasText: "✕" }).first().click();
  await page.waitForTimeout(100);
  ok("✕ closes the panel", (await page.evaluate(() => window.__closed)) >= 1);

  const relevant = errors.filter(e => !/favicon|fonts\.googleapis|preload|net::|Failed to load resource/i.test(e));
  ok("no runtime console errors from the panel", relevant.length === 0, relevant.slice(0, 5).join(" | "));
}

await browser.close();
server.close();
const failed = results.filter(r => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
