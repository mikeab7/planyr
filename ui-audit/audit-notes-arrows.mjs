/* audit-notes-arrows — WHICH KEYS THE MODULE'S GLOBAL BINDINGS SWALLOW, MEASURED (NEW-ARROWS).
 *
 * ⛔ THE REPORT: *"okay the direction keys on my keyboard arent working, debug."*
 *
 * ⛔ AND THE OWNER'S PRIOR, WHICH IS WHERE THIS STARTS RATHER THAN FROM SCRATCH: the arrow-key
 * NUDGE added for a selected box is bound to the **window**, and if it is not properly scoped it
 * eats ArrowLeft/Right/Up/Down everywhere — ordinary text, a list, a table, the title. He named the
 * precedent himself: the Escape defect the same change's adversarial pass caught, handled twice,
 * once by the mat and once by the window binding. Same bug, different key.
 *
 * ⛔ SO THIS FILE DOES NOT ASSERT A THEORY. It drives EVERY key he listed, with a REAL keystroke,
 * in every context he listed, and reports the FAILING SET — the shape that worked for Tab.
 *
 *   • every key is a real key (`page.keyboard.press`). SYNTHETIC-KEYS-DONT-EDIT: a dispatched
 *     KeyboardEvent mutates nothing in this app, so a harness built on one prints a tidy table
 *     describing nothing that happened. And a COMMAND CALL is not a keystroke — it proves the
 *     command, not the binding, which is the entire question here.
 *   • four independent observations per press, because "nothing happened" is the verdict that
 *     hides everything (see `ui-audit/TRAPS.md`): did the CARET move · did the PAGE scroll · did a
 *     BOX move · did the stored DOCUMENT change. A key that scrolls the page instead of moving the
 *     caret and a key that does nothing at all are different defects and must not share a row.
 *   • `defaultPrevented` is read off the real event too, because it is the DIRECT evidence for
 *     "something global swallowed this" — a key can be prevented and still appear to work.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ONLY = process.env.ARROW_ONLY || "";

const rows = [];
const pageErrors = [];

const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});

const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const storedDoc = (page) => page.evaluate((k) => localStorage.getItem(k), `${PAGE_PREFIX}p1`);

/** Where the caret is, as a stable mark — block index plus offset. Lifted from the Tab harness
 *  for the same reason it exists there: without it, "moved the caret correctly" and "did nothing"
 *  are the same row. */
const caretMark = (page) => page.evaluate(() => {
  const sel = document.getSelection();
  const pm = document.querySelector(".ProseMirror");
  if (!sel?.anchorNode) return "none";
  if (!pm?.contains(sel.anchorNode)) {
    const a = document.activeElement;
    const id = a?.getAttribute?.("data-testid") || a?.tagName || "?";
    const off = typeof a?.selectionStart === "number" ? `@${a.selectionStart}` : "";
    return `outside:${id}${off}`;
  }
  const el = sel.anchorNode.nodeType === 3 ? sel.anchorNode.parentElement : sel.anchorNode;
  const block = el.closest("li, td, th, p, h1, h2, h3, h4, pre, blockquote") || el;
  const all = [...pm.querySelectorAll("li, td, th, p, h1, h2, h3, h4, pre, blockquote")];
  return `${all.indexOf(block)}@${sel.anchorOffset}${sel.isCollapsed ? "" : "+sel"}`;
});

/** Every positioned box's stored position, so "the box moved instead" is a measurement. */
const boxMark = (page) => page.evaluate(() => [...document.querySelectorAll(".planyr-anchor")]
  .map((b) => `${b.getAttribute("data-anchor-x") || ""},${b.style.top || ""}`).join("|"));

const scrollMark = (page) => page.evaluate(() => {
  const s = document.querySelector('[data-testid="note-body"]')?.closest("[style*='overflow'], .planyr-note-scroll")
    || document.scrollingElement;
  return `${Math.round(s?.scrollTop || 0)}/${Math.round(window.scrollY || 0)}`;
});

/* ⛔ THE DIRECT EVIDENCE. A listener that calls `preventDefault` is what stops the browser doing
 * the native thing with an arrow key, so this reads the flag off the REAL event rather than
 * inferring it from a symptom. Installed once, in capture on the window at the very END of the
 * bubble path so it sees the event after every app listener has had it. */
