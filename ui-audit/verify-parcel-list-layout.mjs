/* verify-parcel-list-layout — NEW-4 (parcel list layout C): the Parcels LIST, measured on data shaped like the owner's real plans.
 *
 * WHY THIS EXISTS: three rounds of the list passed their own tests on tidy fixtures and still "looked like shit" on the real
 * plan (truncated names, an ACRES heading not over the acres, an empty band, a giant total). This harness drives the list at
 * the real panel width and the narrowest / widest it can be dragged, light AND dark, on fixtures built from the owner's
 * plans (Silvestri Concept D; the 11-parcel plan from his screenshot incl. a name long enough to wrap; a 30-row stress
 * plan with 1,234.56 ac; a one-parcel plan), and asserts by getBoundingClientRect:
 *   · no name / source / acres node is clipped (scrollWidth <= clientWidth) and none uses an ellipsis
 *   · the right edge of EVERY acres value (all groups, and the group headers' acres) is equal within 1 px
 *   · no icon box intersects any text box in its row
 *   · row heights are consistent within a type (single-line rows equal; wrapped rows taller only by whole line heights)
 *   · the summary number's font-size equals the surrounding text's
 *   · name / source / acres / group-label text clears 4.5:1 against its row background (both themes, active and inactive)
 *   · the panel never scrolls sideways
 *   · THE TABLE (owner 2026-10-16): ONE column-heading row above the list; its "Acres" shares the acres right edge; its lock / eye
 *     (and overlap) icons sit CENTRED over the same icon on EVERY row of EVERY group; every row shows its padlock (closed / open) and eye
 *     (open / struck) at rest with the mouse parked away; no row is ever labelled "Unnamed" and no two numbered lots share a label
 *   · the summary figure has the same size AND weight as the words around it
 * KNOWN-GOOD ARM (CLAUDE.md, DRIVER-SCROLL §6): the run is VOID unless every fixture shows its expected sections + row counts
 * AND the long name actually wraps to >1 line at the default width — a layout that cannot wrap proves nothing.
 * Modes: BASE_URL (default local preview) · SIGNED_IN=1 -> ui-audit/lib/signedInSession.mjs (live planyr.io, test account)
 *        SHOTS_DIR=<dir> writes a screenshot per fixture/theme/width.
 */
