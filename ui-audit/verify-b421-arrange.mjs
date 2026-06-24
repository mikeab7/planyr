/* Verify B421 — Markup z-order ("Arrange") via Bluebeam shortcuts + right-click menu, against the
 * REAL built Review viewer (vite preview on :4173). Draws THREE overlapping rectangles (so the
 * single-step Forward/Backward ops are distinguishable from the Front/Back jumps) and proves:
 *
 *   • draw order IS z-order: A,B,C drawn → array/DOM/persisted order [A,B,C] (C on top).
 *   • keyboard chords (e.code, layout-independent): Ctrl+]  = Bring Forward (one step),
 *     Ctrl+Shift+] = Bring to Front, Ctrl+[ = Send Backward, Ctrl+Shift+[ = Send to Back.
 *   • the right-click context menu opens on a markup and its four items do the same reorder.
 *   • every arrange is undoable (Ctrl+Z) and the new order is mirrored to the localStorage draft
 *     (the saved artifact) — so ordering survives save.
 *   • items grey out (disabled) at the top / bottom of the stack.
 *   • right-clicking EMPTY canvas opens NO custom menu (the native menu is left to the browser).
 *   • "Edit text…" appears only for a text note (not a rect); Delete removes the markup.
 *   • the reordered order persists across a full page reload (read back from the draft).
 *
 * Run:  npm run build && npx vite preview --port 4173    (one shell)
 *       node ui-audit/verify-b421-arrange.mjs            (another)
 * Always pass --ignore-certificate-errors (sandbox TLS-inspection proxy).
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
// pdf.js needs the newer Chromium (1194 lacks Map.prototype.getOrInsertComputed). (V72 note)
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const PDF_PATH = "/tmp/b421-arrange-test.pdf";

/* A structurally-valid one-page Letter PDF (612×792) with exact xref offsets so PDF.js parses it
 * without a rebuild — same builder as verify-delete-markup.mjs. No scale text → uncalibrated, which
 * is irrelevant here (rects are redlines, not measurements). */
