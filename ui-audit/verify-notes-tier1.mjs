/* Verify the Notes TIER-1 work against the REAL built app, headless (NEW-1…NEW-7).
 *
 * ⛔ EVERY CHECK BELOW ASSERTS THE RESULTING DOCUMENT OR THE RESULTING UI STATE. None of
 * them asserts that a handler ran, that a menu appeared, or that an element took focus.
 * That is the process rule this module is under, and it is not decoration: B1393 shipped
 * green twice against the owner's repeated report because its check asserted FOCUS instead
 * of where the caret landed. So, specifically:
 *   • the slash menu → the block in the SAVED DOCUMENT is a heading of the right level;
 *   • quick open    → the OTHER NOTE is the one open, by title and by stored page id;
 *   • history       → the restored tree equals the snapshot AND the pre-restore state is
 *                     still listed, which is the "restore never destroys history" rule;
 *   • the rollup    → the checkbox in the NOTE flips, in the stored document and on screen;
 *   • attachments   → the file round-trips (chip → stored node → Markdown export text);
 *   • the outline   → the caret moves into the heading the row named;
 *   • callout/toggle→ the nodes are in the stored document and the PRINT SHEET carries the
 *                     folded section's contents, expanded.
 *
 * MUTATION-CHECKED: reverting the src/ change behind any section turns its rows red. The
 * combinations that were run are recorded on the item.
 *
 *   npx vite preview --port 4173 &
 *   node ui-audit/verify-notes-tier1.mjs
 */
import { chromium } from "playwright";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true, ignoreHTTPSErrors: true });
const page = await ctx.newPage();

/* ⛔ FOREGROUND-OR-VOID. A hidden tab clamps setTimeout and suspends rAF, so both the clock
 * and the geometry of every measurement below would be void — and internally consistent
 * while being void, which is the dangerous half. One precondition, named, failing loudly. */
await assertMeasurable(page, "verify-notes-tier1");

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

/* ---- helpers ------------------------------------------------------------------------- */
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";
const dlDir = mkdtempSync(join(tmpdir(), "notes-tier1-"));

const readTree = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), TREE_KEY);
const readBody = (id) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), PAGE_PREFIX + id);
const tb = (id) => page.locator(`[data-testid="${id}"]`);

const nodesOf = (doc, type) => {
  const out = [];
  const walk = (n) => { if (!n || typeof n !== "object") return; if (n.type === type) out.push(n); (n.content || []).forEach(walk); };
  walk(doc);
  return out;
};
const textOf = (doc) => {
  const out = [];
  const walk = (n) => { if (!n || typeof n !== "object") return; if (n.type === "text") out.push(n.text); (n.content || []).forEach(walk); };
  walk(doc);
  return out.join(" ");
};
/** The id of the page the editor currently has open, read from the app rather than guessed. */
const openPageId = async () => {
  const t = await readTree();
  const title = await tb("note-title").inputValue();
  const hit = [];
  const go = (n) => { if (n.title === title) hit.push(n.id); (n.pages || []).forEach(go); };
  (t?.pages || []).forEach(go);
  return hit[0] || null;
};

/** Put the caret at the end of the document without tripping Click-and-Type. */
const caretInDoc = async () => {
  const at = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="note-body"]');
    const last = body.lastElementChild || body;
    const r = last.getBoundingClientRect();
    return { x: r.right - 2, y: r.top + Math.min(12, r.height / 2) };
  });
  await page.mouse.click(at.x, at.y);
};

/** The MOST RECENT print sheet's HTML.
 *
 *  ⛔ THE LAST FRAME, NOT THE FIRST. `printHtmlDocument` deliberately leaves its hidden
 *  iframe in the document for a minute (the print dialogue is modal and must outlive the
 *  call), so a run that prints twice has two frames and `querySelector` returns the STALE
 *  one — which reads as "the sheet is missing my new block" and is a harness bug wearing a
 *  product bug's clothes. It cost four red rows before it was seen. */
const printedSheet = () => page.evaluate(() => {
  const frames = [...document.querySelectorAll('[data-testid="notes-print-frame"]')];
  const f = frames[frames.length - 1];
  const d = f?.contentDocument;
  /* ⛔ BOTH, AND THE `text` HALF IS THE ONE THAT BITES ON A FOLDED TOGGLE. `innerHTML`
   * carries a collapsed <details>'s contents whether or not they would ever be SEEN, so a
   * check written against it passes on a sheet that prints a blank box. `innerText` is what
   * the browser would actually lay out — it is empty for a closed details — so it is the
   * honest way to ask "did the folded section reach the paper?". */
  return { html: d?.body?.innerHTML || "", text: d?.body?.innerText || "" };
});

