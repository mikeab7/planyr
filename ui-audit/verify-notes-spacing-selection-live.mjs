#!/usr/bin/env node
/* verify-notes-spacing-selection-live — V2007184 / B2556416–B2556418 ON A REAL DEPLOY.
 *
 * Signed in as the TEST account on planyr.io, on a THROWAWAY Notes page it creates and deletes (constraint 15 —
 * never a real page of the owner's). Proves the three owner items against the deployed bundle:
 *   NEW-1  the spacing row offers 0.8 / 0.9 / 1.0 / 1.15 / 1.50 / 2.0 and 0.8 applies, spreads to the whole page, resets
 *          and survives a reload (read off the live editor, then off the page after a reload);
 *   NEW-2  every control in the spacing dropdown (and every other toolbar dropdown) sits inside its panel, on screen;
 *   NEW-3  a selected / hovered / multi-selected / table box (light and dark) computes no background fill.
 * The exhaustive matrix is verify-notes-spacing-popover-selection.mjs, run against the build; this proves the WIRING live.
 *
 * `BASE_URL` (default https://planyr.io) · `EXPECT_BUILD=<sha>` fails if /version.json differs. Real clicks only for anything
 * that must persist (the editor saves only after a genuine isTrusted input — carry-forward, B1662464). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "https://planyr.io";
let s = null;
for (let i = 0; i < 12 && !s; i++) {
  try { s = await openSignedIn({ base: BASE }); }
  catch (e) { if (!/answered 502/.test(String(e)) || i === 11) throw e; console.log("sign-in route 502, retrying…"); await new Promise((r) => setTimeout(r, 15000)); }
}
const { page } = s;
await assertMeasurable(page, "verify-notes-spacing-selection-live");
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
let pass = 0; let fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}${d ? ` — ${d}` : ""}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const wait = (ms) => page.waitForTimeout(ms);

const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
console.log("signed in as", s.proof.email, "· served build", build.build);
if (process.env.EXPECT_BUILD) ok(`served build is the merge commit ${process.env.EXPECT_BUILD}`, String(build.build).startsWith(process.env.EXPECT_BUILD.slice(0, 7)), JSON.stringify(build));

const TITLE = "ZZ throwaway spacing " + Date.now().toString(36);
const para = (...c) => ({ type: "paragraph", content: c });
const t = (x, marks) => (marks ? { type: "text", text: x, marks } : { type: "text", text: x });
const DOC = { type: "doc", content: [
  { type: "noteAnchor", attrs: { x: 40, y: 40, w: 320, h: null, aid: "b1" }, content: [para(t("PLAIN one two three four five six seven eight nine ten eleven twelve")), para(t("PLAIN second paragraph"))] },
  { type: "noteAnchor", attrs: { x: 40, y: 220, w: 320, h: null, aid: "b2" }, content: [{ type: "bulletList", content: [{ type: "listItem", content: [para(t("LISTITEM alpha beta gamma"))] }] }] },
  { type: "noteAnchor", attrs: { x: 40, y: 340, w: 360, h: null, aid: "b3" }, content: [{ type: "table", content: [{ type: "tableRow", content: [
    { type: "tableCell", attrs: {}, content: [para(t("CELLONE alpha beta"))] }, { type: "tableCell", attrs: {}, content: [para(t("CELLTWO second"))] }] }] }] },
  { type: "noteAnchor", attrs: { x: 440, y: 40, w: 420, h: null, aid: "b4" }, content: [para(t("LARGE type here", [{ type: "textStyle", attrs: { fontSize: "44px" } }]))] },
] };

const json = () => page.evaluate(() => window.__noteEditor.json());
/* Line heights of paragraphs that HOLD TEXT. The editor appends one empty structural paragraph on load (TrailingNode,
 * notesAnchorNode.js) — it is not content and is created with no spacing, so counting it read as "0.8 did not survive". */
