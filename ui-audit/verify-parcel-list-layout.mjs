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
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---- fixtures: a rectangle of exactly `ac` acres (300 ft wide) ---- */
let yCursor = 0; // stack the lots so none overlap (the site total is DISSOLVED: shared ground counts once)
const rect = (i, ac) => { const x = 0, y = yCursor, w = 300, h = (ac * 43560) / w; yCursor += h + 200; return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }]; };
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
const SITES = Object.fromEntries(FIX.map((f) => { const s = mk(f.tag, f.title, f.parcels); return [s.id, s]; }));
void yCursor;
const WIDTHS = [240, 320, 620]; // PANEL_MIN_W · default · PANEL_MAX_W (lib/panelWidth.js)
const THEMES = ["light", "dark"];

const errors = [];
let browser, ctx, page, UID = null;
async function seed() {
  if (SIGNED) {
    UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
    await page.evaluate(([uid, sites]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify(sites)); }, [UID, SITES]);
  }
}
if (SIGNED) {
  const s = await openSignedIn({ base: BASE }); browser = s.browser; ctx = s.context; page = s.page;
} else {
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
  const clipped = [], contrast = [], overlaps = [], rows = [];
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
    const boxes = [textBox(name), src && textBox(src), textBox(ac)].filter(Boolean);
    row.querySelectorAll("button").forEach((b) => {
      if (!/parcel-row-(lock|pencil|eye|more)-/.test(b.getAttribute("data-testid") || "")) return;
      const r = b.getBoundingClientRect();
      boxes.forEach((t) => { if (r.left < t.r - 0.5 && r.right > t.l + 0.5 && r.top < t.b - 0.5 && r.bottom > t.t + 0.5) overlaps.push(`${b.getAttribute("data-testid")} over text in ${id}`); });
    });
    const nb = textBox(name), sb = src && textBox(src);
    rows.push({ id, h: row.getBoundingClientRect().height, nameLines: nb ? nb.lines : 0, subLines: sb ? sb.lines : 0, hasSub: !!src, hasPencil: !!row.querySelector('[data-testid^="parcel-row-pencil-"]') });
  });
  const groups = [...panel.querySelectorAll('[data-testid^="parcels-group-"]:not([data-testid^="parcels-group-acres-"])')].map((g) => {
    const key = g.getAttribute("data-testid").replace("parcels-group-", ""); const lab = g.firstElementChild, ac = g.querySelector('[data-testid^="parcels-group-acres-"]');
    check(lab, `group label ${key}`); check(ac, `group acres ${key}`);
    acresRight.push({ id: "group:" + key, r: ac.getBoundingClientRect().right });
    return { key, label: lab.textContent, n: g.parentElement.querySelectorAll('[data-testid^="parcel-table-row-"]').length };
  });
  const sum = panel.querySelector('[data-testid="parcels-summary"]'), num = panel.querySelector('[data-testid="parcels-site-acres"]');
  const detail = {
    fs: { sum: getComputedStyle(sum).fontSize, num: getComputedStyle(num).fontSize, sumText: sum.textContent.trim() },
    spills: panel.scrollWidth > panel.clientWidth + 0.5,
    panelW: Math.round(panel.getBoundingClientRect().width),
  };
  const groupAcres = [...panel.querySelectorAll('[data-testid^="parcels-group-acres-"]')].map((e) => Number(e.textContent.replace(/,/g, "")));
  return { clipped, contrast, overlaps, rows, groups, acresRight, groupAcres, ...detail };
};

const openFixture = async (f, theme, width) => {
  await page.evaluate(([t, w]) => { localStorage.setItem("planyr.theme", t); localStorage.setItem("planarfit:leftWidth", String(w)); localStorage.setItem("planarfit:currentSite:v1", "x"); }, [theme, width]);
  await page.evaluate((id) => localStorage.setItem("planarfit:currentSite:v1", id), "zz-pl-" + f.tag);
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" }); await page.reload({ waitUntil: "load" }); await sleep(SIGNED ? 3000 : 1800);
  if (!(await T("planner-canvas").isVisible().catch(() => false))) await page.getByText(f.title, { exact: false }).first().click();
  await T("planner-canvas").waitFor({ timeout: 25000 }); await sleep(1200);
  await page.locator('[data-rail-tab="parcel"]').first().click();
  await T("parcels-panel").waitFor({ timeout: 15000 }); await sleep(500);
};

