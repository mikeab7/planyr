#!/usr/bin/env node
/* verify-notes-list-enter — ENTER AFTER A PASTED BULLET CONTINUES THE LIST (follow-up NEW-1, owner screenshot 2026-10-30: the
 * cursor at the end of the level-2 item "○ 1M SF - $90K", Enter, type — the new line was a plain paragraph, flush left, even
 * left of its parent "• LEED"). Word's behaviour is the spec: Enter makes a sibling at the same level with the same marker;
 * Enter on an EMPTY item steps out one level; Tab / Shift+Tab change level; Backspace at the start of an item takes one
 * predictable step; Ctrl+Z right after Enter puts it back; Enter in the middle of an item splits it.
 *
 * TWO HALVES.
 *   A · FUTURE PASTES — the committed Word and OneNote outline fixtures (test/fixtures/clipboard-lists, SYNTHETIC models of those
 *       products' markup) pasted into a real box, then the REAL keyboard at levels 1-4 (+ numbered).
 *   B · NOTES ALREADY PASTED — a page seeded with the shape the OLD paste measurably STORED (paragraphs whose text starts with
 *       the glyph + a wide gap, never list nodes). Opened, Enter pressed at the end of the level-2 line, typed into, RELOADED:
 *       the stored page must hold real nested lists with the new item at the right level, and a page nobody edits must not be
 *       rewritten.
 *
 * ⛔ KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): Enter at the end of a REAL typed bullet must continue it. If that fails the
 * harness, not the app, is on trial and the run is VOID. Judged on the STORED document; every key is a real key press.
 * `BASE_URL` (default http://127.0.0.1:5199) · `PW_CHROME` · `ONLY=<case>` to narrow. */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../test/fixtures/clipboard-lists");
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";
const load = (n) => ({ html: fs.readFileSync(path.join(FX, `${n}.html`), "utf8"), text: fs.readFileSync(path.join(FX, `${n}.txt`), "utf8") });

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-list-enter");

let passN = 0; let failN = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { passN += 1; console.log(`  ✓ ${label}`); } else { failN += 1; console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); }
};
const para = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const box = (aid, content) => ({ type: "noteAnchor", attrs: { x: 40, y: 40, w: 460, h: null, aid }, content });

async function seed(docContent) {
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([tk, pk, d]) => {
    localStorage.clear();
    localStorage.setItem("planyr.theme", "light");
    localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Throwaway", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
    localStorage.setItem(pk, JSON.stringify(d));
  }, [TREE_KEY, PAGE_KEY, { type: "doc", content: docContent }]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 800);
}
/** click just after `needle` (the caret lands at the end of that text; `offset` chars earlier puts it inside) */
async function clickAt(needle, back = 0) {
  const p = await page.evaluate(([n, b]) => {
    const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const i = node.nodeValue.indexOf(n);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(node, i + n.length - b); r.collapse(true);
      const rc = r.getBoundingClientRect();
      return { x: Math.round(rc.left) + (b ? 0 : 1), y: Math.round(rc.top + rc.height / 2) };
    }
    return null;
  }, [needle, back]);
  if (!p) throw new Error(`could not find "${needle}" to click`);
  await page.mouse.click(p.x, p.y);
  await pacedWait(page, 250);
}
const enterBox = async (needle) => { await clickAt(needle); await pacedWait(page, 650); await clickAt(needle); };
async function armBlank() {
  const at = await page.evaluate(() => { const s = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: Math.round(s.left + s.width * 0.5), y: Math.round(s.top + s.height * 0.45) }; });
  await page.mouse.dblclick(at.x, at.y);
  await pacedWait(page, 450);
  if (!(await page.evaluate(() => !!document.querySelector('[data-testid="note-pending-caret"]')))) throw new Error("a double-click on blank paper did not arm a caret");
}
async function paste({ html, text }) {
  await page.evaluate(([h, t]) => {
    const dt = new DataTransfer();
    if (h) dt.setData("text/html", h);
    if (t != null) dt.setData("text/plain", t);
    const target = document.activeElement && document.activeElement !== document.documentElement ? document.activeElement : document.body;
    target.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [html || null, text ?? null]);
  await pacedWait(page, 1100);
}
const key = async (k) => { await page.keyboard.press(k); await pacedWait(page, 220); };
const type = async (s) => { await page.keyboard.type(s, { delay: 25 }); await pacedWait(page, 220); };
const stored = async () => { await pacedWait(page, 1000); return JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PAGE_KEY) || "null"); };

