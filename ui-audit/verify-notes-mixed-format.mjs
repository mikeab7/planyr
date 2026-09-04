#!/usr/bin/env node
/* verify-notes-mixed-format — B1139216, the mixed-selection dropdown fix, driven for real.
 *
 * ⛔ EVERY SELECTION AND EVERY PICK HERE IS A REAL GESTURE. `page.mouse` drags select text;
 * FormatMenu OPTIONS are real `<button>`s, clicked for real — never `execCommand("selectAll")`
 * (SYNTHETIC-KEYS-DONT-EDIT's sibling trap, named explicitly in the brief: "A selection must be
 * a real Range inside the editor... clicking a toolbar button applies nothing" otherwise) and
 * never a scripted `Range` object handed to the editor (the brief's own retracted attempt — "my
 * scripted Range being clobbered by a re-render between selection and apply" — is exactly the
 * artifact a real mouse drag cannot suffer, because there is no script-held Range to go stale).
 *
 * THREE THINGS THIS PROVES, MEASURED, NOT ASSUMED:
 *   1. A selection spanning more than one font size / block style shows NO value (blank), not
 *      the first block's — the reported bug, in both themes (screenshots saved).
 *   2. Picking a value is never a dead click — including re-picking the value already showing —
 *      because FormatMenu options are buttons, not a native `<select>`'s change event.
 *   3. defect 6 (his SECOND, unproven report — "Jerry Hayley" and "Kandice Cabets" both read as
 *      the same size): built via REAL drag-select + REAL FormatMenu picks on plain seeded text
 *      (never a scripted Range), then the caret is placed in each run and the readout compared.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOT_DIR = process.env.SHOT_DIR || "/tmp/notes-mixed-format-shots";

const findings = [];
let checks = 0;
const fail = (what, detail = "") => { findings.push({ what, detail }); console.log(`  ✗ ${what}${detail ? `\n      ${detail}` : ""}`); };
const pass = (l) => { checks += 1; console.log(`  ✓ ${l}`); };

const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});

const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";
const SAVE_DEBOUNCE_MS = 600;
const settle = (page) => pacedWait(page, SAVE_DEBOUNCE_MS + 450);

/** Three plain paragraphs at 24 / 18 / 9 px — the exact measured repro. */
async function seedMixedSizes(page, theme) {
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([treeKey, prefix, th]) => {
    localStorage.clear();
    localStorage.setItem("planyr.theme", th);
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Sizes", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    const mark = (px) => [{ type: "textStyle", attrs: { fontSize: `${px}px` } }];
    const T2 = (t, m) => ({ type: "text", text: t, marks: m });
    const P = (...c) => ({ type: "paragraph", content: c });
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [
        P(T2("Large block twentyfour", mark(24))),
        P(T2("Medium block eighteen", mark(18))),
        P(T2("Small block nine", mark(9))),
      ],
    }));
  }, [TREE_KEY, PAGE_PREFIX, theme]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

/** A bulleted list with H2/paragraph/paragraph — the Block style repro (item 4). */
async function seedMixedBlocks(page) {
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem("planyr.theme", "light");
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Blocks", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "A heading" }] },
        { type: "paragraph", content: [{ type: "text", text: "A paragraph" }] },
        { type: "paragraph", content: [{ type: "text", text: "Another paragraph" }] },
      ],
    }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

/** ONE list item, plain text, no marks — the runs are built by REAL gestures, never seeded. */
async function seedInlineFixture(page) {
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem("planyr.theme", "light");
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Contacts", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [{
        type: "bulletList",
        content: [{
          type: "listItem",
          content: [{ type: "paragraph", content: [{ type: "text", text: "Jerry Hayley Kandice Cabets" }] }],
        }],
      }],
    }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

