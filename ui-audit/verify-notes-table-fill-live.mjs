#!/usr/bin/env node
/* verify-notes-table-fill-live — V1899600 / B2456096 + B2456097. Signed in as the TEST account on a real deploy, on a
 * THROWAWAY page it creates and deletes (owner rule 15): a header row that is not row 1 (Michael's shape), Header row
 * pressed + Bold lit, the toggle, Fill / No fill, header + No fill, the right-click menu, the print sheet, the phone More
 * sheet (PHONE_ENGINE=webkit|chromium). Reads the live editor's own document (`window.__noteEditor.json()`, E2E-armed by an
 * init script) and COMPUTED style; persistence is re-read after a reload.
 *
 * `BASE_URL` (default https://planyr.io) · `EXPECT_BUILD=<sha>` fails if /version.json differs (read in the same run) ·
 * `SKIP_PHONE=1`. Known-good arm (a real bold mark lights B) VOIDS the run.
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { sweepNotesThrowaways } from "./lib/notesSweep.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const TITLE = "ZZ throwaway fill check " + Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const arm = [[() => { window.__PLANYR_E2E = true; }, undefined]];

async function open(opts = {}) {
  let s = null;
  for (let i = 0; i < 12 && !s; i++) {
    try { s = await openSignedIn({ base: BASE, initScripts: arm, ...opts }); }
    catch (e) { if (!/answered 5\d\d|Failed to fetch/.test(String(e)) || i === 11) throw e; console.log("sign-in route hiccup, retrying…"); await new Promise((r) => setTimeout(r, 15000)); }
  }
  return s;
}

/* ── the fixture: Michael's shape ── */
const para = (t, marks) => ({ type: "paragraph", content: t ? [{ type: "text", text: t, ...(marks ? { marks } : {}) }] : [] });
const cell = (t, kind = "tableCell") => ({ type: kind, attrs: { colspan: 1, rowspan: 1, colwidth: [150] }, content: [para(t)] });
const DOC = () => ({ type: "doc", content: [
  { type: "noteAnchor", attrs: { x: 40, y: 40, w: 520, h: null, aid: "tbl" }, content: [{ type: "table", content: [
    { type: "tableRow", content: [cell("Permit"), cell("Number"), cell("Authority")] },
    { type: "tableRow", content: [cell("TDLR TABS Compliance", "tableHeader"), cell("TABS2027000388", "tableHeader"), cell("Texas Dept of Licensing", "tableHeader")] },
    { type: "tableRow", content: [cell("Other permit"), cell("N-1"), cell("Some authority")] },
  ] }] },
  { type: "noteAnchor", attrs: { x: 40, y: 380, w: 520, h: null, aid: "bold" }, content: [para("Plain words here"), para("Truly bold words", [{ type: "bold" }])] },
  para(""),
] });

let s = null; let page = null;
if (!process.env.ONLY_PHONE) {
  s = await open({ contextOptions: { permissions: ["clipboard-read", "clipboard-write"] } });
  page = s.page;
  await assertMeasurable(page, "verify-notes-table-fill-live");
  const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
  console.log("signed in as", s.proof.email, "· served build", build.build);
  if (process.env.EXPECT_BUILD) ok(`served build is the merge commit ${process.env.EXPECT_BUILD}`, build.build === process.env.EXPECT_BUILD, JSON.stringify(build));
}

const live = () => page.evaluate(() => window.__noteEditor?.json?.() ?? null);
const findTable = (doc) => { let t = null; const w = (n) => { if (!n || t) return; if (n.type === "table") { t = n; return; } (n.content || []).forEach(w); }; w(doc); return t; };
const rowsOf = (doc) => (findTable(doc)?.content || []).map((r) => r.content.map((c) => ({ kind: c.type, bg: c.attrs?.background ?? null })));
const kinds = (doc) => rowsOf(doc).map((r) => r.map((c) => (c.kind === "tableHeader" ? "H" : "-")).join("")).join("|");
const settle = (ms = 900) => page.waitForTimeout(ms);
async function pointIn(needle) {
  const p = await page.evaluate((n) => {
    const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let node; while ((node = w.nextNode())) { const i = node.nodeValue.indexOf(n); if (i >= 0) { const r = document.createRange(); r.setStart(node, i + 1); r.collapse(true); const b = r.getBoundingClientRect(); return { x: Math.round(b.left) + 1, y: Math.round(b.top + b.height / 2) }; } }
    return null;
  }, needle);
  if (!p) throw new Error(`no "${needle}" on the page`);
  return p;
}
const clickAt = async (n) => { const p = await pointIn(n); await page.mouse.click(p.x, p.y); await page.waitForTimeout(250); };
const enter = async (n) => { await clickAt(n); await page.waitForTimeout(650); await clickAt(n); await page.waitForTimeout(300); };
const pressed = (id) => page.locator(`[data-testid="${id}"]`).first().getAttribute("aria-pressed");
const click = async (id) => { await page.locator(`[data-testid="${id}"]`).first().click(); await page.waitForTimeout(400); };
const css = (needle, prop) => page.evaluate(([n, pr]) => { const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT); let node; while ((node = w.nextNode())) if (node.nodeValue.includes(n)) { const c = node.parentElement.closest("td,th"); return c ? getComputedStyle(c)[pr] : null; } return null; }, [needle, prop]);
const NONE = /rgba\(0, 0, 0, 0\)|transparent/;