import { chromium } from "@playwright/test";
import { existsSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const SIGNED = !!process.env.SIGNED_IN;
const DPR = Number(process.env.DPR || 2.15); // the owner's measured device pixel ratio
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- fixtures: a rectangle of exactly `ac` acres (300 ft wide) ---- */
let yCursor = 0; // stack the lots so none overlap (the site total is DISSOLVED: shared ground counts once)
const rect = (i, ac) => { const x = 0, y = yCursor, w = 300, h = (ac * 43560) / w; yCursor += h + 200; return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]; };
const rectAt = (x, y, ac) => { const w = 300, h = (ac * 43560) / w; return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]; };
const county = (i, id, ac, acct, extra = {}) => ({ id, points: rect(i, ac), source: "county", gisKey: id, acct, ...extra });
const drawn = (i, id, ac, label, extra = {}) => ({ id, points: rect(i, ac), source: "drawn", label, ...extra });
const comb = (i, id, ac, label, n, extra = {}) => ({ id, points: rect(i, ac), label, combined: { from: Array.from({ length: n }, (_, k) => ({ ...county(i, id + "s" + k, ac / n, "0" + (500000 + k)), snapName: "Lot " + (k + 1) })) }, ...extra });
const LONG = "Frontage strip along Ella Blvd north of the detention pond";
const mk = (tag, title, parcels) => ({
  id: "zz-pl-" + tag, groupId: "zz-pl-" + tag, site: title, name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris", parcels,
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
});
const FIX = [
  { tag: "silv", title: "ZZ Silvestri D", sections: { county: 2, drawn: 1 }, rows: 3, parcels: [
    county(0, "s1", 64.28, "0421030000111", { label: "SCHIEL" }), county(1, "s2", 158.2, "0421030000222"), drawn(2, "s3", 197.89, "Parcel 2")] },
  { tag: "elev", title: "ZZ Eleven Parcels", sections: { county: 4, combined: 2, drawn: 5 }, rows: 11, longId: "e11", parcels: [
    county(0, "e1", 6.66, "0421030000123", { label: "ADKINS ACRES" }), county(1, "e2", 8.12, "0421030000124", { label: "HARRIS HOLDINGS LTD" }),
    county(2, "e3", 5.78, "0421030000125", { active: false }), county(3, "e4", 12.4, "0421030000126"),
    comb(4, "e5", 20.1, "Tract A", 3), comb(5, "e6", 14.2, "Tract B", 2),
    drawn(6, "e7", 69.48, "Parcel 4"), drawn(7, "e8", 69.48, "Parcel 5"), drawn(8, "e9", 11.86, "Parcel 6"), drawn(9, "e10", 3.1, "Parcel 7", { active: false }), drawn(10, "e11", 4.4, LONG)] },
  { tag: "many", title: "ZZ Thirty Parcels", sections: { county: 12, combined: 1, drawn: 16, other: 1 }, rows: 30, parcels: [
    ...Array.from({ length: 12 }, (_, k) => county(k, "m" + k, 1234.56 - k * 100.01 > 0 ? (k === 0 ? 1234.56 : 12.34 + k) : 9.9, "04210300" + String(1000 + k), k % 5 === 1 ? { label: "Lot " + k } : {})),
    comb(12, "mc", 88.88, "Tract A", 4),
    ...Array.from({ length: 16 }, (_, k) => drawn(13 + k, "md" + k, 3.3 + k, "Parcel " + (k + 1), { active: false })), // the whole Drawn group is inactive
    { id: "mo", points: rect(29, 7.77), label: "Mystery" }] },
  { tag: "one", title: "ZZ One Parcel", sections: { drawn: 1 }, rows: 1, parcels: [drawn(0, "o1", 41.5, "Parcel 1")] },
];
// 8 South › Concept A, as the owner's real-data check found it (2026-10-11): one account on THREE overlapping rows, a LOCKED combined parcel
// whose source line is "Combined from 2 parcels", and four 69.48 + an 11.86 with no source evidence that sit on top of one another — so the
// rows add up to far more than the (dissolved) site total. KNOWN-GOOD ARM: this plan MUST show overlap; every other fixture must show none.
const OV_BASE = 9_000_000; // far from the stacked fixtures, so nothing else touches it
const ovCounty = (id, ac, dx, dy, extra = {}) => ({ id, points: rectAt(0 + dx, OV_BASE + dy, ac), source: "county", gisKey: id, acct: "0440520000010", ...extra });
const ovDrawn = (id, ac, dx, dy, label) => ({ id, points: rectAt(2000 + dx, OV_BASE + dy, ac), label });
FIX.push({ tag: "ovlp", title: "ZZ Eight South", overlap: true, sections: { county: 4, combined: 1, other: 5 }, rows: 10, longId: null, parcels: [
  ovCounty("o1", 6.66, 0, 0), ovCounty("o2", 6.66, 40, 40), ovCounty("o3", 6.66, 80, 80), { ...county(0, "o4", 8.12, "0440520000099"), points: rectAt(0, OV_BASE + 3000, 8.12) },
  { id: "oc", points: rectAt(4000, OV_BASE, 70), label: "Tract A", locked: true, lockSem: 2, combined: { from: [1, 2].map((k) => ({ ...drawn(0, "oc" + k, 35, "Piece " + k), snapName: "Piece " + k })) } },
  ovDrawn("od1", 69.48, 0, 0, "Parcel 4"), ovDrawn("od2", 69.48, 0, 0, "Parcel 5"), ovDrawn("od3", 69.48, 2000, 60, "Parcel 7"), ovDrawn("od4", 69.48, 0, 6000, "Parcel 8"), ovDrawn("od5", 11.86, 40, 6040, "Parcel 6")] });
// UNNAMED lots, as the owner's real plans hold them: drawn / other parcels nobody named (they read "Parcel N" — and a number stays with its lot when an
// earlier one was deleted: 6 is gone below, so 7 stays 7), plus an unnamed county lot ("Acct …"). KNOWN-GOOD ARM: the labels are known in advance.
const un = (id, y, ac, extra = {}) => ({ id, points: rectAt(12_000_000, y, ac), ...extra });
FIX.push({ tag: "unam", title: "ZZ Unnamed Lots", sections: { county: 1, drawn: 3, other: 2 }, rows: 6, longId: null, expectLabels: { u1: "Acct 0421030000777", u2: "Parcel 4", u3: "Parcel 5", u4: "Parcel 7", u5: "Parcel 8", u6: "Parcel 9" }, parcels: [
  { ...county(0, "u1", 12.5, "0421030000777"), points: rectAt(12_000_000, 0, 12.5), parcelNo: 1 },
  un("u2", 4000, 20, { source: "drawn", parcelNo: 4 }), un("u3", 8000, 21, { source: "drawn", parcelNo: 5 }), un("u4", 12000, 22, { source: "drawn", parcelNo: 7 }),
  un("u5", 16000, 23, { parcelNo: 8 }), un("u6", 20000, 24, { parcelNo: 9 })] });
const SITES = Object.fromEntries(FIX.map((f) => { const s = mk(f.tag, f.title, f.parcels); return [s.id, s]; }));
void yCursor;
const WIDTHS = process.env.WIDTHS ? process.env.WIDTHS.split(",").map(Number) : [240, 320, 620]; // PANEL_MIN_W · default · PANEL_MAX_W (lib/panelWidth.js)
const THEMES = ["light", "dark"];

