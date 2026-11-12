/* notesOverlap — THE "NOTHING DRAWS ON TOP OF ANYTHING" SWEEP (NEW-1 / NEW-2, B2671237 + B2671238, owner report 2026-11-12).
 *
 * Owner: pasting a line into a Notes box made it grow over the box beneath it ("atrocious"); "find any other similar bugs like this."
 * This module is the instrument: a fixture of several one-line boxes stacked close together (the owner's own spacing), and a list of EVERY action
 * that can change a box's size or position. After each action it measures every box's RENDERED rectangle and fails on any intersection — then
 * again after Ctrl+Z (one press must put every box back where the seed had it) and, where a reload hook is supplied, after a reload.
 *
 * ⛔ WHAT MAKES IT AN INSTRUMENT AND NOT A SCRIPT (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6, FOREGROUND-OR-VOID):
 *   · the overlap judge is proven on a KNOWN-OVERLAPPING pair before it is trusted, and on the untouched seed (must be zero pairs);
 *   · every growth scenario has a PRECONDITION — some box must really have grown — or it is reported "not exercised" and FAILS the run (a
 *     scenario whose action did nothing would otherwise pass vacuously, the exact way V2115860 once passed with a skipped arm);
 *   · the stored document is read for NESTED boxes (a box inside a box is how the reported paste hid) and the paste-options tab is judged against
 *     every line of text on the page, not against boxes.
 * Real key and mouse input throughout; a few steps that need a native dialog or a drag-to-size grid go through the toolbar's own controls. */
import { loadBank } from "./pasteBank.mjs";

const para = (t) => ({ type: "paragraph", content: t ? [{ type: "text", text: t }] : [] });
export const LINES = {
  a: "Understand the tax rate cap and how tax revenue interacts with it",
  b: "We did get a preliminary discharge review, may be some additional discharge",
  c: "We need a permit for a second water well",
  d: "Ponds and grades need to be ready by the time that water and wastewater facility contractors show up",
};
export const LONG = " and a long continuation that has to wrap onto a second line and then a third one as well, which is the point";
const box = (aid, x, y, t, w = 560) => ({ type: "noteAnchor", attrs: { x, y, w, h: null, aid }, content: [para(t)] });
/** Four one-line boxes 40 px apart (each ~37 tall, so the gaps are only a few px), plus one far-away box that must never move. */
export const FIXTURE = () => ({ type: "doc", content: [box("a", 40, 100, LINES.a), box("b", 40, 150, LINES.b), box("c", 40, 190, LINES.c), box("d", 40, 230, LINES.d.slice(0, 40)), box("z", 760, 100, "Far away", 200), para("")] });

/* ── pure judges (node-testable) ─────────────────────────────────────────────────────────────── */
export const intersects = (a, b, eps = 0.5) => a.x < b.x + b.w - eps && b.x < a.x + a.w - eps && a.y < b.y + b.h - eps && b.y < a.y + a.h - eps;
export function overlapPairs(rects) {
  const out = [];
  for (let i = 0; i < rects.length; i++) for (let j = i + 1; j < rects.length; j++) if (intersects(rects[i], rects[j])) out.push(`${rects[i].aid}×${rects[j].aid} (${Math.round(Math.min(rects[i].y + rects[i].h, rects[j].y + rects[j].h) - Math.max(rects[i].y, rects[j].y))}px)`);
  return out;
}
export const maxBoxDepth = (doc) => { let m = 0; const w = (n, d) => { if (n.type === "noteAnchor") m = Math.max(m, d); (n.content || []).forEach((c) => w(c, d + (n.type === "noteAnchor" ? 1 : 0))); }; w(doc, 0); return m; };
export const topBoxes = (doc) => (doc.content || []).filter((n) => n.type === "noteAnchor");
export const posMap = (doc) => Object.fromEntries(topBoxes(doc).filter((b) => b.attrs.aid).map((b) => [b.attrs.aid, [b.attrs.x, b.attrs.y]]));

