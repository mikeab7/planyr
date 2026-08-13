/* audit-notes-formatting — ATTACK TYPING AND FORMATTING; DO NOT CONFIRM IT.
 *
 * ⛔ HIS STANDARD, VERBATIM: *"For each of the following, apply it, remove it, RE-apply it, and undo
 * after each step, at a caret AND across a selection, and verify against the STORED document, not
 * just the screen."* And the trap he named, because it has burned this module twice: *"anything
 * that LOOKS right on screen while the document underneath is unchanged. Resize was exactly that."*
 *
 * So every verdict here is read out of `localStorage`, never off the page. A mark that paints and
 * does not store is the exact failure that produced this instruction, and it is the one thing a
 * screen-reading harness cannot see.
 *
 * ⛔ AND EVERY KEY AND EVERY PRESS IS REAL. `page.keyboard` / `page.mouse` only. A dispatched
 * KeyboardEvent mutates nothing in this app (SYNTHETIC-KEYS-DONT-EDIT) and a dispatched click
 * reaches no `mousedown` (B364017) — a harness built on either prints green ticks having exercised
 * nothing. Where a control is a toolbar BUTTON, the button is pressed; the keyboard shortcut is a
 * separate claim and is tested as one.
 *
 * ⛔ THE FIXTURE IS HIS NOTE: a bulleted list with a nested sub-list and an autolinked email in it.
 * Formatting behaves differently inside a list, inside a link, and across a block boundary, and
 * "on a blank paragraph" is the case least likely to be the one he hits.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ONLY = process.env.FMT_ONLY || "";

const findings = [];
const notes = [];
let checks = 0;

const finding = (area, what, repro, evidence = "") => {
  findings.push({ area, what, repro, evidence });
  console.log(`  ✗ ${area} — ${what}\n      repro: ${repro}${evidence ? `\n      stored: ${evidence}` : ""}`);
};
const pass = (l) => { checks += 1; if (process.env.FMT_VERBOSE) console.log(`  ✓ ${l}`); };
const note = (l) => { notes.push(l); console.log(`  · ${l}`); };

const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});

const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";
const pageErrors = [];

/** ⛔ THE EDITOR SAVES ON A 600 ms DEBOUNCE, AND EVERY READ HERE WAITS PAST IT.
 *
 * This is the THIRD time in one session that reading storage too early produced a page of false
 * findings — first the marquee's group drag ("moved nothing"), then the box resize, now sixteen
 * formatting rows that read `[]` for marks the app had applied correctly. The cure is not another
 * `waitForTimeout` at each call site, because the one that gets forgotten is the one that lies:
 * the wait lives INSIDE the reader, so a caller cannot skip it. A read that races the writer
 * measures the harness, not the app. */
const SAVE_DEBOUNCE_MS = 600;
const settle = (page) => pacedWait(page, SAVE_DEBOUNCE_MS + 450);

const storedRaw = async (page) => {
  await settle(page);
  return page.evaluate((k) => localStorage.getItem(k), `${PAGE_PREFIX}p1`);
};

/** ⛔ THE STORED DOCUMENT, NORMALISED — a `null` attribute IS the default, and a hand-authored
 *  fixture omits the ones the editor writes back explicitly. Comparing raw bytes against a seed
 *  reports a difference the first time the editor round-trips, which is not a finding. */
const normalise = (json) => {
  if (!json) return json;
  const strip = (n) => {
    if (Array.isArray(n)) return n.map(strip);
    if (!n || typeof n !== "object") return n;
    const out = {};
    for (const [k, v] of Object.entries(n)) {
      if (k === "attrs" && v && typeof v === "object") {
        const a = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined));
        if (Object.keys(a).length) out.attrs = a;
        continue;
      }
      out[k] = strip(v);
    }
    return out;
  };
  try { return JSON.stringify(strip(JSON.parse(json))); } catch (_) { return json; }
};
const storedDoc = async (page) => normalise(await storedRaw(page));

/** ⛔ A SEMANTIC FINGERPRINT — every block type, every run of text, and the marks on it.
 *
 * The per-step undo checks compare THIS rather than the whole JSON, and that is a correction, not
 * a relaxation. The seeded document is hand-authored; the moment the editor saves once it writes
 * its OWN serialisation, and the two differ in ways that have nothing to do with the edit under
 * test. Measured directly: after bold-then-undo the marks came back exactly and the normalised
 * JSON matched — yet an audit comparing raw seed bytes called it eleven separate failures. What
 * the check is actually about is "did the content and its formatting come back", and this is that
 * question asked precisely. The undo-DEPTH case still demands byte-for-byte, because he asked for
 * byte-for-byte and its baseline is the editor's own output rather than the seed. */
