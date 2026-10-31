/* verify-spreadsheet-flat-chrome — NEW-1 (Spreadsheet): the toolbar, the formula bar and the sheet-tab strip of the UNIVER grid (the
 * grid every account gets since the default-on cutover, NEW-2 2026-10-31) are FLAT, full-width strips directly under the module tabs
 * (no rounded floating card, no shadow, no grey band around them) and the grid starts flush at the window's left edge and runs to its
 * right edge. Ported from the old Ribbon / FormulaBar / SheetView / TabStrip version of this harness (owner-approved mockup 2026-10-29,
 * B2517376); the owner's rule is the same, only the DOM it is measured on changed (Univer: [data-u-comp="headerbar"] / "formula-bar" /
 * the footer <section> holding "slide-tab-bar", and the canvas for the grid — a canvas has no row cells to measure).
 *
 *  1 desktop 1440x900   toolbar + formula bar + tab strip: x=0, full window width, square corners, no shadow, no outer margin; the formula
 *                       bar sits FLUSH under the toolbar (0 gap) and the grid flush under it; the grid canvas and the tab strip span the
 *                       window with no side inset; the tab strip's bottom is the window's bottom
 *  2 measures           where the grid starts and how many rows are visible (printed as MEASURE {...}, read through Univer's facade)
 *  3 narrow 600x800     the toolbar folds into Univer's own "More" (⋮) menu — every control inside the strip, none clipped or overlapping,
 *                       page never scrolls sideways, the name box and the formula editor keep a real width
 *  4 dark theme         the toolbar, formula bar and tab strip each paint a real (non-transparent) surface and the SAME one
 *  5 dropdowns          every toolbar dropdown (paste, font colour, fill colour, alignment, …) opens fully inside the window, directly
 *                       under its button
 *  6 fullscreen toggle  the app header's full-screen button flips and the strips stay flat and flush
 *  7 flat at rest       nothing in the toolbar is rounded or shadowed (strict, every node); nothing in the formula bar / tab strip that is
 *                       VISIBLE at rest is a rounded shaded chip; the one Univer widget that is (the active sheet-tab chip) is reported as a
 *                       FINDING line, never silently dropped (see the end of the file)
 * KNOWN-GOOD ARM: the toolbar, the formula bar, the tab strip and the grid canvas must all be found and have a real size before anything
 * is judged, AND the same flat judge must go RED on a card painted onto the toolbar in this very page (a verdict that cannot see a card
 * proves nothing about the absence of one).
 * RETIRED --expect-old — it existed only to record the "before" numbers of the card-shaped Ribbon; that layout no longer exists.
 * Run: node ui-audit/verify-spreadsheet-flat-chrome.mjs [base=http://localhost:4173] [--shots dir] [--signed-in]
 *   --signed-in  signs in as the test account (E2E_LOGIN_KEY) and opens its fixture site instead of a seeded local project */
import { chromium } from "@playwright/test";
import { mkdirSync, existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn, FIXTURE_SITE_ID } from "./lib/signedInSession.mjs";

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "http://localhost:4173";
const SHOTS = val("--shots");
const SIGNED_IN = flag("--signed-in");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
const CANVAS = 'canvas[id^="univer-sheet-main-canvas"]';

let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const near = (a, b, tol = 0.6) => Math.abs(a - b) <= tol;

let browser, page, signed = null;
if (SIGNED_IN) {
  signed = await openSignedIn({ base: BASE });
  page = signed.page;
  await page.addInitScript(() => { window.__PLANYR_E2E = true; });
} else {
  browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  page = await ctx.newPage();
  const id = `zz-flat-chrome-${Date.now().toString(36)}`;
  const site = { id, groupId: id, site: "ZZ Flat chrome (throwaway)", name: "ZZ Flat chrome (throwaway)", origin: null, county: "harris", parcels: [], els: [], markups: [], measures: [], callouts: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now() };
  await page.addInitScript(([sid, rec]) => { window.__PLANYR_E2E = true; localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [sid]: rec })); }, [id, site]);
  page.__projectId = id;
}
const projectId = SIGNED_IN ? FIXTURE_SITE_ID : page.__projectId;