const errors = [];
let browser, ctx, page, UID = null;
async function seed() {
  if (SIGNED) {
    await page.waitForFunction(() => !!(window.pfSupabase && window.pfSupabase.auth), null, { timeout: 30000 }); // a cold reload has no client yet
    UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
    await page.evaluate(([uid, sites]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify(sites)); }, [UID, SITES]);
  }
}
if (SIGNED) {
  const s = await openSignedIn({ base: BASE, ignoreDefaultArgs: ["--hide-scrollbars"], contextOptions: { deviceScaleFactor: DPR } }); browser = s.browser; ctx = s.context; page = s.page;
} else {
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  // REAL scrollbars: headless Chromium hides them, which is how a few-px overflow that only exists beside a classic (Windows) scrollbar was invisible here
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"], ignoreDefaultArgs: ["--hide-scrollbars"] });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: DPR }); // the owner's panel notches by DEVICE pixel (lib/panelWidth.js) — a dpr-1 rig cannot see that
  page = await ctx.newPage();
  await page.addInitScript((sites) => { try { if (!localStorage.getItem("zz-pl-seeded")) { localStorage.setItem("planarfit:sites:v1", JSON.stringify(sites)); localStorage.setItem("zz-pl-seeded", "1"); } } catch (_) {} }, SITES);
}
page.on("pageerror", (e) => { if (!/infinite number of tiles/.test(String(e))) errors.push(String(e)); });
await page.route("**/*.jpg", (r) => r.abort());
const T = (id) => page.getByTestId(id);