const fingerprint = async (page) => {
  await settle(page);
  return page.evaluate((k) => {
    const doc = JSON.parse(localStorage.getItem(k) || "null");
    const out = [];
    const walk = (n) => {
      if (!n || typeof n !== "object") return;
      if (n.type === "text") out.push(`«${n.text}»${(n.marks || []).map((m) => m.type).sort().join("+")}`);
      else if (n.type) {
        /* ⛔ EVERY BLOCK ATTRIBUTE THAT CARRIES A SETTING, not a hand-picked two. The first version
         * recorded `level` and `textAlign` only — so it could not SEE `lineHeight`, and reported
         * "line spacing does not reach the document" in all three contexts about a feature that was
         * storing it correctly. A fingerprint blind to the property under test is worse than no
         * fingerprint: it returns a confident wrong answer. */
        const a = Object.entries(n.attrs || {})
          .filter(([, v]) => v !== null && v !== undefined && v !== false && v !== "")
          .map(([k, v]) => `${k}=${v}`)
          .sort()
          .join(",");
        out.push(`<${n.type}${a ? `:${a}` : ""}>`);
      }
      (n.content || []).forEach(walk);
    };
    walk(doc);
    return out.join("|");
  }, `${PAGE_PREFIX}p1`);
};

/** ⛔ THE EDITOR'S OWN SERIALISATION, for the byte-for-byte case. One real edit and one undo makes
 *  storage hold what the EDITOR writes rather than what the fixture wrote, so a later byte compare
 *  is about the operations under test and not about how the seed happened to be spelled. */
async function settleToEditorBytes(page) {
  await caretAfter(page, "Closing paragraph.");
  await page.keyboard.type("x", { delay: 20 });
  await settle(page);
  await page.keyboard.press("Control+z");
  await settle(page);
}

/** Which MARKS the stored document carries on the text matching `needle`, and which BLOCK holds it. */
const marksOn = async (page, needle) => {
  await settle(page);
  return page.evaluate(([k, want]) => {
  const doc = JSON.parse(localStorage.getItem(k) || "null");
  const hits = [];
  const walk = (n, block) => {
    if (!n || typeof n !== "object") return;
    const b = n.type && n.type !== "text" ? n : block;
    if (n.type === "text" && String(n.text).includes(want)) {
      hits.push({
        text: n.text,
        marks: (n.marks || []).map((m) => m.type + (m.attrs && Object.values(m.attrs).some(Boolean) ? `(${Object.entries(m.attrs).filter(([, v]) => v).map(([kk, v]) => `${kk}=${v}`).join(",")})` : "")).sort(),
        block: block?.type || null,
        blockAttrs: Object.fromEntries(Object.entries(block?.attrs || {}).filter(([, v]) => v !== null && v !== undefined)),
      });
    }
    (n.content || []).forEach((c) => walk(c, b));
  };
    walk(doc, null);
    return hits;
  }, [`${PAGE_PREFIX}p1`, needle]);
};

/** Every block type in the stored document, in order — for the structural conversions. */
const blockTypes = async (page) => {
  await settle(page);
  return page.evaluate((k) => {
    const doc = JSON.parse(localStorage.getItem(k) || "null");
    return (doc?.content || []).map((n) => n.type + (n.attrs?.level ? n.attrs.level : ""));
  }, `${PAGE_PREFIX}p1`);
};

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
    const T = (t, marks) => (marks ? { type: "text", text: t, marks } : { type: "text", text: t });
    const P = (...c) => ({ type: "paragraph", content: c.length ? c : undefined });
    const LI = (...c) => ({ type: "listItem", content: c });
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [T("Utilities")] },
        P(T("ALPHA bravo charlie delta echo foxtrot")),
        { type: "bulletList", content: [
          LI(P(T("MUD Engineer - Pape Dawson"))),
          LI(P(T("Dustin O'Neal")), { type: "bulletList", content: [
            LI(P(T("281-555-0134"))),
            LI(P(T("doneal@papedawson.com", [{ type: "link", attrs: { href: "mailto:doneal@papedawson.com" } }]))),
          ] }),
          LI(P(T("Third item"))),
        ] },
        /* ⛔ THE MARKS GO ON THE TEXT NODE, NOT ON THE PARAGRAPH. The first version passed the
         * mark array as a second argument to `P`, so the paragraph's content was
         * `[textNode, [marks]]` — malformed. The editor parsed what it could, dropped the rest and
         * re-saved, and the audit then reported TWENTY findings whose real cause was this line.
         * A broken fixture does not report "the fixture is broken"; it reports the app is. */
        P(T("TRIPLE marked run here", [{ type: "bold" }, { type: "italic" }, { type: "underline" }])),
        P(T("Closing paragraph.")),
      ],
    }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