/** Make a fresh page and open it. Returns its id. */
const newPage = async (title) => {
  await tb("notes-new-page").click();
  await page.waitForTimeout(250);
  await tb("note-title").fill(title);
  await page.waitForTimeout(500);
  return openPageId();
};

/** The save debounce is 600 ms; give every "assert the STORED document" a clear margin. */
const settle = (ms = 900) => page.waitForTimeout(ms);

await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => { localStorage.clear(); });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });

/* ════ 1. THE SLASH MENU — the block actually becomes what you named ══════════════════ */
console.log("\n1 · Slash menu (NEW-1)");
{
  const id = await newPage("Slash");
  await caretInDoc();
  await page.keyboard.type("/", { delay: 30 });
  await page.waitForTimeout(120);
  ok("typing / opens the command list", await tb("note-slash-menu").count() === 1);

  await page.keyboard.type("h2", { delay: 30 });
  await page.waitForTimeout(120);
  const rows = await page.locator('[data-testid^="note-slash-"]:not([data-testid="note-slash-menu"])').count();
  ok("typing filters it down to one row", rows === 1, `${rows} row(s)`);

  await page.keyboard.press("Enter");
  await page.keyboard.type("Drainage", { delay: 15 });
  await settle();

  const doc = await readBody(id);
  const heads = nodesOf(doc, "heading");
  ok("⛔ THE BLOCK IS A HEADING 2 IN THE SAVED DOCUMENT", heads.length === 1 && heads[0].attrs.level === 2,
    JSON.stringify(heads.map((h) => h.attrs.level)));
  ok("…carrying the words typed after it, and NOT the `/h2` that summoned it",
    textOf(doc).includes("Drainage") && !textOf(doc).includes("/h2"), textOf(doc));

  // ⛔ ONE UNDO PUTS BACK BOTH THE BLOCK AND THE TYPED COMMAND — the delete and the insert
  // are a single chain, so Ctrl+Z must not walk backwards through the machinery.
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await settle();
  const undone = await readBody(id);
  ok("one undo per step gets back to a paragraph, not to a half-applied state",
    nodesOf(undone, "heading").length === 0, JSON.stringify(undone).slice(0, 120));
}

/* ════ 2. IT DOES NOT FIRE MID-WORD — the report this rule exists for ═════════════════ */
console.log("\n2 · The slash menu stays out of the way (NEW-1)");
{
  const id = await newPage("Mid-word");
  await caretInDoc();
  await page.keyboard.type("and/or", { delay: 25 });
  await page.waitForTimeout(150);
  ok("`and/or` opens nothing", await tb("note-slash-menu").count() === 0);

  await page.keyboard.press("Enter");
  await page.keyboard.type("https://planyr.io/notes", { delay: 12 });
  await page.waitForTimeout(150);
  ok("a pasted-shaped URL opens nothing", await tb("note-slash-menu").count() === 0);

  await settle();
  const doc = await readBody(id);
  ok("⛔ AND BOTH ARE IN THE DOCUMENT, CHARACTER FOR CHARACTER",
    textOf(doc).includes("and/or") && textOf(doc).includes("https://planyr.io/notes"), textOf(doc));

  // Escape closes the menu and LEAVES THE SLASH as ordinary text.
  await page.keyboard.press("Enter");
  await page.keyboard.type("/", { delay: 30 });
  await page.waitForTimeout(120);
  const opened = await tb("note-slash-menu").count() === 1;
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  const closed = await tb("note-slash-menu").count() === 0;
  await settle();
  ok("Escape closes it and the `/` survives as text", opened && closed && (await readBody(id) && textOf(await readBody(id)).includes("/")));

  // …and BACKSPACING past it leaves nothing behind either.
  await page.keyboard.type("hea", { delay: 25 });
  for (let i = 0; i < 4; i += 1) await page.keyboard.press("Backspace");
  await settle();
  const after = textOf(await readBody(id));
  ok("backspacing past the `/` leaves no marker and no stray text",
    !after.includes("/hea"), after.slice(-40));
}