/* ── browser-side readers ────────────────────────────────────────────────────────────────────── */
export const readRects = (page) => page.evaluate(() => [...document.querySelectorAll(".planyr-anchor")].map((e) => { const r = e.getBoundingClientRect(); return { aid: e.getAttribute("data-anchor-id") || "?", x: r.left, y: r.top, w: r.width, h: r.height }; }));
export const readDoc = (page) => page.evaluate(() => window.__noteEditor?.json?.() ?? null);
/** The paste-options tab / flyout against every line of text on the page: the area it hides (px²), 0 when there is no tab. */
export const chipCoverage = (page) => page.evaluate(() => {
  const chip = document.querySelector('[data-testid="note-paste-options"]');
  if (!chip) return { present: false, covered: 0 };
  const c = chip.getBoundingClientRect();
  const pm = document.querySelector(".ProseMirror");
  const range = document.createRange(); const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
  let covered = 0; let n; const hits = [];
  while ((n = walker.nextNode())) {
    if (!n.nodeValue.trim()) continue;
    range.selectNodeContents(n);
    for (const r of range.getClientRects()) {
      const w = Math.min(c.right, r.right) - Math.max(c.left, r.left); const h = Math.min(c.bottom, r.bottom) - Math.max(c.top, r.top);
      if (w > 0.5 && h > 0.5) { covered += w * h; if (hits.length < 3) hits.push(n.nodeValue.slice(0, 24)); }
    }
  }
  return { present: true, covered: Math.round(covered), hits };
});

/**
 * @param ctx { page, seed(doc), ok(label, cond, detail), settle(ms), reloadRead?(): Promise<doc>, voided(why), only?: string[], log }
 */