function buildPdf() {
  const s1 = "BT /F1 20 Tf 60 700 Td (B421 ARRANGE TEST SHEET) Tj ET";
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  objs.forEach((body, i) => { offsets[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const xrefStart = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => { pdf += String(off).padStart(10, "0") + " 00000 n \n"; });
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const results = [];
const ok = (name, pass, detail) => { results.push({ name, pass, detail }); console.log(`${pass ? "PASS ✅" : "FAIL ❌"}  ${name}  —  ${detail}`); };

// Canvas geometry (CSS px) for mapping fractional coords → page clicks.
const geom = (page) => page.evaluate(() => {
  const c = document.querySelector("canvas");
  const cr = c.getBoundingClientRect();
  return { canL: cr.left, canT: cr.top, cssW: cr.width, cssH: cr.height };
});

// Rank a list of distinct numbers → labels by ascending value (smallest = "A"). The three rects
// have distinct, non-crossing min-x, so ranking either the persisted center-x or the DOM rect x
// recovers the same A/B/C identity regardless of how the stack was permuted. Joining in z-order
// (array / DOM order) yields a string like "ABC" (A at bottom) or "BCA".
const rankString = (vals) => { const s = [...vals].sort((a, b) => a - b); return vals.map((v) => "ABCDE"[s.indexOf(v)]).join(""); };

// Persisted z-order, read straight from the localStorage draft (the saved artifact). Returns the
// rect markups' center-x in array order → ranked to "ABC"-style. Null if no draft yet.
const draftOrder = (page) => page.evaluate(() => {
  let best = null;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && k.startsWith("planyr:docreview:draft:")) {
      try { const v = JSON.parse(localStorage.getItem(k)); if (v && v.single && Array.isArray(v.single.markups) && (!best || (v._localAt || 0) > (best._localAt || 0))) best = v; } catch (e) {}
    }
  }
  if (!best) return null;
  return best.single.markups.filter((m) => m.kind === "rect").map((m) => m.pts.reduce((sm, p) => sm + p.x, 0) / m.pts.length);
});

// DOM z-order: the markup overlay paints pageMarks in array order, so the on-screen DOM order of
// the <rect> elements IS the z-order. Their x attribute is monotonic in identity (A<B<C).
const domOrder = (page) => page.$$eval('[data-testid="markup-overlay"] rect', (els) => els.map((e) => +e.getAttribute("x")));

const menuItems = (page) => page.$$eval('[role="menu"] [role="menuitem"]', (els) => els.map((e) => ({ label: e.textContent.replace(/\s+/g, " ").trim(), disabled: e.disabled })));

async function settle(page, ms = 350) { await page.waitForTimeout(ms); }

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
writeFileSync(PDF_PATH, buildPdf());
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
const page = await ctx.newPage();
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

try {
  await page.goto(BASE, { waitUntil: "load" });
  await settle(page, 900);
  await page.locator('button:has-text("Review")').first().click({ timeout: 8000 });
  await settle(page, 700);
  await page.setInputFiles('input[type="file"]', PDF_PATH, { timeout: 8000 });
  await page.waitForFunction(() => { const c = document.querySelector("canvas"); return c && c.width > 0 && c.getBoundingClientRect().width > 0; }, { timeout: 12000 });
  await settle(page, 500);
  await page.getByRole("button", { name: "Page", exact: true }).click(); // whole sheet visible so every click lands
  await settle(page, 500);

  const g = await geom(page);
  const P = (fx, fy) => ({ x: g.canL + g.cssW * fx, y: g.canT + g.cssH * fy });
  // Three horizontally-staggered, pairwise-overlapping rects, each with an EXCLUSIVE click zone.
  const RECTS = [
    { c1: P(0.15, 0.30), c2: P(0.40, 0.62), pick: P(0.20, 0.46) }, // A (left)
    { c1: P(0.37, 0.33), c2: P(0.62, 0.65), pick: P(0.50, 0.49) }, // B (middle) — 0.50 is A-clear, C-clear
    { c1: P(0.58, 0.30), c2: P(0.84, 0.62), pick: P(0.78, 0.46) }, // C (right)
  ];

  // ── draw A, B, C with the Rect tool (2 corner clicks each) ──
  await page.getByRole("button", { name: "Rect", exact: true }).click();
  for (const r of RECTS) { await page.mouse.click(r.c1.x, r.c1.y); await settle(page, 120); await page.mouse.click(r.c2.x, r.c2.y); await settle(page, 160); }
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await settle(page, 200);

  const pickById = ["A", "B", "C"];
  const selectRect = async (label) => { const r = RECTS[pickById.indexOf(label)]; await page.mouse.click(r.pick.x, r.pick.y); await settle(page, 180); };

  // ── setup: three rects, default order A,B,C (C on top) ──
  await page.waitForFunction(() => { /* draft written */ for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith("planyr:docreview:draft:")) { try { const v = JSON.parse(localStorage.getItem(k)); if (v?.single?.markups?.filter((m) => m.kind === "rect").length === 3) return true; } catch (e) {} } } return false; }, { timeout: 6000 }).catch(() => {});
  {
    const dom = rankString(await domOrder(page));
    const draft = rankString((await draftOrder(page)) || []);
    ok("setup: 3 rects, draw order = z-order [A,B,C] (DOM + persisted)", dom === "ABC" && draft === "ABC", `DOM=${dom} draft=${draft}`);
  }

  // ── keyboard: Bring Forward (Ctrl+]) — A (bottom) steps up ONE → B,A,C (not all the way) ──
  await selectRect("A");
  await page.keyboard.press("Control+BracketRight");
  await settle(page, 200);
  {
    const dom = rankString(await domOrder(page)), draft = rankString((await draftOrder(page)) || []);
    ok("Ctrl+] Bring Forward steps A up ONE (B,A,C)", dom === "BAC" && draft === "BAC", `DOM=${dom} draft=${draft}`);
  }
  await page.keyboard.press("Control+z");
  await settle(page, 200);
  ok("Ctrl+Z undoes the arrange → A,B,C", rankString(await domOrder(page)) === "ABC", `DOM=${rankString(await domOrder(page))}`);

  // ── keyboard: Bring to Front (Ctrl+Shift+]) — A jumps to the top → B,C,A ──
  await selectRect("A");
  await page.keyboard.press("Control+Shift+BracketRight");
  await settle(page, 200);
  {
    const dom = rankString(await domOrder(page)), draft = rankString((await draftOrder(page)) || []);
    ok("Ctrl+Shift+] Bring to Front jumps A to top (B,C,A)", dom === "BCA" && draft === "BCA", `DOM=${dom} draft=${draft}`);
  }
  await page.keyboard.press("Control+z");
  await settle(page, 200);

  // ── keyboard: Send Backward (Ctrl+[) — B (middle) steps down ONE → B,A,C ──
  await selectRect("B");
  await page.keyboard.press("Control+BracketLeft");
  await settle(page, 200);
  ok("Ctrl+[ Send Backward steps B down ONE (B,A,C)", rankString(await domOrder(page)) === "BAC", `DOM=${rankString(await domOrder(page))}`);
  await page.keyboard.press("Control+z");
  await settle(page, 200);

  // ── keyboard: Send to Back (Ctrl+Shift+[) — C (top) jumps to the bottom → C,A,B ──
  await selectRect("C");
  await page.keyboard.press("Control+Shift+BracketLeft");
  await settle(page, 200);
  ok("Ctrl+Shift+[ Send to Back jumps C to bottom (C,A,B)", rankString(await domOrder(page)) === "CAB", `DOM=${rankString(await domOrder(page))}`);
  await page.keyboard.press("Control+z");
  await settle(page, 200);
  ok("back to baseline A,B,C after undo", rankString(await domOrder(page)) === "ABC", `DOM=${rankString(await domOrder(page))}`);

  // ── right-click menu on C (top of stack): Front/Forward disabled, Back/Backward enabled ──
  await page.mouse.click(RECTS[2].pick.x, RECTS[2].pick.y, { button: "right" });
  await settle(page, 250);
  {
    const items = await menuItems(page);
    const find = (l) => items.find((it) => it.label.startsWith(l));
    const okTop = items.length >= 5 && find("Bring to Front")?.disabled && find("Bring Forward")?.disabled && !find("Send to Back")?.disabled && !find("Send Backward")?.disabled;
    ok("right-click on TOP markup greys Front/Forward, enables Back/Backward", !!okTop, items.map((i) => `${i.label}${i.disabled ? "(off)" : ""}`).join(", "));
    // Send to Back via the menu → C,A,B
    await page.locator('[role="menu"] [role="menuitem"]:has-text("Send to Back")').click();
    await settle(page, 220);
    const dom = rankString(await domOrder(page)), draft = rankString((await draftOrder(page)) || []);
    ok("menu Send to Back moves C to bottom (C,A,B), persisted", dom === "CAB" && draft === "CAB", `DOM=${dom} draft=${draft}`);
  }
  await page.keyboard.press("Control+z");
  await settle(page, 200);

  // ── right-click menu on A (bottom of stack): Back/Backward disabled ──
  await page.mouse.click(RECTS[0].pick.x, RECTS[0].pick.y, { button: "right" });
  await settle(page, 250);
  {
    const items = await menuItems(page);
    const find = (l) => items.find((it) => it.label.startsWith(l));
    const okBottom = find("Send to Back")?.disabled && find("Send Backward")?.disabled && !find("Bring to Front")?.disabled && !find("Bring Forward")?.disabled;
    ok("right-click on BOTTOM markup greys Back/Backward, enables Front/Forward", !!okBottom, items.map((i) => `${i.label}${i.disabled ? "(off)" : ""}`).join(", "));
    // Bring to Front via the menu → B,C,A
    await page.locator('[role="menu"] [role="menuitem"]:has-text("Bring to Front")').click();
    await settle(page, 220);
    ok("menu Bring to Front moves A to top (B,C,A)", rankString(await domOrder(page)) === "BCA", `DOM=${rankString(await domOrder(page))}`);
  }

  // ── right-click EMPTY canvas → NO custom menu (native menu left to the browser) ──
  await page.mouse.click(g.canL + g.cssW * 0.5, g.canT + g.cssH * 0.85, { button: "right" });
  await settle(page, 200);
  ok("right-click on blank canvas opens NO custom Arrange menu", (await page.locator('[role="menu"]').count()) === 0, `menus = ${await page.locator('[role="menu"]').count()}`);

  // ── Edit text only for a text note; Delete removes a markup ──
  await page.getByRole("button", { name: "Text", exact: true }).click();
  await page.mouse.click(g.canL + g.cssW * 0.30, g.canT + g.cssH * 0.80);
  await settle(page, 200);
  await page.keyboard.type("note one");
  await page.keyboard.press("Enter");
  await settle(page, 220);
  await page.getByRole("button", { name: "Select", exact: true }).click();
  await page.mouse.click(g.canL + g.cssW * 0.30, g.canT + g.cssH * 0.80, { button: "right" });
  await settle(page, 220);
  {
    const items = await menuItems(page);
    const hasEdit = items.some((it) => it.label.startsWith("Edit text"));
    ok("text note's menu has 'Edit text…'", hasEdit, items.map((i) => i.label).join(", "));
    await page.keyboard.press("Escape"); // close the menu
    await settle(page, 150);
  }
  // a rect's menu must NOT offer Edit text
  await page.mouse.click(RECTS[1].pick.x, RECTS[1].pick.y, { button: "right" });
  await settle(page, 200);
  {
    const items = await menuItems(page);
    ok("a rect's menu does NOT offer 'Edit text…'", !items.some((it) => it.label.startsWith("Edit text")), items.map((i) => i.label).join(", "));
    const before = (await domOrder(page)).length;
    await page.locator('[role="menu"] [role="menuitem"]:has-text("Delete")').click();
    await settle(page, 220);
    ok("menu Delete removes the markup", (await domOrder(page)).length === before - 1, `rects ${before} → ${(await domOrder(page)).length}`);
  }
  await page.keyboard.press("Control+z"); // restore the deleted rect for the reload check
  await settle(page, 220);

  // ── reorder persists across a FULL reload (read back from the draft) ──
  const beforeReload = rankString((await draftOrder(page)) || []);
  await page.reload({ waitUntil: "load" });
  await settle(page, 1200);
  const afterReload = rankString((await draftOrder(page)) || []);
  ok("z-order survives a full page reload (persisted draft unchanged)", beforeReload.length === 3 && afterReload === beforeReload, `before=${beforeReload} after=${afterReload}`);

  ok("no page errors", pageErrors.length === 0, pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "clean");
} catch (e) {
  ok("harness ran", false, String(e));
} finally {
  await browser.close();
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
