#!/usr/bin/env node
/* verify-notes-list-paste — A WORD / ONENOTE OUTLINE ARRIVES AS A REAL NESTED LIST, WITH ITS TABLE UNDER ITS BULLET
 * (NEW-1 / NEW-2, owner report 2026-10-30: bullets came through as literal "o", "§" and "□"; a small table nested in
 * the outline came through as loose lines).
 *
 * The clipboards are the committed fixtures in test/fixtures/clipboard-lists — Word's real markup shape
 * (`mso-list`, `mso-list:Ignore` marker spans in Symbol / Courier New / Wingdings, `<![if !supportLists]>`, MsoListParagraph
 * classes, @list definitions) and OneNote's (`<ul>/<li>`, hanging-indent glyph markers). ⛔ They are SYNTHETIC models of those
 * products, built from the owner's description: this proves the WIRING against faithful markup, not a capture from his machine
 * (see manifest note in the carry-forward file). Each is pasted through a REAL paste event carrying a DataTransfer with the
 * fixture's exact bytes, into a real box, and judged on the STORED document.
 *
 * ⛔ KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): plain two-line text must land as text, and Google Docs' own list
 * must land as a list. If either fails the harness is on trial and the run is VOID.
 *
 * `BASE_URL` (default http://127.0.0.1:5199) · `PW_CHROME` · `ONLY=<fixture>` to narrow.
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
/* CI leaves PW_CHROME unset on purpose: chromium.launch() then resolves the revision `playwright install` fetched */
const EXEC = process.env.PW_CHROME || undefined;
const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../test/fixtures/clipboard-lists");
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";
const load = (n) => ({ html: fs.readFileSync(path.join(FX, `${n}.html`), "utf8"), text: fs.readFileSync(path.join(FX, `${n}.txt`), "utf8") });

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-list-paste");

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
  await pacedWait(page, 700);
}
async function clickIn(needle) {
  const p = await page.evaluate((n) => {
    const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT);
    let node;
    while ((node = w.nextNode())) {
      const i = node.nodeValue.indexOf(n);
      if (i < 0) continue;
      const r = document.createRange(); r.setStart(node, i + n.length); r.collapse(true);
      const b = r.getBoundingClientRect();
      return { x: Math.round(b.left) + 1, y: Math.round(b.top + b.height / 2) };
    }
    return null;
  }, needle);
  if (!p) throw new Error(`could not find "${needle}" to click`);
  await page.mouse.click(p.x, p.y);
  await pacedWait(page, 250);
}
const enter = async (needle) => { await clickIn(needle); await pacedWait(page, 650); await clickIn(needle); };
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
const stored = async () => JSON.parse(await page.evaluate((k) => localStorage.getItem(k), PAGE_KEY) || "null");

/* the document as a person reads it: one line per paragraph, bullets/numbers by depth, tables as a grid */
function outline(doc) {
  const out = [];
  const txt = (n) => { let s = ""; const w = (x) => { if (x.text) s += x.text; (x.content || []).forEach(w); }; w(n); return s; };
  const walk = (n, depth, list) => {
    if (n.type === "bulletList" || n.type === "orderedList") {
      (n.content || []).forEach((li, i) => {
        const mark = n.type === "orderedList" ? `${(n.attrs?.start || 1) + i}.` : "•";
        (li.content || []).forEach((c, k) => {
          if (k === 0) out.push(`${"  ".repeat(depth)}${mark} ${txt(c)}`);
          else walk(c, depth + 1, true);
        });
      });
      return;
    }
    if (n.type === "table") {
      out.push(`${"  ".repeat(depth)}[table ${(n.content || []).map((r) => (r.content || []).map((c) => txt(c)).join(" | ")).join(" ; ")}]`);
      return;
    }
    if (n.type === "noteAnchor" || n.type === "doc") { (n.content || []).forEach((c) => walk(c, depth, list)); return; }
    const t = txt(n);
    if (t) out.push(`${"  ".repeat(depth)}${t}`);
  };
  walk(doc, 0, false);
  return out;
}
const MARKER_CHARS = /[·§□▪]/;
const leftoverMarker = (lines) => lines.find((l) => MARKER_CHARS.test(l) || /^\s*[•\d.a-z]*\s*o\s{2,}/.test(l.replace(/^\s*•\s/, "")));

const TABLE = "[table SF | $/SF ; <100K | 1 ; 100K - 250K | .60-.75 ; 500K - 750K | .50 - .40 ; 750K - 1M | .40 - .35]";
const WANT = {
  "word-outline-table": ["• Soft costs", "  • Design and engineering", "    • Fee by building size, per square foot", `      ${TABLE}`, "      • Fees step down as the building gets larger", "  • Permits and impact fees", "    • Impact fees are charged per lot", "• Hard costs"],
  "word-outline-tab-rows": ["• Soft costs", "  • Design and engineering", "    • Fee by building size, per square foot", `      ${TABLE}`, "  • Permits and impact fees"],
  "word-outline-table-outside": ["• Soft costs", "  • Design and engineering", "    • Fee by building size, per square foot", TABLE, "Closing paragraph after the table."],
  "word-numbered-outline": ["1. Entitlements", "  1. Zoning", "    1. Confirm the district", "    2. Check the overlay", "  2. Platting", "2. Construction"],
  "onenote-outline-table-in-li": ["• Soft costs", "  • Design and engineering", "    • Fee by building size, per square foot", `      ${TABLE}`, "      • Fees step down as the building gets larger", "  • Permits and impact fees", "• Hard costs"],
  "onenote-outline-table-after-ul": ["• Soft costs", "  • Design and engineering", "    • Fee by building size, per square foot", TABLE],
  "onenote-hanging-markers": ["• Soft costs", "  • Design and engineering", "    • Fee by building size", "      • Fees step down"],
};
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;