export async function runSweep(ctx) {
  const { page, seed, ok, settle, voided, log = console.log } = ctx;
  const only = ctx.only && ctx.only.length ? new Set(ctx.only) : null;
  const results = [];

  /* ── drivers ── */
  const pointIn = async (needle, atEnd = false) => {
    const p = await page.evaluate(([n, end]) => {
      const t = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
      let node;
      while ((node = t.nextNode())) { const i = node.nodeValue.indexOf(n); if (i >= 0) { const r = document.createRange(); const at = end ? i + n.length : i; r.setStart(node, at); r.collapse(true); const b = r.getBoundingClientRect(); return { x: Math.round(b.left) + (end ? 0 : 1), y: Math.round(b.top + b.height / 2) }; } }
      return null;
    }, [needle, atEnd]);
    if (!p) throw new Error(`no "${needle}" on the page`);
    return p;
  };
  const click = async (needle, atEnd) => { const p = await pointIn(needle, atEnd); await page.mouse.click(p.x, p.y); await settle(250); };
  /** Press 1 selects the box, press 2 puts the caret in it (the two-stage gesture), landing at the start (or end) of `needle`. */
  const enter = async (needle, atEnd = false) => { await click(needle, atEnd); await settle(700); await click(needle, atEnd); await settle(250); };
  const tool = async (id) => {
    const el = page.locator(`[data-testid="${id}"]`).first();
    if (!(await el.count()) || !(await el.isVisible().catch(() => false))) { await page.locator('[data-testid="nt-more"]').first().click().catch(() => {}); await settle(300); }
    await page.locator(`[data-testid="${id}"]`).first().click(); await settle(450);
  };
  const synthPaste = (html, text) => page.evaluate(([h, t]) => {
    const dt = new DataTransfer(); if (h) dt.setData("text/html", h); dt.setData("text/plain", t ?? "");
    document.activeElement.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [html, text]);
  const setClip = (text) => page.evaluate((t) => navigator.clipboard.writeText(t), text);
  const key = async (k) => { await page.keyboard.press(k); await settle(120); };

  /* ── scenarios: { id, label, grows (a box must end up taller or moved), act, undo: 1 | 0 (skip the undo check) } ── */
  const S = [];
  const add = (id, label, act, o = {}) => S.push({ id, label, act, grows: true, undo: 1, reload: true, ...o });

  add("type-wrap", "typing until a line wraps", async () => { await enter(LINES.b, true); await key("End"); await page.keyboard.type(LONG, { delay: 0 }); });
  add("enter-lines", "Enter / new lines", async () => { await enter(LINES.b, true); await key("End"); for (const t of ["second line", "third line"]) { await key("Enter"); await page.keyboard.type(t); } });
  add("paste-plain", "paste of plain text at the start of a box", async () => { await setClip(LINES.a); await enter(LINES.b); await key("Control+v"); await settle(900); });
  add("paste-from-box", "paste of text copied from another box (the owner's case)", async () => {
    await enter(LINES.a); await key("Home"); await page.keyboard.down("Shift"); await key("End"); await page.keyboard.up("Shift"); await key("Control+c"); await settle(300);
    await key("Escape"); await key("Escape");
    await enter(LINES.b); await key("Home"); await key("Control+v"); await settle(900);
  }, { reportNested: true });
  const WORD = '<html><body><!--StartFragment--><p style="font-family:Calibri;font-size:11pt">Lead <b>bold word</b> and <i>italic</i> then <span style="color:#C00000;font-family:Georgia;font-size:20pt">big red serif</span> and a <a href="https://example.com/x">link</a>, followed by a good deal more text so that it must wrap more than once inside the box it lands in.</p><!--EndFragment--></body></html>';
  for (const [mode, letter] of [["source", "K"], ["merge", "M"], ["text", "T"]]) {
    add(`paste-option-${mode}`, `paste with option: ${mode === "source" ? "Keep Source Formatting" : mode === "merge" ? "Merge Formatting" : "Keep Text Only"}`, async () => {
      await enter(LINES.b, true); await key("End"); await synthPaste(WORD, "Lead bold word and italic then big red serif and a link, followed by a good deal more text so that it must wrap more than once inside the box it lands in."); await settle(1000);
      await key("Control"); await settle(250);
      if (mode !== "source") { await key(letter); await settle(900); }
    }, { chip: true, undo: 0 });
  }
  for (const e of loadBank().filter((b) => /^clipboard-(bank|tables)\//.test(b.id) && b.html).slice(0, 8)) {
    add(`paste-bank-${e.name}`, `paste from Word / Outlook / Excel / Chrome: ${e.name}`, async () => { await enter(LINES.b, true); await key("End"); await synthPaste(e.html, e.text); await settle(1500); }, { chip: true, grows: false, undo: 0 });
  }
  add("bullets", "bulleted list", async () => { await enter(LINES.b, true); await key("End"); await key("Enter"); await page.keyboard.type("second item that is long enough to be a real sentence in a list"); await tool("nt-bullet"); await key("Enter"); await page.keyboard.type("third item"); });
  add("numbered", "numbered list", async () => { await enter(LINES.b, true); await key("End"); await key("Enter"); await page.keyboard.type("second item that is long enough to be a real sentence in a list"); await tool("nt-ordered"); await key("Enter"); await page.keyboard.type("third item"); });
  add("indent", "indent / outdent", async () => {
    await enter(LINES.b, true); await key("End"); await tool("nt-bullet"); await key("Enter"); await page.keyboard.type("nested item with enough words to wrap once it has been indented a few times over");
    for (let i = 0; i < 3; i++) await key("Tab"); await settle(400); await key("Shift+Tab");
  }, { grows: false });
  add("font-size", "changing the font size", async () => {
    await enter(LINES.b, true); await key("Home"); await page.keyboard.down("Shift"); await key("End"); await page.keyboard.up("Shift");
    await tool("nt-size");
    const opt = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="nt-size-opt-"]')].map((b) => b.getAttribute("data-testid")).filter((t) => !/default$/.test(t)).pop());
    if (opt) await page.locator(`[data-testid="${opt}"]`).first().click(); await settle(600);
  });
  add("heading-bold", "headings and bold", async () => {
    await enter(LINES.b, true); await key("Home"); await page.keyboard.down("Shift"); await key("End"); await page.keyboard.up("Shift");
    await tool("nt-block");
    const opt = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="nt-block-opt-"]')].map((b) => b.getAttribute("data-testid")).find((t) => /1|h1|heading/i.test(t)));
    if (opt) await page.locator(`[data-testid="${opt}"]`).first().click(); await settle(500);
    await tool("nt-bold");
  });
  add("table", "inserting a table", async () => {
    await enter(LINES.b, true); await key("End"); await tool("nt-table");
    await page.locator('[data-testid="nt-table-grid"] [role="grid"] > *').nth(2 * 8 + 2).click(); await settle(900);
  });
  add("table-rows", "adding / removing table rows", async () => {
    await enter(LINES.b, true); await key("End"); await tool("nt-table");
    await page.locator('[data-testid="nt-table-grid"] [role="grid"] > *').nth(1 * 8 + 1).click(); await settle(700);
    for (let i = 0; i < 4; i++) await tool("nt-row-after");
    await tool("nt-row-del");
  });
  add("image", "inserting an image", async () => {
    await enter(LINES.b, true); await key("End");
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAGQAAABkCAYAAABw4pVUAAAAU0lEQVR4nO3PQQ0AAAgEoJv9O1ZwcLhAAZ0JU3qSKUnJkEnEwTEx4A0KAAAAAElFTkSuQmCC", "base64");
    await page.locator('[data-testid="nt-image-input"]').setInputFiles({ name: "x.png", mimeType: "image/png", buffer: png }); await settle(1500);
  }, { grows: false });
  add("shrink", "deleting text so a box shrinks (nothing may move)", async () => {
    await enter(LINES.b, true); await key("Home"); await page.keyboard.down("Shift"); await key("End"); await page.keyboard.up("Shift"); await key("Delete"); await settle(500);
  }, { grows: false, noMove: true });
  add("resize-width", "narrowing a box by its width handle", async () => {
    await click(LINES.b);   // press 1 selects: the handles appear
    const h = await page.evaluate(() => { const e = [...document.querySelectorAll(".planyr-anchor")].find((a) => a.textContent.includes("preliminary")); const hd = e?.querySelector('[data-handle="e"]'); if (!hd) return null; const r = hd.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
    if (!h) throw new Error("no east handle on the selected box");
    await page.mouse.move(h.x, h.y, { steps: 3 }); await settle(150); await page.mouse.down(); await page.mouse.move(h.x - 330, h.y, { steps: 10 }); await page.mouse.move(h.x - 330, h.y, { steps: 2 }); await page.mouse.up(); await settle(1000);
  });
  add("move-onto", "moving a box by its border onto another", async () => {
    const r = await page.evaluate(() => { const e = [...document.querySelectorAll(".planyr-anchor")].find((a) => a.textContent.includes("Understand")); const q = e.getBoundingClientRect(); return { l: q.left, t: q.top, w: q.width, h: q.height }; });
    const at = { x: r.l + r.w * 0.3, y: r.t - 1 };
    await page.mouse.move(at.x, at.y, { steps: 4 }); await settle(200);
    const onBand = await page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.closest?.(".planyr-anchor-edge"), [at.x, at.y]);
    if (!onBand) throw new Error("the top border band is not under the pointer");
    await page.mouse.down(); await page.mouse.move(at.x + 10, at.y + 70, { steps: 10 }); await page.mouse.move(at.x + 10, at.y + 70, { steps: 2 }); await page.mouse.up(); await settle(1000);
  }, { grows: false, moved: true });

  /* ── the judge's own known-good arms ── */
  ok("[known-good] the overlap judge flags a pair that really overlaps", overlapPairs([{ aid: "p", x: 0, y: 0, w: 100, h: 40 }, { aid: "q", x: 10, y: 30, w: 100, h: 40 }]).length === 1);
  ok("[known-good] …and does not flag boxes that only touch", overlapPairs([{ aid: "p", x: 0, y: 0, w: 100, h: 40 }, { aid: "q", x: 0, y: 40, w: 100, h: 40 }]).length === 0);

  for (const sc of S) {
    if (only && !only.has(sc.id)) continue;
    log(`\n— ${sc.label}`);
    try {
      await seed(FIXTURE());
      const seedRects = await readRects(page);
      const seedDoc = await readDoc(page);
      if (!seedDoc) voided("no editor doc to read");
      if (overlapPairs(seedRects).length) voided(`the seed already overlaps: ${overlapPairs(seedRects).join(", ")}`);
      const seedPos = posMap(seedDoc);
      await sc.act();
      await settle(700);
      const rects = await readRects(page);
      const doc = await readDoc(page);
      const grew = rects.some((r) => { const s = seedRects.find((q) => q.aid === r.aid); return s && (r.h > s.h + 2 || r.w > s.w + 2); });
      const moved = Object.entries(posMap(doc)).some(([id, p]) => seedPos[id] && (p[0] !== seedPos[id][0] || p[1] !== seedPos[id][1]));
      if (sc.grows && !grew) { ok(`${sc.label}: the action really grew a box (precondition — otherwise the check below proves nothing)`, false, "no box got taller or wider"); results.push({ id: sc.id, status: "not-exercised" }); continue; }
      const pairs = overlapPairs(rects);
      ok(`${sc.label}: no two boxes overlap`, pairs.length === 0, pairs.join(", "));
      ok(`${sc.label}: no box sits inside another box (stored document)`, maxBoxDepth(doc) === 0, `max nesting depth ${maxBoxDepth(doc)}`);
      if (sc.noMove) ok(`${sc.label}: no box was moved by a shrink`, !moved, JSON.stringify(posMap(doc)));
      if (!sc.moved && sc.grows !== false || sc.id === "type-wrap") {
        const z = posMap(doc).z; ok(`${sc.label}: the far-away box did not move`, !!z && z[0] === 760 && z[1] === 100, JSON.stringify(z));
      }
      if (sc.chip) { const c = await chipCoverage(page); ok(`${sc.label}: the paste-options tab covers no text`, c.covered === 0, `${c.covered}px² over "${(c.hits || []).join('", "')}"`); }
      if (sc.undo) {
        await page.keyboard.press("Control+z"); await settle(900);
        const ur = await readRects(page); const ud = await readDoc(page);
        const up = posMap(ud); const same = Object.keys(seedPos).every((id) => up[id] && up[id][0] === seedPos[id][0] && up[id][1] === seedPos[id][1]);
        ok(`${sc.label}: ONE Ctrl+Z puts every box back where it was`, same && overlapPairs(ur).length === 0, `${JSON.stringify(up)} vs ${JSON.stringify(seedPos)}`);
      }
      if (ctx.reloadRead && sc.reload && (!ctx.reloadIds || ctx.reloadIds.includes(sc.id))) {
        const after = await ctx.reloadRead();
        ok(`${sc.label}: after a reload nothing overlaps and the layout is the one on screen`, !!after && overlapPairs(after.rects).length === 0 && maxBoxDepth(after.doc) === 0, after ? overlapPairs(after.rects).join(", ") : "reload read failed");
      }
      results.push({ id: sc.id, status: "done" });
    } catch (e) {
      if (/^void|VOID/.test(String(e.message))) throw e;
      ok(`${sc.label}: scenario ran`, false, String(e.message || e).slice(0, 220));
      results.push({ id: sc.id, status: "error" });
    }
  }
  return results;
}