const lineHeights = (doc) => { const o = []; const w = (n) => { if (!n) return; if (n.type === "paragraph" && (n.content || []).length) o.push(n.attrs?.lineHeight ?? null); (n.content || []).forEach(w); }; w(doc); return o; };
const pollJson = async (pred, ms = 5000) => { const end = Date.now() + ms; let d; while (Date.now() < end) { d = await json(); if (pred(d)) return d; await wait(200); } return d; };

async function selectText(needle) {
  await page.evaluate((n) => {
    const pm = document.querySelector(".ProseMirror");
    const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT); let node;
    while ((node = w.nextNode())) {
      const i = node.nodeValue.indexOf(n); if (i < 0) continue;
      pm.focus(); const r = document.createRange(); r.setStart(node, i); r.setEnd(node, i + n.length);
      const g = document.getSelection(); g.removeAllRanges(); g.addRange(r); return;
    }
  }, needle);
  await wait(300);
}
const openSpacing = async () => {
  if (!(await page.locator('[data-testid="nt-spacing-panel"]').count())) await page.locator('[data-testid="nt-spacing"]').click();
  await page.waitForSelector('[data-testid="nt-spacing-panel"]', { timeout: 5000 }); await wait(200);
};
const pickLine = async (id) => { await page.locator(`[data-testid="nt-spacing-line-${id}"]`).click(); await wait(300); };

/** Every dropdown currently open: which descendants poke outside it, is it on screen, does it scroll sideways. */
const probe = () => page.evaluate(() => [...document.querySelectorAll("body *")].filter((el) => { const c = getComputedStyle(el); return c.position === "fixed" && c.zIndex === "300" && c.visibility !== "hidden" && el.getBoundingClientRect().width > 0; }).map((pop) => {
  const pr = pop.getBoundingClientRect(); const esc = [];
  for (const el of pop.querySelectorAll("*")) {
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    let clipped = false; for (let a = el.parentElement; a && a !== pop; a = a.parentElement) { const o = getComputedStyle(a); if (/(auto|scroll|hidden|clip)/.test(o.overflowX + o.overflowY)) { clipped = true; break; } }
    if (clipped) continue;
    if (r.left < pr.left - 0.5 || r.right > pr.right + 0.5 || r.top < pr.top - 0.5 || r.bottom > pr.bottom + 0.5) esc.push((el.getAttribute("data-testid") || el.getAttribute("aria-label") || el.tagName) + " by " + Math.round(Math.max(pr.left - r.left, r.right - pr.right, pr.top - r.top, r.bottom - pr.bottom)));
  }
  return { tid: pop.getAttribute("data-testid") || "?", role: pop.getAttribute("role") || "", text: (pop.textContent || "").slice(0, 40), esc, off: pr.left < -0.5 || pr.right > window.innerWidth + 0.5, side: pop.scrollWidth > pop.clientWidth + 1, w: Math.round(pr.width) };
}));

const boxInfo = (text) => page.evaluate((x) => {
  const b = [...document.querySelectorAll(".planyr-anchor")].find((e) => e.textContent.includes(x)); if (!b) return null;
  const cs = getComputedStyle(b); const r = b.getBoundingClientRect();
  return { bg: cs.backgroundColor, bgImg: cs.backgroundImage, bw: parseFloat(cs.borderTopWidth), sel: b.getAttribute("data-selected") === "1", ed: b.getAttribute("data-editing") === "1", x: r.left, y: r.top, w: r.width, h: r.height };
}, text);
const clear = (c) => c === "rgba(0, 0, 0, 0)" || c === "transparent";

await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
let before = -1;
for (let i = 0; i < 20; i++) { const n = await page.locator('[data-testid^="notes-row-"]').count(); if (n === before && n > 0) break; before = n; await wait(600); }

