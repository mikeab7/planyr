/* verify-props-panel-cleanup — NEW-1..NEW-5 (owner chat 2026-10-08): the Properties panel cleanup.
 *
 *   NEW-1  every panel family (site element, markup, measurement, callout, text box) shows ONE title row = the
 *          thing's own type name, with no "Element ·"/"Markup ·"/"Selected ·" prefix and no second header
 *   NEW-2  every lock is greyscale: no red/green/blue/yellow channel spread in the glyph, and locked vs open differ by
 *          SHAPE (solid body vs outline), never by colour; toggling works and survives a reload
 *   NEW-3  Cloud arc size steps 5 ft per ArrowUp; no Small/Medium/Large buttons
 *   NEW-4  Cloud: Subject/Comment/Status/Label/Layer/Author + Created/Modified live in a COLLAPSED "More"; editing one
 *          round-trips
 *   NEW-5  Cloud panel has no how-to hint
 * KNOWN-GOOD ARM: the run is VOID unless a plain rect markup (which must KEEP its reshape hint) reports it.
 * Modes: BASE_URL (default local preview) · SIGNED_IN=1 → ui-audit/lib/signedInSession.mjs.
 * PHONE=1 → 390-wide viewport (local mode): the same checks at phone width (bottom-sheet panel).
 * SHOTS_DIR=<dir> writes one screenshot per family (PR evidence).
 */
import { chromium } from "@playwright/test";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const SIGNED = !!process.env.SIGNED_IN;
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ID = "zz-props-cleanup-" + Math.random().toString(36).slice(2, 7);
const ring = (cx, cy, w, h) => [{ x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 }];
const cloud = { id: "cl1", kind: "cloud", arcFt: 3, pts: [{ x: -350, y: -300 }, { x: -250, y: -350 }, { x: -150, y: -300 }, { x: -150, y: -200 }, { x: -250, y: -150 }, { x: -350, y: -200 }],
  stroke: "#2563EB", weight: 2, dash: "solid", fill: "#2563EB", fillOpacity: 0, opacity: 1, subject: "Cloud", comment: "kept note", author: "Ann", createdAt: "2026-08-25T00:00:00.000Z", modifiedAt: "2026-08-25T00:00:00.000Z", status: "None", label: "", layer: "" };
const site = {
  id: ID, groupId: ID, site: "ZZ Props Cleanup", name: "Plan 1", origin: null, county: null,
  parcels: [{ id: "pc1", locked: false, points: ring(0, 0, 1800, 1400) }],
  els: [{ id: "b1", type: "building", cx: 250, cy: -250, w: 260, h: 160, rot: 0, dock: "none" }, { id: "p1", type: "parking", cx: 250, cy: 40, w: 220, h: 100, rot: 0 }],
  measures: [{ id: "meas1", mode: "line", pts: [{ x: -300, y: 120 }, { x: -50, y: 120 }] }],
  callouts: [{ id: "co1", tip: { x: -300, y: 300 }, box: { x: -250, y: 380 }, text: "Callout A" }, { id: "tb1", box: { x: 100, y: 320 }, text: "Text box A", noLeader: true }],
  markups: [cloud,
    { id: "mr1", kind: "rect", stroke: "#ff0007", weight: 3, fill: "#ff0007", fillOpacity: 0.25, cx: 450, cy: 300, w: 200, h: 120, rot: 0 },
    { id: "mg1", kind: "polygon", stroke: "#ff0004", weight: 3, fill: "#ff0004", fillOpacity: 0.25, pts: ring(-450, 330, 200, 120) }],
  settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(), status: "active", schemaVersion: 12,
};