const armPreventWitness = (page) => page.evaluate(() => {
  window.__arrowWitness = [];
  window.addEventListener("keydown", (e) => {
    window.__arrowWitness.push({ key: e.key, prevented: e.defaultPrevented });
  });    // bubble phase, no capture: runs LAST, after the app's own handlers
});
const readWitness = (page) => page.evaluate(() => {
  const w = window.__arrowWitness || [];
  window.__arrowWitness = [];
  return w;
});

/** His note, plus the two things this sweep needs that the Tab fixture had only one of: a
 *  positioned box (to select and to edit) and plenty of flow text to arrow through. */
async function seed(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Utilities", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    const T = (t) => ({ type: "text", text: t });
    const P = (...c) => ({ type: "paragraph", content: c.length ? c : undefined });
    const LI = (...c) => ({ type: "listItem", content: c });
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [T("Utilities")] },
        P(T("A plain paragraph of flow text that is long enough to arrow along.")),
        { type: "bulletList", content: [
          LI(P(T("MUD Engineer - Pape Dawson"))),
          LI(P(T("Dustin O'Neal"))),
          LI(P(T("Third top-level item"))),
        ] },
        { type: "table", content: [
          { type: "tableRow", content: [
            { type: "tableHeader", content: [P(T("Utility"))] },
            { type: "tableHeader", content: [P(T("Contact"))] },
          ] },
          { type: "tableRow", content: [
            { type: "tableCell", content: [P(T("Water"))] },
            { type: "tableCell", content: [P(T("MUD 501"))] },
          ] },
        ] },
        { type: "noteAnchor", attrs: { x: 420, y: 300, w: 180 }, content: [P(T("a placed box"))] },
        P(T("A second paragraph after everything else.")),
      ],
    }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
  await armPreventWitness(page);
}

/** Put the caret somewhere by clicking real text. Returns false when the text is not there —
 *  and every caller CHECKS it, per `ui-audit/TRAPS.md` trap 3. */
async function placeCaret(page, { text, at = "start", steps = [] }) {
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
  if (!spot) return false;
  await page.mouse.click(spot.x, spot.y);
  await pacedWait(page, 200);
  for (const k of steps) { await page.keyboard.press(k); await pacedWait(page, 90); }
  return true;
}

/** ⛔ SELECT A BOX WITHOUT EDITING IT — the two-stage model: one press selects the box, a second
 *  press (or a double-click) puts the caret in its text. This is the state where a nudge is the
 *  CORRECT answer, so it has to be reachable or the whole sweep is asking the wrong question. */
async function selectBoxOnly(page) {
  const box = page.locator(".planyr-anchor").first();
  if (!await box.count()) return false;
  const b = await box.boundingBox();
  if (!b) return false;
  /* ⛔ THE CENTRE, NOT A CORNER. Stage one of the two-stage model is a press ANYWHERE on an
   * unselected box — it selects and no caret enters. The first version aimed at a corner to stay
   * "away from the words" and landed on the grip/delete chrome instead, so nothing selected and
   * fourteen rows read COULD-NOT-PLACE. A helper that misses reports as a product defect unless
   * the placement is checked, which is why it is. */
  await page.mouse.click(Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2));
  await pacedWait(page, 350);
  return page.evaluate(() => document.querySelectorAll('.planyr-anchor[data-selected="1"]').length > 0);
}

/** ⛔ ACTUALLY EDIT THE BOX — press twice (the two-stage model) and then PROVE the caret landed
 *  inside it. Returns false rather than guessing, so a failure to reach the state is reported as
 *  COULD-NOT-PLACE instead of being scored as a product defect (TRAPS.md trap 3). */
async function editInsideBox(page) {
  const ok = await placeCaret(page, { text: "a placed box", at: "end" });
  if (!ok) return false;
  await page.mouse.dblclick(...(await (async () => {
    const b = await page.locator(".planyr-anchor").first().boundingBox();
    return [Math.round(b.x + b.width / 2), Math.round(b.y + b.height / 2)];
  })()));
  await pacedWait(page, 350);
  return page.evaluate(() => {
    const sel = document.getSelection();
    const box = document.querySelector(".planyr-anchor");
    return !!(sel?.anchorNode && box && box.contains(sel.anchorNode));
  });
}

/** Select a box, then click back into ordinary flow text. Proves BOTH halves before returning:
 *  a box is still selected AND the caret is in the paragraph. */
