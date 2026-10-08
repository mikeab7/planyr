/* verify-overlays-panel-layout — the Site tab OVERLAYS panel (NEW-1 redesign) must never clip, overflow or
 * hide a control, at ANY width it can be shown at.
 *
 * WHY THIS EXISTS. `verify-width-sweep.mjs` only audits <header> and [data-chrome-toolbar], runs signed out and
 * never opens Overlays. This panel is resizable 240–620 (lib/panelWidth.js), can float (FloatingPanel) and has a
 * phone layout, and its Placement section holds the controls most likely to break (three scale buttons, the
 * rotation stepper + two 90° buttons). Its layout is CSS on the panel's OWN box (grid auto-fit / flex-wrap) —
 * nothing reads window width — so the only honest proof is to MEASURE it in a real browser.
 *
 * WHAT IT MEASURES, per (surface × panel width × open-row variant):
 *   · no horizontal overflow — the panel's scroll box and the panel root never scroll sideways
 *   · nothing pokes out — every descendant's box sits inside the panel root's box
 *   · no clipped text — no element's content is wider than its own box (buttons, labels, inputs, sub-lines)
 *   · THE TYPE SPEC — every visible text-bearing element's computed (font-size, font-weight) is one of
 *     (control,400) · (control,500 — the row NAME only) · (label,600 — uppercase section labels only) · (label,400);
 *     anything else (a 700, a 600 button, a third size) fails
 *   · ONE ACCENT — no text colour, fill, border or accent-color in the panel resolves to the orange `--accent`
 *   · THE SCALE GROUP is ONE row of equal buttons or ONE column of equal full-width buttons — never 2 + 1 —
 *     at 240 / 300 / 400 / 520 / 620, docked and floating
 *   · THE OPEN ROW FITS — at a 1366×768 laptop, docked, the open PDF row through "Knock out white paper"
 *     is on screen without scrolling
 *   · every control is reachable — each button / input / select has a box, and a hit test at its centre (after
 *     scrolling it into its scroll box) lands on it
 *   · the scale buttons are the SAME size, weight and fill
 *   · the control census — every control the spec names is present for the variant (PDF · image-unscaled ·
 *     DXF-assumed · map capture)
 *
 * SURFACES: docked at 240 / 400 / 620 · floating at 240 / 400 / 620 · phone (390×844 and 360×640).
 *
 * KNOWN-GOOD ARM (DRIVER-SCROLL §6 / the "instrument can see" rule): the 620 docked PDF reading must be fully
 * clean on ANY build; if it is not, the instrument is broken and the run is VOID instead of scored.
 *
 * RED PROOF: `--broken` injects a deliberately broken layout (a fixed-width 3-column scale grid, a no-wrap
 * rotation row, a 300px-wide control) and requires the run to go RED. `--expect-red` inverts the exit code for
 * that run. A guard nobody has seen fail is a guard that rots green.
 *
 * Run:  node ui-audit/verify-overlays-panel-layout.mjs                       (preview on :4173)
 *       node ui-audit/verify-overlays-panel-layout.mjs --broken --expect-red
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { mkdirSync } from "node:fs";

const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const BROKEN = process.argv.includes("--broken");
const EXPECT_RED = process.argv.includes("--expect-red");
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const PT = 72, imgW = 36 * PT, imgH = 24 * PT;
const svg = (c) => "data:image/svg+xml;utf8," + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' width='${imgW}' height='${imgH}'><rect width='${imgW}' height='${imgH}' fill='${c}'/></svg>`);
const base = { rotation: 0, opacity: 0.85, locked: false, imgW, imgH, ftPerPx: 30 / PT, x: -400, y: -250, page: 1, pageCount: 1 };
const LONG = "VERY-LONG-SITE-PLAN-FILENAME-grading-and-drainage-civil-set-sheet-C-5.pdf";
const overlays = [
  { ...base, id: "map1", name: "Aerial backdrop", fromMap: true, kind: "image", src: svg("#4a6"), ftPerPx: 1, x: -600, y: -600 },
  { ...base, id: "pdf1", name: LONG, sheet: { std: true, label: "ARCH D (24×36)" }, detectedScale: 40, pageCount: 3, page: 2, storageKey: "x/pdf1.pdf", src: svg("#c8a06e") },
  { ...base, id: "img1", name: "Aerial.png", unscaled: true, src: svg("#69c"), imgW: 800, imgH: 600, ftPerPx: 1 },
  { ...base, id: "dxf1", name: "Civil.dxf", kind: "dxf", unitsAssumed: true, unitsLabel: "feet", src: svg("#999") },
];
const VARIANTS = [
  { id: "pdf1", label: "PDF (multi-page, scaled)", must: ["overlay-scale-ratio", "overlay-scale-set", "overlay-scale-trace", "overlay-scale-match", "overlay-page", "overlay-rotation", "overlay-rot-minus", "overlay-rot-plus", "overlay-rot-ccw90", "overlay-rot-cw90", "overlay-crop-open", "overlay-crop-reset", "overlay-opacity-pct", "reference-below-pdf1", "reference-above-pdf1"], text: ["Knock out white paper"] },
  { id: "img1", label: "Image (not scaled)", must: ["overlay-not-scaled", "overlay-scale-trace", "overlay-scale-match", "overlay-rotation", "overlay-crop-open", "overlay-opacity-pct"], mustNot: ["overlay-scale-set", "overlay-scale-ratio"] },
  { id: "dxf1", label: "DXF (units assumed)", must: ["overlay-not-scaled", "overlay-scale-trace", "overlay-scale-match", "overlay-crop-open"], mustNot: ["overlay-scale-set", "overlay-scale-ratio"] },
  { id: "map1", label: "Map capture", must: ["overlay-opacity-pct"], mustNot: ["overlay-placement", "overlay-crop-open", "overlay-scale-trace", "overlay-rot-plus"] },
];
const site = { id: "S", groupId: "S", site: "Scaleyard", name: "Plan 1", origin: { lat: 29.7836, lon: -95.8244 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, points: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, sheetOverlays: overlays, parcelDrawings: [], updatedAt: Date.now() };
const seedFor = (w, sel) => `(()=>{try{localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify({ S: site })}));localStorage.setItem('planarfit:currentSite:v1','S');localStorage.setItem('planarfit:leftWidth','${w}');sessionStorage.setItem('planyr:selOverlay:S','${sel}');}catch(e){}})();`;

/* Runs in the page. Returns plain facts; the verdicts are made outside. */
const measure = (floating) => {
  const root = document.querySelector('[data-testid="overlays-panel"]');
  if (!root) return { missing: true };
  const rr = root.getBoundingClientRect();
  const scroller = root.closest("[data-panel-body]") || (floating ? root.closest('[data-testid="floating-panel-references"]') : null) || root.parentElement;
  const facts = { rootW: Math.round(rr.width), scrollerOverflow: scroller ? scroller.scrollWidth - scroller.clientWidth : 0, rootOverflow: root.scrollWidth - root.clientWidth,
    poke: [], clipped: [], unreachable: [], sizes: {}, scaleBtns: [], scaleRows: 0, badPairs: [], orange: [] };
  const probe = document.createElement("i"); probe.style.cssText = "position:absolute;color:var(--accent);background:var(--accent)"; root.appendChild(probe);
  const orange = getComputedStyle(probe).color; probe.remove();
  facts.orangeRef = orange;
  const all = [root, ...root.querySelectorAll("*")];
  const sizes = {};
  for (const el of all) {
    if (el.closest("svg")) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const name = (el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.tagName.toLowerCase() + ":" + (el.textContent || "").trim().slice(0, 18));
    // nothing pokes out of the root's box (a 1px border / focus ring tolerance)
    if (r.left < rr.left - 1 || r.right > rr.right + 1) facts.poke.push(`${name} [${Math.round(r.left - rr.left)}..${Math.round(r.right - rr.left)}] of ${Math.round(rr.width)}`);
    // clipped text: content wider than the box that holds it
    if (el.scrollWidth > el.clientWidth + 1 && cs.textOverflow !== "ellipsis" && !["INPUT", "SELECT", "svg"].includes(el.tagName) && cs.display !== "inline" && el.clientWidth > 0) facts.clipped.push(`${name} content ${el.scrollWidth} > box ${el.clientWidth}`);
    if (el.tagName === "INPUT" && el.type !== "checkbox" && el.type !== "range" && el.type !== "file") {
      // an input whose own text is wider than its box is clipped too
      if (el.scrollWidth > el.clientWidth + 1) facts.clipped.push(`${name} input text ${el.scrollWidth} > ${el.clientWidth}`);
    }
    // font sizes of anything that directly holds text
    const own = Array.from(el.childNodes).some((n) => n.nodeType === 3 && n.textContent.trim());
    const textInput = (el.tagName === "INPUT" && !["checkbox", "range", "file", "radio"].includes(el.type)) || el.tagName === "SELECT";
    if (own || textInput) {
      const k = cs.fontSize; sizes[k] = (sizes[k] || 0) + 1; (facts.sizeWho = facts.sizeWho || {})[k] = ((facts.sizeWho || {})[k] || []).concat(name).slice(0, 4);
      const pair = `${cs.fontSize}/${cs.fontWeight}`;
      const isName = el.getAttribute("data-testid") === "overlay-row-name";
      const isSection = cs.textTransform === "uppercase";
      const ok = pair === "12px/400" || (pair === "12px/500" && isName) || (pair === "10.5px/600" && isSection) || (pair === "10.5px/400" && !isSection);
      if (!ok) facts.badPairs.push(`${name} ${pair}${isSection ? " (section label)" : ""}`);
    }
    // ONE ACCENT: nothing may resolve to the orange --accent (text colour, fill, border, accent-color)
    for (const [prop, val] of [["color", own || textInput ? cs.color : null], ["background", cs.backgroundColor], ["border", cs.borderTopColor !== "rgba(0, 0, 0, 0)" && parseFloat(cs.borderTopWidth) > 0 ? cs.borderTopColor : null], ["accent-color", cs.accentColor]]) {
      if (val && val === orange) facts.orange.push(`${name} ${prop}`);
    }
    if (["BUTTON", "INPUT", "SELECT"].includes(el.tagName) && el.type !== "file") {
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const q = el.getBoundingClientRect();
      const hit = document.elementFromPoint(q.left + q.width / 2, q.top + q.height / 2);
      if (!(hit === el || el.contains(hit) || (hit && hit.contains(el) && hit.tagName === "LABEL"))) facts.unreachable.push(`${name} → ${hit ? hit.tagName + ":" + (hit.getAttribute("data-testid") || (hit.textContent || "").trim().slice(0, 14)) : "null"}`);
    }
  }
  facts.sizes = sizes;
  const g = root.querySelector('[data-testid="overlay-scale-group"]');
  if (g) {
    const bs = Array.from(g.children).map((b) => { const q = b.getBoundingClientRect(); return { w: +q.width.toFixed(1), h: +q.height.toFixed(1), top: Math.round(q.top), fw: getComputedStyle(b).fontWeight, bg: getComputedStyle(b).backgroundColor, fs: getComputedStyle(b).fontSize }; });
    facts.scaleBtns = bs;
    facts.scaleRows = new Set(bs.map((b) => b.top)).size;
    const per = {}; for (const b of bs) per[b.top] = (per[b.top] || 0) + 1;
    facts.scaleRowCounts = Object.values(per);
    facts.scaleLayout = g.getAttribute("data-layout");
    facts.groupW = Math.round(g.getBoundingClientRect().width);
  }
  facts.testids = Array.from(root.querySelectorAll("[data-testid]")).map((n) => n.getAttribute("data-testid"));
  facts.text = root.innerText;
  return facts;
};

