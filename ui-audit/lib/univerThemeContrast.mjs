/* Univer grid theme contrast — the measuring half, shared by verify-univer-theme-contrast (sandbox host) and
 * verify-univer-theme-live (the real signed-in app). PIXELS, not stylesheets: Univer repaints its canvas through its own
 * dark-mode colour inversion, so computed styles cannot say what lands on screen. See the sandbox harness header for the method. */
import { decodePng } from "./pngDiff.mjs";

export const TEXT = 4.5, ICON = 3.0, LINE_MIN = 1.08, LINE_MAX = 3.0;

// ── colour maths (WCAG 2.x relative luminance) ──────────────────────────────────────────────────────────────────────
const lin = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const ratio = (a, b) => { const [hi, lo] = lum(a) >= lum(b) ? [lum(a), lum(b)] : [lum(b), lum(a)]; return (hi + 0.05) / (lo + 0.05); };
const css = (c) => `rgb(${c.join(",")})`;

/** Ink contrast of a rectangle of a decoded screenshot: the region's background (modal colour) against its furthest pixel. */
export function inkContrast(img, rect) {
  const x0 = Math.max(0, Math.round(rect.x)), y0 = Math.max(0, Math.round(rect.y));
  const x1 = Math.min(img.width, Math.round(rect.x + rect.w)), y1 = Math.min(img.height, Math.round(rect.y + rect.h));
  if (x1 <= x0 || y1 <= y0) return { ratio: 0, bg: null, ink: null, empty: true };
  const counts = new Map(); const px = [];
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const i = (y * img.width + x) * img.channels; const c = [img.data[i], img.data[i + 1], img.data[i + 2]]; px.push(c);
    const k = c.join(","); counts.set(k, (counts.get(k) || 0) + 1);
  }
  let bg = null, best = -1; for (const [k, n] of counts) if (n > best) { best = n; bg = k.split(",").map(Number); }
  let ink = bg, top = 1; for (const c of px) { const r = ratio(c, bg); if (r > top) { top = r; ink = c; } }
  return { ratio: top, bg, ink };
}

// Tool icons only: the small dropdown chevrons (under 12px, 1px strokes) antialias to a lower peak and are not what the owner reported.
// ── what to measure, from the live DOM ────────────────────────────────────────────────────────────────────────────────
async function regions(page) {
  return page.evaluate(() => {
    const box = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
    const q = (s) => document.querySelector(s);
    const root = q(".planyr-univer");
    const canvas = q("canvas[id^='univer-sheet-main-canvas']"); const cr = canvas.getBoundingClientRect();
    // NEW-1 (B2574352): the Start / Formulas / Data / View row is ONE dropdown at the left of the single header strip.
    const dd = [...root.querySelectorAll('[data-u-comp="headerbar"] a[data-state]')].find((e) => e.getBoundingClientRect().width > 0);
    const icons = [...root.querySelectorAll('[data-u-comp="ribbon-toolbar"] button:not([disabled]) svg')].filter((e) => e.getBoundingClientRect().width >= 12).map(box);
    const fb = q('.planyr-univer [data-u-comp="formula-bar"]');
    const dn = q('.planyr-univer [data-u-comp="defined-name"]'), fe = q('.planyr-univer [data-u-comp="formula-editor"]');
    const strip = q('.planyr-univer [data-u-comp="headerbar"]');
    const radii = [strip, ...strip.querySelectorAll("*")].map((e) => getComputedStyle(e)).filter((s) => parseFloat(s.borderTopLeftRadius) > 0 || (s.boxShadow && s.boxShadow !== "none"));
    return {
      stripBox: box(strip), rootBox: box(root), flatViolations: radii.length,
      tabs: { "Start ▾ dropdown": dd ? box(dd) : null },
      icons, definedName: dn ? box(dn) : null, formulaEditor: fe ? box(fe) : null, formulaBar: fb ? box(fb) : null,
      toolbar: box(q('.planyr-univer [data-u-comp="ribbon-toolbar"]')),
      colHeader: { x: cr.x + 46 + 4, y: cr.y + 1, w: 112, h: 18 },         // column "A" label
      rowHeader: { x: cr.x + 2, y: cr.y + 20 + 2, w: 42, h: 20 },            // row "1" label
      sheetTab: (() => { const t = q('.planyr-univer [data-u-comp="slide-tab-item"]'); return t ? box(t) : { x: 0, y: 0, w: 0, h: 0 }; })(),
      cellA1: { x: cr.x + 46 + 2, y: cr.y + 20 + 2, w: 116, h: 18 },
      cellB2: { x: cr.x + 46 + 124, y: cr.y + 20 + 24, w: 112, h: 18 },      // an empty cell: its background
      lineAt: { x: cr.x + 46 + 120, y: cr.y + 20 + 60 },                       // a vertical grid line between B and C
      cell: { x: cr.x + 46, y: cr.y + 20 },
    };
  });
}

