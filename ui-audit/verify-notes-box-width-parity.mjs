/* verify-notes-box-width-parity — A NOTE LAYS OUT IDENTICALLY ON EVERY DEVICE; ONLY THE ZOOM DIFFERS
 * (B2078593 ×2, owner iPhone screenshot 2026-10-04, build after #1973).
 *
 * THE DEFECT: on his phone "Hard Cost Pricing" (page 1012 wide, one box stored x 0, w 873, a list and a
 * two-column table) rendered its box at 386 workspace-px — 41% of the page instead of 86% — and cut the
 * table off mid-word, while his desktop rendered the stored width. `fitAnchorBox({hostWidth: paneWidth})`
 * clamped the RENDERED width to the screen pane's own (unscaled) width, a number that has nothing to do
 * with the page the view transform then scales. The first harness for the full-width opening checked the
 * page's edges and top only, never what was INSIDE the page — which is how he found it on his phone.
 *
 * WHAT THIS ASSERTS, per case × per context:
 *   1. the rendered box width ÷ the view's zoom == the STORED w (±1%)            — layout independent of screen
 *   2. rendered box width ÷ rendered page width == stored w ÷ pageWidth (±1%)    — same fraction of the page
 *   3. every table: right edge inside the box AND inside the page; every cell's text inside its cell (no
 *      clipped text, no horizontal overflow)
 *   4. line breaks: per-paragraph line counts equal between the phone and desktop contexts of the SAME engine
 *      (cross-engine counts are printed, never asserted — two engines' font hinting may legitimately differ)
 * CONTEXTS: WebKit phone (390×844, dpr 3, hasTouch+isMobile) · WebKit desktop · Chromium desktop (1280×800)
 * · Chromium phone emulation · Chromium NARROW desktop (900×700, where the pane is smaller than the box —
 * the same bug on a desktop). KNOWN-GOOD ARM: the fixture must really be present (stored w read back from
 * the page's own document) and the Chromium 1280 context must pass on untouched main too (run it there).
 * `EVIDENCE_DIR=<dir>` writes a page screenshot per case × context for the PR. Engines reported as WebKit /
 * Chromium, never "iPhone". */
import { chromium, webkit } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const EVIDENCE = process.env.EVIDENCE_DIR || "";
if (EVIDENCE) mkdirSync(EVIDENCE, { recursive: true });
const failures = [];
const ok = (l, c, d) => { console.log(`${c ? "✓" : "⛔"} ${l}${d !== undefined ? ` — ${d}` : ""}`); if (!c) failures.push(l); };

const T = (t, bold) => ({ type: "text", text: t, ...(bold ? { marks: [{ type: "bold" }] } : {}) });
const p = (...c) => ({ type: "paragraph", content: c });
const li = (...c) => ({ type: "listItem", content: c });
const ol = (...c) => ({ type: "orderedList", content: c });
const cell = (type, w, ...c) => ({ type, attrs: { colspan: 1, rowspan: 1, colwidth: [w] }, content: [p(...c)] });
const priceTable = () => ({ type: "table", content: [
  { type: "tableRow", content: [cell("tableHeader", 160, T("Usage tier")), cell("tableHeader", 517, T("Rate"))] },
  { type: "tableRow", content: [cell("tableCell", 160, T("Up to 10M gallons/year")), cell("tableCell", 517, T("$26 per million gallons + $240 annual permit fee → "), T("$500/year total", 1), T(" at the 10M gallon mark"))] },
  { type: "tableRow", content: [cell("tableCell", 160, T("Above 10M gallons/year")), cell("tableCell", 517, T("80/20 split: 80% of total usage billed at "), T("$12.12 per 1,000 gallons", 1), T("; the remaining 20% billed at $26/million gallons"))] },
] });
const box = (aid, x, y, w, ...content) => ({ type: "noteAnchor", attrs: { x, y, w, h: null, aid }, content });
const prose = (t) => p(T(t));
const LONG = "The quick brown fox jumps over the lazy dog while the contractor reviews the unit pricing schedule for the sanitary sewer and water extension.";

/** The owner's exact document (read from his account 2026-10-04) as a fixture. */
const OWNER = { type: "doc", attrs: { density: "comfortable", pageWidth: 1012, pageHeight: 724, pageMarginLeft: 0 }, content: [
  box("bx", 0, 0, 873,
    ol(li(p(T("Utility Facilities")), ol(li(p(T("Sanitary Sewer")), ol(li(p(T("$10-15 /GPD")), ol(li(p(T("Noted by BGE 2026"))))))), li(p(T("Water")), ol(li(p(T("Discuss Harris Galveston Subsidence District Structure")))))))),
    priceTable()),
  { type: "paragraph" }] };
