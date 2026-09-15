/* verify-notes-write-on-open — B1662464, "opening a note writes to it."
 *
 * Owner-relayed observation: a real note's stored body was found shorter than a Version
 * History revision taken minutes earlier, and Version History held a row labelled "While you
 * were typing" against a session in which nobody had typed a character. The report's own first
 * question: does the app write on open at all, with zero input?
 *
 * ⛔ MEASURED CAUSE. Tiptap's own mount-time schema settle — missing node attrs filled to their
 * schema defaults, and the TrailingNode extension inserting a blank paragraph so the cursor has
 * somewhere to land after a table/list — is a REAL, doc-changed ProseMirror transaction, fired
 * with zero keystrokes. `NoteEditor.jsx`'s `onUpdate` could not tell that transaction apart from
 * a real edit, so it queued a write, flipped the status to "unsaved", and (via `docTick`, which
 * also bumps on a pure `selectionUpdate`) could mint a version row labelled "typing" — on a page
 * nobody touched. Reproduced here across six run/mark shapes with ZERO interaction: before the
 * fix every one changed shape and got saved on the very first open; after the fix, none does.
 *
 * This harness does not — and cannot, sandboxed and signed out — settle whether any REAL text
 * was ever destroyed by this on a live account; see BACKLOG.md's B1662464 for that half, parked
 * `Verify: live` / `Blocker: real-data`. What this proves is narrower and unconditional: merely
 * opening a note, with no interaction at all, must never change the stored document or the
 * page's `updatedAt`. That property removes the entire class the report worried about — "any
 * normalisation bug becomes silent data loss just by looking at a page" — regardless of what
 * specifically happened to the one line that was reported missing.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";

const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});

const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const T = (text, marks) => ({ type: "text", text, ...(marks ? { marks } : {}) });
const P = (...c) => ({ type: "paragraph", content: c.length ? c : undefined });
const LI = (...c) => ({ type: "listItem", content: c });
const UL = (...items) => ({ type: "bulletList", content: items });

function textOf(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type === "text") out.push(node.text);
  for (const c of node.content || []) textOf(c, out);
  return out;
}

async function seed(page, content) {
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 300);
  await page.evaluate(([treeKey, prefix, doc]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "write-on-open repro", createdAt: 1000, updatedAt: 1000, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify({ type: "doc", content: doc }));
  }, [TREE_KEY, PAGE_PREFIX, content]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);
}

async function readStored(page) {
  return page.evaluate(([treeKey, prefix]) => {
    const tree = JSON.parse(localStorage.getItem(treeKey) || "null");
    const p1 = JSON.parse(localStorage.getItem(prefix + "p1") || "null");
    return { updatedAt: tree?.pages?.[0]?.updatedAt, doc: p1 };
  }, [TREE_KEY, PAGE_PREFIX]);
}

const CASES = [
  { name: "identical marks (three runs merge, stock ProseMirror behaviour)",
    doc: [UL(LI(P(T("Contacts: "), T("Jerry Hayley "), T("Kandice Cabets"))))] },
  { name: "differing textStyle fontSize between two adjacent runs",
    doc: [UL(LI(P(
      T("Jerry Hayley ", [{ type: "textStyle", attrs: { fontSize: "16px" } }]),
      T("Kandice Cabets", [{ type: "textStyle", attrs: { fontSize: "14px" } }]),
    )))] },
  { name: "one run bold, the adjacent run plain",
    doc: [UL(LI(P(T("Jerry Hayley ", [{ type: "bold" }]), T("Kandice Cabets"))))] },
  { name: "second run autolink-shaped (email) with a link mark",
    doc: [UL(LI(P(
      T("Jerry Hayley "),
      T("kandice@example.com", [{ type: "link", attrs: { href: "mailto:kandice@example.com", target: "_blank", rel: "noopener noreferrer" } }]),
    )))] },
  { name: "a real Tab-sunk nested list item with two runs on the child",
    doc: [UL(
      LI(P(T("MUD 377"))),
      LI(P(T("Engineer - Pape Dawson")), UL(LI(P(T("Dustin O'Neal "), T("713-428-2400", [{ type: "textStyle", attrs: { fontSize: "12px" } }]))))),
    )] },
  { name: "an item wearing Tab's flat indent attribute, two runs",
    doc: [UL({ type: "listItem", attrs: { indent: 1 }, content: [P(T("Jerry Hayley "), T("Kandice Cabets", [{ type: "bold" }]))] })] },
];

const rows = [];
for (const c of CASES) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await assertMeasurable(page, "verify-notes-write-on-open");

  await seed(page, c.doc);
  const after1 = await readStored(page);
  // Reopen mechanically — no click, no keystroke — via a route change and a hard reload.
  await page.goto(`${BASE}#/site`, { waitUntil: "domcontentloaded" });
  await pacedWait(page, 300);
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);
  const after2 = await readStored(page);

  const origText = c.doc.flatMap((n) => textOf(n)).join("");
  const t1 = textOf(after1.doc).join("");
  const t2 = textOf(after2.doc).join("");

  rows.push({
    name: c.name,
    noDocChangeOnOpen: JSON.stringify(after1.doc) === JSON.stringify({ type: "doc", content: c.doc }),
    noDocChangeOnReopen: JSON.stringify(after1.doc) === JSON.stringify(after2.doc),
    updatedAtUnchanged: after1.updatedAt === 1000 && after2.updatedAt === 1000,
    textPreserved: t1 === origText && t2 === origText,
    errors,
  });
  await ctx.close();
}

console.log("\n" + "=".repeat(100));
console.log("NOTES WRITE-ON-OPEN — opening a note, with zero interaction, must change nothing");
console.log("=".repeat(100));
let failed = 0;
for (const r of rows) {
  const ok = r.noDocChangeOnOpen && r.noDocChangeOnReopen && r.updatedAtUnchanged && r.textPreserved && !r.errors.length;
  if (!ok) failed += 1;
  console.log(`  ${ok ? "✓" : "✗"} ${r.name}`);
  if (!ok) {
    console.log(`      stored doc unchanged on open: ${r.noDocChangeOnOpen}`);
    console.log(`      stored doc unchanged on reopen: ${r.noDocChangeOnReopen}`);
    console.log(`      updatedAt unchanged: ${r.updatedAtUnchanged}`);
    console.log(`      text preserved: ${r.textPreserved}`);
    if (r.errors.length) console.log(`      page errors: ${r.errors.slice(0, 3).join(" | ")}`);
  }
}
console.log(`\n${rows.length - failed}/${rows.length} checks passed`);
await browser.close();
process.exit(failed ? 1 : 0);