/* ---- the in-page measurement: returns a plain object; the assertions run in node ---- */
const MEASURE = () => {
  const panel = document.querySelector('[data-testid="parcels-panel"]');
  const rgb = (c) => { const m = /rgba?\(([^)]+)\)/.exec(c); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] == null ? 1 : p[3] }; };
  const bgOf = (el) => { let e = el; while (e) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && c.a > 0.5) return c; e = e.parentElement; } return { r: 255, g: 255, b: 255, a: 1 }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const textBox = (el) => { const g = document.createRange(); g.selectNodeContents(el); const rs = [...g.getClientRects()].filter((r) => r.width > 0); if (!rs.length) return null; return { l: Math.min(...rs.map((r) => r.left)), r: Math.max(...rs.map((r) => r.right)), t: Math.min(...rs.map((r) => r.top)), b: Math.max(...rs.map((r) => r.bottom)), lines: new Set(rs.map((r) => Math.round(r.top))).size }; };
  const nameBtnPure = (row, id) => { const b = row.querySelector(`[data-testid="parcel-row-${id}"]`); const bad = [...b.querySelectorAll("[data-testid]")].filter((e) => !/^parcel-row-(name|source)-/.test(e.getAttribute("data-testid"))); return bad.length ? `${id}: name block holds ${bad.map((e) => e.getAttribute("data-testid")).join(",")} besides name + source` : ""; };
  const iconLefts = { overlap: [], lock: [], eye: [], more: [] };
  const iconCx = { overlap: [], lock: [], eye: [] }, hiddenAtRest = [], states = { locked: 0, open: 0, struck: 0, eyeOpen: 0, mismatch: [] }, labels = [];
  const cxOf = (el) => { const g = el.querySelector("svg") || el; const r = g.getBoundingClientRect(); return (r.left + r.right) / 2; };
  const hdrCount = panel.querySelectorAll('[data-testid="parcels-columns"]').length;
  const headSeat = (id) => { const e = panel.querySelector(`[data-testid="${id}"]`); return e ? { cx: cxOf(e), svg: !!e.querySelector("svg") } : null; };
  const head = { overlap: headSeat("parcels-col-overlap"), lock: headSeat("parcels-col-lock"), eye: headSeat("parcels-col-eye") };
  const headAcres = panel.querySelector('[data-testid="parcels-col-acres"]'), headBox = panel.querySelector('[data-testid="parcels-columns"]');
  const clipped = [], contrast = [], overlaps = [], rows = [], slots = [], outsideSlot = [], cellShared = [], wrappedSources = [];
  const check = (el, what) => {
    if (el.scrollWidth > el.clientWidth + 0.5) clipped.push(`${what}: scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth}`);
    const cs = getComputedStyle(el); if (cs.textOverflow === "ellipsis") clipped.push(`${what}: text-overflow ellipsis`);
    const fg = rgb(cs.color), bg = bgOf(el); const cr = fg ? ratio(fg, bg) : 0;
    if (cr < 4.5) contrast.push(`${what}: ${cr.toFixed(2)}:1`);
  };
  const acresRight = [];
  panel.querySelectorAll('[data-testid^="parcel-table-row-"]').forEach((row) => {
    const id = row.getAttribute("data-testid").replace("parcel-table-row-", "");
    const name = row.querySelector(`[data-testid="parcel-row-name-${id}"]`), src = row.querySelector(`[data-testid="parcel-row-source-${id}"]`), ac = row.querySelector(`[data-testid="parcel-row-acres-${id}"]`);
    check(name, `name ${id}`); if (src) check(src, `source ${id}`); check(ac, `acres ${id}`);
    acresRight.push({ id, r: ac.getBoundingClientRect().right });
    labels.push({ id, group: row.getAttribute("data-group-kind"), text: name.textContent.trim() });
    const boxes = [textBox(name), src && textBox(src), textBox(ac)].filter(Boolean);
    row.querySelectorAll("button").forEach((b) => {
      if (!/parcel-row-(lock|pencil|eye|more)-/.test(b.getAttribute("data-testid") || "")) return;
      const r = b.getBoundingClientRect();
      boxes.forEach((t) => { if (r.left < t.r - 0.5 && r.right > t.l + 0.5 && r.top < t.b - 0.5 && r.bottom > t.t + 0.5) overlaps.push(`${b.getAttribute("data-testid")} over text in ${id}`); });
    });
    // lines of the NAME TEXT only — the small "overlaps" tag rides inline beside it and sits a pixel higher, which is not a line
    const nameLines = (() => { const tops = new Set(); const w = document.createTreeWalker(name, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.parentElement.closest('[data-testid^="parcel-row-overlap-"]')) continue; const g = document.createRange(); g.selectNodeContents(n); [...g.getClientRects()].filter((r) => r.width > 0).forEach((r) => tops.add(Math.round(r.top))); } return tops.size; })();
    const nb = textBox(name), sb = src && textBox(src);
    const eye = row.querySelector(`[data-testid="parcel-row-eye-${id}"]`), lock = row.querySelector(`[data-testid="parcel-row-lock-${id}"]`), more = row.querySelector(`[data-testid="parcel-row-more-${id}"]`);
    const ovIcon = row.querySelector(`[data-testid="parcel-row-overlap-${id}"]`);
    const slot = eye.parentElement, sr = slot.getBoundingClientRect(), nameCell = name.closest("div[style*='flex']") || name.parentElement.parentElement;
    slots.push({ id, l: sr.left, r: sr.right });
    if (ovIcon && !slot.contains(ovIcon)) outsideSlot.push(`overlap marker of ${id} is not in the icon slot`);
    if (ovIcon && ovIcon.getBoundingClientRect().right > (lock || eye).getBoundingClientRect().left + 0.5) outsideSlot.push(`overlap marker of ${id} is not left of the padlock / eye`);
    if (nameBtnPure(row, id)) cellShared.push(nameBtnPure(row, id));
    if (ovIcon) iconLefts.overlap.push({ id, l: ovIcon.getBoundingClientRect().left }); if (lock) iconLefts.lock.push({ id, l: lock.getBoundingClientRect().left }); iconLefts.eye.push({ id, l: eye.getBoundingClientRect().left }); iconLefts.more.push({ id, l: more.getBoundingClientRect().left });
    [lock, eye, more, ovIcon].filter(Boolean).forEach((b) => { const r = b.getBoundingClientRect(); if (r.left < sr.left - 0.5 || r.right > sr.right + 0.5 || r.top < sr.top - 0.5 || r.bottom > sr.bottom + 0.5) outsideSlot.push(`${b.getAttribute("data-testid")} outside its icon slot`); });
    if (lock && lock.getBoundingClientRect().right > eye.getBoundingClientRect().left + 0.5) outsideSlot.push(`padlock of ${id} is not left of the eye`);
    // the name cell holds the name button ONLY (no icon in the middle of the row) and the button uses the cell's full width
    const nbtn = row.querySelector(`[data-testid="parcel-row-${id}"]`), cellW = nbtn.parentElement.getBoundingClientRect().width, indent = parseFloat(getComputedStyle(nbtn.parentElement).paddingLeft) || 0;
    if (nbtn.parentElement.children.length !== 1 || nbtn.getBoundingClientRect().width < cellW - indent - 1) cellShared.push(`${id}: name block shares its cell with ${nbtn.parentElement.children.length - 1} other element(s) / ${(cellW - indent - nbtn.getBoundingClientRect().width).toFixed(1)}px narrower`);
    if (src) { const sb2 = textBox(src); if (sb2 && sb2.lines > 1) { const c = src.cloneNode(true); c.style.cssText += ";white-space:nowrap;position:absolute;visibility:hidden;width:auto"; src.parentElement.appendChild(c); const natural = c.getBoundingClientRect().width; c.remove(); wrappedSources.push({ id, natural, avail: src.getBoundingClientRect().width, text: src.textContent }); } }
    if (ovIcon) iconCx.overlap.push({ id, cx: cxOf(ovIcon) }); if (lock) iconCx.lock.push({ id, cx: cxOf(lock) }); iconCx.eye.push({ id, cx: cxOf(eye) });
    // lock + eye are ALWAYS there: painted (not transparent / hidden) with the mouse parked away from every row
    [["lock", lock], ["eye", eye]].forEach(([k, b]) => { if (!b) { hiddenAtRest.push(`${k} of ${id} is missing`); return; } const cs = getComputedStyle(b), r = b.getBoundingClientRect(), g = b.querySelector("svg"); if (Number(cs.opacity) < 0.9 || cs.visibility !== "visible" || cs.display === "none" || r.width < 8 || r.height < 8 || !g) hiddenAtRest.push(`${k} of ${id} hidden at rest (opacity ${cs.opacity})`); });
    if (lock) { const glyph = lock.querySelector("[data-lock-glyph]"), g = glyph && glyph.getAttribute("data-lock-glyph"), want = lock.getAttribute("data-locked") === "1" ? "locked" : "open"; if (g !== want) states.mismatch.push(`${id}: padlock shows ${g}, row is ${want}`); if (want === "locked") states.locked++; else states.open++; }
    if (eye) { const struck = [...eye.querySelectorAll("path")].some((p) => /^M3 3l18 18/.test(p.getAttribute("d") || "")), inc = eye.getAttribute("data-included") === "1"; if (struck === inc) states.mismatch.push(`${id}: eye ${struck ? "struck" : "open"} but row ${inc ? "active" : "left out"}`); if (struck) states.struck++; else states.eyeOpen++; }
    rows.push({ id, tagged: !!row.querySelector(`[data-testid="parcel-row-overlap-${id}"]`), h: row.getBoundingClientRect().height, nameLines: nb ? nameLines : 0, subLines: sb ? sb.lines : 0, hasSub: !!src });
  });
  if (headAcres) acresRight.push({ id: "column-header", r: headAcres.getBoundingClientRect().right });
  const groups = [...panel.querySelectorAll('[data-testid^="parcels-group-"]:not([data-testid^="parcels-group-acres-"])')].map((g) => {
    const key = g.getAttribute("data-testid").replace("parcels-group-", ""); const lab = g.firstElementChild, ac = g.querySelector('[data-testid^="parcels-group-acres-"]');
    check(lab, `group label ${key}`); check(ac, `group acres ${key}`);
    acresRight.push({ id: "group:" + key, r: ac.getBoundingClientRect().right });
    return { key, label: lab.textContent, n: g.parentElement.querySelectorAll('[data-testid^="parcel-table-row-"]').length };
  });
  const sum = panel.querySelector('[data-testid="parcels-summary"]'), num = panel.querySelector('[data-testid="parcels-site-acres"]');
  const detail = {
    fs: { sum: getComputedStyle(sum).fontSize, num: getComputedStyle(num).fontSize, sumText: sum.textContent.trim(), sumW: getComputedStyle(sum).fontWeight, numW: getComputedStyle(num).fontWeight },
    spills: panel.scrollWidth > panel.clientWidth + 0.5,
    panelW: Math.round(panel.getBoundingClientRect().width),
  };
  const groupAcres = [...panel.querySelectorAll('[data-testid^="parcels-group-acres-"]')].map((e) => Number(e.textContent.replace(/,/g, "")));
  const ovEl = panel.querySelector('[data-testid="parcels-overlap"]');
  const lineCount = (el) => { const tops = new Set(); const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) { const g = document.createRange(); g.selectNodeContents(n); [...g.getClientRects()].filter((r) => r.width > 0).forEach((r) => tops.add(Math.round(r.top))); } return tops.size; };
  const summaryLines = ["parcels-summary-line", "parcels-overlap"].map((id) => { const e = panel.querySelector(`[data-testid="${id}"]`); return e ? { id, lines: lineCount(e), text: e.textContent.trim() } : null; }).filter(Boolean);
  // the nearest scrolling ancestor = the panel body: nothing may poke past its right edge (the owner's 403 vs 400)
  let body = panel.parentElement; while (body && !/(auto|scroll)/.test(getComputedStyle(body).overflowX + getComputedStyle(body).overflowY)) body = body.parentElement;
  body = body || document.scrollingElement;
  const lim = body.getBoundingClientRect().left + body.clientLeft + body.clientWidth;
  const offenders = [...body.querySelectorAll("*")].filter((e) => { const cs = getComputedStyle(e); return cs.position !== "fixed" && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().right > lim + 0.5; }).slice(0, 3).map((e) => `${e.tagName.toLowerCase()}[${e.getAttribute("data-testid") || e.className || ""}] +${(e.getBoundingClientRect().right - lim).toFixed(1)}`);
  const bodyOverflow = { sw: body.scrollWidth, cw: body.clientWidth, offenders };
  return { clipped, contrast, overlaps, rows, groups, acresRight, groupAcres, slots, outsideSlot, cellShared, wrappedSources, overlapText: ovEl ? ovEl.textContent : "", summaryLines, bodyOverflow, iconLefts, iconCx, head, hdrCount, headText: headBox ? headBox.textContent.trim() : "", hiddenAtRest, states, labels, ...detail };
};