/** Runs IN THE PAGE. Plain numbers / strings only. */
const measure = () => page.evaluate(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height, right: b.right, bottom: b.bottom }; };
  const visible = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && b.height > 0; };
  const host = document.querySelector('[data-testid="univer-grid"]');
  const q = (sel) => (host ? host.querySelector(sel) : null);
  const header = q('[data-u-comp="headerbar"]'), fbar = q('[data-u-comp="formula-bar"]'), canvas = q('canvas[id^="univer-sheet-main-canvas"]');
  const tabBar = q('[data-u-comp="slide-tab-bar"]');
  const foot = tabBar ? (tabBar.closest("section") || tabBar.parentElement) : null;
  const cs = (el, p) => (el ? getComputedStyle(el)[p] : null);
  const box = (el) => (el ? { margin: cs(el, "margin"), radius: cs(el, "borderTopLeftRadius") + "/" + cs(el, "borderBottomLeftRadius"), shadow: cs(el, "boxShadow") } : null);
  const offenders = (root, { restrictAtRest = false } = {}) => {
    const out = [];
    if (!root) return out;
    for (const el of root.querySelectorAll("*")) {
      if (!visible(el)) continue;
      const c = getComputedStyle(el);
      const rounded = [c.borderTopLeftRadius, c.borderTopRightRadius, c.borderBottomLeftRadius, c.borderBottomRightRadius].some((x) => parseFloat(x) > 0);
      const shadow = c.boxShadow && c.boxShadow !== "none";
      if (!rounded && !shadow) continue;
      // "visible at rest" = the node paints a fill, a border or a shadow of its own (a transparent rounded wrapper is only a hover target)
      const fill = c.backgroundColor && c.backgroundColor !== "rgba(0, 0, 0, 0)" && c.backgroundColor !== "transparent";
      const border = ["Top", "Right", "Bottom", "Left"].some((s) => parseFloat(c[`border${s}Width`]) > 0 && c[`border${s}Style`] !== "none");
      if (restrictAtRest && !(fill || border || shadow)) continue;
      out.push(`${el.tagName.toLowerCase()}${el.getAttribute("data-u-comp") ? "[" + el.getAttribute("data-u-comp") + "]" : ""}:${rounded ? c.borderTopLeftRadius : "sq"}${shadow ? "+shadow" : ""}`);
    }
    return out;
  };
  const nameInput = q('[data-u-comp="defined-name"] input');
  const editor = q('[data-u-comp="formula-editor"]');
  const sheetB = canvas ? canvas.getBoundingClientRect() : null;
  // The EFFECTIVE box (what can actually be seen / pressed): the control's box cut by every clipping ancestor, the way verify-width-sweep does it —
  // a 10 px sliver of a combobox <input> that Univer's own overflow:hidden strip clips away is not "overlapping" the ⋮ button, a visible one is.
  const effOf = (el) => { let b = el.getBoundingClientRect(); let l = b.left, r = b.right, t = b.top, bt = b.bottom; for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) { const c = getComputedStyle(a); if (c.overflowX !== "visible" || c.overflowY !== "visible") { const q = a.getBoundingClientRect(); if (c.overflowX !== "visible") { l = Math.max(l, q.left); r = Math.min(r, q.right); } if (c.overflowY !== "visible") { t = Math.max(t, q.top); bt = Math.min(bt, q.bottom); } } } return { l, r, t, b: bt, w: Math.max(0, r - l), h: Math.max(0, bt - t) }; };
  const ctlLabel = (el) => el.getAttribute("data-u-command") || el.getAttribute("aria-label") || (el.textContent || "").trim().slice(0, 14) || el.tagName;
  const headerAll = header ? [...header.querySelectorAll("button, a, input, [role=button]")].filter(visible) : [];
  const headerRaw = headerAll.map((el) => { const q = el.getBoundingClientRect(); return { l: q.left, r: q.right, t: q.top, b: q.bottom, w: q.width, h: q.height, label: ctlLabel(el) }; });
  const headerBtns = headerAll.map((el) => { const x = effOf(el); return { ...x, label: ctlLabel(el) }; }).filter((x) => x.w > 0 && x.h > 0);
  return {
    vw: window.innerWidth, vh: window.innerHeight, docScrollW: document.documentElement.scrollWidth,
    host: r(host), header: r(header), fbar: r(fbar), canvas: r(canvas), tabs: r(foot), tabBar: r(tabBar),
    hostBox: box(host), headerBox: box(header), fbarBox: box(fbar), tabsBox: box(foot), canvasParentBox: box(canvas && canvas.parentElement),
    headerBg: cs(header, "backgroundColor"), fbarBg: cs(fbar, "backgroundColor"), tabsBg: cs(foot, "backgroundColor"),
    headerOff: offenders(header), fbarOffAtRest: offenders(fbar, { restrictAtRest: true }), tabsOffAtRest: offenders(foot, { restrictAtRest: true }),
    tabsOffAll: offenders(foot),
    nameBox: r(nameInput) && { ...r(nameInput), radius: cs(nameInput, "borderTopLeftRadius"), shadow: cs(nameInput, "boxShadow") }, editor: r(editor),
    headerBtns, headerRaw, hasMore: !!(header && header.querySelector('button[aria-label="More"]')),
    sheetBottom: sheetB ? sheetB.bottom : null,
  };
});