/* ════ 3. QUICK OPEN — the other note is actually open ════════════════════════════════ */
console.log("\n3 · Quick open (NEW-2)");
{
  await newPage("Water district minutes");
  const target = await newPage("Grand Port entitlements");
  await caretInDoc();
  await page.keyboard.type("the surety bond letter is with the city", { delay: 8 });
  await settle();

  const back = await newPage("Somewhere else entirely");
  ok("the harness starts on a different note", (await tb("note-title").inputValue()) === "Somewhere else entirely");

  await page.keyboard.press("Control+k");
  await page.waitForSelector('[data-testid="notes-quick-open"]', { timeout: 5000 });
  await page.keyboard.type("gpent", { delay: 30 });
  await page.waitForTimeout(200);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);

  ok("⛔ THE OTHER NOTE IS THE ONE OPEN — fuzzy, across the trail",
    (await tb("note-title").inputValue()) === "Grand Port entitlements",
    await tb("note-title").inputValue());
  ok("…and it is the same page id the rail holds", (await openPageId()) === target);
  ok("the palette closed behind it", await tb("notes-quick-open").count() === 0);

  // FALLING THROUGH TO THE FULL TEXT: a phrase that is in a BODY and in no title.
  await page.keyboard.press("Control+k");
  await page.waitForSelector('[data-testid="notes-quick-open"]', { timeout: 5000 });
  await page.keyboard.type("surety bond", { delay: 25 });
  await page.waitForTimeout(300);
  const inText = await page.locator('[data-testid^="notes-quick-open-hit-"][data-where="body"]').count();
  ok("a body-only phrase produces an IN TEXT hit", inText >= 1, `${inText}`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  ok("Escape closes it and changes nothing", await tb("notes-quick-open").count() === 0
    && (await tb("note-title").inputValue()) === "Grand Port entitlements");

  // ⛔ AND IT DID NOT BREAK LINK INSERTION — the control Ctrl+K might have displaced.
  await tb("nt-link").click();
  await page.waitForTimeout(150);
  ok("the toolbar's link editor still opens (Ctrl+K displaced nothing)", await tb("nt-link-input").count() === 1);
  await page.keyboard.press("Escape");
  void back;
}

/* ════ 4. VERSION HISTORY — restore, and history survives it ═════════════════════════ */
console.log("\n4 · Version history with restore (NEW-3)");
{
  const id = await newPage("Mangled");
  await caretInDoc();
  await page.keyboard.type("THE ORIGINAL SENTENCE", { delay: 10 });
  await settle();

  /* Leaving the page always takes a snapshot (`force`), so switching away and back is how a
   * harness gets a real version without waiting out the 90-second typing gap. */
  await tb("notes-new-page").click();
  await page.waitForTimeout(400);
  await page.locator(`[data-testid="notes-row-${id}"]`).click();
  await page.waitForTimeout(500);

  await caretInDoc();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("MANGLED BEYOND RECOGNITION", { delay: 10 });
  await settle();

  await tb("nt-history").click();
  await page.waitForSelector('[data-testid="note-history"]', { timeout: 5000 });
  const rowCount = await page.locator('[data-testid^="note-history-row-"]').count();
  ok("the page has a history to show", rowCount >= 1, `${rowCount} version(s)`);

  const previews = await page.locator('[data-testid="note-history"] p').allInnerTexts();
  const originalRow = previews.findIndex((t) => t.includes("THE ORIGINAL SENTENCE"));
  ok("the version taken before the mangling is in the list", originalRow >= 0, previews.join(" | ").slice(0, 160));

  await page.locator(`[data-testid="note-history-restore-${Math.max(0, originalRow)}"]`).click();
  await page.waitForTimeout(900);
  await settle();

  const restored = await readBody(id);
  ok("⛔ THE RESTORED DOCUMENT MATCHES THE SNAPSHOT", textOf(restored).includes("THE ORIGINAL SENTENCE"), textOf(restored));
  ok("…and the mangled text is off the page", !textOf(restored).includes("MANGLED BEYOND RECOGNITION"));

  const after = await page.locator('[data-testid="note-history"] p').allInnerTexts();
  ok("⛔ AND THE PRE-RESTORE STATE IS STILL IN HISTORY — a restore creates, never destroys",
    after.some((t) => t.includes("MANGLED BEYOND RECOGNITION")), after.join(" | ").slice(0, 160));
  ok("the history grew rather than shrank",
    await page.locator('[data-testid^="note-history-row-"]').count() > rowCount);

  await tb("note-history-close").click();
  await page.waitForTimeout(150);
  ok("the panel closes", await tb("note-history").count() === 0);
}