const openFixtureOnce = async (f, theme, width) => {
  await page.evaluate(([t, w]) => { localStorage.setItem("planyr.theme", t); localStorage.setItem("planarfit:leftWidth", String(w)); }, [theme, width]);
  await page.evaluate((id) => localStorage.setItem("planarfit:currentSite:v1", id), "zz-pl-" + f.tag);
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  if (SIGNED) await seed(); // the signed-in app prunes local-only sites between loads, so re-seed right before every reload
  await page.reload({ waitUntil: "load" }); await sleep(SIGNED ? 3000 : 1800);
  if (!(await T("planner-canvas").isVisible().catch(() => false))) await page.getByText(f.title, { exact: false }).first().click({ timeout: 15000 });
  await T("planner-canvas").waitFor({ timeout: 25000 }); await sleep(1200);
  await page.locator('[data-rail-tab="parcel"]').first().click({ timeout: 15000 });
  await T("parcels-panel").waitFor({ timeout: 15000 }); await sleep(500);
};
// A cold signed-in boot occasionally has not opened the planner yet; retry the OPEN (never the assertions) up to 3 times.
const openFixture = async (f, theme, width) => {
  for (let k = 1; ; k++) { try { return await openFixtureOnce(f, theme, width); } catch (e) { if (k >= 3) throw e; console.log(`  (open ${f.tag}/${theme}/${width} attempt ${k} failed: ${String(e.message).split("\n")[0]} — retrying)`); } }
};