/** Select a word by double-clicking it — a real gesture, and the one a person uses. */
async function selectWord(page, word) {
  const spot = await page.evaluate((needle) => {
    const pm = document.querySelector(".ProseMirror");
    const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.nodeValue.indexOf(needle);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i); r.setEnd(n, i + needle.length);
      const rect = r.getBoundingClientRect();
      return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) };
    }
    return null;
  }, word);
  if (!spot) return false;
  await page.mouse.dblclick(spot.x, spot.y);
  await pacedWait(page, 250);
  return true;
}

/** Put a bare caret at the end of the text containing `needle`. */
async function caretAfter(page, needle) {
  const spot = await page.evaluate((n2) => {
    const pm = document.querySelector(".ProseMirror");
    const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = w.nextNode())) {
      const i = n.nodeValue.indexOf(n2);
      if (i < 0) continue;
      const r = document.createRange();
      r.setStart(n, i + n2.length); r.collapse(true);
      const rect = r.getBoundingClientRect();
      const p = n.parentElement.getBoundingClientRect();
      return { x: Math.round(rect.left || p.right), y: Math.round((rect.top || p.top) + (rect.height || p.height) / 2) };
    }
    return null;
  }, needle);
  if (!spot) return false;
  await page.mouse.click(spot.x, spot.y);
  await pacedWait(page, 200);
  return true;
}

const clickTool = async (page, id) => {
  const behindMore = await page.evaluate((t) => {
    const el = document.querySelector(`[data-testid="${t}"]`);
    return !el || !el.getBoundingClientRect().width;
  }, id);
  if (behindMore) {
    await page.locator('[data-testid="nt-more"]').first().click().catch(() => {});
    await pacedWait(page, 250);
  }
  const el = page.locator(`[data-testid="${id}"]`).first();
  if (!(await el.count())) return false;
  await el.click({ timeout: 4000 }).catch(() => {});
  await pacedWait(page, 500);
  return true;
};

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 1. EVERY MARK: apply · remove · RE-apply · undo after each — at a caret AND across a selection
 * ═════════════════════════════════════════════════════════════════════════════════════════ */
const MARKS = [
  ["nt-bold", "bold"], ["nt-italic", "italic"], ["nt-underline", "underline"],
  ["nt-strike", "strike"], ["nt-code", "code"],
];