try {
  await page.locator('[data-testid="notes-new-page"]').click();
  await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
  await page.locator('[data-testid="note-title"]').fill(TITLE);
  await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
  await wait(800);
  await page.waitForFunction(() => !!window.__noteEditor, null, { timeout: 15000 });
  await page.evaluate((d) => window.__noteEditor.setDoc(d), DOC);
  await wait(900);

  console.log("\n[NEW-1 + NEW-2] the spacing dropdown");
  await selectText("PLAIN one two");
  await openSpacing();
  const labels = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="nt-spacing-line-"]')].filter((b) => b.tagName === "BUTTON").map((b) => b.textContent.trim()));
  ok("the row reads 0.8 / 0.9 / 1.0 / 1.15 / 1.50 / 2.0", JSON.stringify(labels) === JSON.stringify(["0.8", "0.9", "1.0", "1.15", "1.50", "2.0"]), labels.join(" / "));
  const pops = await probe();
  const sp = pops.find((p) => p.tid === "nt-spacing-panel");
  ok("(known-good) the spacing panel was found and measured", !!sp);
  ok("every control inside the spacing dropdown — both + buttons included", !!sp && sp.esc.length === 0, sp ? JSON.stringify(sp.esc) : "");
  ok("…the dropdown is fully on screen and does not scroll sideways", !!sp && !sp.off && !sp.side);
  await pickLine("0.8");
  let d = await pollJson((x) => lineHeights(x).includes(0.8));
  ok("0.8 on a selected paragraph is stored on that paragraph only", lineHeights(d).filter((x) => x === 0.8).length === 1, JSON.stringify(lineHeights(d)));
  await page.keyboard.press("Escape").catch(() => {});
  await selectText("PLAIN one two"); await openSpacing();
  ok("0.8 highlights when the dropdown reopens", await page.evaluate(() => document.querySelector('[data-testid="nt-spacing-line-0.8"]').style.background.includes("accent-notes")));
  await page.locator('[data-testid="nt-spacing-whole-page"]').click();
  d = await pollJson((x) => lineHeights(x).every((v) => v === 0.8));
  ok("Apply to whole page puts 0.8 on every paragraph", lineHeights(d).length >= 5 && lineHeights(d).every((v) => v === 0.8), JSON.stringify(lineHeights(d)));
  const rows = await page.evaluate(() => { const f = (s) => { const p = [...document.querySelectorAll(".ProseMirror p")].find((e) => e.textContent.startsWith(s)); const c = getComputedStyle(p); return Math.abs(parseFloat(c.lineHeight) - parseFloat(c.fontSize) * 0.8) < 0.7; }; return { li: f("LISTITEM"), cell: f("CELLONE"), big: f("LARGE") }; });
  ok("0.8 reaches a list item, a table cell and 44px type", rows.li && rows.cell && rows.big, JSON.stringify(rows));
  // reload persistence: wait for the save debounce, reload, reopen the page, read the editor
  await page.keyboard.press("Escape").catch(() => {});
  await wait(1800);
  await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid^="notes-row-"]', { timeout: 30000 });
  await page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).first().click();
  await page.waitForFunction(() => !!window.__noteEditor, null, { timeout: 20000 });
  await wait(1200);
  d = await json();
  ok("0.8 is still on every paragraph after a reload", lineHeights(d).length >= 5 && lineHeights(d).every((v) => v === 0.8), JSON.stringify(lineHeights(d)));
  await selectText("PLAIN one two"); await openSpacing();
  await page.locator('[data-testid="nt-spacing-reset"]').click();
  d = await pollJson((x) => lineHeights(x)[0] == null);
  ok("Reset clears the selected paragraph", lineHeights(d)[0] == null, JSON.stringify(lineHeights(d)));
  await page.keyboard.press("Escape").catch(() => {});

  console.log("\n[NEW-2] every other toolbar dropdown stays inside itself");
  let opened = 0; const bad = []; const tips = []; const seenPanels = [];
  for (const tid of ["nt-block", "nt-font", "nt-size", "nt-color", "nt-highlight", "nt-align-menu", "nt-insert-plus", "nt-more"]) {
    await selectText("PLAIN one two");
    const btn = page.locator(`[data-testid="${tid}"]`).first();
    if (!(await btn.count()) || !(await btn.isVisible())) continue;
    await btn.click(); await wait(350);
    for (const p of await probe()) {
      if (p.tid === "?") { tips.push(`"${p.text}"`); continue; }   // an unnamed fixed box is the hover tooltip of the button just clicked
      opened += 1; seenPanels.push(p.tid);
      if (p.esc.length || p.off || p.side) bad.push(`${p.tid}: ${JSON.stringify(p.esc)} off=${p.off} side=${p.side}`);
    }
    await page.keyboard.press("Escape"); await wait(200);
  }
  ok("(known-good) at least five other dropdowns opened and were measured", opened >= 5, `opened ${opened}`);
  console.log("    panels measured:", seenPanels.join(", "));
  console.log("    unnamed fixed boxes seen (hover tooltips, not scored):", tips.join(" · "));
  ok("none of them has a control outside it, off screen, or scrolling sideways", bad.length === 0, bad.join(" | "));

  console.log("\n[NEW-3] a clicked box paints no fill (light, then dark)");
  for (const theme of ["light", "dark"]) {
    await page.evaluate((th) => document.documentElement.setAttribute("data-theme", th), theme);
    await wait(300);
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await wait(200);
    let b = await boxInfo("PLAIN one");
    ok(`${theme}: an unselected box has no fill`, clear(b.bg), b.bg);
    await page.mouse.click(b.x + b.w * 0.5, b.y + b.h * 0.5); await wait(500);
    b = await boxInfo("PLAIN one");
    if (!b.sel) ok(`${theme}: (known-good) a real press selected the box`, false, "never selected — selected-state checks VOID");
    else {
      ok(`${theme}: a SELECTED box computes no background`, clear(b.bg) && b.bgImg === "none", `${b.bg} / ${b.bgImg}`);
      ok(`${theme}: …its border is still drawn`, b.bw >= 1);
    }
    const o = await boxInfo("LISTITEM");
    await page.mouse.move(o.x + o.w / 2, o.y + o.h / 2); await wait(250);
    ok(`${theme}: hovering another box paints no fill`, clear((await boxInfo("LISTITEM")).bg));
    await page.keyboard.down("Shift"); await page.mouse.click(o.x + o.w * 0.5, o.y + o.h * 0.5); await page.keyboard.up("Shift"); await wait(500);
    const m1 = await boxInfo("PLAIN one"); const m2 = await boxInfo("LISTITEM");
    ok(`${theme}: (known-good) two boxes are selected together`, m1.sel && m2.sel);
    ok(`${theme}: …and neither paints a fill`, clear(m1.bg) && clear(m2.bg), `${m1.bg} | ${m2.bg}`);
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await wait(250);
    const tb = await boxInfo("CELLONE");
    await page.mouse.click(tb.x + tb.w * 0.3, tb.y + 1); await wait(500);
    const tsel = await boxInfo("CELLONE");
    ok(`${theme}: (known-good) the table box was selected`, tsel.sel);
    ok(`${theme}: a SELECTED table box paints no fill`, clear(tsel.bg), tsel.bg);
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape"); await wait(250);
  }
} finally {
  console.log("\n[cleanup] deleting the throwaway page");
  try {
    await page.evaluate(() => document.documentElement.removeAttribute("data-theme")).catch(() => {});
    await page.keyboard.press("Escape");
    const row = page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).first();
    await row.click({ button: "right" }); await wait(300);
    await page.locator('[data-testid^="notes-menu-"]', { hasText: /^Delete/ }).first().click(); await wait(800);
    const yes = page.locator('button[aria-label*="Confirm" i], button:has-text("✓")').first();
    if (await yes.count()) { await yes.click(); await wait(1200); }
  } catch (e) { console.log("  cleanup step error:", String(e).slice(0, 200)); }
  const left = await page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).count();
  ok("the throwaway page is gone from the list", left === 0);
  const after = await page.locator('[data-testid^="notes-row-"]').count();
  ok("page count is back to what it was", after === before, `${before} → ${after}`);
}
ok("no page error", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await s.close();
process.exit(fail ? 1 : 0);