export async function setTheme(page, theme) { await page.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme); await page.waitForTimeout(700); }
async function typeA1(page) {
  await page.evaluate(() => { const api = window.__planyrUniverRead.api(); const ws = api.getActiveWorkbook().getActiveSheet(); ws.getRange("A1").setValue("Hello"); ws.getRange("A1").activate(); });
  await page.waitForTimeout(500);
}
async function colours(page) {
  return page.evaluate(() => {
    const root = document.querySelector(".planyr-univer"); const cs = (e) => (e ? getComputedStyle(e) : null);
    const eff = (e) => { for (let n = e; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") return c; } return "rgb(255, 255, 255)"; };
    const tb = root.querySelector('[data-u-comp="ribbon-toolbar"] button:not([disabled]) svg');
    const st = [...root.querySelectorAll('[data-u-comp="headerbar"] a[data-state]')].find((e) => e.getBoundingClientRect().width > 0) || root.querySelector('[data-u-comp="headerbar"]');
    return { theme: document.documentElement.dataset.theme, univerDark: document.documentElement.classList.contains("univer-dark"),
      toolbarIconColor: tb ? cs(tb).color : null, toolbarBg: tb ? eff(tb) : null, stripBg: eff(st), appSurface: cs(root).backgroundColor };
  });
}

export async function scenario(page, name, steps) {
  const results = []; const rec = (id, label, ok, detail) => results.push({ id, label, ok, detail });
  const shot = async () => decodePng(await page.screenshot());
  const R = await regions(page);
  const img = await shot();
  const ink = (rect) => inkContrast(img, rect);
  const fmt = (m) => `${m.ratio.toFixed(2)}:1 (${m.ink ? css(m.ink) : "?"} on ${m.bg ? css(m.bg) : "?"})`;

  // known-good arm — the bottom sheet tab reads
  // (In the two FLIP scenarios a failing sheet tab is a real finding — the theme was not rebuilt — not a broken rig.)
  const arm = ink(R.sheetTab);
  rec(steps.length ? "sheet-tab" : "known-good-arm", "the bottom sheet tab reads" + (steps.length ? "" : " (known-good arm)"), arm.ratio >= TEXT, fmt(arm));
  await typeA1(page); await page.evaluate(() => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getRange("B2").activate()); await page.waitForTimeout(300);
  const cellText = inkContrast(decodePng(await page.screenshot()), R.cellA1);
  rec("cell-text", `typed grid text reads (≥ ${TEXT}:1)`, cellText.ratio >= TEXT, fmt(cellText));

  // Re-activate A1 so the formula bar and name box have content, then measure them.
  await page.evaluate(() => window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet().getRange("A1").activate()); await page.waitForTimeout(400);
  const img3 = decodePng(await page.screenshot());
  const I = (rect) => inkContrast(img3, rect);

  const icons = R.icons.map((r) => I(r)); const worst = icons.reduce((a, b) => (b.ratio < a.ratio ? b : a), { ratio: 99 });
  rec("toolbar-icons", `every enabled toolbar icon reads (≥ ${ICON}:1)`, icons.length > 5 && icons.every((m) => m.ratio >= ICON), `${icons.length} icons, worst ${fmt(worst)}`);
  for (const [t, r] of Object.entries(R.tabs)) { if (!r) { rec(`tab-${t}`, `${t} present`, false, "not found"); continue; } const m = I(r); rec(`tab-${t}`, `"${t}" label reads (≥ ${TEXT}:1)`, m.ratio >= TEXT, fmt(m)); }
  const ch = I(R.colHeader); rec("col-letter", `column letter reads (≥ ${TEXT}:1)`, ch.ratio >= TEXT, fmt(ch));
  const rh = I(R.rowHeader); rec("row-number", `row number reads (≥ ${TEXT}:1)`, rh.ratio >= TEXT, fmt(rh));
  if (R.definedName) { const m = I({ x: R.definedName.x + 2, y: R.definedName.y + 2, w: 44, h: R.definedName.h - 4 }); rec("name-box", `name box text reads (≥ ${TEXT}:1)`, m.ratio >= TEXT, fmt(m)); } else rec("name-box", "name box present", false, "not found");
  if (R.formulaEditor) { const m = I({ x: R.formulaEditor.x, y: R.formulaEditor.y + 2, w: 80, h: R.formulaEditor.h - 4 }); rec("formula-bar", `formula bar text reads (≥ ${TEXT}:1)`, m.ratio >= TEXT, fmt(m)); } else rec("formula-bar", "formula bar present", false, "not found");
  // hairline under the formula bar: visible, not glaring
  const below = I({ x: 300, y: R.formulaBar.y + R.formulaBar.h - 2, w: 400, h: 4 });
  rec("formula-bar-border", `formula bar has a visible hairline (${LINE_MIN}–${LINE_MAX}:1)`, below.ratio >= LINE_MIN && below.ratio <= LINE_MAX, fmt(below));
  // grid line: visible but not glaring
  const ln = I({ x: R.lineAt.x - 2, y: R.lineAt.y, w: 5, h: 4 });
  rec("grid-lines", `grid lines are visible and quiet (${LINE_MIN}–${LINE_MAX}:1)`, ln.ratio >= LINE_MIN && ln.ratio <= LINE_MAX, fmt(ln));
  // the header strip: flat, full width, and the tab dropdown on the same surface as the tools beside it (no bright pill on a dark header)
  const ddBox = R.tabs["Start ▾ dropdown"];
  const stripBg = ddBox ? inkContrast(img3, { x: ddBox.x, y: ddBox.y, w: ddBox.w, h: ddBox.h }).bg : null;
  const toolBg = inkContrast(img3, { x: 8, y: R.toolbar.y, w: 300, h: R.toolbar.h }).bg;
  rec("strip-flat", "header strip has no rounded corners or shadow", R.flatViolations === 0, `${R.flatViolations} rounded/shadowed parts`);
  rec("strip-full-width", "header strip spans the whole width", Math.abs(R.stripBox.w - R.rootBox.w) <= 1, `${Math.round(R.stripBox.w)} of ${Math.round(R.rootBox.w)}`);
  rec("strip-matches-toolbar", "tab dropdown is the same surface as the toolbar (no pill)", stripBg && toolBg && ratio(stripBg, toolBg) <= 1.25, `${stripBg ? css(stripBg) : "?"} vs ${toolBg ? css(toolBg) : "?"}`);
  return { name, results, colours: await colours(page) };
}

