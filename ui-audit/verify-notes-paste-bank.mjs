#!/usr/bin/env node
/* verify-notes-paste-bank — EVERY NOTES CLIPBOARD FIXTURE, THROUGH THE REAL PASTE PATH, JUDGED ON DOCUMENT STRUCTURE
 * (NEW-1, 2026-11-05: "this is what stops the paste bug stream from coming back").
 *
 * The bank is ui-audit/lib/pasteBank.mjs: the clipboard-tables fixtures (OneNote desktop/web, Word, Outlook, Excel, Sheets…),
 * the clipboard-lists fixtures (Word/OneNote outlines) and the clipboard-bank fixtures added with it (the 2026-10-30 spike's four
 * Office losses — `bgcolor` fills, <font color>, empty cells arriving as a space, Word bullets arriving as "·" paragraphs — plus
 * a Word bullet+numbered list and an Excel range with a merged cell, a fill, an empty cell, a bold cell and a coloured-text cell).
 *
 * Each is pasted through a REAL ClipboardEvent carrying a DataTransfer with the fixture's exact bytes into a real box (and, for
 * the added cases, onto armed blank paper too), and the STORED document is judged on STRUCTURE — rows, columns, merges, fills,
 * empty cells, marks, text colours, list nesting — never on "something appeared". A cell that should be empty and holds a space
 * fails; a fill that should be #ffff00 and is absent fails.
 *
 * ⛔ THE INSTRUMENT IS ON TRIAL FIRST (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): plain text must land as text (known-good arm), and the
 * judge must REJECT an empty document for a fixture that owes structure (teeth arm). Either failing VOIDS the run (exit 2) — a run
 * that cannot see a paste, or a judge that cannot fail, must never print a score.
 *
 * `BASE_URL` (default http://127.0.0.1:5199) · `PW_CHROME` · `ONLY=<id,id>` (substring match) to narrow.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { loadBank, unregisteredFixtures, summariseDoc, checkEntry, checkOptionFills } from "./lib/pasteBank.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
/* CI leaves PW_CHROME unset on purpose: chromium.launch() then resolves the revision `playwright install` fetched */
const EXEC = process.env.PW_CHROME || undefined;
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_KEY = "planyr:notes:page:v1:local:p1";

const bank = loadBank();
const only = process.env.ONLY ? process.env.ONLY.split(",") : null;
const entries = bank.filter((b) => !only || only.some((o) => b.id.includes(o)));