function outline(doc) {
  const out = [];
  const txt = (n) => { let s = ""; const w = (x) => { if (x.text) s += x.text; (x.content || []).forEach(w); }; w(n); return s; };
  const walk = (n, depth) => {
    if (n.type === "bulletList" || n.type === "orderedList") {
      (n.content || []).forEach((li, i) => {
        const mark = n.type === "orderedList" ? `${(n.attrs?.start || 1) + i}.` : "•";
        /* a first item cannot nest under a bullet above it, so Tab raises its `indent` attribute instead (NEW-TAB): the level a
         * person sees is nesting PLUS that number */
        const ind = Math.max(0, Math.trunc(Number(li.attrs?.indent)) || 0);
        (li.content || []).forEach((c, k) => { if (k === 0) out.push(`${"  ".repeat(depth + ind)}${mark} ${txt(c)}`); else walk(c, depth + 1 + ind); });
      });
      return;
    }
    if (n.type === "table") { out.push(`${"  ".repeat(depth)}[table]`); return; }
    if (n.type === "noteAnchor" || n.type === "doc") { (n.content || []).forEach((c) => walk(c, depth)); return; }
    const t = txt(n);
    if (t) out.push(`${"  ".repeat(depth)}${t}`);
  };
  walk(doc, 0);
  return out;
}
const lineOf = (lines, needle) => lines.findIndex((l) => l.endsWith(needle));
const prefixOf = (line) => /^(\s*)(•|\d+\.)\s/.exec(line);
const nextMarker = (m) => (/^\d+\.$/.test(m[2]) ? `${parseInt(m[2], 10) + 1}.` : "•");

/* ── KNOWN-GOOD ARM ─────────────────────────────────────────────────────────────────────── */
console.log("\n=== KNOWN-GOOD ARM — Enter at the end of a REAL typed bullet continues it ===");
{
  await seed([box("b1", [{ type: "bulletList", content: [{ type: "listItem", content: [para("Typed bullet")] }] }]), para("")]);
  await enterBox("Typed bullet"); await key("Enter"); await type("Second");
  const lines = outline(await stored());
  const good = lines[0] === "• Typed bullet" && lines[1] === "• Second";
  ok("Enter on a typed bullet makes a sibling bullet", good, JSON.stringify(lines));
  if (!good) { console.log("\nVOID: the known-good arm failed — the harness cannot drive Enter in a list."); await browser.close(); process.exit(2); }
}

