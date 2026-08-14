/* diagnose-notes-outdent — SHIFT+TAB DRAGS OTHER PEOPLE'S LINES WITH IT (NEW-OUTDENT).
 *
 * ⛔ HIS REPORT, with a screenshot: *"I'm trying to press shift tab to promote MUD ATTORNEY: BRIAN
 * YATES, that line. I'm trying to promote it to the left, but it takes Dustin O'Neal, the phone
 * number, and the email with it."*
 *
 * ⛔ AND HIS INSTRUCTION, which this file exists to obey: **do not fix from a theory.** Dump the
 * STORED document before the press and after it, diff them, and let the diff say which of three
 * different bugs this is — the lift capturing PRECEDING siblings, capturing FOLLOWING siblings, or
 * re-parenting the wrong subtree. The screenshot cannot distinguish them and neither can reading
 * the code.
 *
 * ⛔ THE FIXTURE IS HIS OUTLINE, NOT A SIMPLIFICATION — four levels deep, with the branch that
 * moved sitting BESIDE the pressed line rather than under it, and with "Dustin O'Neal" carrying a
 * SMALLER FONT than its siblings, because he flagged that as a possible cause: if any of this code
 * walks the tree by rendered geometry rather than by document structure, the odd one out is where
 * it would show.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await assertMeasurable(page, "diagnose-notes-outdent");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

const storedDoc = (page_) => page_.evaluate((k) => localStorage.getItem(k), `${PAGE_PREFIX}p1`);

/** HIS OUTLINE, exactly as the screenshot shows it. */
function fixture() {
  const T = (t, marks) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
  const P = (...c) => ({ type: "paragraph", content: c });
  const LI = (...c) => ({ type: "listItem", content: c });
  const UL = (...items) => ({ type: "bulletList", content: items });
  const small = [{ type: "textStyle", attrs: { fontSize: "12px" } }];
  return {
    type: "doc",
    content: [UL(
      LI(P(T("MUD 377")), UL(
        LI(P(T("Active"))),
        LI(P(T("Engineer - Pape Dawson")), UL(
          // ⛔ THE SMALLER FONT, kept because he named it as a candidate cause.
          LI(P(T("Dustin O'Neal", small)), UL(
            LI(P(T("P: 713-428-2400"))),
            LI(P(T("doneal@pape-dawson.com", [{ type: "link", attrs: { href: "mailto:doneal@pape-dawson.com" } }]))),
          )),
        )),
        LI(P(T("MUD ATTORNEY: BRIAN YATES"))),
      )),
      LI(P(T("Water Authority: Northwest Regional Water Authority"))),
      LI(P(T("Sanitary:")), UL(
        LI(P(T("Discharge Permit may be 18 months"))),
      )),
    )],
  };
}

async function seed(doc = fixture()) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, prefix, d]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "MUD 377", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify(d));
  }, [TREE_KEY, PAGE_PREFIX, doc]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

/** The outline as a person reads it: one line per item, indented by its REAL depth in the
 *  document plus whatever `indent` attribute it carries. This is the diff he asked for, in the
 *  form that makes the failure's SHAPE visible rather than a wall of JSON. */
function outline(raw) {
  let doc = null;
  try { doc = JSON.parse(raw || "null"); } catch (_) { return ["<unreadable>"]; }
  const out = [];
  const walk = (n, depth) => {
    if (!n) return;
    if (n.type === "listItem" || n.type === "taskItem") {
      let text = "";
      const dig = (x) => { if (x?.type === "text") text += x.text; (x?.content || []).forEach(dig); };
      (n.content || []).filter((c) => c.type !== "bulletList" && c.type !== "orderedList").forEach(dig);
      const attr = Number(n.attrs?.indent) || 0;
      out.push(`${"    ".repeat(depth + attr)}${text}${attr ? `   [indent=${attr}]` : ""}`);
      (n.content || []).forEach((c) => walk(c, depth + 1));
      return;
    }
    (n.content || []).forEach((c) => walk(c, n.type === "listItem" ? depth + 1 : depth));
  };
  walk(doc, 0);
  return out;
}