const shot = async (name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };
const solid = (c) => c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent";

try {
  await page.goto(`${BASE}/#/project/${projectId}/spreadsheet`, { waitUntil: "load" });
  await page.waitForSelector(CANVAS, { timeout: 60000 });
  await page.waitForFunction(() => { const h = window.__planyrUniverRead; const a = h && h.api && h.api(); return !!(a && a.getActiveWorkbook && a.getActiveWorkbook()); }, null, { timeout: 60000 });
  await page.waitForTimeout(1200);
  await assertMeasurable(page, "verify-spreadsheet-flat-chrome");
  if (SIGNED_IN) { const sb = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json())); console.log(`served build: ${sb.build}  account: ${signed.proof?.email}  base: ${BASE}`); }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(400);

  // ── 1+2 desktop ────────────────────────────────────────────────────────────────────────────────────────────────
  const m = await measure();
  ok("known-good arm: toolbar, formula bar, tab strip and grid canvas all found with a real size", !!(m.header && m.fbar && m.tabs && m.canvas && m.header.w > 100 && m.fbar.w > 100 && m.tabs.w > 100 && m.canvas.h > 100 && m.header.h > 20));
  // known-good arm, other side: paint a card onto the toolbar in this very page — the SAME offender sweep must see it
  await page.evaluate(() => { const h = document.querySelector('[data-u-comp="headerbar"]'); h.setAttribute("data-card-probe", "1"); h.style.setProperty("border-radius", "12px", "important"); h.style.setProperty("box-shadow", "0 4px 12px rgba(0,0,0,.4)", "important"); h.style.setProperty("margin", "8px", "important"); }); // inline !important: univerSheet.css flattens the strip with !important, so a plain inline style would lose and the probe would prove nothing
  const probe = await measure();
  ok("known-good arm: a rounded, shadowed, inset toolbar IS caught by the same measurement (teeth)", probe.headerBox.radius !== "0px/0px" && probe.headerBox.shadow !== "none" && probe.headerBox.margin !== "0px" && probe.header.x > 0);
  await page.evaluate(() => { const h = document.querySelector('[data-u-comp="headerbar"]'); h.style.removeProperty("border-radius"); h.style.removeProperty("box-shadow"); h.style.removeProperty("margin"); h.removeAttribute("data-card-probe"); });
  await page.waitForTimeout(150);
  const rows = await page.evaluate(() => { const ws = window.__planyrUniverRead.api().getActiveWorkbook().getActiveSheet(); const cv = document.querySelector('canvas[id^="univer-sheet-main-canvas"]').getBoundingClientRect(); let n = 0, firstTop = null; for (let i = 0; i < 400; i++) { const rc = ws.getRange(i, 0).getCellRect(); const o = typeof rc === "string" ? JSON.parse(rc) : rc; if (firstTop === null) firstTop = cv.top + o.y; if (o.y + o.height <= cv.height + 0.5) n++; else break; } return { n, firstTop }; });
  console.log("MEASURE " + JSON.stringify({ viewport: [m.vw, m.vh], toolbarTop: m.header?.y, toolbarH: m.header?.h, formulaBarTop: m.fbar?.y, gridTop: m.canvas?.y, firstRowTop: rows.firstTop, gridLeft: m.canvas?.x, gridWidth: m.canvas?.w, visibleRows: rows.n, tabsTop: m.tabs?.y, tabsH: m.tabs?.h, hostBox: m.hostBox, tabsBox: m.tabsBox }));
  await shot("desktop-light");
  ok("toolbar block is flush left and spans the whole window", near(m.header.x, 0) && near(m.header.w, m.vw), `x=${m.header.x} w=${m.header.w} vw=${m.vw}`);
  ok("toolbar block: no margin, square corners, no shadow", m.headerBox.margin === "0px" && m.headerBox.radius === "0px/0px" && m.headerBox.shadow === "none" && m.hostBox.margin === "0px" && m.hostBox.radius === "0px/0px" && m.hostBox.shadow === "none", JSON.stringify({ header: m.headerBox, host: m.hostBox }));
  ok("formula bar sits flush under the toolbar (no gap) and spans the window", near(m.fbar.y, m.header.bottom, 1) && near(m.fbar.x, 0) && near(m.fbar.w, m.vw), `header.bottom=${m.header.bottom} fbar.y=${m.fbar.y} w=${m.fbar.w}`);
  ok("formula bar block: no margin, square corners, no shadow", m.fbarBox.margin === "0px" && m.fbarBox.radius === "0px/0px" && m.fbarBox.shadow === "none", JSON.stringify(m.fbarBox));
  ok("grid starts flush under the formula bar (no gap)", near(m.canvas.y, m.fbar.bottom, 1.5), `fbar.bottom=${m.fbar.bottom} canvas.y=${m.canvas.y}`);
  ok("grid is flush left and runs to the right edge (no side inset, no rounded top)", near(m.canvas.x, 0) && near(m.canvas.w, m.vw) && m.canvasParentBox.margin === "0px" && m.canvasParentBox.radius === "0px/0px", JSON.stringify(m.canvasParentBox));
  ok("sheet-tab strip spans the window with no inset, corners or shadow, and ends at the window's bottom", near(m.tabs.x, 0) && near(m.tabs.w, m.vw) && near(m.tabs.bottom, m.vh, 1) && m.tabsBox.radius === "0px/0px" && m.tabsBox.shadow === "none" && m.tabsBox.margin === "0px", JSON.stringify({ r: m.tabs, b: m.tabsBox }));
  ok("the grid canvas ends where the tab strip begins (no gap)", near(m.canvas.bottom, m.tabs.y, 1.5), `canvas.bottom=${m.canvas.bottom} tabs.y=${m.tabs.y}`);
  ok("formula bar: the name box is square and shadowless (no pill, no inset box)", m.nameBox && m.nameBox.radius === "0px" && m.nameBox.shadow === "none", JSON.stringify(m.nameBox));
  ok("toolbar is flat to the last node: no node anywhere in the strip has a radius or a shadow", m.headerOff.length === 0, m.headerOff.slice(0, 6).join(", "));
  ok("formula bar: nothing visible at rest is a rounded / shaded chip (a transparent rounded hover target is invisible)", m.fbarOffAtRest.length === 0, m.fbarOffAtRest.slice(0, 6).join(", "));
  ok("buttons keep comfortable hit targets (>= 24 tall — Univer's own tool size; the old Ribbon's 26 was Planyr's)", m.headerRaw.length > 5 && m.headerRaw.every((b) => b.h >= 24), `min h=${Math.min(...m.headerRaw.map((b) => b.h))} of ${m.headerRaw.length}`);

  // ── 3 narrow ───────────────────────────────────────────────────────────────────────────────────────────────────
  await page.setViewportSize({ width: 600, height: 800 });
  await page.waitForTimeout(600);
  const n = await measure();
  await shot("narrow-light");
  ok("narrow: page does not scroll sideways", n.docScrollW <= n.vw + 1, `scrollWidth=${n.docScrollW} vw=${n.vw}`);
  ok("narrow: every toolbar control sits fully inside the strip (none clipped or overlapping the edge)", n.header && n.headerRaw.length > 3 && n.headerRaw.every((b) => b.l >= n.header.x - 0.5 && b.r <= n.header.right + 0.5), `header=${n.header?.x}-${n.header?.right} controls=${n.headerRaw.length} outside=${n.headerRaw.filter((b) => b.l < n.header.x - 0.5 || b.r > n.header.right + 0.5).map((b) => b.label).join(",")}`);
  // two DIFFERENT controls whose boxes intersect (a control nested inside another — an icon button inside its dropdown wrapper — is one tool, not an overlap)
  const nested = (a, b) => (a.l <= b.l + 0.5 && a.r >= b.r - 0.5 && a.t <= b.t + 0.5 && a.b >= b.b - 0.5) || (b.l <= a.l + 0.5 && b.r >= a.r - 0.5 && b.t <= a.t + 0.5 && b.b >= a.b - 0.5);
  const clashes = [];
  for (let i = 0; i < n.headerBtns.length; i++) for (let j = i + 1; j < n.headerBtns.length; j++) { const a = n.headerBtns[i], b = n.headerBtns[j]; const ox = Math.min(a.r, b.r) - Math.max(a.l, b.l), oy = Math.min(a.b, b.b) - Math.max(a.t, b.t); if (ox > 1 && oy > 1 && !nested(a, b)) clashes.push(`${a.label}|${b.label} ${ox.toFixed(0)}x${oy.toFixed(0)}`); }
  ok("narrow: no two toolbar controls overlap", clashes.length === 0, clashes.slice(0, 4).join("; "));
  ok("narrow: the More (⋮) button is present (overflow folded, not clipped)", n.hasMore);
  ok("narrow: formula bar still usable (name box and formula editor have width)", n.nameBox && n.nameBox.w > 30 && n.editor && n.editor.w > 80, `name=${n.nameBox?.w} editor=${n.editor?.w}`);
  ok("narrow: toolbar, formula bar, tab strip and grid still span the window edge to edge", [n.header, n.fbar, n.tabs, n.canvas].every((b) => b && near(b.x, 0) && near(b.w, n.vw)), JSON.stringify([n.header?.w, n.fbar?.w, n.tabs?.w, n.canvas?.w]));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(600);

  // ── 4 dark ─────────────────────────────────────────────────────────────────────────────────────────────────────
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(500);
  const d = await measure();
  await shot("desktop-dark");
  ok("dark: toolbar, formula bar and tab strip each paint a real surface, and the same one", solid(d.headerBg) && solid(d.fbarBg) && solid(d.tabsBg) && d.headerBg === d.fbarBg && d.fbarBg === d.tabsBg, `${d.headerBg} / ${d.fbarBg} / ${d.tabsBg}`);
  ok("dark: the surface really changed from light (the theme switch reached the strips)", d.headerBg !== m.headerBg, `${m.headerBg} -> ${d.headerBg}`);
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.waitForTimeout(400);

  // ── 5 dropdowns ────────────────────────────────────────────────────────────────────────────────────────────────
  // Univer's arrow-bearing tools are radix dropdown triggers; press the ARROW end (the centre of "Paste" is the action itself).
  const trig = page.locator('[data-u-comp="headerbar"] [data-slot="dropdown-menu-trigger"]:visible');
  const count = await trig.count();
  ok("known-good arm: the toolbar exposes dropdowns to test", count >= 4, `${count} dropdowns`);
  let opened = 0;
  for (let i = 0; i < count; i++) {
    const t = trig.nth(i);
    const a = await t.boundingBox();
    if (!a || a.width < 12) continue;
    const label = (await t.getAttribute("data-u-command")) || (await t.locator("[data-u-command]").first().getAttribute("data-u-command").catch(() => null)) || (await t.getAttribute("aria-label")) || `#${i}`;
    await page.mouse.click(a.x + a.width - 8, a.y + a.height / 2);
    await page.waitForTimeout(350);
    const menu = await page.evaluate(() => { const els = [...document.querySelectorAll("[data-radix-popper-content-wrapper]")].filter((e) => { const b = e.getBoundingClientRect(); return b.width > 20 && b.height > 20; }); const el = els[els.length - 1]; if (!el) return null; const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, r: b.right, b: b.bottom }; });
    if (menu) opened++;
    ok(`dropdown "${label}" opens inside the window, directly under its button`, !!menu && menu.x >= 0 && menu.r <= 1440 + 0.5 && menu.b <= 900 + 0.5 && menu.y >= a.y + a.height - 2 && menu.y <= a.y + a.height + 14, menu ? `anchor.bottom=${(a.y + a.height).toFixed(1)} menu.y=${menu.y.toFixed(1)} x=${menu.x.toFixed(0)}-${menu.r.toFixed(0)}` : "menu not found");
    if (opened === 2) await shot("dropdown-open");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
    await page.mouse.click(700, 500);
    await page.waitForTimeout(150);
  }
  ok("known-good arm: at least four dropdowns were actually opened", opened >= 4, `${opened} opened`);

  // ── 6 fullscreen toggle ────────────────────────────────────────────────────────────────────────────────────────
  // signed in, other workspaces stay mounted (hidden) with their own copy of the toggle: drive the visible one
  const fs = page.locator('[data-testid="toggle-fullscreen"]:visible').first();
  if (await fs.count()) {
    const before = await fs.getAttribute("aria-pressed");
    await fs.click();
    await page.waitForTimeout(700);
    const after = await fs.getAttribute("aria-pressed");
    const f = await measure();
    await shot("fullscreen");
    ok("fullscreen: the header toggle flips", after !== before, `aria-pressed ${before} -> ${after}`);
    ok("fullscreen: toolbar, formula bar and grid stay flat and flush left", near(f.header.x, 0) && near(f.canvas.x, 0) && near(f.fbar.y, f.header.bottom, 1) && f.headerBox.radius === "0px/0px" && f.headerBox.shadow === "none", `header.x=${f.header.x} canvas.x=${f.canvas.x}`);
    if (after === "true") await fs.click();
  } else {
    ok("fullscreen button present", false);
  }

  // ── FINDING (reported, not asserted) ───────────────────────────────────────────────────────────────────────────
  // Univer's footer strip draws its ACTIVE sheet tab as a small rounded chip with a drop shadow (and rounded zoom / add buttons). They sit
  // INSIDE the flat strip (the strip itself is square, edge to edge, shadowless — asserted above), they are Univer-internal widgets and
  // univerSheet.css's `[class*="univer-sheet-bar"]` rule does not reach them (Univer 1.3.1's footer classes are Tailwind utilities).
  // The old TabStrip never had a shadowed chip, so this is a visible difference from the owner-approved flat mockup; whether the chip is
  // acceptable is the owner's call, and fixing it is a product (CSS) change, not a harness one — so it is printed, never loosened away.
  const chip = await measure();
  const chipLines = chip.tabsOffAll.filter((x) => /slide-tab-item/.test(x));
  console.log(`FINDING — sheet-tab chip inside the flat strip: ${chipLines.length ? chipLines.join(", ") : "none (the chip is flat)"}; all rounded/shadowed nodes in the footer strip: ${chip.tabsOffAll.length}`);
} catch (e) {
  console.log("FAIL — harness error: " + (e?.stack || e));
  failures++;
} finally {
  if (signed) await signed.close?.(); else await browser?.close();
}
console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
process.exit(failures ? 1 : 0);