/* ════ 5. THE TASK ROLLUP — ticking it there flips it in the note ════════════════════ */
console.log("\n5 · One view of every open checklist item (NEW-4)");
{
  const id = await newPage("Water district");
  await caretInDoc();
  await tb("nt-task").click();
  await page.keyboard.type("Call the district about the 12-inch line", { delay: 8 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("Send the LOI comment back", { delay: 8 });
  await settle();

  const before = nodesOf(await readBody(id), "taskItem");
  ok("the note has two open items", before.length === 2 && before.every((t) => !t.attrs.checked));

  await tb("notes-view-tasks").click();
  await page.waitForTimeout(400);
  const listed = await page.locator('[data-testid^="notes-task-open-"]').allInnerTexts();
  ok("both items appear in the rollup, naming the note they came from",
    listed.length === 2 && listed.join(" ").includes("Water district"), listed.join(" | ").slice(0, 140));

  // ⛔ TICK IT IN THE LIST — and assert the NOTE, not the list.
  await page.locator('[data-testid^="notes-task-check-"]').first().click();
  await page.waitForTimeout(400);
  await settle();

  const after = nodesOf(await readBody(id), "taskItem");
  ok("⛔ THE CHECKBOX IN THE NOTE IS NOW TICKED", after.filter((t) => t.attrs.checked).length === 1,
    JSON.stringify(after.map((t) => t.attrs.checked)));
  ok("…and exactly one item was touched", after.length === 2);
  ok("the ticked item leaves the list", (await page.locator('[data-testid^="notes-task-open-"]').count()) === 1);

  // It is ticked ON SCREEN too, in the open editor, not only in storage.
  const onScreen = await page.locator('[data-testid="note-body"] input[type="checkbox"]:checked').count();
  ok("the checkbox on the page is drawn ticked", onScreen === 1, `${onScreen} ticked`);

  // Clicking the words opens that note at the line.
  await page.locator('[data-testid^="notes-task-open-"]').first().click();
  await page.waitForTimeout(500);
  ok("clicking an item opens the note it lives in", (await tb("note-title").inputValue()) === "Water district");
  ok("…and marks where the line is", await tb("note-find-bar").count() === 1);
  await tb("notes-view-tree").click();
  await page.waitForTimeout(200);
}

/* ════ 6. ATTACHMENTS — a real file, round-tripped ══════════════════════════════════ */
console.log("\n6 · Attachments of any file type (NEW-5)");
{
  const id = await newPage("Survey");
  await caretInDoc();
  await page.keyboard.type("Survey came in:", { delay: 8 });

  await tb("nt-attach").click();
  await page.setInputFiles('[data-testid="note-file-input"]', {
    name: "Site survey.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4\n% a small but real pdf header\n"),
  });
  await page.waitForTimeout(700);
  await settle();

  ok("a chip appears for the file", await tb("note-attachment").count() === 1);
  const chip = await tb("note-attachment").innerText();
  ok("…with its name, its type and its size", chip.includes("Site survey.pdf") && chip.includes("PDF") && /B|KB|MB/.test(chip), chip.replace(/\n/g, " "));

  const doc = await readBody(id);
  const files = nodesOf(doc, "noteAttachment");
  ok("⛔ THE NODE IS IN THE SAVED DOCUMENT", files.length === 1 && files[0].attrs.name === "Site survey.pdf");
  ok("…and the DOCUMENT DOES NOT HOLD THE BYTES", !JSON.stringify(doc).includes("JVBERi"), `${JSON.stringify(doc).length} chars`);

  const bytesInIdb = await page.evaluate(async (fileId) => new Promise((resolve) => {
    const req = indexedDB.open("planyr-notes");
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction("images", "readonly");
      const g = t.objectStore("images").get(`local:${fileId}`);
      g.onsuccess = () => resolve(!!g.result?.dataUrl && g.result.kind === "file");
      g.onerror = () => resolve(false);
    };
    req.onerror = () => resolve(false);
  }), files[0]?.attrs?.fileId);
  ok("…they are in IndexedDB, marked as a FILE", bytesInIdb === true);

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    tb("nt-export").click(),
  ]);
  const saved = join(dlDir, download.suggestedFilename());
  await download.saveAs(saved);
  const md = readFileSync(saved, "utf8");
  ok("⛔ IT SURVIVES THE MARKDOWN EXPORT, BY NAME", md.includes("Site survey.pdf"), md.split("\n").find((l) => l.includes("survey")) || "");

  // …and the printed sheet names it too (PDF-PARITY): a file must not vanish off paper.
  await tb("nt-print").click();
  await page.waitForTimeout(1200);
  const sheet = await printedSheet();
  ok("⛔ …AND THE PRINTED SHEET NAMES IT", sheet.text.includes("Site survey.pdf"), `${sheet.text.length} chars of sheet`);
}