try {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  if (SIGNED) { await seed(); await page.reload({ waitUntil: "load" }); await sleep(3000); }
  await assertMeasurable(page, "verify-parcel-list-layout");
  console.log("served build", await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build));
  for (const f of FIX.filter((x) => !process.env.ONLY || process.env.ONLY.split(",").includes(x.tag))) for (const theme of THEMES) for (const width of WIDTHS) {
    const tag = `${f.tag}/${theme}/${width}`;
    await openFixture(f, theme, width);
    if ((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) !== theme && theme === "dark") throw new Error(`VOID: ${tag} — the dark theme did not apply`);
    await page.mouse.move(1, 1); await sleep(350); // park the pointer away from every row: nothing may depend on hover
    const m = await page.evaluate(MEASURE);
    // known-good arm
    const secs = Object.fromEntries(m.groups.map((g) => [g.key, g.n]));
    const expectSecs = JSON.stringify(Object.entries(f.sections).sort()), gotSecs = JSON.stringify(Object.entries(secs).sort());
    if (m.rows.length !== f.rows || expectSecs !== gotSecs) throw new Error(`VOID: ${tag} — expected ${f.rows} rows in ${expectSecs}, saw ${m.rows.length} in ${gotSecs}`);
    if (f.longId && width <= 320) { const lr = m.rows.find((r) => r.id === f.longId); if (!lr || lr.nameLines < 2) throw new Error(`VOID: ${tag} — the long name did not wrap (lines=${lr && lr.nameLines}); the clip checks prove nothing`); }
    ok(`${tag}: order of sections is County → Combined → Drawn → Other`, JSON.stringify(m.groups.map((g) => g.key)) === JSON.stringify(["county", "combined", "drawn", "other"].filter((k) => k in f.sections)));
    ok(`${tag}: no name / source / acres / label is clipped or ellipsised`, m.clipped.length === 0, m.clipped.slice(0, 3).join(" | "));
    const rs = m.acresRight.map((a) => a.r); const spread = Math.max(...rs) - Math.min(...rs);
    ok(`${tag}: every acres value (${rs.length} incl. group totals) shares one right edge`, spread <= 1, `spread ${spread.toFixed(2)}px`);
    ok(`${tag}: no icon box intersects any text box`, m.overlaps.length === 0, m.overlaps.slice(0, 3).join(" | "));
    // row heights: group by (hasSub, nameLines, subLines); each type uniform, extra lines add ~1 line height
    // a row's kind is (group, lines) only — overlap / lock state is deliberately NOT part of it: a marker may never change a row's height
    const types = new Map(); m.rows.forEach((r) => { const k = `${r.hasSub ? 1 : 0}/${r.nameLines}/${r.subLines}`; (types.get(k) || types.set(k, []).get(k)).push(r.h); });
    const nonUniform = [...types].filter(([, hs]) => Math.max(...hs) - Math.min(...hs) > 1).map(([k, hs]) => `${k}: ${Math.min(...hs).toFixed(1)}–${Math.max(...hs).toFixed(1)}`);
    ok(`${tag}: row heights are consistent within each row type (${types.size} types)`, nonUniform.length === 0, nonUniform.join(" | "));
    const single = types.get("0/1/0");
    if (single) { const base = single[0]; const bad = [...types].filter(([k, hs]) => { const [s, n, u] = k.split("/").map(Number); const extra = (n - 1) + (u > 1 ? u - 1 : 0); return extra > 0 && !s ? Math.abs(hs[0] - base - extra * 17) > 2 : false; }); ok(`${tag}: a wrapped name adds only whole line heights`, bad.length === 0, bad.map(([k, hs]) => `${k}=${hs[0]}`).join(" | ")); }
    // TOTALS RECONCILE: the rows/groups add up to the site total PLUS the disclosed overlap — or the mismatch is a defect (owner, 2026-10-11).
    const sumAc = Number(m.fs.sumText.split(" ")[0].replace(/,/g, "")), grpAc = m.groupAcres.reduce((a, b) => a + b, 0);
    const ovAc = m.overlapText ? Number((/([\d,]+\.\d\d) AC overlap/.exec(m.overlapText) || [0, "0"])[1].replace(/,/g, "")) : 0;
    const gap = grpAc - sumAc;
    ok(`${tag}: group totals reconcile with the site total — a gap is DISCLOSED as "N AC overlap" (gap ${gap.toFixed(2)}, disclosed ${ovAc.toFixed(2)})`, Math.abs(gap - ovAc) < 0.06 && (gap < 0.05 || (ovAc > 0 && m.rows.some((r) => r.tagged))), `${m.fs.sumText}`);
    if (f.overlap) { if (!(gap > 0.5)) throw new Error(`VOID: ${tag} — the overlap fixture has no overlap in the DATA (rows add to ${grpAc.toFixed(2)}, site ${sumAc}); the totals check proves nothing`); }
    else ok(`${tag}: a plan with no overlap shows no overlap tag or note`, !m.overlapText && !m.rows.some((r) => r.tagged));
    // ICONS: every row icon sits INSIDE the one icon slot (padlock left of the eye), the slot is the same on every row, and the name block owns its whole cell
    const slotSpread = Math.max(...m.slots.map((s) => s.r)) - Math.min(...m.slots.map((s) => s.r)), slotSpreadL = Math.max(...m.slots.map((s) => s.l)) - Math.min(...m.slots.map((s) => s.l));
    ok(`${tag}: every icon sits inside its row's icon slot, padlock left of the eye`, m.outsideSlot.length === 0, m.outsideSlot.slice(0, 3).join(" | "));
    // FIXED COLUMNS: every icon of a kind has the SAME left edge on every row (a locked row's overlap icon must not shift left)
    const colSpread = Object.entries(m.iconLefts).map(([k, a]) => [k, a.length ? Math.max(...a.map((x) => x.l)) - Math.min(...a.map((x) => x.l)) : 0, a.length]);
    ok(`${tag}: each icon kind sits in ONE column down the list (${colSpread.filter((c) => c[2]).map((c) => `${c[0]}×${c[2]}`).join(" ")})`, colSpread.every((c) => c[1] <= 1), colSpread.filter((c) => c[1] > 1).map((c) => `${c[0]} spread ${c[1].toFixed(1)}`).join(" | "));
    ok(`${tag}: the icon slot is the same box on every row`, slotSpread <= 1 && slotSpreadL <= 1, `${slotSpread.toFixed(1)} / ${slotSpreadL.toFixed(1)}`);
    // THE TABLE: one heading row, "Acres" on the acres edge (above), an icon over each icon column, centred over the icons beneath it
    ok(`${tag}: ONE column-heading row sits above the list, reading Name / Acres`, m.hdrCount === 1 && /Name/i.test(m.headText) && /Acres/i.test(m.headText), `${m.hdrCount} × "${m.headText}"`);
    const wantKinds = ["lock", "eye", ...(m.iconCx.overlap.length ? ["overlap"] : [])];
    const cxBad = wantKinds.flatMap((k) => { const h = m.head[k]; if (!h || !h.svg) return [`no ${k} icon in the column heading`]; return m.iconCx[k].filter((r) => Math.abs(r.cx - h.cx) > 1).slice(0, 2).map((r) => `${k} of ${r.id}: ${Math.abs(r.cx - h.cx).toFixed(1)}px off the heading icon`); });
    ok(`${tag}: each heading icon (${wantKinds.join(" · ")}) sits centred over the same icon on EVERY row (${wantKinds.map((k) => m.iconCx[k].length).join("/")} rows)`, cxBad.length === 0, cxBad.slice(0, 3).join(" | "));
    ok(`${tag}: no heading icon is shown for a column that does not exist`, !!m.head.overlap === (m.iconCx.overlap.length > 0));
    ok(`${tag}: the padlock and the eye are visible on EVERY row with the pointer parked away (${m.rows.length} rows)`, m.hiddenAtRest.length === 0, m.hiddenAtRest.slice(0, 3).join(" | "));
    const wantLocked = f.parcels.filter((p) => p.locked).length, wantStruck = f.parcels.filter((p) => p.active === false).length;
    ok(`${tag}: closed padlock only on locked rows (${m.states.locked}/${wantLocked}), struck eye only on left-out rows (${m.states.struck}/${wantStruck}), and each glyph agrees with its row`, m.states.mismatch.length === 0 && m.states.locked === wantLocked && m.states.struck === wantStruck && m.states.open === m.rows.length - wantLocked, m.states.mismatch.slice(0, 3).join(" | "));
    ok(`${tag}: no row is labelled "Unnamed", and no two numbered lots in a group share a label`, !m.labels.some((l) => /^unnamed$/i.test(l.text)) && ![...new Set(m.labels.map((l) => l.group))].some((g) => { const t = m.labels.filter((l) => l.group === g && /^Parcel \d+$/.test(l.text)).map((l) => l.text); return new Set(t).size !== t.length; }), m.labels.filter((l) => /unnamed/i.test(l.text)).map((l) => l.id).join(","));
    if (f.expectLabels) ok(`${tag}: unnamed lots read by their STABLE number (a deleted one leaves a gap, nothing renumbers)`, Object.entries(f.expectLabels).every(([id, t]) => (m.labels.find((l) => l.id === id) || {}).text === t), JSON.stringify(m.labels.map((l) => l.id + "=" + l.text)));
    ok(`${tag}: nothing but the name block sits in the name cell (the source line gets the full block width)`, m.cellShared.length === 0, m.cellShared.slice(0, 3).join(" | "));
    // a source line may wrap ONLY if it genuinely does not fit the block (natural width > available), and a short one never wraps at a comfortable width
    const badWrap = m.wrappedSources.filter((w) => w.natural <= w.avail + 0.5);
    ok(`${tag}: no source line wraps while it fits the name block`, badWrap.length === 0, badWrap.slice(0, 2).map((w) => `${w.id} "${w.text}" ${w.natural.toFixed(0)}≤${w.avail.toFixed(0)}`).join(" | "));
    if (width >= 320) { const shortWrapped = m.wrappedSources.filter((w) => w.text.length <= 30); ok(`${tag}: a short source line ("Combined from 2 parcels") is one line at ${width}`, shortWrapped.length === 0, shortWrapped.map((w) => `${w.id} "${w.text}" avail ${w.avail.toFixed(0)}`).join(" | ")); }
    ok(`${tag}: the summary number is the same size as the words around it`, m.fs.num === m.fs.sum, `${m.fs.num} vs ${m.fs.sum} — "${m.fs.sumText}"`);
    ok(`${tag}: the summary figure is the same weight as the words around it (${m.fs.numW} vs ${m.fs.sumW})`, m.fs.numW === m.fs.sumW, `"${m.fs.sumText}"`);
    ok(`${tag}: text clears 4.5:1`, m.contrast.length === 0, m.contrast.slice(0, 3).join(" | "));
    ok(`${tag}: the panel never scrolls sideways (${m.panelW}px wide)`, !m.spills);
    const diag = await page.evaluate(() => { try { sessionStorage.setItem("planyr:diag", "1"); } catch (_) {} return window.__parcelListOverflow ? window.__parcelListOverflow() : undefined; });
    ok(`${tag}: the armed self-report window.__parcelListOverflow() answers and agrees (known-good arm for the overflow instrument)`, !!diag && Array.isArray(diag.offenders) && diag.scrollWidth <= diag.clientWidth + 0.5 && diag.offenders.length === 0, String(JSON.stringify(diag)).slice(0, 220));
    ok(`${tag}: the panel BODY has no horizontal overflow (scrollWidth ${m.bodyOverflow.sw} vs clientWidth ${m.bodyOverflow.cw})`, m.bodyOverflow.sw <= m.bodyOverflow.cw + 0.5 && m.bodyOverflow.offenders.length === 0, m.bodyOverflow.offenders.join(" | "));
    if (width >= 320) ok(`${tag}: no summary line wraps at ${width} (${m.summaryLines.map((s) => s.lines).join("+")} lines)`, m.summaryLines.length >= 1 && m.summaryLines.every((s) => s.lines === 1), m.summaryLines.map((s) => `${s.id}: "${s.text}" ×${s.lines}`).join(" | "));
    if (SHOTS) await T("parcels-panel").screenshot({ path: `${SHOTS}/${tag.replace(/\//g, "-")}.png` });
  }
  // ⋯ reveal contract on the Silvestri-shaped plan: hidden at rest, shown on hover. (The padlock and the eye are NOT hover-only any more — the table shows them on every row, asserted above.)
  await openFixture(FIX[1], "light", 320);
  const op = (id) => T(id).evaluate((e) => Number(getComputedStyle(e).opacity));
  await page.mouse.move(5, 5); await sleep(300);
  ok("at rest the ⋯ of a row is hidden, while its eye and padlock are shown", (await op("parcel-row-more-e1")) < 0.1 && (await op("parcel-row-eye-e1")) > 0.9 && (await op("parcel-row-lock-e1")) > 0.9);
  await T("parcel-table-row-e1").hover(); await sleep(350);
  ok("hovering a row shows its ⋯", (await op("parcel-row-more-e1")) > 0.9);
  // each is a working control: the padlock locks / unlocks, the eye leaves a lot out / back in
  await T("parcel-row-lock-e1").click(); await sleep(250);
  ok("clicking the open padlock closes it (the row reads locked)", (await T("parcel-row-lock-e1").getAttribute("data-locked")) === "1");
  await T("parcel-row-lock-e1").click(); await sleep(250);
  ok("clicking the closed padlock opens it again", (await T("parcel-row-lock-e1").getAttribute("data-locked")) === "0");
  await T("parcel-row-eye-e1").click(); await sleep(250);
  ok("clicking the eye leaves the lot out (struck eye)", (await T("parcel-row-eye-e1").getAttribute("data-included")) === "0");
  await T("parcel-row-eye-e1").click(); await sleep(250);
  ok("clicking it again counts the lot back in", (await T("parcel-row-eye-e1").getAttribute("data-included")) === "1");
  ok("the summary reads '<n> AC in site · 9 of 11 active'", /AC in site\s*·\s*9 of 11 active/.test(await T("parcels-summary").innerText()), await T("parcels-summary").innerText());
  ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) {
  console.log("ERROR", e.message); results.push({ name: "harness error: " + e.message, pass: false });
} finally {
  await browser.close();
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