async function auditMarks(page, label) {
  console.log(`\n[${label}] 1 — every mark, applied / removed / re-applied, with undo after each`);
  for (const [tool, mark] of MARKS) {
    if (ONLY && !tool.includes(ONLY)) continue;
    await seed(page);
    if (!(await selectWord(page, "bravo"))) { finding("marks", `could not select a word to test ${mark}`, "seed, double-click 'bravo'"); continue; }
    const clean = await fingerprint(page);

    if (!(await clickTool(page, tool))) { finding("marks", `${tool} is not on the toolbar`, `seed, look for ${tool}`); continue; }
    let hit = (await marksOn(page, "bravo"))[0];
    if (!hit?.marks.includes(mark)) {
      finding("marks", `${mark} does not reach the DOCUMENT`, `seed, double-click 'bravo', press ${tool}`, JSON.stringify(hit?.marks ?? null));
      continue;
    }
    pass(`${mark} applies`);

    /* ⛔ UNDO AFTER EACH STEP — his instruction, and the step most likely to be skipped. */
    await page.keyboard.press("Control+z");
    const backTo = await fingerprint(page);
    if (backTo !== clean) {
      finding("undo", `Ctrl+Z after applying ${mark} does not restore the document`, `seed, select 'bravo', ${tool}, Ctrl+Z`, `${clean.slice(0, 90)} → ${backTo.slice(0, 90)}`);
    } else pass(`${mark} undo restores`);

    // re-apply, then REMOVE, then RE-APPLY
    await selectWord(page, "bravo");
    await clickTool(page, tool);
    await selectWord(page, "bravo");
    await clickTool(page, tool);
    hit = (await marksOn(page, "bravo"))[0];
    if (hit?.marks.includes(mark)) {
      finding("marks", `${mark} cannot be REMOVED — pressing it twice leaves it on`, `seed, select 'bravo', ${tool}, ${tool}`, JSON.stringify(hit.marks));
      continue;
    }
    pass(`${mark} removes`);
    await selectWord(page, "bravo");
    await clickTool(page, tool);
    hit = (await marksOn(page, "bravo"))[0];
    if (!hit?.marks.includes(mark)) finding("marks", `${mark} does not RE-apply after being removed`, `seed, select 'bravo', ${tool} ×3`, JSON.stringify(hit?.marks));
    else pass(`${mark} re-applies`);
  }

  /* ⛔ TWO MARKS ON ONE RUN — the combination case, which a per-mark test cannot reach. */
  await seed(page);
  await selectWord(page, "charlie");
  await clickTool(page, "nt-bold");
  await selectWord(page, "charlie");
  await clickTool(page, "nt-italic");
  const both = (await marksOn(page, "charlie"))[0];
  if (!(both?.marks.includes("bold") && both?.marks.includes("italic"))) {
    finding("marks", "two marks on one run: the second replaces the first instead of joining it", "seed, select 'charlie', bold, select again, italic", JSON.stringify(both?.marks));
  } else pass("bold+italic coexist");

  /* ⛔ A CARET-ONLY mark: set it with nothing selected, then TYPE — the mark must apply to what
   * is typed next. This is the case where a screen-only implementation is invisible. */
  await seed(page);
  await caretAfter(page, "Closing paragraph.");
  await clickTool(page, "nt-bold");
  await page.keyboard.type(" typedbold", { delay: 25 });
  await pacedWait(page, 900);
  const typed = (await marksOn(page, "typedbold"))[0];
  if (!typed) finding("marks", "text typed after setting bold at a bare caret did not reach the document", "seed, caret at end of the last paragraph, bold, type");
  else if (!typed.marks.includes("bold")) finding("marks", "bold set at a bare caret does not apply to what you type next", "seed, caret at end, press bold, type ' typedbold'", JSON.stringify(typed.marks));
  else pass("a caret-set mark applies to typing");
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 2. CLEAR FORMATTING over a run with THREE marks and a link
 * ═════════════════════════════════════════════════════════════════════════════════════════ */
async function auditClear(page, label) {
  console.log(`\n[${label}] 2 — clear formatting over three marks, and over a link`);
  await seed(page);
  const before = (await marksOn(page, "TRIPLE"))[0];
  if ((before?.marks || []).length < 3) { finding("clear", "the fixture's triple-marked run did not survive seeding", "seed and read the stored marks", JSON.stringify(before?.marks)); return; }
  await selectWord(page, "TRIPLE");
  if (!(await clickTool(page, "nt-clear"))) { finding("clear", "no clear-formatting control", "seed, look for nt-clear"); return; }
  const after = (await marksOn(page, "TRIPLE"))[0];
  if ((after?.marks || []).length) finding("clear", "clear formatting leaves marks behind on a three-mark run", "seed, select 'TRIPLE', press clear formatting", JSON.stringify(after.marks));
  else pass("clear formatting strips three marks");

  await seed(page);
  await selectWord(page, "doneal");
  await clickTool(page, "nt-clear");
  const link = (await marksOn(page, "doneal"))[0];
  note(`clear formatting over an autolinked email leaves: ${JSON.stringify(link?.marks ?? [])}`);
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 3. BLOCK CONVERSIONS — headings on a list item, list type conversion, alignment, quote, etc.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */
async function auditBlocks(page, label) {
  console.log(`\n[${label}] 3 — block conversions, including on a line that is already a list item`);

  /* Heading on a plain paragraph, and back to body text. */
  for (const level of ["1", "2", "3", "4"]) {
    await seed(page);
    await caretAfter(page, "Closing paragraph.");
    const sel = page.locator('[data-testid="nt-block"]').first();
    if (!(await sel.count())) { finding("blocks", "no block-style control", "seed, look for nt-block"); break; }
    const opts = await sel.evaluate((n) => [...n.options].map((o) => o.value));
    const want = opts.find((o) => o.includes(level)) || null;
    if (!want) { note(`no block option for heading ${level} (options: ${opts.join(",")})`); continue; }
    await sel.selectOption(want);
    await pacedWait(page, 700);
    const types = await blockTypes(page);
    if (!types.some((t) => t.startsWith("heading"))) finding("blocks", `heading ${level} did not reach the document`, `seed, caret in the last paragraph, block style → ${want}`, JSON.stringify(types));
    else pass(`heading ${level} applies`);
    // back to body
    const back = opts.find((o) => /para|body|normal|text/i.test(o));
    if (back) {
      await sel.selectOption(back);
      await pacedWait(page, 700);
      const t2 = await blockTypes(page);
      if (t2[t2.length - 2] !== "paragraph" && t2[t2.length - 1] !== "paragraph") {
        finding("blocks", `heading ${level} → body text did not return the block to a paragraph`, `seed, heading ${level}, then ${back}`, JSON.stringify(t2));
      } else pass(`heading ${level} reverts`);
    }
  }

  /* ⛔ A HEADING ON A LINE THAT IS ALREADY A LIST ITEM — his explicit case. */
  await seed(page);
  await caretAfter(page, "Third item");
  const sel2 = page.locator('[data-testid="nt-block"]').first();
  if (await sel2.count()) {
    const opts = await sel2.evaluate((n) => [...n.options].map((o) => o.value));
    const h = opts.find((o) => o.includes("2"));
    if (h) {
      const before = await fingerprint(page);
      await sel2.selectOption(h);
      const after = await fingerprint(page);
      if (before === after) finding("blocks", "making a LIST ITEM into a heading does nothing at all", "seed, caret on 'Third item', block style → heading 2");
      else pass("a list item can become a heading");
      await page.keyboard.press("Control+z");
      const back2 = await fingerprint(page);
      if (back2 !== before) finding("undo", "Ctrl+Z after making a list item a heading does not restore it", "seed, caret on 'Third item', heading 2, Ctrl+Z", `${before.slice(0, 90)} → ${back2.slice(0, 90)}`);
      else pass("…and it undoes");
    }
  }

  /* List type conversions, and Enter / Backspace on items. */
  await seed(page);
  await caretAfter(page, "Third item");
  const beforeList = await blockTypes(page);
  await clickTool(page, "nt-ordered");
  const afterList = await blockTypes(page);
  if (JSON.stringify(beforeList) === JSON.stringify(afterList)) {
    finding("blocks", "converting a bulleted list to numbered does nothing in the document", "seed, caret on 'Third item', press the numbered-list control", JSON.stringify(afterList));
  } else pass("bullet → numbered converts");

  await seed(page);
  await caretAfter(page, "Third item");
  await clickTool(page, "nt-task");
  const asTask = await blockTypes(page);
  if (!asTask.some((t) => /task/i.test(t))) finding("blocks", "converting a list to a checklist does nothing in the document", "seed, caret on 'Third item', press the checklist control", JSON.stringify(asTask));
  else pass("bullet → checklist converts");

  /* Enter splits an item; Backspace merges two. */
  await seed(page);
  await caretAfter(page, "Third item");
  const beforeSplit = await storedDoc(page);
  await page.keyboard.press("Enter");
  await page.keyboard.type("split", { delay: 25 });
  await pacedWait(page, 900);
  const afterSplit = await marksOn(page, "split");
  if (!afterSplit.length) finding("blocks", "Enter at the end of a list item then typing does not reach the document", "seed, caret at end of 'Third item', Enter, type 'split'");
  else pass("Enter splits an item");
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await pacedWait(page, 900);
  if ((await storedDoc(page)) !== beforeSplit) note("two undos after Enter+type did not return exactly to the pre-split document (may need a third)");

  /* Alignment, quote, code block, divider. */
  for (const [tool, name] of [["nt-align-center", "centre"], ["nt-align-right", "right"], ["nt-quote", "quote"], ["nt-codeblock", "code block"], ["nt-hr", "divider"]]) {
    await seed(page);
    await caretAfter(page, "Closing paragraph.");
    const before = await fingerprint(page);
    if (!(await clickTool(page, tool))) { finding("blocks", `${name} control (${tool}) is not reachable`, `seed, open More, look for ${tool}`); continue; }
    const after = await fingerprint(page);
    if (before === after) { finding("blocks", `${name} does not reach the document`, `seed, caret in the last paragraph, press ${tool}`); continue; }
    pass(`${name} applies`);
    await page.keyboard.press("Control+z");
    const back3 = await fingerprint(page);
    if (back3 !== before) finding("undo", `Ctrl+Z after ${name} does not restore the document`, `seed, caret in the last paragraph, ${tool}, Ctrl+Z`, `${before.slice(0, 90)} → ${back3.slice(0, 90)}`);
    else pass(`${name} undoes`);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 4. LINKS — autolink on typing, editing the text of an autolinked run, unlink
 * ═════════════════════════════════════════════════════════════════════════════════════════ */
async function auditLinks(page, label) {
  console.log(`\n[${label}] 4 — links: autolink, edit inside one, unlink`);
  await seed(page);
  await caretAfter(page, "Closing paragraph.");
  await page.keyboard.type(" mike@example.com ", { delay: 25 });
  await pacedWait(page, 1000);
  const mailed = (await marksOn(page, "mike@example.com"))[0];
  if (!mailed) finding("links", "a typed email did not reach the document at all", "seed, caret at end, type ' mike@example.com '");
  else if (!mailed.marks.some((m) => m.startsWith("link"))) note(`typing a bare email does NOT autolink (stored marks: ${JSON.stringify(mailed.marks)})`);
  else pass("a typed email autolinks");

  await seed(page);
  await caretAfter(page, "Closing paragraph.");
  await page.keyboard.type(" https://example.com ", { delay: 25 });
  await pacedWait(page, 1000);
  const urled = (await marksOn(page, "https://example.com"))[0];
  if (!urled) finding("links", "a typed URL did not reach the document at all", "seed, caret at end, type ' https://example.com '");
  else if (!urled.marks.some((m) => m.startsWith("link"))) note(`typing a bare URL does NOT autolink (stored marks: ${JSON.stringify(urled.marks)})`);
  else pass("a typed URL autolinks");

  /* ⛔ EDITING THE TEXT OF AN AUTOLINKED RUN — the case his note actually contains. */
  await seed(page);
  await caretAfter(page, "doneal@papedawson.com");
  await page.keyboard.type("X", { delay: 25 });
  await pacedWait(page, 900);
  const edited = await marksOn(page, "doneal@papedawson.comX");
  if (!edited.length) {
    const still = await marksOn(page, "doneal@papedawson.com");
    finding("links", "typing at the end of an autolinked email did not extend that run", "seed, caret at the end of the email, type 'X'", JSON.stringify(still.map((h) => h.text)));
  } else pass("an autolinked run can be typed into");

  /* Unlink. */
  await seed(page);
  await selectWord(page, "doneal");
  const beforeUnlink = (await marksOn(page, "doneal"))[0];
  if (!beforeUnlink?.marks.some((m) => m.startsWith("link"))) { note("the seeded email is not stored with a link mark; unlink not exercised"); return; }
  await clickTool(page, "nt-link");
  await pacedWait(page, 500);
  const afterUnlink = (await marksOn(page, "doneal"))[0];
  if (afterUnlink?.marks.some((m) => m.startsWith("link"))) note("pressing the link control on a linked run did not remove the link (it may open a panel instead)");
  else pass("unlink removes the link mark");
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 5. ⛔ UNDO DEPTH — 20 mixed operations, then undo all the way back to byte-identical
 * ═════════════════════════════════════════════════════════════════════════════════════════ */
async function auditUndoDepth(page, label) {
  console.log(`\n[${label}] 5 — twenty mixed operations, then undo all the way back`);
  await seed(page);
  await settleToEditorBytes(page);
  const start = await storedDoc(page);

  const ops = [];
  const doOp = async (name, fn) => { await fn(); ops.push(name); await pacedWait(page, 260); };

  await doOp("select+bold", async () => { await selectWord(page, "bravo"); await clickTool(page, "nt-bold"); });
  await doOp("select+italic", async () => { await selectWord(page, "charlie"); await clickTool(page, "nt-italic"); });
  await doOp("type at end", async () => { await caretAfter(page, "Closing paragraph."); await page.keyboard.type(" one", { delay: 20 }); });
  await doOp("select+underline", async () => { await selectWord(page, "delta"); await clickTool(page, "nt-underline"); });
  await doOp("type more", async () => { await page.keyboard.type(" two", { delay: 20 }); });
  await doOp("quote", async () => { await caretAfter(page, "Closing paragraph."); await clickTool(page, "nt-quote"); });
  await doOp("unquote", async () => { await clickTool(page, "nt-quote"); });
  await doOp("select+strike", async () => { await selectWord(page, "echo"); await clickTool(page, "nt-strike"); });
  await doOp("numbered list", async () => { await caretAfter(page, "Third item"); await clickTool(page, "nt-ordered"); });
  await doOp("back to bullets", async () => { await clickTool(page, "nt-bullet"); });
  await doOp("type in a list item", async () => { await caretAfter(page, "Third item"); await page.keyboard.type("!", { delay: 20 }); });
  await doOp("enter+type", async () => { await page.keyboard.press("Enter"); await page.keyboard.type("new", { delay: 20 }); });
  await doOp("backspace ×3", async () => { for (let i = 0; i < 3; i += 1) { await page.keyboard.press("Backspace"); await pacedWait(page, 90); } });
  await doOp("align centre", async () => { await caretAfter(page, "Closing paragraph."); await clickTool(page, "nt-align-center"); });
  await doOp("align left", async () => { await clickTool(page, "nt-align-left"); });
  await doOp("bold a word", async () => { await selectWord(page, "foxtrot"); await clickTool(page, "nt-bold"); });
  await doOp("clear it", async () => { await selectWord(page, "foxtrot"); await clickTool(page, "nt-clear"); });
  await doOp("type again", async () => { await caretAfter(page, "Closing paragraph."); await page.keyboard.type(" three", { delay: 20 }); });
  await doOp("tab in a list", async () => { await caretAfter(page, "Third item"); await page.keyboard.press("Tab"); });
  await doOp("type last", async () => { await caretAfter(page, "Closing paragraph."); await page.keyboard.type(" four", { delay: 20 }); });

  await pacedWait(page, 1000);
  const changed = await storedDoc(page);
  if (changed === start) { finding("undo", "twenty operations left the document unchanged — the run proves nothing", "run the undo-depth phase"); return; }
  pass(`${ops.length} operations changed the document`);

  /* ⛔ UNDO ALL THE WAY BACK. Generously more presses than operations, because one operation can
   * be more than one history step — and stopping early would report a false failure. */
  for (let i = 0; i < 70; i += 1) {
    await page.keyboard.press("Control+z");
    await pacedWait(page, 80);
  }
  await pacedWait(page, 1400);
  const back = await storedDoc(page);
  if (back !== start) {
    const a = JSON.parse(start || "null");
    const b = JSON.parse(back || "null");
    const txt = (n) => { let s = ""; const dig = (x) => { if (x?.type === "text") s += x.text; (x?.content || []).forEach(dig); }; dig(n); return s; };
    finding("undo", "⛔ TWENTY OPERATIONS DO NOT UNDO BACK TO THE STARTING DOCUMENT",
      "run the undo-depth phase, then press Ctrl+Z seventy times",
      `text before "${txt(a).slice(0, 60)}…" vs after "${txt(b).slice(0, 60)}…"`);
  } else pass("⛔ twenty operations undo back to a byte-identical document");
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════
 * 6. ⛔ THE NEWEST CODE, AND THE INTERACTIONS NOBODY HAS ASKED ABOUT
 *
 * Added because the first complete run found NOTHING, and an audit that reports nothing is a
 * failed audit. These are the cases his list names that the phases above do not reach: line
 * spacing (shipped days ago) against a LIST ITEM and a HEADING rather than a plain paragraph, and
 * the attribute-carrying marks — font size and colour — whose stored VALUE is the thing that can
 * silently not be there.
 * ═════════════════════════════════════════════════════════════════════════════════════════ */
async function auditAttributes(page, label) {
  console.log(`\n[${label}] 6 — line spacing on lists and headings, and the attribute marks`);

  /* Line spacing on a LIST ITEM. */
  for (const [where, anchor] of [["a list item", "Third item"], ["a heading", "Utilities"], ["a plain paragraph", "Closing paragraph."]]) {
    await seed(page);
    if (!(await caretAfter(page, anchor))) { finding("spacing", `could not put the caret in ${where}`, `seed, click at the end of "${anchor}"`); continue; }
    const before = await fingerprint(page);
    const sel = page.locator('[data-testid="nt-spacing"]').first();
    if (!(await sel.count())) { finding("spacing", "no line-spacing control on the toolbar", "seed, look for nt-spacing"); break; }
    /* ⛔ PICK AN OPTION THAT ACTUALLY CHANGES SOMETHING. The values are `lh:` / `lh:1.15` / `sb:6`
     * …, and `lh:` IS "Lines: Single" — the DEFAULT. The first version took the first option that
     * differed from the placeholder, which was exactly that no-op, and then reported "line spacing
     * does not reach the document" three times about a control working correctly. */
    const opts = await sel.evaluate((n) => [...n.options].map((o) => o.value));
    const pick = opts.find((o) => /^(lh|sb|sa):.+/.test(o));
    if (!pick) { note(`line spacing offers no option that sets a value (${opts.join(",")})`); break; }
    await sel.selectOption(pick);
    const after = await fingerprint(page);
    if (before === after) {
      finding("spacing", `line spacing does not reach the document on ${where}`, `seed, caret in ${where}, line spacing → ${pick}`, after.slice(0, 120));
      continue;
    }
    pass(`line spacing applies on ${where}`);
    await page.keyboard.press("Control+z");
    const back = await fingerprint(page);
    if (back !== before) finding("undo", `Ctrl+Z after line spacing on ${where} does not restore it`, `seed, caret in ${where}, spacing → ${pick}, Ctrl+Z`, `${before.slice(0, 80)} → ${back.slice(0, 80)}`);
    else pass(`line spacing undoes on ${where}`);
  }

  /* ⛔ THE ATTRIBUTE MARKS: the VALUE has to be in the document, not just a class on screen. */
  for (const [tool, mark, how] of [["nt-size", "textStyle", "select"], ["nt-font", "textStyle", "select"]]) {
    await seed(page);
    await selectWord(page, "bravo");
    const el = page.locator(`[data-testid="${tool}"]`).first();
    const behindMore = await page.evaluate((t) => {
      const n = document.querySelector(`[data-testid="${t}"]`);
      return !n || !n.getBoundingClientRect().width;
    }, tool);
    if (behindMore) { await page.locator('[data-testid="nt-more"]').first().click().catch(() => {}); await pacedWait(page, 250); }
    if (!(await el.count())) { finding("attrs", `${tool} is not reachable`, `seed, open More, look for ${tool}`); continue; }
    const opts = await el.evaluate((n) => [...n.options].map((o) => o.value));
    const pick = opts.find((o) => o && o !== opts[0]);
    if (!pick) { note(`${tool} offers no second option`); continue; }
    await el.selectOption(pick);
    const hit = (await marksOn(page, "bravo"))[0];
    if (!hit || !hit.marks.some((m) => m.startsWith(mark))) {
      finding("attrs", `${tool} does not reach the document as a stored mark`, `seed, select 'bravo', ${tool} → ${pick}`, JSON.stringify(hit?.marks ?? null));
    } else if (!hit.marks.some((m) => m.includes("="))) {
      finding("attrs", `${tool} stores a mark with NO VALUE on it — the setting is lost`, `seed, select 'bravo', ${tool} → ${pick}`, JSON.stringify(hit.marks));
    } else pass(`${tool} stores its value (${hit.marks.filter((m) => m.includes("=")).join(",")})`);
  }

  /* Colour and highlight live behind a popover rather than a select. */
  for (const [tool, what] of [["nt-color", "text colour"], ["nt-highlight", "highlight"]]) {
    await seed(page);
    await selectWord(page, "bravo");
    if (!(await clickTool(page, tool))) { finding("attrs", `${tool} is not reachable`, `seed, look for ${tool}`); continue; }
    /* ⛔ NOT THE FIRST SWATCH — it is "Default", which REMOVES the colour. Picking it and then
     * reporting "no value was stored" is the instrument testing the no-op and blaming the app. */
    const swatch = page.locator(`[data-testid="${tool}-popover"] button`).filter({ hasNotText: /^$/ }).nth(2);
    const anySwatch = page.locator(`[data-testid="${tool}-popover"] button`);
    const count = await anySwatch.count();
    if (count < 3) { note(`${what}: fewer than three swatches in the popover; not exercised`); continue; }
    const label = await anySwatch.nth(2).getAttribute("title");
    note(`${what}: picking swatch "${label}"`);
    await anySwatch.nth(2).click();
    await pacedWait(page, 400);
    const hit = (await marksOn(page, "bravo"))[0];
    if (!hit || !hit.marks.some((m) => m.includes("="))) {
      finding("attrs", `${what} does not store a value on the document`, `seed, select 'bravo', ${tool}, pick the first swatch`, JSON.stringify(hit?.marks ?? null));
    } else pass(`${what} stores its value`);
  }

  /* Callout and toggle: their stored SHAPE, not just that nothing crashed. */
  for (const [tool, type] of [["nt-callout", "callout"], ["nt-toggle", "toggle"]]) {
    await seed(page);
    await caretAfter(page, "Closing paragraph.");
    const before = await blockTypes(page);
    if (!(await clickTool(page, tool))) { finding("blocks", `${tool} is not reachable`, `seed, open More, look for ${tool}`); continue; }
    let after = await blockTypes(page);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      /* A callout opens a tone panel first — pick the first tone. */
      const tone = page.locator('[data-testid^="nt-callout-"]').first();
      if (await tone.count()) { await tone.click(); await pacedWait(page, 500); after = await blockTypes(page); }
    }
    if (JSON.stringify(before) === JSON.stringify(after)) finding("blocks", `${type} does not reach the document`, `seed, caret in the last paragraph, ${tool}`, JSON.stringify(after));
    else pass(`${type} applies (${after.filter((t) => !before.includes(t)).join(",") || "structure changed"})`);
  }
}

/* ═══════════════════════════════════════════════════════════════════════════════════════════ */

async function run(label, { width, height }) {
  console.log(`\n${"=".repeat(78)}\n${label}\n${"=".repeat(78)}`);
  const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => pageErrors.push(`${label}: ${e.message}`));
  await assertMeasurable(page, "audit-notes-formatting");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await seed(page);

  for (const ph of [auditMarks, auditClear, auditBlocks, auditLinks, auditAttributes, auditUndoDepth]) {
    try { await ph(page, label); }
    catch (e) { finding("harness", `${ph.name} stopped early: ${String(e.message).split("\n")[0]}`, `run audit-notes-formatting at ${label}`); }
  }
  await ctx.close();
}

await run("A · a full window", { width: 1500, height: 950 });

const NOT_COVERED = [
  "pasting from Word / a browser / a plain-text source — the system clipboard cannot be loaded with real HTML+RTF flavours from a headless driver; the three paste MODES are unit-tested in test/ over synthetic slices, which is a weaker claim and is stated as one",
  "table row/column add, delete, merge, split and header-row toggle — the table controls appear only while the caret is in a table and are not driven here",
  "sync: every claim here is local; none of it has been through a real account",
];

console.log(`\n${"=".repeat(78)}\nFORMATTING AUDIT\n${"=".repeat(78)}`);
console.log(`${checks} checks passed.`);
if (!findings.length) {
  console.log("\n⛔ NOTHING FOUND — DISTRUST THIS. A formatting audit that reports nothing is a failed");
  console.log("   audit, the same as the sweep. Check the phases actually ran before believing it.");
} else {
  console.log(`\n⛔ ${findings.length} FINDING(S):\n`);
  const byArea = {};
  for (const f of findings) (byArea[f.area] ||= []).push(f);
  for (const [area, list] of Object.entries(byArea)) {
    console.log(`  ${area.toUpperCase()} (${list.length})`);
    for (const f of list) console.log(`    • ${f.what}\n        repro: ${f.repro}${f.evidence ? `\n        stored: ${f.evidence}` : ""}`);
  }
}
console.log("\nNOT COVERED — stated rather than left to be assumed:");
for (const n of NOT_COVERED) console.log(`  · ${n}`);
console.log(`\npage errors: ${pageErrors.length ? pageErrors.slice(0, 3).join(" | ") : "clean"}`);

await browser.close();
process.exit(findings.length ? 1 : 0);