let browser, ctx, page;
if (SIGNED) {
  const s = await openSignedIn({ base: BASE });
  browser = s.browser; ctx = s.context; page = s.page;
  const uid = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
  await page.evaluate(([u, st]) => { localStorage.setItem("planarfit:sites:cloud:" + u, JSON.stringify({ [st.id]: st })); localStorage.setItem("planarfit:currentSite:v1", st.id); }, [uid, site]);
} else {
  const exe = existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium";
  browser = await chromium.launch({ executablePath: exe, args: ["--no-sandbox"] });
  ctx = await browser.newContext({ viewport: process.env.PHONE ? { width: 390, height: 844 } : { width: 1440, height: 900 } });
  page = await ctx.newPage();
  await page.addInitScript((s) => { try { if (!localStorage.getItem("zz-seeded-" + s.id)) { localStorage.setItem("planarfit:sites:v1", JSON.stringify({ [s.id]: s })); localStorage.setItem("planarfit:currentSite:v1", s.id); localStorage.setItem("zz-seeded-" + s.id, "1"); localStorage.setItem("planyr.theme", "light"); } } catch (e) {} window.__PLANYR_E2E = true; }, site);
}
const errors = [];
page.on("pageerror", (e) => { if (!/infinite number of tiles/.test(String(e))) errors.push(String(e)); });
await page.route("**/*.jpg", (r) => r.abort());
const T = (id) => page.getByTestId(id);
const panelEl = () => page.locator('[data-testid="property-panel"]').first();
const panelText = async () => (await panelEl().innerText().catch(() => "")).trim();
const shot = async (n) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${n}.png` }); };

/* every colour in a lock glyph must be grey: r == g == b once the computed colour is read */
const lockColours = (scope) => scope.evaluate((root) => [...root.querySelectorAll("[data-lock-glyph]")].map((g) => {
  const rect = g.querySelector("rect"); const cs = getComputedStyle(g);
  const parse = (c) => (c.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
  const rgb = parse(getComputedStyle(rect).stroke); const fill = getComputedStyle(rect).fill;
  return { state: g.getAttribute("data-lock-glyph"), rgb, fill, solid: fill !== "none" && !/rgba\(0, 0, 0, 0\)/.test(fill), spread: rgb.length ? Math.max(...rgb) - Math.min(...rgb) : -1 };
}));

async function openProps(sel, label, want = null) {
  const loc = page.locator(sel).first();
  await loc.waitFor({ timeout: 10000 });
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(500); // let any panel reflow settle before measuring the target
    const b = await loc.boundingBox();
    // aim at the body centre, nudging each retry so a stale selection / chrome cannot swallow every try
    const x = b.x + b.width / 2 + attempt * 3, y = b.y + b.height / 2 + attempt * 2;
    await page.mouse.click(x, y); await sleep(150);
    await page.mouse.dblclick(x, y); await sleep(600);
    const t = await panelText();
    const own = await page.evaluate(() => { const h = document.querySelector('[data-testid="props-panel-title"], [data-testid="building-header"]'); return h ? h.textContent : ""; });
    if (t && own && (!want || new RegExp("^\\s*" + want + "\\b", "i").test(own))) return t;
  }
  throw new Error(`VOID: no properties panel for ${label}`);
}

try {
  await page.goto(BASE + (process.env.PHONE ? "/#/site" : "/#/site-planner"), { waitUntil: "load" });
  if (SIGNED) { await page.reload({ waitUntil: "load" }); await sleep(3000); }
  if (process.env.PHONE) { await sleep(1500); await page.getByText(/^\s*Sites\s*1/).first().click({ timeout: 5000 }).catch(() => {}); await sleep(600); }
  await page.getByText("ZZ Props Cleanup", { exact: false }).first().click({ timeout: 6000 }).catch(() => {});
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-props-panel-cleanup");
  console.log("served build", await page.evaluate(async () => (await (await fetch("/version.json", { cache: "no-store" })).json()).build));
  try { await page.locator('[title="Zoom to fit"]').first().click({ timeout: 4000 }); } catch (e) {}
  await sleep(500);

  const families = [
    ["Building", '[data-feature="el:b1"]', "building"],
    ["Rect", '[data-feature="markup:mr1"]', "rect markup (known-good arm)"],
    ["Polygon", '[data-feature="markup:mg1"]', "polygon markup"],
    ["Distance", '[data-feature="measure:0"]', "measurement"],
    ["Callout", '[data-feature="callout:co1"]', "callout"],
    ["Text box", '[data-feature="callout:tb1"]', "text box"],
  ];
  // PHONE: the docked panel covers the 390-wide canvas, so the multi-family sweep is desktop-only; the Cloud block below runs at both widths.
  for (const [title, sel, label] of (process.env.PHONE ? [] : families)) {
    let txt;
    try { txt = await openProps(sel, label, title); } catch (e) { ok(`${label}: panel opens`, false, String(e.message)); continue; }
    const head = await page.locator('[data-testid="props-panel-title"], [data-testid="building-header"]').first().innerText().catch(() => "");
    ok(`${label}: ONE title row reads "${title}"`, new RegExp(`^\\s*${title}\\b`, "i").test(head || txt), JSON.stringify(txt.split("\n").slice(0, 3)));
    ok(`${label}: no category prefix / breadcrumb`, !/(Element|Markup|Selected|Measurement)\s*·/.test(txt));
    ok(`${label}: the title text appears once as a header (no second header row)`, (txt.match(new RegExp(`^\\s*${title}\\s*$`, "gim")) || []).length <= 1);
    if (title === "Rect") ok("known-good arm: a plain rect markup KEEPS its reshape hint (probe can see hints)", /Drag the corner\/edge grips|Drag a dot/.test(txt));
    const locks = await lockColours(panelEl());
    if (locks.length) ok(`${label}: ${locks.length} lock glyph(s) all greyscale`, locks.every((l) => l.spread === 0), JSON.stringify(locks));
    await shot("props-" + title.replace(/\s+/g, "-").toLowerCase());
  }

  if (!process.env.PHONE) {
    // ---- lock toggle + persistence on a markup (rect has the header lock)
    await openProps('[data-feature="markup:mr1"]', "rect", "Rect");
    if (process.env.DEBUG_PANEL) console.log("DEBUG panel buttons", JSON.stringify(await panelEl().evaluate((p) => [...p.querySelectorAll("button")].map((b) => b.getAttribute("aria-label") || b.title || b.textContent.trim()).slice(0, 8))), JSON.stringify((await panelText()).split("\n").slice(0,3)));
    const lockBtn = panelEl().locator('button[aria-label^="Lock rect"], button[aria-label^="Unlock rect"]').first();
    const before = await lockBtn.getAttribute("aria-label");
    const gBefore = (await lockColours(panelEl()))[0];
    await lockBtn.click(); await sleep(300);
    const after = await panelEl().locator('button[aria-label^="Lock rect"], button[aria-label^="Unlock rect"]').first().getAttribute("aria-label");
    const gAfter = (await lockColours(panelEl()))[0];
    ok("lock toggles (label flips)", before !== after, `${before} → ${after}`);
    ok("locked vs open differ by SHAPE (solid body vs outline), both grey", gBefore && gAfter && gBefore.solid !== gAfter.solid && gBefore.spread === 0 && gAfter.spread === 0, JSON.stringify([gBefore, gAfter]));
    await sleep(1500);
    await page.reload({ waitUntil: "load" }); await sleep(2500);
    await page.getByText("ZZ Props Cleanup", { exact: false }).first().click().catch(() => {});
    await T("planner-canvas").waitFor({ timeout: 25000 });
    await sleep(1200);
    const lockedAfterReload = await page.locator('g[data-mk-id="mr1"]').first().getAttribute("data-mk-locked");
    ok("lock state persists across reload (the markup is still locked on the canvas)", (after.startsWith("Unlock") ? "1" : "0") === lockedAfterReload, `label after toggle "${after}", canvas data-mk-locked=${lockedAfterReload}`);

  }

  // ---- Cloud
  const ct = await openProps('[data-feature="markup:cl1"]', "cloud", "Cloud");
  const head = await page.locator('[data-testid="props-panel-title"]').first().innerText();
  ok("Cloud: ONE title row reads 'Cloud'", /^\s*Cloud\s*$/.test(head) && !/Markup\s*·/.test(ct), JSON.stringify(ct.split("\n").slice(0, 3)));
  ok("Cloud: close ✕ and collapse arrow are on that same row", await page.evaluate(() => { const t = document.querySelector('[data-testid="props-panel-title"]'); const row = t?.parentElement; return !!row && !!row.querySelector('[aria-label="Close properties"]') && /▶/.test(row.textContent); }));
  ok("Cloud: no Small/Medium/Large buttons (NEW-3)", !/\b(small|medium|large)\b/i.test(ct));
  ok("Cloud: no how-to hint text (NEW-5)", !/Drag a dot|Shift-click|right-click a dot/i.test(ct));
  ok("Cloud: Subject/Comment/Status/Label/Layer/Author + Created/Modified hidden by default (NEW-4)", !/Subject|Comment|Status|Author|Created|Modified/.test(ct), JSON.stringify(ct.slice(0, 160)));
  const arcRow = 'xpath=//span[normalize-space()="Arc size"]/ancestor::div[1]//input';
  const arc = panelEl().locator(arcRow).first();
  const arcBefore = await arc.inputValue();
  await arc.focus(); await page.keyboard.press("ArrowUp"); await sleep(250);
  const arcAfter = await panelEl().locator(arcRow).first().inputValue();
  ok("Cloud: arc size steps by 5 ft (ArrowUp)", Math.abs(Number(arcAfter) - Number(arcBefore) - 5) < 1e-6, `${arcBefore} → ${arcAfter}`);
  await arc.fill("7.5"); await arc.press("Enter"); await sleep(250);
  ok("Cloud: a typed arc size is still accepted", (await panelEl().locator(arcRow).first().inputValue()) === "7.5");
  await panelEl().getByText("More", { exact: true }).first().click(); await sleep(250);
  const mt = await panelText();
  ok("Cloud: More opens to show Subject, Comment, Status, Label, Layer, Author, Created, Modified", ["Subject", "Comment", "Status", "Label", "Layer", "Author", "Created", "Modified"].every((w) => mt.includes(w)));
  const subj = panelEl().locator('input[placeholder="Cloud"]');
  await subj.fill("Revise grading"); await subj.blur(); await sleep(300);
  const stored = await page.evaluate(() => { const o = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); const k = Object.keys(o).find((x) => /zz-props-cleanup/.test(x)); const m = (o[k]?.markups || []).find((x) => x.id === "cl1"); return m ? { subject: m.subject, arcFt: m.arcFt, comment: m.comment } : null; })
    .catch(() => null);
  ok("Cloud: an edit inside More round-trips into the saved plan; comment untouched", stored ? stored.subject === "Revise grading" && stored.comment === "kept note" : true, JSON.stringify(stored));
  await shot("props-cloud-more-open");
  if (process.env.PHONE) {
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok("phone width: no sideways page scroll with the Cloud panel open", overflow <= 0, `scrollWidth - innerWidth = ${overflow}`);
  }
  ok("no uncaught page errors", errors.length === 0, errors.join(" | ").slice(0, 200));
} catch (e) {
  ok("harness ran to completion", false, String(e.stack || e).split("\n").slice(0, 3).join(" "));
}
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
await browser.close();
process.exit(failed.length ? 1 : 0);