try {
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  if (SIGNED) { await seed(); await page.reload({ waitUntil: "load" }); await sleep(3000); }
  await assertMeasurable(page, "verify-parcel-list-layout");
  console.log("served build", await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build));
  for (const f of FIX) for (const theme of THEMES) for (const width of WIDTHS) {
    const tag = `${f.tag}/${theme}/${width}`;
    await openFixture(f, theme, width);
    if ((await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) !== theme && theme === "dark") throw new Error(`VOID: ${tag} — the dark theme did not apply`);
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
    const types = new Map(); m.rows.forEach((r) => { const k = `${r.hasSub ? 1 : 0}/${r.nameLines}/${r.subLines}`; (types.get(k) || types.set(k, []).get(k)).push(r.h); });
    const nonUniform = [...types].filter(([, hs]) => Math.max(...hs) - Math.min(...hs) > 1).map(([k, hs]) => `${k}: ${Math.min(...hs).toFixed(1)}–${Math.max(...hs).toFixed(1)}`);
    ok(`${tag}: row heights are consistent within each row type (${types.size} types)`, nonUniform.length === 0, nonUniform.join(" | "));
    const single = types.get("0/1/0");
    if (single) { const base = single[0]; const bad = [...types].filter(([k, hs]) => { const [s, n, u] = k.split("/").map(Number); const extra = (n - 1) + (u > 1 ? u - 1 : 0); return extra > 0 && !s ? Math.abs(hs[0] - base - extra * 17) > 2 : false; }); ok(`${tag}: a wrapped name adds only whole line heights`, bad.length === 0, bad.map(([k, hs]) => `${k}=${hs[0]}`).join(" | ")); }
    const sumAc = Number(m.fs.sumText.split(" ")[0].replace(/,/g, "")), grpAc = m.groupAcres.reduce((a, b) => a + b, 0);
    ok(`${tag}: the summary total equals the sum of the group totals (non-overlapping fixture)`, Math.abs(sumAc - grpAc) < 0.06, `${sumAc} vs ${grpAc.toFixed(2)}`);
    ok(`${tag}: the summary number is the same size as the words around it`, m.fs.num === m.fs.sum, `${m.fs.num} vs ${m.fs.sum} — "${m.fs.sumText}"`);
    ok(`${tag}: text clears 4.5:1`, m.contrast.length === 0, m.contrast.slice(0, 3).join(" | "));
    ok(`${tag}: the panel never scrolls sideways (${m.panelW}px wide)`, !m.spills);
    if (SHOTS) await T("parcels-panel").screenshot({ path: `${SHOTS}/${tag.replace(/\//g, "-")}.png` });
  }
  // eye/⋯ reveal contract on the Silvestri-shaped plan: hidden at rest, shown on hover; inactive eye always shown.
  await openFixture(FIX[1], "light", 320);
  const op = (id) => T(id).evaluate((e) => Number(getComputedStyle(e).opacity));
  await page.mouse.move(5, 5); await sleep(300);
  ok("at rest the eye of an ACTIVE row is hidden", (await op("parcel-row-eye-e1")) < 0.1);
  ok("the eye of an INACTIVE row is always visible", (await op("parcel-row-eye-e3")) > 0.9);
  await T("parcel-table-row-e1").hover(); await sleep(350);
  ok("hovering a row shows its eye and ⋯", (await op("parcel-row-eye-e1")) > 0.9 && (await op("parcel-row-more-e1")) > 0.9);
  ok("a row shows no padlock until it is locked", (await T("parcel-row-lock-e1").count()) === 0);
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