/* ════ 7. THE OUTLINE — clicking a row moves the caret into that heading ═════════════ */
console.log("\n7 · Outline pane (NEW-6)");
{
  const id = await newPage("No headings here");
  await caretInDoc();
  await page.keyboard.type("just a paragraph", { delay: 8 });
  await settle();
  ok("⛔ A NOTE WITH NO HEADINGS SHOWS NO PANE AT ALL — absent, not empty",
    await tb("note-outline").count() === 0 && await tb("note-outline-open").count() === 0);

  const withHeads = await newPage("Sections");
  await caretInDoc();
  await page.keyboard.type("/h1", { delay: 25 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("Site", { delay: 10 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("acreage", { delay: 10 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("/h2", { delay: 25 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("Drainage", { delay: 10 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("detention pond sizing", { delay: 10 });
  await settle();

  await page.waitForSelector('[data-testid="note-outline"]', { timeout: 5000 });
  const rows = await page.locator('[data-testid^="note-outline-row-"]').allInnerTexts();
  ok("the pane lists the headings, in order", rows.join("|") === "Site|Drainage", rows.join("|"));

  const beforeDoc = await readBody(withHeads);
  await page.locator('[data-testid="note-outline-row-0"]').click();
  await page.waitForTimeout(300);
  // ⛔ ASSERT WHERE THE CARET WENT, not that anything took focus: type a character and see
  // which heading it lands in.
  await page.keyboard.type("X", { delay: 10 });
  await settle();
  const afterDoc = await readBody(withHeads);
  const headings = nodesOf(afterDoc, "heading").map((h) => textOf(h));
  ok("⛔ CLICKING A ROW PUTS THE CARET IN THAT HEADING", headings[0] === "XSite", headings.join("|"));
  ok("…and left the other section alone", headings[1] === "Drainage");
  ok("the document was otherwise untouched",
    nodesOf(afterDoc, "heading").length === nodesOf(beforeDoc, "heading").length);

  // The active row follows the caret.
  const active = await page.locator('[data-testid="note-outline-row-0"]').getAttribute("data-active");
  ok("the section the caret is in is the highlighted row", active === "1");

  // Collapsing hides the rows nested under it; the pane itself collapses to a rail.
  await tb("note-outline-close").click();
  await page.waitForTimeout(200);
  ok("the pane collapses to a way back in", await tb("note-outline").count() === 0 && await tb("note-outline-open").count() === 1);
  await tb("note-outline-open").click();
  await page.waitForTimeout(200);
  ok("…and re-opens", await tb("note-outline").count() === 1);
  void id;
}

/* ════ 8. CALLOUT + TOGGLE — in the document, and expanded on paper ═════════════════ */
console.log("\n8 · Callouts and collapsible sections (NEW-7)");
{
  const id = await newPage("Blocks");
  await caretInDoc();
  await page.keyboard.type("/callout", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("The district will not accept the 8-inch line.", { delay: 6 });
  await settle();

  let doc = await readBody(id);
  ok("⛔ A CALLOUT IS IN THE SAVED DOCUMENT, WITH A TONE",
    nodesOf(doc, "noteCallout").length === 1 && !!nodesOf(doc, "noteCallout")[0].attrs.tone,
    JSON.stringify(nodesOf(doc, "noteCallout")[0]?.attrs));
  ok("…and it holds the words typed into it", textOf(doc).includes("8-inch line"));

  // Change its tone from the toolbar and assert the DOCUMENT, not the button.
  await tb("nt-more").click();
  await page.waitForTimeout(150);
  await tb("nt-callout").click();
  await page.waitForTimeout(150);
  await tb("nt-callout-danger").click();
  await settle();
  doc = await readBody(id);
  ok("changing the tone changes the node's tone, in place", nodesOf(doc, "noteCallout")[0]?.attrs?.tone === "danger");
  ok("…and did not nest a second callout inside the first", nodesOf(doc, "noteCallout").length === 1);

  // A toggle, folded, then printed.
  await page.keyboard.press("Control+End");
  await caretInDoc();
  await page.keyboard.press("Enter");
  await page.keyboard.type("/toggle", { delay: 20 });
  await page.keyboard.press("Enter");
  await page.keyboard.type("Bonding", { delay: 10 });
  await settle();
  // Click straight into the toggle's body paragraph. ArrowDown out of a <summary> is the
  // browser's business, not the app's, and a harness that depends on it is testing Chromium.
  const bodyAt = await page.evaluate(() => {
    const para = document.querySelector('[data-testid="note-body"] details.planyr-toggle > p');
    if (!para) return null;
    const r = para.getBoundingClientRect();
    return { x: r.left + 8, y: r.top + r.height / 2 };
  });
  ok("the toggle arrives with somewhere to type", !!bodyAt);
  if (bodyAt) await page.mouse.click(bodyAt.x, bodyAt.y);
  await page.keyboard.type("THE SURETY LETTER IS IN", { delay: 8 });
  await settle();

  doc = await readBody(id);
  const toggles = nodesOf(doc, "noteToggle");
  ok("⛔ A TOGGLE IS IN THE SAVED DOCUMENT, WITH A TITLE AND A BODY",
    toggles.length === 1 && textOf(toggles[0]).includes("Bonding"), textOf(toggles[0] || {}));
  ok("…and its contents are inside it", textOf(toggles[0] || {}).includes("THE SURETY LETTER IS IN"));

  // Fold it on screen.
  const foldedOnScreen = await page.evaluate(() => {
    const d = document.querySelector('[data-testid="note-body"] details.planyr-toggle');
    if (!d) return null;
    const s = d.querySelector("summary");
    const r = s.getBoundingClientRect();
    return { x: r.left + 6, y: r.top + r.height / 2 };
  });
  if (foldedOnScreen) {
    await page.mouse.click(foldedOnScreen.x, foldedOnScreen.y);
    await page.waitForTimeout(300);
    await settle();
  }
  const shut = await page.evaluate(() => !document.querySelector('[data-testid="note-body"] details.planyr-toggle')?.open);
  ok("pressing the marker folds it on screen", shut === true);
  doc = await readBody(id);
  ok("…and the fold is recorded in the document, so it survives a reload",
    nodesOf(doc, "noteToggle")[0]?.attrs?.open === false, JSON.stringify(nodesOf(doc, "noteToggle")[0]?.attrs));

  // ⛔ AND A FOLDED TOGGLE PRINTS EXPANDED.
  await tb("nt-print").click();
  await page.waitForTimeout(1400);
  const sheet = await printedSheet();
  ok("⛔ THE PRINTED SHEET CARRIES THE FOLDED SECTION'S CONTENTS — laid out, not merely present",
    sheet.text.includes("THE SURETY LETTER IS IN"), `${sheet.text.length} chars of laid-out sheet`);
  ok("…as an OPEN details element, not a closed one", /<details[^>]*\sopen/.test(sheet.html));
  ok("the callout prints too, with its tone", sheet.text.includes("8-inch line") && sheet.html.includes('data-callout="danger"'));

  // The Markdown export carries both.
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    tb("nt-export").click(),
  ]);
  const saved = join(dlDir, `blocks-${download.suggestedFilename()}`);
  await download.saveAs(saved);
  const md = readFileSync(saved, "utf8");
  ok("⛔ THE MARKDOWN CARRIES THE CALLOUT AS A REAL ALERT", md.includes("[!CAUTION]"), md.split("\n").find((l) => l.includes("[!")) || "");
  ok("⛔ …AND THE FOLDED TOGGLE, EXPANDED", md.includes("<details open>") && md.includes("THE SURETY LETTER IS IN"));
}

/* ════ 9. NOTHING SHIPPED TODAY REGRESSED ════════════════════════════════════════════ */
console.log("\n9 · The things that already worked still work");
{
  const id = await newPage("Regression");
  await caretInDoc();
  // Tab in a plain paragraph still belongs to the document (B1392).
  await page.keyboard.type("indent me", { delay: 8 });
  await page.keyboard.press("Home");
  await page.keyboard.press("Tab");
  await settle();
  ok("Tab still indents inside the note rather than escaping to the browser",
    textOf(await readBody(id)).includes("\t"), JSON.stringify(textOf(await readBody(id))));

  // Click-and-type still inserts nothing but a caret (B1393 ×3).
  const before = JSON.stringify(await readBody(id));
  const box = await page.evaluate(() => {
    const mat = document.querySelector('[data-testid="note-mat"]').getBoundingClientRect();
    return { x: mat.left + 200, y: mat.bottom - 40 };
  });
  await page.mouse.click(box.x, box.y);
  await settle();
  const after = JSON.stringify(await readBody(id));
  const added = (after.match(/"paragraph"/g) || []).length - (before.match(/"paragraph"/g) || []).length;
  ok("clicking blank space adds at most one empty line and no filler", added <= 1, `${added} paragraph(s)`);

  // Full-text search still returns an IN TEXT badge with a snippet.
  await tb("notes-search").fill("surety");
  await page.waitForTimeout(400);
  const hits = await tb("notes-search-results").innerText().catch(() => "");
  ok("full-text search still finds a body hit and badges it", hits.includes("IN TEXT"), hits.split("\n").slice(0, 3).join(" / "));
  await tb("notes-search").fill("");
}

/* ════ 10. ⛔ AN OVERLAY OWNS THE KEYBOARD, OR IT WRITES INTO THE NOTE (B298753 ×2) ════════
 *
 * THE REPORT THIS SECTION EXISTS FOR, because it reached a real note. Ctrl+K opened the
 * palette over the editor; the owner typed `Quadvest`; the list never filtered and the word
 * was written into his real, previously-empty Entitlements note.
 *
 * ⛔ AND §3 ABOVE WAS GREEN THROUGHOUT — because it waits for the panel before it types.
 * That wait is exactly what a person does not do, and it is what made a data-writing bug
 * look like a passing feature. So every row below asserts BOTH halves, always: the list
 * filtered to the expected note AND the underlying document is byte-for-byte unchanged. A
 * check that asserted only "the panel opened" would have passed on the shipped build.
 */
console.log("\n10 · The palette owns the keyboard (B298753 ×2)");
{
  await newPage("Quadvest water");
  const target = await newPage("Entitlements");
  await caretInDoc();
  await settle();
  const before = JSON.stringify(await readBody(target));

  /* HIS GESTURE, EXACTLY: the chord, then typing, with no wait for the panel in between.
   *
   * ⛔ AND A MEASURED ADMISSION, BECAUSE IT DECIDES WHICH ROW ACTUALLY HAS TEETH. On a WARM
   * cache this timing race does not reproduce here at all: against the broken build these
   * rows stayed green at 55 ms between keystrokes AND at full speed, because Playwright's
   * key dispatch is slower than a React commit once the chunk is already downloaded. So the
   * rows below assert the PROPERTY and are worth having, but they are not the ones that
   * catch the regression. The two that are, are the deterministic focus row immediately
   * after this block — which reproduces the owner's symptom exactly, by putting focus back
   * where he had it — and §11, which makes the gap a real network round trip. */
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Quadvest", { delay: 0 });
  await page.waitForTimeout(700);

  ok("⛔ THE LIST FILTERED TO THE NOTE HE MEANT",
    (await page.locator('[data-testid^="notes-quick-open-hit-"]').allInnerTexts()).join("|") === "Quadvest water",
    (await page.locator('[data-testid^="notes-quick-open-hit-"]').allInnerTexts()).join("|"));
  ok("…every character reached the field, including the first",
    (await tb("notes-quick-open-input").inputValue()) === "Quadvest",
    await tb("notes-quick-open-input").inputValue());

  await settle();
  ok("⛔ AND THE DOCUMENT BEHIND IT IS BYTE-FOR-BYTE UNCHANGED",
    JSON.stringify(await readBody(target)) === before, `${before} → ${JSON.stringify(await readBody(target))}`);

  /* ⛔ THE DETERMINISTIC ONE, AND IT IS THE OWNER'S SYMPTOM WITH THE RACE TAKEN OUT.
   *
   * His report was not "a character leaked" — it was that the palette never took the
   * keyboard at all and the whole word went into the note. Rather than try to lose a race on
   * purpose, put focus back exactly where he had it, with the palette open, and type. A
   * build whose safety depends on focus fails this every time; a build that swallows at the
   * window does not care where focus is, which is the property being claimed. */
  await page.evaluate(() => { document.querySelector('[data-testid="note-body"]')?.focus(); });
  await page.waitForTimeout(120);
  const beforeStolen = JSON.stringify(await readBody(target));
  await page.keyboard.type(" water", { delay: 20 });
  await settle();
  ok("⛔ WITH FOCUS PUT BACK IN THE NOTE, TYPING STILL DOES NOT REACH IT",
    JSON.stringify(await readBody(target)) === beforeStolen,
    `${beforeStolen} → ${JSON.stringify(await readBody(target))}`);
  ok("…it went to the palette instead, which is where the person was looking",
    (await tb("notes-quick-open-input").inputValue()) === "Quadvest water",
    await tb("notes-quick-open-input").inputValue());
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(200);

  /* Escape closes it and gives the caret back — otherwise focus is nowhere and the next
     keystroke lands on the page rather than in the note. */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  ok("Escape closes the palette", await tb("notes-quick-open").count() === 0);
  await page.keyboard.type("back in the note", { delay: 8 });
  await settle();
  ok("…and typing goes back to the NOTE, where the caret was",
    textOf(await readBody(target)).includes("back in the note"), textOf(await readBody(target)));
  ok("…and the word he typed at the palette is still nowhere in the note",
    !textOf(await readBody(target)).includes("Quadvest"), textOf(await readBody(target)));

  /* ⛔ ENTER STILL OPENS THE HIT, typed straight through with no wait. */
  await page.keyboard.press("Control+k");
  await page.keyboard.type("Quadvest", { delay: 0 });
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  ok("Enter opens the note the list was showing", (await tb("note-title").inputValue()) === "Quadvest water",
    await tb("note-title").inputValue());
}

/* ════ 11. THE COLD CASE — the palette's chunk still downloading ══════════════════════ */
console.log("\n11 · The palette is late and the keyboard is still safe (B298753 ×2)");
{
  /* ⛔ THIS IS THE CONDITION HE ACTUALLY HIT AND THE ONE A WARM SANDBOX CANNOT REACH: the
   * FIRST Ctrl+K on a freshly-deployed build downloads the palette's lazy chunk, so the gap
   * between "open" and "on screen" is a network round trip rather than a React commit. A
   * fresh browser context is the only honest way to get an unwarmed cache; the route delays
   * the chunk so the gap is wide enough to type a whole word into. */
  const coldCtx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
  const cold = await coldCtx.newPage();
  await cold.route(/QuickOpen-.*\.js$/, async (route) => {
    await new Promise((r) => setTimeout(r, 900));
    await route.continue();
  });
  await cold.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await cold.evaluate(() => { localStorage.clear(); });
  await cold.reload({ waitUntil: "domcontentloaded" });
  await cold.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });

  for (const t of ["Quadvest water", "Entitlements"]) {
    await cold.locator('[data-testid="notes-new-page"]').click();
    await cold.waitForTimeout(350);
    await cold.locator('[data-testid="note-title"]').fill(t);
    await cold.waitForTimeout(600);
  }
  const coldAt = await cold.evaluate(() => {
    const b = document.querySelector('[data-testid="note-body"]');
    const r = (b.lastElementChild || b).getBoundingClientRect();
    return { x: r.right - 2, y: r.top + 8 };
  });
  await cold.mouse.click(coldAt.x, coldAt.y);
  await cold.waitForTimeout(400);

  const coldId = await cold.evaluate(() => {
    const t = JSON.parse(localStorage.getItem("planyr:notes:tree:v1:local") || "null");
    const title = document.querySelector('[data-testid="note-title"]').value;
    const hit = [];
    const go = (n) => { if (n.title === title) hit.push(n.id); (n.pages || []).forEach(go); };
    (t?.pages || []).forEach(go);
    return hit[0];
  });
  const readCold = () => cold.evaluate((k) => localStorage.getItem(k), PAGE_PREFIX + coldId);
  const coldBefore = await readCold();

  await cold.keyboard.press("Control+k");
  await cold.keyboard.type("Quadvest", { delay: 55 });   // the whole word lands inside the gap
  await cold.waitForTimeout(2000);

  ok("⛔ WITH THE PANEL STILL DOWNLOADING, THE DOCUMENT IS STILL UNTOUCHED",
    (await readCold()) === coldBefore, `${coldBefore} → ${await readCold()}`);
  ok("…and when it arrives it is already filtered by what was typed at it",
    (await cold.locator('[data-testid^="notes-quick-open-hit-"]').allInnerTexts()).join("|") === "Quadvest water",
    (await cold.locator('[data-testid^="notes-quick-open-hit-"]').allInnerTexts()).join("|"));
  ok("…with every character, none swallowed by the wait",
    (await cold.locator('[data-testid="notes-quick-open-input"]').inputValue()) === "Quadvest",
    await cold.locator('[data-testid="notes-quick-open-input"]').inputValue());

  await coldCtx.close();
}

/* ════ 12. THE SAME CLASS ON THE OTHER TWO OVERLAYS ══════════════════════════════════ */
console.log("\n12 · Every other surface that accepts keystrokes (B298753 ×2)");
{
  const id = await newPage("Other overlays");
  await caretInDoc();

  /* THE SLASH MENU IS THE DELIBERATE OPPOSITE, and it is worth stating rather than assuming:
   * its keystrokes are SUPPOSED to reach the document, because the `/h2` you type IS the
   * filter and is removed when a command runs. What must NOT reach the document is the
   * navigation — an arrow or an Escape must never arrive as a character. */
  await page.keyboard.type("/head", { delay: 25 });
  await page.waitForTimeout(150);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Escape");
  await settle();
  const afterSlash = textOf(await readBody(id));
  ok("the slash menu's arrows and Escape never arrive as text", afterSlash.trim() === "/head", JSON.stringify(afterSlash));

  /* THE HISTORY PANEL IS A SIDE PANE, NOT AN OVERLAY — it never takes focus, so typing while
   * it is open must keep going to the note. A pane that quietly ate keystrokes would be the
   * mirror image of the palette bug and just as invisible. */
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await settle();
  await tb("nt-history").click();
  await page.waitForSelector('[data-testid="note-history"]', { timeout: 5000 });
  await caretInDoc();
  await page.keyboard.type("typed with history open", { delay: 8 });
  await settle();
  ok("the history pane does not eat keystrokes — they go to the note",
    textOf(await readBody(id)).includes("typed with history open"), textOf(await readBody(id)));
  await tb("note-history-close").click();
  await page.waitForTimeout(200);
  ok("…and closing it changes nothing in the document",
    textOf(await readBody(id)).includes("typed with history open"));
}

/* ---- report -------------------------------------------------------------------------- */
ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("\nFailed:");
  for (const f of failed) console.log(`  ✗ ${f.name}`);
  process.exit(1);
}