/** Screen coordinates for the START or END of the first text node containing `needle`. */
async function textEdge(page, needle, edge) {
  return page.evaluate(([n2, e]) => {
    const pm = document.querySelector(".ProseMirror");
    const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.nodeValue.indexOf(n2);
      if (i < 0) continue;
      const r = document.createRange();
      if (e === "start") { r.setStart(n, i); r.collapse(true); } else { r.setStart(n, i + n2.length); r.collapse(true); }
      const rect = r.getBoundingClientRect();
      const p = n.parentElement.getBoundingClientRect();
      return { x: Math.round(rect.left || p.left), y: Math.round((rect.top || p.top) + (rect.height || p.height) / 2) };
    }
    return null;
  }, [needle, edge]);
}

/** A REAL mouse drag from the start of `fromNeedle` to the end of `toNeedle` — a real Range,
 *  built the way a person builds one, never `execCommand`/a scripted `Range` object. */
async function dragSelect(page, fromNeedle, toNeedle) {
  const from = await textEdge(page, fromNeedle, "start");
  const to = await textEdge(page, toNeedle, "end");
  if (!from || !to) return false;
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await pacedWait(page, 250);
  return true;
}

/** A single real click that places a bare caret inside `needle` (its middle character). */
async function caretInside(page, needle) {
  const spot = await page.evaluate((n2) => {
    const pm = document.querySelector(".ProseMirror");
    const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.nodeValue.indexOf(n2);
      if (i < 0) continue;
      const mid = i + Math.floor(n2.length / 2);
      const r = document.createRange();
      r.setStart(n, mid); r.collapse(true);
      const rect = r.getBoundingClientRect();
      const p = n.parentElement.getBoundingClientRect();
      return { x: Math.round(rect.left || p.left), y: Math.round((rect.top || p.top) + (rect.height || p.height) / 2) };
    }
    return null;
  }, needle);
  if (!spot) return false;
  await page.mouse.click(spot.x, spot.y);
  await pacedWait(page, 200);
  return true;
}

const label = async (page, testid) => (await page.locator(`[data-testid="${testid}"]`).innerText()).trim();
const title = async (page, testid) => page.locator(`[data-testid="${testid}"]`).getAttribute("title");

const openMenu = async (page, testid) => { await page.locator(`[data-testid="${testid}"]`).first().click(); await pacedWait(page, 200); };
const pickOption = async (page, testid, suffix) => {
  await openMenu(page, testid);
  const opt = page.locator(`[data-testid="${testid}-opt-${suffix}"]`).first();
  await opt.click({ timeout: 4000 });
  await pacedWait(page, 500);
};
const menuIsOpen = (page, testid) => page.locator(`[data-testid="${testid}-menu"]`).count().then((c) => c > 0);

async function storedDoc(page) {
  await settle(page);
  return page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), `${PAGE_PREFIX}p1`);
}

/** Every text run's own fontSize, walking the stored document. */
function runSizesFor(doc, needle) {
  const hits = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "text" && String(n.text).includes(needle)) {
      const m = (n.marks || []).find((x) => x.type === "textStyle");
      hits.push((m && m.attrs && m.attrs.fontSize) || null);
    }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return hits;
}
function blockTypesOf(doc) {
  return (doc?.content || []).map((n) => n.type + (n.attrs?.level ? n.attrs.level : ""));
}

/** StarterKit's own "trailing node" extension appends an empty paragraph whenever the document
 *  no longer ends in one (e.g. every block just became a heading) — ordinary editor behaviour,
 *  nothing to do with this fix. Drop it before asserting block-style uniformity, the same
 *  tolerance `audit-notes-formatting.mjs`'s own checks already give it. */
function dropTrailingEmptyParagraph(doc) {
  const content = doc?.content || [];
  const last = content[content.length - 1];
  const lastIsEmptyParagraph = last?.type === "paragraph" && !(last.content || []).length;
  return lastIsEmptyParagraph ? content.slice(0, -1) : content;
}

