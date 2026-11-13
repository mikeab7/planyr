#!/usr/bin/env node
/* verify-notes-caret-snapback — THE NEW-3 RECORDER IS WIRED (owner report 2026-11-12 1:43 PM; see src/workspaces/notes/lib/notesCaretSnapback.js).
 * The symptom was not reproduced, so the editor now reports it when it happens. This proves the recorder: a NORMAL click sends nothing; a click whose caret
 * is moved elsewhere right after (forced here with the E2E caret hook, which stands in for the unknown cause) sends ONE `notes-snapback` event carrying
 * structure only — and no word of the note; a press that began with the editor blurred (select-then-enter) sends nothing.
 * Known-good arm: the forced snap-back MUST be recorded or the run is VOID. `BASE_URL` · `PW_CHROME`. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
const browser = await chromium.launch({ ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}), args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-caret-snapback");
let pass = 0, fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const wait = (ms) => pacedWait(page, ms);
const li = (t) => ({ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: t }] }] });
const doc = { type: "doc", content: [{ type: "noteAnchor", attrs: { x: 40, y: 40, w: 460, h: null, aid: "b1" }, content: [{ type: "paragraph", content: [{ type: "text", text: "Zebra intro line" }] }, { type: "orderedList", content: [li("Quokka first item"), li("Wombat second item"), li("Ibex third item")] }] }] };
await page.goto("about:blank");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
await page.evaluate(([d]) => {
  localStorage.clear(); localStorage.setItem("planyr.theme", "light");
  localStorage.setItem("planyr:notes:tree:v1:local", JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Throwaway", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
  localStorage.setItem("planyr:notes:page:v1:local:p1", JSON.stringify(d));
}, [doc]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 }); await wait(800);
const endOf = (needle) => page.evaluate((n) => { const w = document.createTreeWalker(document.querySelector(".ProseMirror"), NodeFilter.SHOW_TEXT); let node; while ((node = w.nextNode())) { const i = node.nodeValue.indexOf(n); if (i < 0) continue; const r = document.createRange(); r.setStart(node, i + n.length); r.collapse(true); const b = r.getBoundingClientRect(); return { x: Math.round(b.left) + 1, y: Math.round(b.top + b.height / 2) }; } return null; }, needle);
const click = async (needle) => { const p = await endOf(needle); await page.mouse.click(p.x, p.y); };
const events = () => page.evaluate(() => (window.pfTelemetry?.recent?.() || []).filter((r) => /notes-snapback/.test(JSON.stringify(r))).length);
const lastEvent = () => page.evaluate(() => JSON.stringify((window.pfTelemetry?.recent?.() || []).filter((r) => /notes-snapback/.test(JSON.stringify(r))).slice(-1)[0] || null));
// enter the box (two-stage: select, then enter)
await click("Zebra intro line"); await wait(650); await click("Zebra intro line"); await wait(400);
const base = await events();

console.log("\n=== a normal click records nothing ===");
await click("Quokka first item"); await wait(1000);
ok("clicking a list line and staying there sends no event", (await events()) === base);

console.log("\n=== KNOWN-GOOD ARM — a forced snap-back is recorded ===");
await page.evaluate(() => { const once = () => { document.removeEventListener("mouseup", once, false); setTimeout(() => window.__noteEditor.caretAt(5), 40); }; document.addEventListener("mouseup", once, false); });
await click("Ibex third item"); await wait(1200);
if ((await events()) !== base + 1) { console.log(`\nVOID: a forced snap-back was not recorded (events ${base} → ${await events()}) — the recorder is not wired or the ring cannot be read.`); await browser.close(); process.exit(2); }
ok("a click whose caret was moved away right after sends exactly one notes-snapback event", true);
const ev = (await lastEvent()).replace(/\\"/g, `"`);
ok("the event names structure (node types, list depth, direction)", /"listDepth":1/.test(ev) && /"direction"/.test(ev) && /paragraph/.test(ev), ev.slice(0, 300));
ok("…and carries no word of the note", !/Quokka|Wombat|Ibex|Zebra/.test(ev), ev.slice(0, 300));

console.log("\n=== it is rate-limited, and a press that begins blurred records nothing ===");
await page.evaluate(() => { const once = () => { document.removeEventListener("mouseup", once, false); setTimeout(() => window.__noteEditor.caretAt(5), 40); }; document.addEventListener("mouseup", once, false); });
await click("Wombat second item"); await wait(1200);
ok("a second snap-back inside five minutes is not sent again", (await events()) === base + 1);
await page.keyboard.press("Escape"); await wait(200); await page.keyboard.press("Escape"); await wait(300);
await page.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
const before = await events();
await click("Ibex third item"); await wait(1000);
ok("a click made while the editor was not focused records nothing", (await events()) === before);
console.log(`\n${pass} passed, ${fail} failed`);
await browser.close();
process.exit(fail ? 1 : 0);