const browser = await chromium.launch({ ...(EXEC ? { executablePath: EXEC } : {}), args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-paste-bank");

let passN = 0; let failN = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  if (cond) { passN += 1; console.log(`  ✓ ${label}`); } else { failN += 1; failures.push(label); console.log(`  ✗ ${label}${detail ? `\n      ${detail}` : ""}`); }
};
const void_ = async (why) => { console.log(`\nVOID: ${why}`); await browser.close(); process.exit(2); };

const para = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const box = (aid, content) => ({ type: "noteAnchor", attrs: { x: 40, y: 40, w: 460, h: null, aid }, content });

async function seed(docContent) {
  /* leave the page first: an edited editor flushes its document as the tab unloads, which would overwrite the seed written next */
  await page.goto("about:blank");
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
/** Desktop is TWO-STAGE: press 1 on a box SELECTS it, press 2 puts the caret in (spaced out so it is not a double-click). */
const enter = async (needle) => { await clickIn(needle); await pacedWait(page, 650); await clickIn(needle); };
async function armBlank() {
  const at = await page.evaluate(() => { const s = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: Math.round(s.left + s.width * 0.5), y: Math.round(s.top + s.height * 0.45) }; });
  await page.mouse.dblclick(at.x, at.y);
  await pacedWait(page, 450);
  if (!(await page.evaluate(() => !!document.querySelector('[data-testid="note-pending-caret"]')))) throw new Error("a double-click on blank paper did not arm a caret — the harness is not in the state it claims");
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

/* ⛔ BOTH LANDINGS START ON AN EMPTY LINE. A caret at the END of existing text makes ProseMirror merge the paste's first
 * paragraph INTO that line ("Intro lineSoft costs") — correct editor behaviour, and exactly what made a first version of this
 * bank report a working paste as broken. The caret-in-text landings are verify-notes-table-paste.mjs's job. */
const LANDINGS = {
  "empty-box-line": { doc: [box("b1", [para("x")]), para("")], act: async () => { await enter("x"); await page.keyboard.press("Backspace"); await pacedWait(page, 300); } },
  "armed-empty-sheet": { doc: [para("")], act: armBlank },
};
const landingsFor = () => ["empty-box-line", "armed-empty-sheet"];

/* ── COMPLETENESS: nothing committed to a fixture directory may be missing from the bank ─────────────────────────── */
console.log("\n=== BANK COMPLETENESS ===");
const missing = unregisteredFixtures(bank);
ok("every committed clipboard fixture has a structural expectation in the bank", missing.length === 0, missing.join(", "));
ok(`the bank holds fixtures from all three directories (${bank.length})`, ["clipboard-tables", "clipboard-lists", "clipboard-bank"].every((d) => bank.some((b) => b.dir === d)));

/* ── TEETH ARM: the judge must be able to FAIL ───────────────────────────────────────────────────────────────────── */
console.log("\n=== TEETH ARM — an empty document must fail every fixture that owes structure ===");
{
  const empty = summariseDoc({ type: "doc", content: [{ type: "paragraph" }] });
  const survivors = bank.filter((b) => checkEntry(b, empty).length === 0).map((b) => b.id);
  if (survivors.length) await void_(`the judge passed an EMPTY document for: ${survivors.join(", ")} — it cannot fail, so no verdict below means anything.`);
  ok("the judge rejects an empty document for all " + bank.length + " fixtures", true);
}

/* ── KNOWN-GOOD ARM: a paste is visible to this harness ─────────────────────────────────────────────────────────── */
console.log("\n=== KNOWN-GOOD ARM — plain two-line text must land as text on both landings ===");
for (const [land, spec] of Object.entries(LANDINGS)) {
  await seed(spec.doc); await spec.act();
  await paste({ text: "alpha line\nbeta line" });
  const t = summariseDoc(await stored()).outline.join("|");
  const good = /alpha line/.test(t) && /beta line/.test(t);
  if (!good) await void_(`plain text did not land on "${land}" (${t}) — the harness cannot see a paste.`);
  ok(`plain text pastes on "${land}"`, good);
}

/* ── THE BANK ────────────────────────────────────────────────────────────────────────────────────────────────── */
let judged = 0;
for (const b of entries) {
  console.log(`\n=== ${b.id}${b.spike ? "  (2026-10-30 spike loss)" : ""} ===`);
  if (!b.html) { ok(`${b.id} — has html`, false, "no .html file"); continue; }
  for (const land of landingsFor()) {
    const spec = LANDINGS[land];
    await seed(spec.doc); await spec.act();
    await paste({ html: b.html, text: b.text });
    const doc = await stored();
    const problems = checkEntry(b, summariseDoc(doc));
    judged += 1;
    ok(`${b.id} · ${land} — document structure is right`, problems.length === 0, problems.join("\n      "));
    /* the decided split: a plain paste brings NO foreign shading, the paste-options tab's "Values and Source Formatting" does */
    const optionMode = (b.expect?.tables || []).map((t) => t.optionFills?.mode).find(Boolean);
    if (optionMode) {
      const chip = page.locator('[data-testid="note-paste-badge"]');
      if (await chip.count() === 0) { ok(`${b.id} · ${land} — the paste-options tab is offered`, false, "no badge after the paste"); continue; }
      await chip.click(); await pacedWait(page, 250);
      await page.locator(`[data-testid="note-paste-${optionMode}"]`).click(); await pacedWait(page, 1000);
      const after = checkOptionFills(b, summariseDoc(await stored()));
      ok(`${b.id} · ${land} — "${optionMode}" brings the source shading in`, after.length === 0, after.join("\n      "));
    }
  }
}

if (!only && judged < bank.length) await void_(`only ${judged} of ${bank.length} fixtures were judged`);
ok("no page error during any paste", errs.length === 0, errs.slice(0, 3).join(" | "));
console.log(`\n${passN} passed, ${failN} failed`);
if (failN) console.log("FAILED:\n - " + failures.join("\n - "));
await browser.close();
process.exit(failN ? 1 : 0);