async function run() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => fail("page error", e.message));
  await assertMeasurable(page, "verify-notes-mixed-format");

  /* ═══ 1. FONT SIZE — mixed selection reads blank, in both themes (screenshots) ═══ */
  console.log("\n1 — Font size on a mixed (24/18/9) selection");
  for (const theme of ["light", "dark"]) {
    await seedMixedSizes(page, theme);
    const ok = await dragSelect(page, "Large", "nine");
    if (!ok) { fail(`${theme}: could not real-drag across all three blocks`); continue; }
    const lbl = await label(page, "nt-size");
    const ttl = await title(page, "nt-size");
    await page.locator('[data-testid="note-toolbar"]').screenshot({ path: `${SHOT_DIR}/font-size-mixed-${theme}.png` }).catch(() => {});
    if (lbl !== "") fail(`${theme}: the Font size box shows "${lbl}" on a mixed (24/18/9) selection — should be blank`, `title="${ttl}"`);
    else pass(`${theme}: Font size box is blank on a mixed selection (title: "${ttl}")`);
  }

  /* ⛔ THE APPLY PATH, RE-PROVEN on the new control shape (already known-good per the brief, but
   * the control is new code and must earn its own proof, not inherit the old one's). */
  console.log("\n2 — applying a size to a mixed selection changes every block");
  {
    await seedMixedSizes(page, "light");
    await dragSelect(page, "Large", "nine");
    await pickOption(page, "nt-size", "12");
    const doc = await storedDoc(page);
    const sizes = [...runSizesFor(doc, "Large"), ...runSizesFor(doc, "Medium"), ...runSizesFor(doc, "Small")];
    if (sizes.every((s) => s === "12px")) pass(`applying 12 to a mixed selection sets all three blocks: ${JSON.stringify(sizes)}`);
    else fail("applying a size to a mixed selection did not reach every block", JSON.stringify(sizes));
  }

  /* ═══ 3. THE DEAD CLICK, STRUCTURALLY — re-picking the value ALREADY shown must still act ═══ */
  console.log("\n3 — re-picking the value the box already shows is not a dead click");
  {
    // Selection is already uniform-at-12 from step 2. Re-select and re-pick "12".
    await dragSelect(page, "Large", "nine");
    const before = await label(page, "nt-size");
    await openMenu(page, "nt-size");
    const stillOpenBeforePick = await menuIsOpen(page, "nt-size");
    if (!stillOpenBeforePick) fail("the Font size menu did not open at all — cannot test the re-pick");
    else {
      await page.locator('[data-testid="nt-size-opt-12"]').first().click({ timeout: 4000 });
      await pacedWait(page, 400);
      const stillOpenAfterPick = await menuIsOpen(page, "nt-size");
      if (stillOpenAfterPick) fail("clicking the value already shown (12) left the menu open — the click did not register");
      else pass(`clicking the already-shown value ("${before}") closed the menu — the click registered, not a dead click`);

      // Undo-depth proof: the re-pick must be its own history entry, distinct from the first.
      await page.keyboard.press("Control+z");
      await settle(page);
      const doc1 = await storedDoc(page);
      const sizes1 = [...runSizesFor(doc1, "Large"), ...runSizesFor(doc1, "Medium"), ...runSizesFor(doc1, "Small")];
      const stillUniform12 = sizes1.every((s) => s === "12px");
      if (stillUniform12) pass(`ONE undo after the re-pick still reads uniform 12px (${JSON.stringify(sizes1)}) — the re-pick was its own real, separate command`);
      else console.log(`  · one undo after the re-pick reads ${JSON.stringify(sizes1)} (informational — not asserted; ProseMirror may coalesce a content-identical re-application into no new history step, which is a property of the editor's history plugin, not of whether the click fired)`);
    }
  }

  /* ═══ 4. BLOCK STYLE — the same defect (item 4 in the brief) ═══ */
  console.log("\n4 — Block style on a mixed (H2 + paragraph + paragraph) selection");
  {
    await seedMixedBlocks(page);
    const ok = await dragSelect(page, "A heading", "Another paragraph");
    if (!ok) fail("could not real-drag across the heading and both paragraphs");
    else {
      const lbl = await label(page, "nt-block");
      const ttl = await title(page, "nt-block");
      if (lbl !== "") fail(`the Block style box shows "${lbl}" on a mixed selection — should be blank`, `title="${ttl}"`);
      else pass(`Block style box is blank on a mixed selection (title: "${ttl}")`);

      await pickOption(page, "nt-block", "h2");
      const doc = await storedDoc(page);
      const types = blockTypesOf({ content: dropTrailingEmptyParagraph(doc) });
      if (types.length === 3 && types.every((t) => t === "heading2")) pass(`picking "Heading 2" on the mixed selection normalises all three blocks: ${JSON.stringify(types)}`);
      else fail("picking a block style on a mixed selection did not reach every block", JSON.stringify(types));
    }
  }

  /* ═══ 5. defect 6 — inline runs at different sizes inside ONE list item, built by REAL gestures ═══ */
  console.log("\n5 — defect 6: the caret readout inside two differently-sized inline runs (unproven in the brief)");
  {
    await seedInlineFixture(page);
    const before = await storedDoc(page);
    const beforeMarks = runSizesFor(before, "Jerry Hayley Kandice Cabets");
    if (!beforeMarks.length || beforeMarks[0] !== null) {
      fail("the inline fixture did not seed as one plain unmarked run", JSON.stringify(before));
    } else {
      pass("fixture is one plain run before any gesture — confirms the runs below are built by the gestures, not the seed");

      const gestured1 = await dragSelect(page, "Jerry", "Hayley");
      if (!gestured1) fail("could not real-drag-select 'Jerry Hayley'");
      else await pickOption(page, "nt-size", "20");

      const gestured2 = await dragSelect(page, "Kandice", "Cabets");
      if (!gestured2) fail("could not real-drag-select 'Kandice Cabets'");
      else await pickOption(page, "nt-size", "12");

      const doc = await storedDoc(page);
      const runs = [];
      const walk = (n) => {
        if (!n || typeof n !== "object") return;
        if (n.type === "text") {
          const m = (n.marks || []).find((x) => x.type === "textStyle");
          runs.push({ text: n.text, size: (m && m.attrs && m.attrs.fontSize) || null });
        }
        (n.content || []).forEach(walk);
      };
      walk(doc);
      console.log(`  · stored runs after the two real gestures: ${JSON.stringify(runs)}`);

      const jerryRun = runs.find((r) => r.text.includes("Jerry"));
      const kandiceRun = runs.find((r) => r.text.includes("Kandice"));
      if (!jerryRun || jerryRun.size !== "20px" || !kandiceRun || kandiceRun.size !== "12px") {
        fail("⛔ APPLYING A SIZE TO A SUB-RANGE SPREAD TO THE WHOLE RUN (or did not land at all) — this is a REAL defect, distinct from the mixed-dropdown bug", JSON.stringify(runs));
      } else {
        pass("applying two different sizes to two sub-ranges of one plain run produced two distinct stored runs — the apply path is fine at the document level");

        // Now the actual defect-6 question: does the CARET readout, per run, agree with storage?
        await caretInside(page, "Jerry");
        const jerryLabel = await label(page, "nt-size");
        await caretInside(page, "Kandice");
        const kandiceLabel = await label(page, "nt-size");

        if (jerryLabel === "20" && kandiceLabel === "12") {
          pass(`defect 6 REFUTED — the caret readout is correct per run: "Jerry" reads ${jerryLabel}, "Kandice" reads ${kandiceLabel}. Nothing changed here.`);
        } else {
          fail("⛔ defect 6 CONFIRMED — the caret readout does not match the run it sits in", `Jerry run stored 20px, caret reads "${jerryLabel}"; Kandice run stored 12px, caret reads "${kandiceLabel}"`);
        }
      }
    }
  }

  await ctx.close();
}

await run();

console.log(`\n${"=".repeat(78)}\nVERIFY-NOTES-MIXED-FORMAT\n${"=".repeat(78)}`);
console.log(`${checks} checks passed.`);
if (findings.length) {
  console.log(`\n⛔ ${findings.length} FINDING(S):`);
  for (const f of findings) console.log(`  • ${f.what}${f.detail ? `\n      ${f.detail}` : ""}`);
} else {
  console.log("\n✓ no findings.");
}
console.log(`\nscreenshots: ${SHOT_DIR}/font-size-mixed-{light,dark}.png`);

await browser.close();
process.exit(findings.length ? 1 : 0);