const BREAK_CSS = `
  [data-testid="overlay-scale-group"]{grid-template-columns:repeat(3,160px)!important}
  [data-testid="overlay-rotation-row"]{flex-wrap:nowrap!important}
  [data-testid="overlay-opacity-pct"]{width:300px!important}
  [data-testid="overlay-crop-shape"]{font-size:14px!important}
  [data-testid="overlay-scale-trace"]{white-space:nowrap!important;overflow:hidden!important;width:46px!important}
  [data-testid="overlay-row-name"]{font-weight:700!important}
  [data-testid="overlay-scale-match"]{color:var(--accent)!important}`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
let fail = 0, void_ = false;
const lines = [];
const log = (ok, msg) => { lines.push((ok ? "✓ " : "✗ ") + msg); console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

async function openPanel(page, { phone }) {
  if (phone) {
    await page.evaluate(() => document.querySelector('[data-testid="mobile-panels-tab"]')?.click());
    await page.waitForTimeout(500);
  }
  await page.evaluate(() => document.querySelector('[data-rail-tab="references"]')?.click());
  await page.waitForTimeout(900);
}

async function run(surface, { w, vw = 1440, vh = 1000, floating = false, phone = false }) {
  for (const v of VARIANTS) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: phone, isMobile: phone, deviceScaleFactor: 1 });
    await ctx.addInitScript(seedFor(w, v.id));
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(String(e)));
    await assertMeasurable(page, "verify-overlays-panel-layout");
    await page.goto(`${BASE}#/project/S/site`, { waitUntil: "load" });
    await page.waitForTimeout(3200);
    await openPanel(page, { phone });
    if (floating) {
      await page.locator('[data-testid="panel-chrome-references"]').dblclick({ position: { x: 90, y: 14 } });
      await page.waitForTimeout(700);
    }
    if (BROKEN) await page.addStyleTag({ content: BREAK_CSS });
    await page.waitForTimeout(300);
    const m = await page.evaluate(measure, floating);
    const tag = `${surface} · ${v.label}`;
    if (m.missing) { log(false, `${tag}: Overlays panel not found`); await ctx.close(); continue; }
    if (errs.length) log(false, `${tag}: page error ${errs[0].slice(0, 90)}`);
    const before = fail;
    log(m.scrollerOverflow <= 0, `${tag}: no sideways scroll (scroll box overflow ${m.scrollerOverflow})`);
    log(m.rootOverflow <= 0, `${tag}: panel root does not overflow itself (${m.rootOverflow})`);
    log(m.poke.length === 0, `${tag}: nothing pokes out of the panel${m.poke.length ? " — " + m.poke.slice(0, 3).join("; ") : ""}`);
    log(m.clipped.length === 0, `${tag}: no clipped text${m.clipped.length ? " — " + m.clipped.slice(0, 3).join("; ") : ""}`);
    const sz = Object.keys(m.sizes).sort();
    log(sz.length <= 2 && sz.every((s) => s === "12px" || s === "10.5px"), `${tag}: only two text sizes (${sz.join(", ")}${sz.length > 2 || sz.some((x) => x !== "12px" && x !== "10.5px") ? " — " + JSON.stringify(m.sizeWho) : ""})`);
    log(m.badPairs.length === 0, `${tag}: every text is an allowed (size, weight) pair${m.badPairs.length ? " — " + m.badPairs.slice(0, 4).join("; ") : ""}`);
    log(m.orange.length === 0 && !!m.orangeRef, `${tag}: no orange accent anywhere (ref ${m.orangeRef})${m.orange.length ? " — " + m.orange.slice(0, 4).join("; ") : ""}`);
    log(m.unreachable.length === 0, `${tag}: every control reachable${m.unreachable.length ? " — " + m.unreachable.slice(0, 3).join("; ") : ""}`);
    for (const id of v.must) log(m.testids.includes(id), `${tag}: has ${id}`);
    for (const id of v.mustNot || []) log(!m.testids.includes(id), `${tag}: correctly has NO ${id}`);
    for (const t of v.text || []) log(m.text.includes(t), `${tag}: has "${t}"`);
    if (m.scaleBtns.length >= 2) {
      const s0 = m.scaleBtns[0];
      log(m.scaleBtns.every((b) => Math.abs(b.w - s0.w) <= 1 && Math.abs(b.h - s0.h) <= 1 && b.fw === s0.fw && b.bg === s0.bg && b.fs === s0.fs),
        `${tag}: the scale buttons are identical in size, weight and fill (${m.scaleBtns.length} × ${s0.w}×${s0.h}, ${m.scaleBtns.length === 3 ? m.scaleRows + " row(s)" : ""})`);
    }
    if (m.scaleBtns.length >= 2) {
      const counts = m.scaleRowCounts, n = m.scaleBtns.length;
      const oneRow = counts.length === 1 && counts[0] === n;
      const oneCol = counts.length === n && counts.every((c) => c === 1) && m.scaleBtns.every((b) => Math.abs(b.w - m.groupW) <= 1);
      log(oneRow || oneCol, `${tag}: scale group is ${oneRow ? "one row" : oneCol ? "one full-width column" : "NEITHER (" + counts.join("+") + ")"} — never ${n === 3 ? "2 + 1" : "a split"}`);
    }
    if (!/^(Width|ft wide)/m.test(m.text)) log(!/\bWidth\b/.test(m.text), `${tag}: no Width box and no sheet-width readout`);
    if (surface === "docked 620" && v.id === "pdf1") {
      // the known-good arm: this reading is clean on ANY build, or the instrument is void
      if (fail > before) void_ = true;
    }
    if (process.env.SHOTS) {
      await page.screenshot({ path: `${OUT}overlays-panel-${surface.replace(/\W+/g, "-")}-${v.id}.png` });
      await page.locator('[data-testid="overlays-panel"]').screenshot({ path: `${OUT}overlays-panel-only-${surface.replace(/\W+/g, "-")}-${v.id}.png` }).catch(() => {});
    }
    await ctx.close();
  }
}