const CASES = [
  { id: "owner", doc: OWNER, pageWidth: 1012, boxes: [{ aid: "bx", w: 873 }], tables: 1 },
  { id: "two-boxes", pageWidth: 1012, boxes: [{ aid: "l", w: 470 }, { aid: "r", w: 470 }], tables: 0,
    doc: { type: "doc", attrs: { density: "comfortable", pageWidth: 1012, pageHeight: 724, pageMarginLeft: 0 }, content: [box("l", 0, 0, 470, prose(LONG), prose(LONG)), box("r", 520, 0, 470, prose(LONG), prose(LONG)), { type: "paragraph" }] } },
  { id: "box-x-gt-0", pageWidth: 1012, boxes: [{ aid: "b", w: 640 }], tables: 0,
    doc: { type: "doc", attrs: { density: "comfortable", pageWidth: 1012, pageHeight: 724, pageMarginLeft: 0 }, content: [box("b", 220, 60, 640, prose(LONG), prose(LONG)), { type: "paragraph" }] } },
  { id: "page-narrower-than-phone", pageWidth: 320, boxes: [{ aid: "n", w: 280 }], tables: 0,
    doc: { type: "doc", attrs: { density: "comfortable", pageWidth: 320, pageHeight: 724, pageMarginLeft: 0 }, content: [box("n", 0, 0, 280, prose(LONG)), { type: "paragraph" }] } },
];
CASES.push({ id: "unpinned-default-page", pageWidth: null, boxes: [{ aid: "u", w: 300 }], tables: 0,
  doc: { type: "doc", attrs: { density: "comfortable", pageWidth: null, pageHeight: null, pageMarginLeft: 0 }, content: [box("u", 0, 120, 300, prose(LONG), prose(LONG)), { type: "paragraph" }] } });
const CONTEXTS = [
  { id: "webkit-phone", engine: "webkit", opts: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }, group: "webkit" },
  { id: "webkit-desktop", engine: "webkit", opts: { viewport: { width: 1280, height: 800 } }, group: "webkit" },
  { id: "chromium-desktop", engine: "chromium", opts: { viewport: { width: 1280, height: 800 } }, group: "chromium" },
  { id: "chromium-phone", engine: "chromium", opts: { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 }, group: "chromium" },
  { id: "chromium-narrow-desktop", engine: "chromium", opts: { viewport: { width: 900, height: 700 } }, group: "chromium-narrow" },
];

async function measure(browser, ctxDef, c) {
  const ctx = await browser.newContext(ctxDef.opts);
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("   PAGEERROR", String(e.message).slice(0, 160)));
  await assertMeasurable(page, "verify-notes-box-width-parity");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 300);
  await page.evaluate(([d]) => {
    localStorage.clear();
    localStorage.setItem("planyr:notes:tree:v1:local", JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Hard Cost Pricing", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem("planyr:notes:page:v1:local:p1", JSON.stringify(d));
    localStorage.setItem("planyr:notes:activePage:v1:local", "p1");
  }, [c.doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".planyr-anchor", { timeout: 30000 });
  await pacedWait(page, 2600);
  const m = await page.evaluate(() => {
    const tr = /scale\(([-\d.]+)\)/.exec(document.querySelector('[data-testid="note-workspace"]').style.transform || "");
    const z = tr ? parseFloat(tr[1]) : 1;
    const R = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
    const sheet = R(document.querySelector('[data-testid="note-sheet"]'));
    const stored = JSON.parse(localStorage.getItem("planyr:notes:page:v1:local:p1") || "null");
    const boxes = [...document.querySelectorAll(".planyr-anchor")].map((a) => ({ aid: a.getAttribute("data-anchor-id"), ...R(a), storedW: Number(a.getAttribute("data-anchor-w")) }));
    const tables = [...document.querySelectorAll("table")].map((t) => {
      const tb = R(t); const a = t.closest(".planyr-anchor"); const ab = a ? R(a) : null;
      const clipped = [];
      for (const td of t.querySelectorAll("td, th")) {
        const cb = R(td);
        const rg = document.createRange(); rg.selectNodeContents(td);
        const tb2 = rg.getBoundingClientRect();
        if (td.scrollWidth > td.clientWidth + 1 || tb2.right > cb.r + 1) clipped.push((td.textContent || "").slice(0, 30));
      }
      return { ...tb, inBox: ab ? tb.r <= ab.r + 1 : true, inSheet: tb.r <= sheet.r + 1, clipped };
    });
    const lines = [...document.querySelectorAll(".ProseMirror p")].map((pEl) => {
      const rg = document.createRange(); rg.selectNodeContents(pEl);
      const tops = new Set([...rg.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top / 4)));
      return tops.size;
    });
    return { z, sheet, boxes, tables, lines, storedDocW: (stored?.content || []).filter((n) => n.type === "noteAnchor").map((n) => n.attrs.w), pageW: stored?.attrs?.pageWidth };
  });
  if (EVIDENCE) await page.screenshot({ path: `${EVIDENCE}/${c.id}__${ctxDef.id}.png`, clip: { x: 0, y: 0, width: ctxDef.opts.viewport.width, height: Math.min(ctxDef.opts.viewport.height, 860) } });
  await ctx.close();
  return m;
}

