/* verify-notes-open-page-adopt — NEW-7. A body the SYNC adopts must reach the OPEN editor in place.
 *
 * The store half (type → visibilitychange → newer server copy, both edits survive) is the repo-root
 * test `test/notesOpenPageSync.test.js`, against a gated fake network. THIS harness proves the half
 * a fake editor cannot: that the REAL editor's registered `applyDocument` (the exact function the
 * store calls for an adopted body) (1) keeps the SAME editor instance — a remount would replace the
 * ProseMirror node, which is what closed the phone keyboard — (2) keeps the caret where it was,
 * (3) shows the new text, and (4) queues NO save of its own (the text is already in storage; a
 * queued save would be a spurious dirty page pushed upward).
 *
 * Known-good arm (CLAUDE.md DRIVER-SCROLL §6): a control that DOES remount — a plain page switch
 * and back — must replace the node, or the identity probe could not have seen a remount at all. */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";
const P = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
await assertMeasurable(page, "verify-notes-open-page-adopt");

await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
await pacedWait(page, 300);
await page.evaluate(([tk, pp, d]) => {
  localStorage.clear();
  localStorage.setItem(tk, JSON.stringify({ v: 3, tombs: [], trash: [],
    pages: [{ id: "p1", title: "adopt", createdAt: 1000, updatedAt: 1000, projectId: null, pages: [] },
      { id: "p2", title: "other", createdAt: 1000, updatedAt: 1000, projectId: null, pages: [] }] }));
  localStorage.setItem(pp + "p2", JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "second" }] }] }));
  localStorage.setItem("planyr:notes:activePage:v1:local", "p1");
  localStorage.setItem(pp + "p1", JSON.stringify({ type: "doc", content: d }));
}, [TREE_KEY, PAGE_PREFIX, [P("alpha one"), P("bravo two"), P("charlie three")]]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
await pacedWait(page, 700);

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "✅" : "⛔"} ${name}${detail ? " — " + detail : ""}`); };

// Real caret: click into paragraph 2, move to the end of "bravo", then a REAL keystroke.
await page.evaluate(() => { document.querySelector('[data-testid="note-body"]').__probe = "same-instance"; });
const pos = await page.evaluate(() => { const h = window.__noteEditor; return h.startOf([1]); });
await page.evaluate((p) => window.__noteEditor.caretAt(p + 3), pos);
await page.keyboard.type("Z");                       // pending, un-flushed (inside the debounce)
const before = await page.evaluate(() => window.__noteEditor.selection());

const took = await page.evaluate((d) => window.__noteEditor.applyExternal({ type: "doc", content: d }),
  [P("alpha one FROM SERVER"), P("braZvo two"), P("charlie three")]);
await pacedWait(page, 120);
const after = await page.evaluate(() => ({
  probe: document.querySelector('[data-testid="note-body"]').__probe,
  sel: window.__noteEditor.selection(),
  text: document.querySelector('[data-testid="note-body"]').innerText,
  active: document.activeElement?.closest?.('[data-testid="note-body"]') ? "editor" : String(document.activeElement?.tagName),
}));
check("the editor took the body in place", took === true);
check("same editor instance (no remount)", after.probe === "same-instance");
check("the new text is on screen", /FROM SERVER/.test(after.text));
check("the caret stayed where it was", after.sel.from === before.from && after.sel.empty, `${before.from} → ${after.sel.from}`);
check("focus stayed in the editor", after.active === "editor", after.active);

// No save queued by the external apply: reset the stored page, wait out the debounce, expect untouched.
await page.evaluate(([pp]) => localStorage.setItem(pp + "p1", JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "STORED-MARK" }] }] })), [PAGE_PREFIX]);
await page.evaluate(() => window.__noteEditor.applyExternal({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "from the sync" }] }] }));
await pacedWait(page, 1500);
const stored = await page.evaluate(([pp]) => localStorage.getItem(pp + "p1"), [PAGE_PREFIX]);
check("an external apply queues no save of its own", /STORED-MARK/.test(stored), stored.slice(0, 80));

// Known-good arm: a real remount (open another page, come back) DOES replace the node.
await page.getByText("other", { exact: true }).first().click();
await pacedWait(page, 500);
await page.getByText("adopt", { exact: true }).first().click();
await pacedWait(page, 500);
const remounted = await page.evaluate(() => document.querySelector('[data-testid="note-body"]').__probe !== "same-instance");
check("KNOWN-GOOD ARM: a real remount replaces the node (the probe can see one)", remounted);
check("no page errors", errors.length === 0, errors.join(" | "));

await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(bad.length ? `\n⛔ ${bad.length} failed` : "\n✅ all passed");
process.exit(bad.length ? 1 : 0);