/* THE OPEN ROW FITS: on a laptop-sized window, docked, the open PDF row — through "Knock out white paper" —
 * is on screen with no scrolling. Read BEFORE anything scrolls it into view. */
async function fitCheck() {
  for (const w of [300, 400]) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, deviceScaleFactor: 1 });
    await ctx.addInitScript(seedFor(w, "pdf1"));
    const page = await ctx.newPage();
    await assertMeasurable(page, "verify-overlays-panel-layout");
    await page.goto(`${BASE}#/project/S/site`, { waitUntil: "load" });
    await page.waitForTimeout(3200);
    await openPanel(page, { phone: false });
    if (BROKEN) await page.addStyleTag({ content: BREAK_CSS });
    await page.waitForTimeout(300);
    const f = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="overlays-panel"]');
      const lab = Array.from(root.querySelectorAll("label")).find((l) => /Knock out white paper/.test(l.textContent));
      const sc = root.closest("[data-panel-body]") || root.parentElement;
      const sr = sc.getBoundingClientRect();
      return { bottom: lab ? lab.getBoundingClientRect().bottom : null, viewBottom: Math.min(innerHeight, sr.bottom), scrolled: sc.scrollTop };
    });
    log(f.bottom != null && f.scrolled === 0 && f.bottom <= f.viewBottom, `fit 1366×768 docked ${w}: open row ends at ${f.bottom == null ? "?" : Math.round(f.bottom)} within the visible panel (${Math.round(f.viewBottom)}), unscrolled`);
    if (process.env.SHOTS) await page.screenshot({ path: `${OUT}overlays-panel-fit-${w}.png` });
    await ctx.close();
  }
}

const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(",").map(Number) : [240, 300, 400, 520, 620];
for (const w of WIDTHS) await run(`docked ${w}`, { w });
for (const w of WIDTHS) await run(`floating ${w}`, { w, floating: true });
await fitCheck();
await run("phone 390×844", { w: 320, vw: 390, vh: 844, phone: true });
await run("phone 360×640", { w: 320, vw: 360, vh: 640, phone: true });
await browser.close();

console.log(`\n${fail === 0 ? "ALL CLEAN" : fail + " FAILED"} (${lines.length} checks${BROKEN ? ", DELIBERATELY BROKEN layout" : ""})`);
if (void_ && !BROKEN) { console.log("⚠ the known-good 620 arm was not clean — the run is VOID."); process.exit(3); }
if (EXPECT_RED) { console.log(fail > 0 ? "expected red — saw red ✓" : "expected red — but the instrument stayed GREEN ✗"); process.exit(fail > 0 ? 0 : 1); }
process.exit(fail === 0 ? 0 : 1);