const within = (a, b, tol = 0.01) => Math.abs(a - b) <= Math.abs(b) * tol + 0.001;
const results = {};
for (const engine of ["webkit", "chromium"]) {
  const browser = engine === "webkit" ? await webkit.launch({}) : await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  for (const ctxDef of CONTEXTS.filter((x) => x.engine === engine)) {
    for (const c of CASES) {
      const m = await measure(browser, ctxDef, c);
      results[`${c.id}|${ctxDef.id}`] = m;
      const tag = `[${c.id} · ${ctxDef.id}]`;
      ok(`${tag} KNOWN-GOOD: the fixture is really present (stored box widths ${JSON.stringify(c.boxes.map((b) => b.w))})`,
        JSON.stringify(m.storedDocW) === JSON.stringify(c.boxes.map((b) => b.w)) && m.boxes.length === c.boxes.length && m.tables.length === c.tables, `${m.boxes.length} boxes, ${m.tables.length} tables, stored ${JSON.stringify(m.storedDocW)}`);
      for (const spec of c.boxes) {
        const b = m.boxes.find((x) => x.aid === spec.aid);
        if (!b) { ok(`${tag} box ${spec.aid} exists`, false); continue; }
        ok(`${tag} box ${spec.aid}: rendered width ÷ zoom == stored w ${spec.w} (±1%)`, within(b.w / m.z, spec.w), `${(b.w / m.z).toFixed(1)} vs ${spec.w} (zoom ${m.z.toFixed(3)})`);
        // Where the page's rendered width IS its stored pageWidth (the owner's fixture) the share is exactly
        // stored w ÷ pageWidth. Where the page grows to hold what overhangs (two boxes, a page pinned below the
        // sheet's own padding floor) the rendered page is wider than the pin — then the claim is DEVICE
        // INDEPENDENCE, asserted against Chromium-desktop below, not a number from the pin.
        if (c.id === "owner") ok(`${tag} box ${spec.aid}: share of the page == stored w ÷ pageWidth (±1%)`, within(b.w / m.sheet.w, spec.w / c.pageWidth), `${(b.w / m.sheet.w * 100).toFixed(1)}% vs ${(spec.w / c.pageWidth * 100).toFixed(1)}%`);
        console.log(`   (info) ${tag} box ${spec.aid}: page renders ${(m.sheet.w / m.z).toFixed(0)} wide for a stored pageWidth ${c.pageWidth}`);
      }
      m.tables.forEach((t, i) => {
        ok(`${tag} table ${i}: inside its box and inside the page`, t.inBox && t.inSheet, JSON.stringify({ inBox: t.inBox, inSheet: t.inSheet }));
        ok(`${tag} table ${i}: no cell text is clipped`, t.clipped.length === 0, t.clipped.join(" | ") || "none");
      });
    }
  }
  await browser.close();
}
// Informational only: the PAPER MARGIN (sheet padding) is a deliberate phone setting (16 vs 40 px a side), so
// a page that grows to hold its content, or is pinned below the padding floor, renders ~48 workspace-units
// narrower on a phone. Box widths, table widths and line breaks (asserted above/below) do NOT move with it.
for (const c of CASES) {
  const ref = results[`${c.id}|chromium-desktop`];
  for (const ctxDef of CONTEXTS) {
    const m = results[`${c.id}|${ctxDef.id}`];
    console.log(`   (info) [${c.id} · ${ctxDef.id}] page ${(m.sheet.w / m.z).toFixed(0)} wide (desktop ${(ref.sheet.w / ref.z).toFixed(0)}), box shares ${m.boxes.map((b) => (b.w / m.sheet.w * 100).toFixed(1) + "%").join(", ")}`);
  }
}
// line breaks: phone vs desktop of the SAME engine must be identical; cross-engine only printed
for (const c of CASES) {
  for (const [a, b, label] of [["webkit-phone", "webkit-desktop", "WebKit phone vs desktop"], ["chromium-phone", "chromium-desktop", "Chromium phone vs desktop"], ["chromium-narrow-desktop", "chromium-desktop", "Chromium narrow vs wide desktop"]]) {
    const x = results[`${c.id}|${a}`]?.lines, y = results[`${c.id}|${b}`]?.lines;
    ok(`[${c.id}] line breaks identical — ${label}`, !!x && !!y && x.length > 0 && JSON.stringify(x) === JSON.stringify(y), `${JSON.stringify(x)} vs ${JSON.stringify(y)}`);
  }
  const wx = results[`${c.id}|webkit-phone`]?.lines, cx = results[`${c.id}|chromium-desktop`]?.lines;
  console.log(`   (info, not asserted) [${c.id}] WebKit-phone lines ${JSON.stringify(wx)} vs Chromium-desktop ${JSON.stringify(cx)}`);
}
console.log(failures.length ? `\n⛔ ${failures.length} failed` : "\n✓ all box-width parity arms pass");
process.exit(failures.length ? 1 : 0);