if (!process.env.ONLY_PHONE) try {
  await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
  await page.locator('[data-testid="notes-new-page"]').click();
  await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
  await page.locator('[data-testid="note-title"]').fill(TITLE);
  await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await settle(1200);
  await page.evaluate((d) => window.__noteEditor.setDoc(d), DOC());
  await settle(1500);
  ok("fixture seeded: row 2 all header, rows 1 and 3 plain", kinds(await live()) === "---|HHH|---", kinds(await live()));

  console.log("\n=== KNOWN-GOOD ARM ===");
  await enter("Truly bold words"); const armBold = await pressed("nt-bold");
  await enter("Plain words here"); const armPlain = await pressed("nt-bold");
  ok("B lit on a real bold run, off on plain text", armBold === "true" && armPlain === "false", `${armBold}/${armPlain}`);
  if (!(armBold === "true" && armPlain === "false")) { console.log("VOID: known-good arm failed"); throw new Error("void"); }

  console.log("\n=== NEW-1 — header row on row 2 ===");
  await enter("TABS2027000388");
  ok("Header row PRESSED in row 2", (await pressed("nt-header-row")) === "true");
  ok("button reads 'Header row'", /Header row/.test(await page.locator('[data-testid="nt-header-row"]').first().innerText()));
  ok("Bold LIT in the header cell (no mark stored)", (await pressed("nt-bold")) === "true");
  ok("Bold tooltip names the control", /header row: use Header row to change/i.test((await page.locator('[data-testid="nt-bold"]').first().getAttribute("aria-label")) || ""));
  await enter("Other permit");
  ok("row 3: Header row off, Bold off", (await pressed("nt-header-row")) === "false" && (await pressed("nt-bold")) === "false");
  await enter("TABS2027000388");
  await click("nt-header-row"); await settle();
  ok("ONE click: row 2 is plain, rows 1 and 3 untouched", kinds(await live()) === "---|---|---", kinds(await live()));
  ok("…renders as <td>, not bold", Number(await css("TABS2027000388", "fontWeight")) < 600);
  await click("nt-header-row"); await settle();
  ok("again: header again", kinds(await live()) === "---|HHH|---");
  await page.keyboard.press("Control+z"); await settle();
  ok("Ctrl+Z: one step back to plain", kinds(await live()) === "---|---|---", kinds(await live()));

  console.log("\n=== NEW-2 — fill ===");
  await page.evaluate((d) => window.__noteEditor.setDoc(d), DOC()); await settle(1200);
  await enter("Other permit");
  await click("nt-fill");
  const items = await page.evaluate(() => [...document.querySelectorAll('[data-testid="nt-fill-popover"] button')].map((b) => b.getAttribute("data-testid")));
  ok("popover: No fill first, then the tints", items[0] === "nt-fill-none" && items.length === 9, JSON.stringify(items));
  await click("nt-fill-yellow"); await settle(1200);
  ok("whole row filled, other rows untouched", JSON.stringify(rowsOf(await live()).map((r) => r.map((c) => c.bg))) === JSON.stringify([[null, null, null], [null, null, null], ["#fef08a", "#fef08a", "#fef08a"]]));
  ok("rendered tint + dark ink", (await css("Other permit", "backgroundColor")) === "rgb(254, 240, 138)" && (await css("Other permit", "color")) === "rgb(27, 30, 38)");
  await page.waitForTimeout(2500);            // let the save + cloud push land before the reload
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 30000 }); await settle(2500);
  ok("still filled after a reload", (await css("Other permit", "backgroundColor")) === "rgb(254, 240, 138)" && rowsOf(await live())[2].every((c) => c.bg === "#fef08a"));
  await enter("Other permit"); await click("nt-fill"); await click("nt-fill-none"); await settle(1200);
  ok("No fill clears it", rowsOf(await live())[2].every((c) => c.bg === null) && NONE.test(await css("Other permit", "backgroundColor")));

  console.log("\n--- header row + No fill ---");
  await enter("TABS2027000388");
  ok("(header shade is on by default)", !NONE.test(await css("TABS2027000388", "backgroundColor")));
  await click("nt-fill"); await click("nt-fill-none"); await settle(1200);
  ok("no shade, still a header (explicit transparent)", rowsOf(await live())[1].every((c) => c.kind === "tableHeader" && c.bg === "transparent") && NONE.test(await css("TABS2027000388", "backgroundColor")));
  ok("Header row still pressed", (await pressed("nt-header-row")) === "true");

  console.log("\n--- right-click menu ---");
  await enter("Other permit");
  { const p = await pointIn("Other permit"); await page.mouse.click(p.x, p.y, { button: "right" }); await page.waitForTimeout(500); }
  ok("menu has Header row and Fill ▸", (await page.locator('[data-testid="note-menu-header-row"]').count()) === 1 && (await page.locator('[data-testid="note-menu-fill"]').count()) === 1);
  await page.locator('[data-testid="note-menu-fill"]').hover(); await page.waitForTimeout(300);
  await page.locator('[data-testid="note-menu-fill-green"]').click(); await settle(1200);
  ok("a tint picked from the menu fills the row", rowsOf(await live())[2].every((c) => c.bg === "#bbf7d0"));

  console.log("\n--- print sheet ---");
  await page.locator('[data-testid="notes-header-export"]').click(); await page.waitForTimeout(300);
  await page.locator('[data-testid="notes-header-export-print"]').click(); await page.waitForTimeout(2000);
  const printed = await page.evaluate(() => { const d = document.querySelector('[data-testid="notes-print-frame"]')?.contentDocument; if (!d) return null; const td = [...d.querySelectorAll("td")].find((x) => x.textContent.includes("Other permit")); return td?.getAttribute("style") || ""; });
  ok("the print sheet carries the fill", !!printed && /background-color:\s*(#bbf7d0|rgb\(187,\s*247,\s*208\))/i.test(printed), String(printed));
  ok("no page error", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
} catch (e) {
  if (String(e).includes("void")) { fail++; } else { fail++; console.log("  ✗ run aborted:", String(e).slice(0, 300)); }
} finally {
  await s.close();
}
/* ── PHONE (one signed-in browser at a time) ── */
if (!process.env.SKIP_PHONE) {
  const engine = process.env.PHONE_ENGINE || "webkit";
  console.log(`\n=== PHONE — ${engine}, iPhone descriptor ===`);
  let ps = null;
  try {
    ps = await open({ engine, device: engine === "webkit" ? "iPhone 14" : "Pixel 7", contextOptions: {} });
    page = ps.page; s = ps;
    await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="note-body"], [data-testid="notes-new-page"]', { timeout: 40000 });
    await page.waitForTimeout(1500);
    // A phone shows ONE pane: if a page is open, the list is behind Back (carry-forward: two notes-new-page buttons, one hidden).
    const back = page.locator('[data-testid="notes-mobile-back"]:visible').first();
    if (await back.count()) { await back.tap(); await page.waitForTimeout(800); }
    await page.locator('[data-testid="notes-new-page"]:visible').first().tap();
    await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
    await page.locator('[data-testid="note-title"]').fill(TITLE);
    await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
    await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 }); await page.waitForTimeout(1500);
    await page.evaluate((d) => window.__noteEditor.setDoc(d), DOC()); await page.waitForTimeout(1200);
    const tap = async (needle) => { const p = await pointIn(needle); await page.touchscreen.tap(p.x, p.y); await page.waitForTimeout(500); };
    await tap("Other permit"); await tap("Other permit");
    await page.locator('[data-testid="nt-more"]').first().tap(); await page.waitForTimeout(500);
    ok(`[${engine}] More sheet carries Header row and Fill`, (await page.locator('[data-testid="nt-header-row"]:visible').count()) === 1 && (await page.locator('[data-testid="nt-fill"]:visible').count()) === 1);
    const bb = await page.locator('[data-testid="nt-fill"]').first().boundingBox();
    ok(`[${engine}] Fill is a ≥44 tap target`, !!bb && bb.height >= 44, JSON.stringify(bb));
    await page.locator('[data-testid="nt-fill"]').first().tap(); await page.waitForTimeout(400);
    const vis = await page.evaluate(() => { const el = document.querySelector('[data-testid="nt-fill-popover"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { l: r.left, r: r.right, b: r.bottom, w: innerWidth, h: innerHeight }; });
    ok(`[${engine}] swatch popover fully on screen`, !!vis && vis.l >= 0 && vis.r <= vis.w && vis.b <= vis.h, JSON.stringify(vis));
    await page.locator('[data-testid="nt-fill-blue"]').first().tap(); await page.waitForTimeout(1200);
    ok(`[${engine}] a tapped swatch fills the caret row`, rowsOf(await live())[2].every((c) => c.bg === "#bfdbfe"), JSON.stringify(rowsOf(await live())[2]));
    /* WebKit logs the app's background county-GIS probes (third-party hosts without CORS headers, e.g. gisclient.quiddity.com) as
     * "Fetch API cannot load … due to access control checks" on ANY page, Notes or not — environmental, not this feature. Named, not hidden. */
    const real = ps.errors.filter((e) => !/access control checks/.test(e));
    ok(`[${engine}] no page error (third-party GIS CORS noise excluded: ${ps.errors.length - real.length})`, real.length === 0, real.slice(0, 3).join(" | "));
  } catch (e) { fail++; console.log("  ✗ phone arm aborted:", String(e).slice(0, 300)); }
  finally { await ps?.close().catch(() => {}); }
}

/* ── cleanup (rule 15: no asking; delete-must-verify: list AND Bin) ── */
console.log("\n[cleanup] sweeping the throwaway page(s)");
const left = await sweepNotesThrowaways({ base: BASE });
ok("throwaway page gone from the list", left.pagesLeft === 0);
ok("…and from the Bin", left.binLeft === 0);
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