/* ── A · FUTURE PASTES ──────────────────────────────────────────────────────────────────── */
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const CASES = [
  { name: "word · L1", fx: "word-outline-table", needle: "Hard costs", level: 1 },
  { name: "word · L3", fx: "word-outline-table", needle: "Impact fees are charged per lot", level: 3 },
  { name: "word · L4", fx: "word-outline-table", needle: "Fees step down as the building gets larger", level: 4 },
  { name: "onenote · L2", fx: "onenote-outline-table-in-li", needle: "Permits and impact fees", level: 2 },
  { name: "onenote · L1", fx: "onenote-outline-table-in-li", needle: "Hard costs", level: 1 },
  { name: "word numbered · L1", fx: "word-numbered-outline", needle: "Construction", level: 1 },
  { name: "word numbered · L2", fx: "word-numbered-outline", needle: "Platting", level: 2 },
];
async function pasteFresh(fx) {
  await seed([para("")]);
  await armBlank();
  await paste(load(fx));
  return outline(await stored());
}
for (const c of CASES.filter((x) => !only || only.some((o) => x.name.includes(o)))) {
  console.log(`\n=== ${c.name} — ${c.needle} ===`);
  let base = await pasteFresh(c.fx);
  const at = lineOf(base, c.needle);
  ok(`${c.name}: the fixture pasted with the target line present`, at >= 0, JSON.stringify(base));
  if (at < 0) continue;
  const m = prefixOf(base[at]);
  ok(`${c.name}: the target line is a real list item (not a paragraph that begins with a glyph)`, !!m, JSON.stringify(base[at]));
  if (!m) continue;
  const sib = `${m[1]}${nextMarker(m)} NEW`;
  const want = [...base.slice(0, at + 1), sib, ...base.slice(at + 1)];
  // Enter at the end → a sibling at the same level with the same kind of marker
  await enterBox(c.needle); await key("End"); await key("Enter"); await type("NEW");
  let got = outline(await stored());
  ok(`${c.name}: Enter makes a sibling item at the same level and marker`, JSON.stringify(got) === JSON.stringify(want), `\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);

  // Enter on the empty new item steps out ONE level (level 1 leaves the list)
  await pasteFresh(c.fx); await enterBox(c.needle); await key("End"); await key("Enter"); await key("Enter"); await type("OUT");
  got = outline(await stored());
  const outLine = got.find((l) => l.endsWith("OUT"));
  const wantOut = c.level === 1 ? "OUT" : `${"  ".repeat(c.level - 2)}${(/^\d+\./.test(m[2]) ? "" : "• ")}OUT`.replace(/^(\s*)OUT$/, (x) => x);
  ok(`${c.name}: Enter on the empty item steps out one level`, !!outLine && (c.level === 1 ? !/^\s*(•|\d+\.)\s/.test(outLine) : outLine.startsWith("  ".repeat(c.level - 2)) && !outLine.startsWith("  ".repeat(c.level - 1))), `want ${wantOut} · got ${JSON.stringify(outLine)} in ${JSON.stringify(got)}`);

  // Ctrl+Z right after the Enter puts everything back
  await pasteFresh(c.fx); await enterBox(c.needle); await key("End"); await key("Enter"); await key("Control+z");
  got = outline(await stored());
  ok(`${c.name}: Ctrl+Z right after Enter restores the list exactly`, JSON.stringify(got) === JSON.stringify(base), `\n      want ${JSON.stringify(base)}\n      got  ${JSON.stringify(got)}`);

  // Tab nests it one deeper, Shift+Tab brings it back exactly (only where a sibling above exists)
  if (c.level >= 1) {
    await pasteFresh(c.fx); await enterBox(c.needle); await key("End"); await key("Tab");
    got = outline(await stored());
    const i2 = lineOf(got, c.needle);
    ok(`${c.name}: Tab moves the item one level deeper (text unchanged)`, i2 >= 0 && got[i2].startsWith(`${m[1]}  `) , JSON.stringify(got[i2]));
    await key("Shift+Tab");
    got = outline(await stored());
    ok(`${c.name}: Shift+Tab brings it back to the original outline exactly`, JSON.stringify(got) === JSON.stringify(base), `\n      want ${JSON.stringify(base)}\n      got  ${JSON.stringify(got)}`);
  }
}

/* Enter in the MIDDLE of an item splits it; Backspace at the start of an item takes ONE predictable step */
if (!only || only.includes("split")) {
  console.log("\n=== split in the middle · Backspace at the start ===");
  await pasteFresh("word-outline-table");
  await enterBox("Hard costs"); await clickAt("Hard costs", " costs".length); await key("Enter");
  let got = outline(await stored());
  const i = got.findIndex((l) => l === "• Hard");
  ok("Enter in the middle of 'Hard costs' splits it into two bullets", i >= 0 && got[i + 1] === "•  costs", JSON.stringify(got));
  await key("Backspace");                                           // the caret is at the start of the second item
  got = outline(await stored());
  const tail = got.slice(-2);
  ok("Backspace at the start of an item takes ONE step (the bullet goes, the text stays, nothing merges up)", tail[0] === "• Hard" && tail[1] === " costs", JSON.stringify(got));
}

/* ── B · NOTES ALREADY PASTED (the shape the OLD paste stored) ──────────────────────────── */
console.log("\n=== B · a note pasted BEFORE the fix: Enter works there too, and the result survives a reload ===");
{
  const GAP = " ".repeat(7);
  const fake = (glyph, words) => ({ type: "paragraph", content: [{ type: "text", text: glyph }, { type: "text", text: GAP }, { type: "text", text: words }] });
  const legacy = [box("b1", [fake("•", "LEED"), fake("○", "1M SF - $90K"), fake("§", "Third level"), fake("□", "Fourth level"), fake("•", "Next")]), para("")];
  await seed(legacy);
  const untouched = JSON.stringify(await stored());
  ok("opening a note nobody edits does NOT rewrite it (the stored page still holds the text bullets)", untouched.includes('"text":"•"') && !untouched.includes("bulletList"), untouched.slice(0, 200));
  await enterBox("1M SF - $90K"); await key("End"); await key("Enter"); await type("400K SF - $85K");
  let got = outline(await stored());
  const wantB = ["• LEED", "  • 1M SF - $90K", "  • 400K SF - $85K", "    • Third level", "      • Fourth level", "• Next"];
  ok("Enter after the level-2 line makes a level-2 sibling (the owner's exact case)", got.includes("  • 400K SF - $85K") && got.indexOf("  • 400K SF - $85K") === got.indexOf("  • 1M SF - $90K") + 1, JSON.stringify(got));
  ok("the whole note is real nested lists at the right levels, with no glyph left in the text", got.every((l) => !/[•○§□]\s+[•○§□]/.test(l)) && got[0] === "• LEED" && got.includes("• Next"), JSON.stringify(got));
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
  const after = outline(JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PAGE_KEY)));
  ok("after a RELOAD the stored page still holds the new item as a real list item at level 2", JSON.stringify(after) === JSON.stringify(got), `\n      before ${JSON.stringify(got)}\n      after  ${JSON.stringify(after)}`);
  const stillLists = await page.evaluate(() => document.querySelectorAll(".ProseMirror ul ul").length);
  ok("and the reloaded editor renders nested lists (not paragraphs)", stillLists >= 1, `nested ul count ${stillLists}`);
}

ok("no page errors", errs.length === 0, errs.join(" | "));
console.log(`\n${passN} passed, ${failN} failed`);
await browser.close();
process.exit(failN ? 1 : 0);