function diff(before, after) {
  const a = outline(before); const b = outline(after);
  const lines = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i += 1) {
    const l = a[i] ?? "—"; const r = b[i] ?? "—";
    lines.push(`${l === r ? "   " : " ⛔"} ${l.padEnd(52)} │ ${r}`);
  }
  return lines;
}

/** Click the text, then press the key for real. */
async function pressOn(text, key, { at = "end" } = {}) {
  const spot = await page.evaluate(([needle, where]) => {
    const pm = document.querySelector(".ProseMirror");
    const walker = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (!n.nodeValue.includes(needle)) continue;
      const r = document.createRange();
      const i = n.nodeValue.indexOf(needle);
      r.setStart(n, where === "end" ? i + needle.length : i);
      r.collapse(true);
      const rect = r.getBoundingClientRect();
      const el = n.parentElement.getBoundingClientRect();
      return { x: Math.round(rect.left || el.left + 2), y: Math.round((rect.top || el.top) + (rect.height || el.height) / 2) };
    }
    return null;
  }, [text, at]);
  if (!spot) throw new Error(`could not find "${text}" — the fixture changed`);
  await page.mouse.click(spot.x, spot.y);
  await pacedWait(page, 250);
  const before = await storedDoc(page);
  await page.keyboard.press(key);
  await pacedWait(page, 800);
  return { before, after: await storedDoc(page) };
}

const CASES = [
  ["⛔ HIS CASE — Shift+Tab on MUD ATTORNEY (a sibling branch is DEEPER than it)", "MUD ATTORNEY", "Shift+Tab"],
  ["Shift+Tab on an item that HAS children (Engineer) — they must follow it, nothing else moves", "Engineer - Pape Dawson", "Shift+Tab"],
  ["Shift+Tab on an item with FOLLOWING siblings at its level (Active)", "Active", "Shift+Tab"],
  ["Shift+Tab on the LAST item of a nested list (doneal@)", "doneal@pape-dawson.com", "Shift+Tab"],
  ["Shift+Tab on the FIRST item of a nested list (P: 713)", "P: 713-428-2400", "Shift+Tab"],
  ["Tab on MUD ATTORNEY — the inverse", "MUD ATTORNEY", "Tab"],
  ["Tab on Active — the inverse where real nesting is possible", "Active", "Tab"],
];

for (const [name, text, key] of CASES) {
  await seed();
  const { before, after } = await pressOn(text, key);
  console.log("\n" + "=".repeat(112));
  console.log(name);
  console.log("=".repeat(112));
  console.log(`    ${"BEFORE".padEnd(52)} │ AFTER`);
  console.log("    " + "-".repeat(52) + "─┼─" + "-".repeat(50));
  for (const l of diff(before, after)) console.log(l);
  console.log(before === after ? "\n    (the stored document did not change at all)" : "");
}

/* ⛔ THE ROUND-TRIP, on his own structure: indent then outdent must return the document
 * byte-identical. This is the symmetry check he asked for, and it is the one assertion here
 * rather than a print, because it has a right answer. */
await seed();
const start = await storedDoc(page);
await pressOn("MUD ATTORNEY", "Tab");
await pressOn("MUD ATTORNEY", "Shift+Tab");
const end = await storedDoc(page);
console.log("\n" + "=".repeat(112));
console.log(`ROUND-TRIP on MUD ATTORNEY (Tab then Shift+Tab): ${start === end ? "✓ byte-identical" : "⛔ NOT byte-identical"}`);
if (start !== end) for (const l of diff(start, end)) console.log(l);

console.log(`\npage errors: ${errs.length ? errs.slice(0, 3).join(" | ") : "clean"}`);
await browser.close();