const LANDINGS = {
  "armed-empty-sheet": { doc: [para("")], act: armBlank },
  "empty-box-line": { doc: [box("b1", [para("x")]), para("")], act: async () => {
    // a box whose only line is empty after the first character is removed: enter, select all in the box, delete
    await enter("x"); await page.keyboard.press("Backspace"); await pacedWait(page, 300);
  } },
};

console.log("\n=== KNOWN-GOOD ARM — plain text lands as text; Google Docs' own list lands as a list ===");
let armOk = true;
for (const [land, spec] of Object.entries(LANDINGS)) {
  await seed(spec.doc); await spec.act();
  await paste({ text: "alpha line\nbeta line" });
  const t = outline(await stored()).join("|");
  const good = /alpha line/.test(t) && /beta line/.test(t);
  if (!good) armOk = false;
  ok(`plain text pastes on "${land}"`, good, t);
}
{
  const gdocs = `<meta charset='utf-8'><b style="font-weight:normal;" id="docs-internal-guid-1"><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:disc;" aria-level="1"><p dir="ltr" role="presentation"><span>Docs one</span></p></li><ul style="margin-top:0;margin-bottom:0;padding-inline-start:48px;"><li dir="ltr" style="list-style-type:circle;" aria-level="2"><p dir="ltr" role="presentation"><span>Docs two</span></p></li></ul></ul></b>`;
  await seed([para("")]); await armBlank();
  await paste({ html: gdocs, text: "Docs one\nDocs two" });
  const o = outline(await stored());
  const good = o[0] === "• Docs one" && o[1] === "  • Docs two";
  if (!good) armOk = false;
  ok("Google Docs list lands as a nested list (unchanged by this work)", good, JSON.stringify(o));
}
if (!armOk) { console.log("\nVOID: a known-good arm failed — the harness cannot see a paste, so no verdict below means anything."); await browser.close(); process.exit(2); }

for (const name of Object.keys(WANT).filter((n) => !only || only.includes(n))) {
  const fx = load(name);
  for (const [land, spec] of Object.entries(LANDINGS)) {
    await seed(spec.doc); await spec.act();
    await paste(fx);
    const lines = outline(await stored());
    const want = WANT[name];
    ok(`${name} · ${land} — arrives as the outline it was`, JSON.stringify(lines) === JSON.stringify(want), `\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(lines)}`);
    ok(`${name} · ${land} — no bullet glyph is left in the text`, !leftoverMarker(lines), leftoverMarker(lines));
  }
}

/* landing INSIDE an existing bullet: the outline still comes in, still no glyphs, the table still a table */
for (const name of ["word-outline-table", "onenote-outline-table-in-li"].filter((n) => !only || only.includes(n))) {
  await seed([box("b1", [{ type: "bulletList", content: [{ type: "listItem", content: [para("Bullet one")] }] }]), para("")]);
  await enter("Bullet one");
  await paste(load(name));
  const lines = outline(await stored());
  ok(`${name} · in-bullet — the table arrives as a table`, lines.some((l) => l.includes(TABLE)), JSON.stringify(lines));
  ok(`${name} · in-bullet — no bullet glyph is left in the text`, !leftoverMarker(lines), leftoverMarker(lines));
  ok(`${name} · in-bullet — every outline line arrived`, ["Soft costs", "Design and engineering", "Hard costs"].filter((w) => name !== "word-outline-table" || w !== "Hard costs" || true).every((w) => lines.join("\n").includes(w)), JSON.stringify(lines));
}

/* THE SAFETY NET, driven on purpose (no clipboard we know of makes the parse drop a table, so it could otherwise never be seen
 * working): a slice that lost its tables gets them back, built from the cells the html held; a slice that kept them is untouched. */
{
  await seed([para("")]); await armBlank();
  const html = load("word-outline-table").html;
  const got = await page.evaluate((h) => window.__noteEditor.pasteSafetyNetProbe(h), html);
  const flat = JSON.stringify(got || []);
  const cells = (flat.match(/"type":"tableCell"/g) || []).length;
  ok("safety net — a slice that lost its table gets it back (5 rows × 2 cells)", cells === 10 && /"text":"100K - 250K"/.test(flat) && /"text":"\.60-\.75"/.test(flat), flat.slice(0, 300));
  const none = await page.evaluate(() => window.__noteEditor.pasteSafetyNetProbe("<p>no table here</p>"));
  ok("safety net — html with no table adds nothing", !JSON.stringify(none || []).includes("tableCell"), JSON.stringify(none));
}

ok("no page errors", errs.length === 0, errs.join(" | "));
console.log(`\n${passN} passed, ${failN} failed`);
await browser.close();
process.exit(failN ? 1 : 0);