async function selectThenType(page) {
  if (!await selectBoxOnly(page)) return false;
  if (!await placeCaret(page, { text: "second paragraph", at: "end" })) return false;
  return page.evaluate(() => {
    const sel = document.getSelection();
    const pm = document.querySelector(".ProseMirror");
    const caretInText = !!(sel?.anchorNode && pm?.contains(sel.anchorNode)
      && !sel.anchorNode.parentElement?.closest(".planyr-anchor"));
    // Reported even when no box is still selected — that is a PASS for the product and this
    // context then simply measures ordinary text, which the table makes visible.
    return caretInText;
  });
}

/** Drive ONE press: snapshot everything, press for real, snapshot again, judge. */
async function probe(page, name, place, key, { reseed = true } = {}) {
  if (ONLY && !name.includes(ONLY)) return;
  if (reseed) await seed(page);
  const placed = await place(page);
  if (!placed) { rows.push({ name, key, verdict: "COULD-NOT-PLACE" }); return; }

  await readWitness(page);                       // drop anything the placement generated
  const before = {
    caret: await caretMark(page), doc: await storedDoc(page),
    box: await boxMark(page), scroll: await scrollMark(page),
  };

  await page.keyboard.press(key);
  await pacedWait(page, 700);                    // past the editor's 600 ms save debounce

  const after = {
    caret: await caretMark(page), doc: await storedDoc(page),
    box: await boxMark(page), scroll: await scrollMark(page),
  };
  const witness = (await readWitness(page)).filter((w) => w.key !== "Control" && w.key !== "Shift");
  const prevented = witness.some((w) => w.prevented);

  /* ⛔ THE VERDICT NAMES WHAT HAPPENED, NOT WHETHER SOMETHING DID. Four independent observations,
   * reported in the order that matters: a box moving when the caret should have is the reported
   * defect; a page scrolling instead of a caret moving is the browser doing the native thing
   * because nobody handled the key; and "nothing" is only ever reported when all four agree. */
  const moved = [];
  if (after.caret !== before.caret) moved.push("caret");
  if (after.box !== before.box) moved.push("BOX-MOVED");
  if (after.doc !== before.doc) moved.push("doc");
  if (after.scroll !== before.scroll) moved.push("PAGE-SCROLLED");

  let verdict = moved.length ? moved.join("+") : "NOTHING";
  if (verdict === "caret") verdict = "caret-moved";

  rows.push({
    name, key, verdict, prevented,
    caret: `${before.caret} → ${after.caret}`,
  });
}

const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true })).newPage();
page.on("pageerror", (e) => pageErrors.push(e.message));
await assertMeasurable(page, "audit-notes-arrows");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

/* ⛔ EVERY CONTEXT HE NAMED. */
const CONTEXTS = [
  /* ⛔ THE CARET GOES IN THE MIDDLE OF THE TEXT, NEVER AT AN EDGE, AND THAT IS NOT COSMETIC. The
   * first run placed it at the END and then scored `End → NOTHING` as a failure — the caret was
   * already there, so doing nothing was the correct answer. That is `TRAPS.md` trap 2 exactly:
   * an assertion about the KEY written as an assertion about the WORLD, measured from a starting
   * point nobody checked. Mid-text, every arrow and both of Home/End have somewhere to go, so
   * "did not move" means what the table says it means. */
  ["ordinary paragraph text", (p) => placeCaret(p, { text: "plain paragraph", at: "start", steps: ["ArrowRight", "ArrowRight", "ArrowRight"] })],
  ["a list item", (p) => placeCaret(p, { text: "Dustin O'Neal", at: "start", steps: ["ArrowRight", "ArrowRight", "ArrowRight"] })],
  ["a table cell", (p) => placeCaret(p, { text: "MUD 501", at: "start", steps: ["ArrowRight", "ArrowRight", "ArrowRight"] })],
  ["the page TITLE field", async (p) => {
    await p.locator('[data-testid="note-title"]').first().click();
    await pacedWait(p, 250);
    await p.keyboard.press("Home");
    for (let i = 0; i < 3; i += 1) await p.keyboard.press("ArrowRight");
    await pacedWait(p, 150);
    return true;
  }],
  /* ⛔ EDITING means the caret is IN THE BOX'S TEXT, and this context PROVES it rather than
   * assuming a click did it. The first run of this harness got exactly that wrong: one click on
   * the box's words SELECTS the box (stage one of the two-stage model), so the row labelled
   * "editing" was measuring the selected state, the caret read `none`, and it looked like arrows
   * move the box while you are typing in it. They do not — that row was the instrument. */
  ["EDITING a positioned box", (p) => editInsideBox(p)],
  ["a box SELECTED, not edited", (p) => selectBoxOnly(p)],
  /* ⛔ AND THE ONE THE PRIOR IS REALLY ABOUT, which no other row reaches: a box is SELECTED and
   * the caret is then put back into ORDINARY TEXT. The window binding is armed while a selection
   * exists and declines only for `input, textarea, select` — the editor is a contenteditable div
   * and is DELIBERATELY not excluded, on the argument that clicking into the document clears the
   * selection on the way. If that argument is wrong anywhere, this is the row that says so, and
   * it is the exact shape of his report: arrows dead while typing in normal text. */
  ["box selected, THEN caret in text", (p) => selectThenType(p)],
  ["nothing selected, caret nowhere", async (p) => {
    await p.evaluate(() => { document.getSelection().removeAllRanges(); document.activeElement?.blur?.(); });
    await pacedWait(p, 200);
    return true;
  }],
];

