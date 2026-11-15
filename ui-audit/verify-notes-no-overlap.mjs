#!/usr/bin/env node
/* verify-notes-no-overlap — NEW-1 / NEW-2 (B2671237 + B2671238): after ANY edit, nothing on a Notes page draws on top of anything else.
 *
 * The instrument is ui-audit/lib/notesOverlap.mjs (read its header): several one-line boxes stacked close together, then every action that can
 * change a box's size or position — typing to wrap, Enter, paste of plain text / of text copied from a box / with each paste option / from the
 * committed Word, Outlook, Excel and Chrome clipboards, lists, indent, font size, headings, a table and its rows, an image, a shrink, a width
 * drag, a border move onto another box — measuring every box's RENDERED rectangle after each one, after ONE Ctrl+Z, and after a reload.
 *
 * Local run: BASE_URL (default http://127.0.0.1:5199) · PW_CHROME (executable) · ONLY=id,id to run a subset. Red-proof: run it against a
 * build WITHOUT the fix (git stash the src/ change) — NEW-1's scenarios must fail there and pass on the fix. The same sweep runs LIVE, signed in,
 * from verify-notes-engine-live.mjs (section 7). Exit 0 = all pass, 1 = a check failed, 2 = VOID (the instrument could not see). */
import { chromium } from "playwright";
import { runSweep, readRects, readDoc } from "./lib/notesOverlap.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://127.0.0.1:5199";
const TREE_KEY = "planyr:notes:tree:v1:local"; const PAGE_KEY = "planyr:notes:page:v1:local:p1";
let pass = 0; let fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const voided = (why) => { console.log(`\nVOID: ${why}`); process.exitCode = 2; throw new Error("void"); };

const browser = await chromium.launch(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME, args: ["--no-sandbox"] } : { args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, permissions: ["clipboard-read", "clipboard-write"] });
const page = await ctx.newPage();
const errs = []; page.on("pageerror", (e) => errs.push(e.message));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await assertMeasurable(page, "verify-notes-no-overlap");
const settle = (ms) => page.waitForTimeout(ms);

/** A clean page for every scenario: write the fixture into storage and reload, so no undo history from the seed exists. */
async function seed(doc) {
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([tk, pk, d]) => { localStorage.clear(); localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Throwaway", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] })); localStorage.setItem(pk, JSON.stringify(d)); }, [TREE_KEY, PAGE_KEY, doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await settle(1200);
}
async function reloadRead() {
  await settle(1500);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 }); await settle(1200);
  return { rects: await readRects(page), doc: await readDoc(page) };
}

try {
  const results = await runSweep({ page, seed, ok, settle, voided, reloadRead, only: (process.env.ONLY || "").split(",").filter(Boolean) });
  const sweep = results.map((r) => `${r.id}:${r.status}`).join(" ");
  console.log(`\nsweep: ${sweep}`);
  ok("page errors during the sweep", errs.length === 0, errs.slice(0, 3).join(" | "));
} catch (e) { if (e.message !== "void") { fail++; console.log("  ✗ run aborted:", String(e).slice(0, 300)); } }
await browser.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(process.exitCode || (fail ? 1 : 0));