/* ⛔ EVERY KEY HE NAMED, plus the siblings — because if ONE global binding is swallowing arrows
 * there may be others, and the cheapest time to find out is now rather than in another report. */
const KEYS = [
  "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown",
  "Shift+ArrowLeft", "Shift+ArrowRight",              // extending a selection — a different path
  "Control+ArrowRight",                                // word jump
  "Home", "End",
  "Delete", "Backspace", "Escape", "Enter", "Tab",
];

for (const [name, place] of CONTEXTS) {
  for (const key of KEYS) await probe(page, name, place, key);
}

/* ---- the table ------------------------------------------------------------------------- */
console.log("\n" + "=".repeat(112));
console.log("EVERY KEY, IN EVERY CONTEXT — real keystrokes, four independent observations per press");
console.log("=".repeat(112));
const pad = (s, n) => String(s ?? "").slice(0, n).padEnd(n);
console.log(pad("context", 28) + pad("key", 20) + pad("what happened", 26) + pad("prevented", 11) + "caret");
console.log("-".repeat(112));
let last = "";
for (const r of rows) {
  console.log(
    pad(r.name === last ? "" : r.name, 28) + pad(r.key, 20)
    + pad(r.verdict, 26) + pad(r.prevented === undefined ? "-" : r.prevented ? "YES" : "no", 11)
    + (r.caret || ""),
  );
  last = r.name;
}

/* ⛔ THE FAILING SET, DEFINED RATHER THAN EYEBALLED. A key fails when it did not do the thing that
 * key is for in that context — and the definition is per-context, because the RIGHT answer differs:
 * in text an arrow moves the caret; on a selected box it moves the box. */
const CARET_CONTEXTS = ["ordinary paragraph text", "a list item", "a table cell", "the page TITLE field", "EDITING a positioned box"];
/* ⛔ THE EXPECTATION IS PER CONTEXT AND PER KEY, because the RIGHT answer differs and a looser
 * rule reports working behaviour as broken — which this harness did twice on its first two runs.
 * Only the FOUR PLAIN ARROWS are judged: they are the reported defect, they have somewhere to go
 * from a mid-text caret in every context, and they are the keys a nudge is bound to. Home/End and
 * Shift+Arrow are MEASURED and printed but not judged — on a selected box there is no caret for
 * them to move (doing nothing is correct), and in a short box the caret can legitimately already
 * be at the edge they aim for. Printing them without judging them is the honest split: the table
 * still shows a regression, the failing set does not cry wolf. */
const PLAIN_ARROWS = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
const failing = rows.filter((r) => {
  if (r.verdict === "COULD-NOT-PLACE") return true;
  if (!PLAIN_ARROWS.includes(r.key)) return false;
  // In text, an arrow moves the CARET and must never move a box.
  if (CARET_CONTEXTS.includes(r.name) || r.name === "box selected, THEN caret in text") {
    return !r.verdict.includes("caret") || r.verdict.includes("BOX-MOVED");
  }
  // On a selected box with no caret, an arrow nudges the BOX. That is the feature.
  if (r.name === "a box SELECTED, not edited") return !r.verdict.includes("BOX-MOVED");
  return false;
});

console.log("\nFAILING SET");
if (!failing.length) console.log("  none — every arrow did the thing that arrow is for, in every context.");
for (const r of failing) console.log(`  ✗ ${r.name} [${r.key}] → ${r.verdict}${r.prevented ? " (prevented)" : ""}`);
console.log(`\n  page errors : ${pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "clean"}`);

await browser.close();
process.exit(failing.length ? 1 : 0);
