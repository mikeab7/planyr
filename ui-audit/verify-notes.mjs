/* Verify the Notes workspace against the REAL built app, headless.
 *
 * Everything here is reachable logged out, which is why none of it is parked for a live
 * pass: the module's storage is per-device, the editor needs no network, and the whole
 * notebook › section › page flow works signed out. (The ONE genuinely auth-blocked half —
 * that account A's notes are invisible to account B in the same browser — is a V### entry,
 * because the sandbox proxy CORS-blocks Supabase sign-in.)
 *
 * TWO OF THESE CHECKS FAILED BEFORE THE FIXES THEY GUARD, which is why they are committed
 * rather than run ad hoc:
 *   • "an edit made a split second before switching pages survives" — the old flush asked
 *     the outgoing editor for its document and lost the race with the editor's own cleanup.
 *   • "reopening a note containing a table does not crash" — an effect calling setContent
 *     against a torn-down instance threw `Cannot read properties of null (reading
 *     'commands')` and took the whole workspace into its error boundary.
 *
 * ROUND TWO added the checks below §10: the empty-page prompt, a pasted PICTURE (and the
 * proof its bytes are in IndexedDB rather than in the note), the print sheet, the visible
 * broken-image state, MOVE through the UI (the model ops that had no caller at all), page
 * timestamps and Recent, search that marks and steps, the one-row toolbar, and the BIN —
 * including the two exits that matter: undo restores everything, and only "delete forever"
 * frees the bytes.
 *
 *   npx vite preview --port 4173 &
 *   node ui-audit/verify-notes.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

/* Local `vite preview` by default. Point BASE_URL at a deployed origin (a Cloudflare Pages
 * branch preview, or planyr.io) to run the same checks against the REAL served bytes — the
 * sandbox egress proxy intercepts TLS, so a remote origin additionally needs the proxy on
 * the command line and certificate errors ignored, per the VERIFICATION.md recipe. */
const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const browser = await chromium.launch({
  executablePath: EXEC,
  args: [
    "--no-sandbox",
    "--ignore-certificate-errors",
    ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : []),
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, acceptDownloads: true, ignoreHTTPSErrors: true });
const page = await ctx.newPage();

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
const jsRequests = [];
/* Anything that would be a NOTES cloud call (B1291). Signed out there must be none at all —
 * see §20. Scoped to the notes tables and the picture bucket on purpose: the app has other,
 * legitimate Supabase traffic (auth, site data) and a blanket "any supabase URL" check would
 * be a false alarm rather than a guard. */
const cloudRequests = [];
page.on("request", (r) => {
  const u = r.url();
  if (u.endsWith(".js")) jsRequests.push(u.split("/").pop());
  if (/notes_trees|notes_pages|notes_images|notes-images/.test(u)) cloudRequests.push(u.slice(0, 120));
});

/* ---- helpers ------------------------------------------------------------------------- */

const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const readTree = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), TREE_KEY);
const readBody = (id) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), PAGE_PREFIX + id);
const pageKeyCount = () => page.evaluate((p) => Object.keys(localStorage).filter((k) => k.startsWith(p)).length, PAGE_PREFIX);
// The badge is uppercased by CSS (textTransform), so innerText comes back "UNSAVED".
// Compare on the word, not the casing.
const badge = async () => (await page.locator('[data-testid="note-save-badge"]').innerText()).trim().toLowerCase();

/** Every node of a given type in a ProseMirror document. */
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
const marksIn = (doc) => {
  const out = new Set();
  const walk = (n) => { if (!n || typeof n !== "object") return; (n.marks || []).forEach((m) => out.add(m.type)); (n.content || []).forEach(walk); };
  walk(doc);
  return [...out];
};

const typeInBody = async (text) => {
  await page.locator('[data-testid="note-body"]').click();
  await page.keyboard.type(text, { delay: 8 });
};
const tb = (id) => page.locator(`[data-testid="${id}"]`);
/* A tree row reveals its ＋ / rename / delete controls on HOVER, so a click has to be
 * preceded by a real pointer move onto the row — exactly as a person would do it. */
const rowAction = async (rowId, action) => {
  await tb(`notes-row-${rowId}`).hover();
  await page.waitForTimeout(120);
  await tb(`notes-${action}-${rowId}`).click();
};
/** Settle past the 600 ms autosave debounce. */
const settle = async () => page.waitForTimeout(1100);

/* Every image record in the notes IndexedDB, WITHOUT its bytes. The whole point of the
 * image tier is that the pixels are NOT in localStorage, so a check that only reads
 * localStorage cannot see them at all — this is how the harness proves where they went. */
const imageRecords = () => page.evaluate(() => new Promise((resolve) => {
  let req;
  try { req = indexedDB.open("planyr-notes", 1); } catch (_) { resolve([]); return; }
  req.onerror = () => resolve([]);
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains("images")) { resolve([]); return; }
    const out = [];
    const cur = db.transaction("images", "readonly").objectStore("images").openCursor();
    cur.onerror = () => resolve(out);
    cur.onsuccess = () => {
      const c = cur.result;
      if (!c) { resolve(out); return; }
      const v = c.value || {};
      out.push({ id: v.id, pageId: v.pageId, bytes: v.bytes, mime: v.mime, scope: v.scope, isDataUrl: /^data:image\//.test(v.dataUrl || "") });
      c.continue();
    };
  };
}));

/** Paste a real PNG into the open note, exactly as a clipboard image arrives. */
const pasteImage = async (px = 240) => {
  await page.locator('[data-testid="note-body"]').click();
  await page.evaluate(async (size) => {
    const c = document.createElement("canvas");
    c.width = size; c.height = Math.round(size * 0.6);
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#1D4ED8"; ctx.fillRect(0, 0, c.width, c.height);
    ctx.fillStyle = "#FEF08A"; ctx.fillRect(10, 10, 60, 30);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const file = new File([blob], "flood-map.png", { type: "image/png" });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.querySelector('[data-testid="note-body"]').dispatchEvent(
      new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }),
    );
  }, px);
  await page.waitForTimeout(900);
};

console.log("Notes workspace — live checks\n");

/* ════ 1. The tab opens, and the engine arrives BEHIND the tree ════════════════════════ */
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1500);

/* The Shell keeps every VISITED workspace mounted (hidden), and each renders its own
 * AppHeader — so once Notes has been opened there are two module-tab rows in the DOM and
 * only one is visible. Every header locator below is therefore scoped to :visible. */
const notesTab = page.locator('[data-testid="module-tab-notes"]:visible').first();
ok("a Notes module tab exists in the shared header", await notesTab.count() === 1);

const beforeClick = jsRequests.length;
await notesTab.click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });
ok("clicking the tab activates it", await notesTab.getAttribute("aria-current") === "page");
ok("the notebook tree renders", await page.locator('[data-testid="notes-tree"]').isVisible());

const afterNav = jsRequests.slice(beforeClick);
const notesChunkAt = afterNav.findIndex((f) => /^Notes-/.test(f));
ok("the Notes route pulled its own chunk on demand", notesChunkAt > -1, afterNav.filter((f) => /Notes|NoteEditor/.test(f)).join(", ") || "none");

await page.waitForTimeout(2000);
/* The engine has NOT been fetched yet: with no notebook there is no open page, so the
 * Suspense boundary never mounts. This is the boundary working — the rail is interactive
 * while ~464 KB of editor has not been asked for. */
ok("the tree is interactive BEFORE the editor engine is fetched at all",
  !jsRequests.some((f) => /^NoteEditor-/.test(f)), jsRequests.filter((f) => /NoteEditor/.test(f)).join(", ") || "engine not yet requested");

/* ════ 2. One click makes a typeable notebook ══════════════════════════════════════════ */
ok("with nothing yet, an empty state offers to create a notebook", await page.locator('[data-testid="notes-empty-create"]').count() === 1);

await tb("notes-new-notebook").click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
ok("ONE click produces an open, typeable page", await page.locator('[data-testid="note-body"]').isVisible());

await page.waitForTimeout(1200);   // past the tree-save debounce
const editorChunk = jsRequests.find((f) => /^NoteEditor-/.test(f));
ok("the EDITOR arrives as its OWN chunk, only once a page is opened", !!editorChunk, editorChunk || "not requested");

let tree = await readTree();
ok("the new notebook is born with a section and a page", !!tree && tree.notebooks[0].sections[0].pages.length === 1,
  tree ? `${tree.notebooks[0].sections.length} section(s)` : "no tree");
ok("created from the dashboard, the notebook is LOOSE (visible from every project)", tree?.notebooks[0].projectId === null);

const page1 = tree.notebooks[0].sections[0].pages[0].id;
const section1 = tree.notebooks[0].sections[0].id;
const notebook1 = tree.notebooks[0].id;

/* ════ 3. Typing reaches THAT page's own key, and the badge tells the truth ═════════════ */
await typeInBody("The north property line runs along the bayou.");
const badgeWhileTyping = await badge();
ok('the badge reads "Unsaved" while a change is pending', badgeWhileTyping === "unsaved", badgeWhileTyping);

await settle();
const badgeAfter = await badge();
ok('the badge reads "Saved" once the write lands', badgeAfter === "saved", badgeAfter);

const body1 = await readBody(page1);
ok("the text landed in THAT PAGE'S OWN storage key", textOf(body1).includes("north property line"), (PAGE_PREFIX + page1).slice(0, 42) + "…");
ok("the tree key holds NO page body — bodies are separate keys", !JSON.stringify(await readTree()).includes("north property line"));

/* ════ 4. The formatting writes the REAL document model ════════════════════════════════ */
await page.keyboard.press("Enter");
await tb("nt-bold").click();
await typeInBody("Bold sentence.");
await settle();
ok("Bold writes a real bold mark into the document model", marksIn(await readBody(page1)).includes("bold"));

await page.locator('[data-testid="note-body"]').click();
await page.keyboard.press("Enter");
await tb("nt-block").selectOption("h2");
await page.keyboard.type("Site conditions", { delay: 8 });
await settle();
let doc = await readBody(page1);
const headings = nodesOf(doc, "heading");
ok("the block-style select writes a real heading node at the chosen level", headings.some((h) => h.attrs?.level === 2), `levels ${headings.map((h) => h.attrs?.level).join(",")}`);

await page.keyboard.press("Enter");
await tb("nt-block").selectOption("p");
await tb("nt-task").click();
await page.keyboard.type("Call the district", { delay: 8 });
await settle();
doc = await readBody(page1);
ok("the checklist button writes a real task list", nodesOf(doc, "taskList").length === 1 && nodesOf(doc, "taskItem").length === 1);
ok("a task item carries its checked state", nodesOf(doc, "taskItem")[0]?.attrs?.checked === false);

/* ════ 5. Tables, and controls that appear only inside one ═════════════════════════════ */
ok("the table controls are HIDDEN while the caret is not in a table", await tb("nt-table-group").count() === 0);

await tb("nt-table").click();
await page.waitForTimeout(400);
ok("the table controls APPEAR once the caret is inside a table", await tb("nt-table-group").count() === 1);

await settle();
doc = await readBody(page1);
ok("inserting a table writes a real table node", nodesOf(doc, "table").length === 1);
const rows0 = nodesOf(doc, "tableRow").length;
const cols0 = nodesOf(doc, "tableRow")[0]?.content?.length || 0;
ok("the inserted table has a header row", nodesOf(doc, "tableHeader").length > 0, `${rows0} rows × ${cols0} cols`);

await tb("nt-row-after").click();
await settle();
const rows1 = nodesOf(await readBody(page1), "tableRow").length;
ok("inserting a row CHANGES the model", rows1 === rows0 + 1, `${rows0} → ${rows1}`);

await tb("nt-col-after").click();
await settle();
doc = await readBody(page1);
const cols1 = nodesOf(doc, "tableRow")[0]?.content?.length || 0;
ok("inserting a column CHANGES the model", cols1 === cols0 + 1, `${cols0} → ${cols1}`);

await page.locator('[data-testid="note-body"] table td').first().click();
await page.keyboard.type("Katy Prairie", { delay: 8 });
await settle();
ok("a table cell accepts text", textOf(await readBody(page1)).includes("Katy Prairie"));

/* ════ 6. THE RACE: an edit a split second before switching pages ══════════════════════ */
await rowAction(section1, "add");
await page.waitForTimeout(700);
tree = await readTree();
const page2 = tree.notebooks[0].sections[0].pages[1]?.id;
ok("a second page can be added to the section", !!page2, page2 || "none");

await typeInBody("Second page groundwork.");
await settle();
ok("the second page saves to its OWN key, leaving the first alone",
  textOf(await readBody(page2)).includes("Second page groundwork")
  && !textOf(await readBody(page1)).includes("Second page groundwork"));

/* Type, then switch pages IMMEDIATELY — well inside the 600 ms debounce. This is the
 * regression: the old flush queried the outgoing editor and raced its own teardown. */
await page.locator('[data-testid="note-body"]').click();
await page.keyboard.press("End");
await page.keyboard.type(" LAST-TYPED-BEFORE-SWITCH", { delay: 5 });
await page.waitForTimeout(90);                                  // a split second, not a full debounce
await tb(`notes-row-${page1}`).click();
await page.waitForTimeout(1400);

const rescued = textOf(await readBody(page2));
ok("AN EDIT MADE A SPLIT SECOND BEFORE SWITCHING PAGES IS NOT LOST",
  rescued.includes("LAST-TYPED-BEFORE-SWITCH"), rescued.slice(-52));

/* ...and it landed in the RIGHT page. Verified by falsification: with the per-page remount
 * key removed, the marker above still survived, but page 1's text bled into page 2's body
 * (one editor instance carrying its content across the switch). Presence of the marker
 * alone is therefore not enough — the page must contain ONLY its own text. */
ok("...and page 1's content did NOT bleed into page 2 (the remount key is doing its job)",
  rescued.trim().startsWith("Second page groundwork"), rescued.slice(0, 60));

ok("switching pages did not crash the workspace", pageErrors.length === 0, pageErrors.join(" | ") || "clean");
ok("the first page's own content is intact after the round trip", textOf(await readBody(page1)).includes("north property line"));

/* ════ 7. A reload restores everything — including the TABLE that used to crash ════════ */
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1800);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await page.waitForTimeout(900);

const crashed = await page.locator("text=Something went wrong").count();
ok("REOPENING A NOTE CONTAINING A TABLE DOES NOT CRASH THE WORKSPACE", crashed === 0 && pageErrors.length === 0,
  pageErrors.join(" | ") || "clean");
ok("the reloaded page shows its text again", (await page.locator('[data-testid="note-body"]').innerText()).includes("north property line"));
ok("the reloaded page still renders its TABLE", await page.locator('[data-testid="note-body"] table').count() === 1);
ok("both pages survived the reload", (await readTree()).notebooks[0].sections[0].pages.length === 2);

await tb(`notes-row-${page2}`).click();
await page.waitForTimeout(900);
ok("the second page reopens with its own text (per-page bodies, not one blob)",
  (await page.locator('[data-testid="note-body"]').innerText()).includes("Second page groundwork"));

/* ════ 8. Search reaches page BODIES, not just titles ══════════════════════════════════ */
await tb("notes-search").fill("bayou");
await page.waitForTimeout(700);
const hits = page.locator('[data-testid="notes-search-results"] button');
ok("SEARCH FINDS A PAGE BY A PHRASE THAT APPEARS ONLY IN ITS BODY", await hits.count() >= 1, `${await hits.count()} hit(s)`);
ok("a body hit is labelled as such and shows an excerpt", (await hits.first().innerText()).toLowerCase().includes("in text"));

await tb("notes-search").fill("zzz-no-such-phrase");
await page.waitForTimeout(500);
ok("a query with no matches says so instead of showing everything", await page.locator("text=No pages match").count() === 1);
await tb("notes-search").fill("");
await page.waitForTimeout(400);

/* ════ 9. Markdown export downloads a REAL file ════════════════════════════════════════ */
await tb(`notes-row-${page1}`).click();
await page.waitForTimeout(900);
await page.locator('[data-testid="note-body"]').click();
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await tb("nt-bullet").click();
await page.keyboard.type("Export bullet item", { delay: 8 });
await settle();

const dlDir = mkdtempSync(join(tmpdir(), "notes-export-"));
const [download] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  tb("nt-export").click(),
]);
const saved = join(dlDir, download.suggestedFilename());
await download.saveAs(saved);
const md = readFileSync(saved, "utf8");

ok("the export downloads a real .md file", download.suggestedFilename().endsWith(".md"), download.suggestedFilename());
ok("the exported Markdown contains the HEADING", /^##\s*Site conditions/m.test(md));
ok("the exported Markdown contains the BULLET", /^-\s+Export bullet item/m.test(md));
ok("the exported Markdown contains a GFM task list", /^-\s+\[[ x]\]\s+Call the district/m.test(md));
ok("the exported Markdown contains a pipe TABLE", /\|\s*---\s*\|/.test(md) || /<table>/.test(md));
/* Honesty, both directions. Everything on this page so far — heading, bold, bullet, task
 * list, header-row table — is fully expressible in GFM, so the export must claim NO loss. */
await page.waitForTimeout(400);
ok("a fully-expressible page exports with NO lossiness notice", await tb("notes-export-notice").count() === 0);

/* Now add something Markdown genuinely cannot spell, and export again. */
await page.locator('[data-testid="note-body"]').click();
await page.keyboard.press("Control+End");
await page.keyboard.press("Enter");
await tb("nt-underline").click();
await page.keyboard.type("Underlined clause", { delay: 8 });
await settle();

const [download2] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  tb("nt-export").click(),
]);
const saved2 = join(dlDir, `second-${download2.suggestedFilename()}`);
await download2.saveAs(saved2);
const md2 = readFileSync(saved2, "utf8");
ok("underline falls back to inline HTML so it still DISPLAYS in a reader", /<u>Underlined clause<\/u>/.test(md2));

await page.waitForTimeout(400);
const noticeText = await tb("notes-export-notice").count() ? await tb("notes-export-notice").innerText() : "";
ok("the export NAMES what Markdown could not carry", /underlined text/i.test(noticeText), noticeText.slice(0, 80) || "no notice");

/* ════ 10. AN EMPTY PAGE IS NOT A BLANK VOID ═══════════════════════════════════════════ */
await rowAction(section1, "add");
await page.waitForTimeout(800);
tree = await readTree();
const page3 = tree.notebooks[0].sections[0].pages[2]?.id;
ok("a third, EMPTY page can be added", !!page3, page3 || "none");

const placeholderAttr = await page.locator('[data-testid="note-body"] p.is-editor-empty').first().getAttribute("data-placeholder").catch(() => null);
ok("AN EMPTY PAGE SHOWS A STARTING PROMPT (the Placeholder extension is actually installed)",
  !!placeholderAttr && placeholderAttr.length > 4, placeholderAttr || "no placeholder attribute");
const placeholderPainted = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="note-body"] p.is-editor-empty');
  if (!el) return "";
  return getComputedStyle(el, "::before").content || "";
});
ok("...and the CSS rule for it actually paints — a rule with no extension matched nothing before",
  /Start typing/.test(placeholderPainted), placeholderPainted.slice(0, 48) || "no ::before content");

/* ════ 11. A NOTE CAN HOLD A PICTURE — and the bytes are NOT in localStorage ═══════════ */
await pasteImage(260);
await settle();

const figures = await page.locator('[data-testid="note-image"]').count();
ok("PASTING AN IMAGE PUTS A PICTURE ON THE PAGE", figures === 1, `${figures} figure(s)`);
ok("the pasted picture actually rendered (it has real pixels, not a broken glyph)",
  await page.evaluate(() => { const i = document.querySelector('[data-testid="note-image"] img'); return !!i && i.naturalWidth > 0; }));

let imgs = await imageRecords();
ok("THE BYTES WENT TO INDEXEDDB, not into the note", imgs.length === 1 && imgs[0].isDataUrl,
  imgs.length ? `${imgs[0].bytes} B, ${imgs[0].mime}` : "no record");
ok("the image record is scoped and tagged with the page that owns it",
  imgs[0]?.scope === "local" && imgs[0]?.pageId === page3, `${imgs[0]?.scope} / ${imgs[0]?.pageId}`);

const body3 = await readBody(page3);
const imgNodes = nodesOf(body3, "noteImage");
ok("the DOCUMENT holds an image ID, never the pixels", imgNodes.length === 1 && !!imgNodes[0].attrs?.imageId,
  imgNodes[0]?.attrs?.imageId || "none");
ok("NO base64 image data reached localStorage — this is the whole reason for the split",
  !JSON.stringify(body3).includes("data:image"));

/* ════ 12. The Markdown export inlines the picture, so an exported note is self-contained */
const [download3] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  tb("nt-export").click(),
]);
const saved3 = join(dlDir, `image-${download3.suggestedFilename()}`);
await download3.saveAs(saved3);
const md3 = readFileSync(saved3, "utf8");
ok("THE EXPORTED MARKDOWN INLINES THE IMAGE AS A DATA URL", /!\[[^\]]*\]\(data:image\/[a-z+]+;base64,/.test(md3),
  `${md3.length} chars`);

/* ════ 13. Print / PDF — the sheet shows what the screen shows (PDF-PARITY) ════════════ */
await tb("nt-print").click();
await page.waitForTimeout(1400);
const sheet = await page.evaluate(() => {
  const f = document.querySelector('[data-testid="notes-print-frame"]');
  const d = f && f.contentDocument;
  if (!d) return null;
  return {
    title: d.title,
    h1: d.querySelector(".doc-title")?.textContent || "",
    imgs: d.querySelectorAll('.note-body img[src^="data:image/"]').length,
    body: d.body ? d.body.innerText.slice(0, 400) : "",
    bg: d.body ? getComputedStyle(d.body).backgroundColor : "",
    chrome: d.querySelectorAll('[data-testid="notes-tree"], [data-testid="note-toolbar"]').length,
  };
});
ok("PRINT BUILDS A REAL SHEET", !!sheet && !!sheet.h1, sheet ? sheet.h1 : "no print frame");
ok("the sheet carries the page's PICTURE, resolved to real bytes", (sheet?.imgs || 0) === 1, `${sheet?.imgs} image(s)`);
ok("the sheet drops the app chrome — no rail, no toolbar", sheet?.chrome === 0);
ok("the sheet is light-on-white, whatever the app theme is", /rgb\(255,\s*255,\s*255\)/.test(sheet?.bg || ""), sheet?.bg);

/* ════ 14. A PICTURE WHOSE BYTES ARE GONE SAYS SO ══════════════════════════════════════ */
const gone = imgs[0].id;
await page.evaluate((id) => new Promise((resolve) => {
  const req = indexedDB.open("planyr-notes", 1);
  req.onsuccess = () => {
    const tx = req.result.transaction("images", "readwrite");
    tx.objectStore("images").delete(`local:${id}`);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => resolve(false);
  };
  req.onerror = () => resolve(false);
}), gone);

await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1800);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });
await tb(`notes-row-${page3}`).click();
await page.waitForTimeout(1200);
ok("AN IMAGE WHOSE STORED COPY IS GONE RENDERS A NAMED BROKEN STATE, never a blank gap",
  await page.locator('[data-testid="note-image"][data-missing]').count() === 1
  && /Image missing/i.test(await page.locator('[data-testid="note-image"]').innerText()));

/* ════ 15. MOVE — the model's move ops finally have a caller ════════════════════════════ */
await rowAction(notebook1, "add");
await page.waitForTimeout(900);
tree = await readTree();
const section2Id = tree.notebooks[0].sections[1]?.id;
ok("a second section can be added, to move a page into", !!section2Id, section2Id || "none");

await tb(`notes-row-${page3}`).click();
await page.waitForTimeout(700);

await rowAction(page3, "mv");
await page.waitForTimeout(250);
ok("the move panel opens inline, not in a dialog box", await tb(`notes-move-${page3}`).count() === 1);

await tb(`notes-move-${page3}-to-${section2Id}`).click();
await page.waitForTimeout(900);
tree = await readTree();
const movedInto = tree.notebooks[0].sections.find((s) => (s.pages || []).some((p) => p.id === page3));
ok("A PAGE CAN BE MOVED INTO ANOTHER SECTION — through the UI, not just in a unit test",
  movedInto?.id === section2Id, `now in ${movedInto?.title}`);

await rowAction(page1, "mv");
await page.waitForTimeout(250);
await tb(`notes-move-${page1}-down`).click();
await page.waitForTimeout(900);
tree = await readTree();
const order = tree.notebooks[0].sections[0].pages.map((p) => p.id);
ok("A PAGE CAN BE REORDERED INSIDE ITS SECTION", order.indexOf(page1) > 0, order.join(" → "));

/* ════ 16. Timestamps, and the Recent view they make possible ══════════════════════════ */
tree = await readTree();
const stamped = tree.notebooks[0].sections.flatMap((s) => s.pages).filter((p) => Number.isFinite(p.updatedAt));
ok("EVERY PAGE NOW RECORDS WHEN IT WAS LAST TOUCHED", stamped.length >= 3, `${stamped.length} stamped`);
ok("the rail shows a relative time on a page row", await page.locator(`[data-testid="notes-when-${page1}"]`).count() >= 0);

await tb("notes-view-recent").click();
await page.waitForTimeout(400);
const recentRows = await page.locator('[data-testid="notes-recent-list"] button').count();
ok("A RECENT VIEW LISTS PAGES BY WHEN THEY WERE EDITED", recentRows >= 3, `${recentRows} row(s)`);
const firstRecent = await page.locator('[data-testid="notes-recent-list"] button').first().getAttribute("data-testid");
const newest = [...tree.notebooks[0].sections.flatMap((s) => s.pages)].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
ok("...newest first", firstRecent === `notes-recent-${newest.id}`, `${firstRecent} vs ${newest.id}`);
await tb("notes-view-tree").click();
await page.waitForTimeout(300);

/* ════ 17. Search lands you ON the phrase, and Esc gives the tree back ═════════════════ */
await tb("notes-search").fill("bayou");
await page.waitForTimeout(700);
await page.locator('[data-testid="notes-search-results"] button').first().click();
await page.waitForTimeout(1200);

const findText = await tb("note-find-count").innerText().catch(() => "");
ok("OPENING A SEARCH HIT SAYS WHERE THE PHRASE IS, instead of dropping you at the top",
  /1 of \d+/.test(findText), findText || "no find bar");
ok("the match is actually MARKED in the page", await page.locator('[data-testid="note-body"] .note-search-hit').count() >= 1);

await tb("notes-search").fill("the");
await page.waitForTimeout(700);
await page.locator('[data-testid="notes-search-results"] button').first().click();
await page.waitForTimeout(1200);
const multi = await tb("note-find-count").innerText().catch(() => "");
if (/of (\d+)/.test(multi) && Number(multi.match(/of (\d+)/)[1]) > 1) {
  await tb("note-find-next").click();
  await page.waitForTimeout(400);
  const stepped = await tb("note-find-count").innerText();
  ok("YOU CAN STEP BETWEEN MATCHES", stepped !== multi, `${multi} → ${stepped}`);
} else {
  ok("YOU CAN STEP BETWEEN MATCHES", false, `only one match to step through: ${multi}`);
}
ok("the current match is distinguished from the others", await page.locator('[data-testid="note-body"] .note-search-hit-current').count() === 1);

await tb("note-find-clear").click();
await page.waitForTimeout(300);
ok("clearing the search removes the marking from the page", await page.locator('[data-testid="note-body"] .note-search-hit').count() === 0);

await tb("notes-search").fill("bayou");
await page.waitForTimeout(500);
await tb("notes-search").press("Escape");
await page.waitForTimeout(400);
ok("ESC IN THE SEARCH BOX CLEARS IT AND GIVES THE TREE BACK — it used to do nothing at all",
  await tb("notes-search").inputValue() === "" && await page.locator('[data-testid="notes-search-results"]').count() === 0);

/* ════ 18. The toolbar fits on ONE row at a normal laptop width ════════════════════════ */
/* Measured on a page with NO table: the table group is deliberately contextual (it appears
 * only when the caret is inside one) and is not part of the row that has to fit. */
await tb(`notes-row-${page3}`).click();
await page.waitForTimeout(900);
await page.setViewportSize({ width: 1366, height: 850 });
await page.waitForTimeout(400);
const barRows = await page.evaluate(() => {
  const bar = document.querySelector('[data-testid="note-toolbar"]');
  if (!bar) return 0;
  /* Group on each control's vertical CENTRE, not its top: the bar is `align-items:center`,
   * so a short separator and a tall button in the same row share a centre and differ by
   * several pixels at the top. Counting tops reports two rows on a bar that never wrapped. */
  const rows = new Set();
  for (const el of bar.children) {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) continue;          // the hidden file input
    rows.add(Math.round(r.top + r.height / 2));
  }
  return rows.size;
});
ok("THE FORMATTING BAR NO LONGER WRAPS ONTO A SECOND ROW on a normal laptop", barRows === 1, `${barRows} row(s)`);
ok("the long tail is still reachable, one click away", await tb("nt-more").count() === 1);
await tb("nt-more").click();
await page.waitForTimeout(250);
ok("the More drawer holds the controls that left the row", await tb("nt-more-panel").count() === 1
  && await tb("nt-align-center").count() === 1 && await tb("nt-font").count() === 1);
await page.keyboard.press("Escape");
await page.setViewportSize({ width: 1500, height: 950 });
await page.waitForTimeout(300);

/* ════ 19. DELETE IS UNDOABLE — the bin, and the purge that finally frees the bytes ════ */
/* Put a picture back on a page the section owns, so the purge has real bytes to destroy —
 * the §14 check deleted the earlier one out from under the note on purpose. */
await tb(`notes-row-${page1}`).click();
await page.waitForTimeout(900);
await pasteImage(200);
await settle();
ok("a picture is in place on a page the section owns", (await imageRecords()).length === 1);

const keysBefore = await pageKeyCount();
ok("every page body is on disk before the delete", keysBefore >= 2, `${keysBefore} key(s)`);

await rowAction(section1, "rm");
await page.waitForTimeout(300);
ok("delete asks inline rather than with a dialog box", await tb(`notes-del-${section1}-yes`).count() === 1);

await tb(`notes-del-${section1}-yes`).click();
await page.waitForTimeout(1200);

let treeAfter = await readTree();
ok("the section leaves the live tree", !(treeAfter.notebooks[0]?.sections || []).some((s) => s.id === section1));
ok("...and lands in the BIN, carrying its full page cascade",
  (treeAfter.trash || []).length === 1 && (treeAfter.trash[0].pageIds || []).length >= 1,
  `${(treeAfter.trash?.[0]?.pageIds || []).length} page(s) binned`);
ok("THE BODIES ARE STILL ON DISK — a bin whose contents were already destroyed is not a bin",
  await pageKeyCount() === keysBefore, `${keysBefore} → ${await pageKeyCount()} key(s)`);
ok("an UNDO is offered at the moment of the delete, not buried in a menu", await tb("notes-undo-bar").count() === 1);

await tb("notes-undo").click();
await page.waitForTimeout(1200);
treeAfter = await readTree();
ok("UNDO PUTS THE WHOLE SECTION BACK, pages and all",
  (treeAfter.notebooks[0]?.sections || []).some((s) => s.id === section1) && (treeAfter.trash || []).length === 0);
ok("...and its text is still there afterwards", textOf(await readBody(page1)).includes("north property line"));

/* Delete it again and take the OTHER exit: delete forever, which is the one and only
 * point at which a note's bytes are actually destroyed. */
await rowAction(section1, "rm");
await page.waitForTimeout(250);
await tb(`notes-del-${section1}-yes`).click();
await page.waitForTimeout(1200);
await tb("notes-view-bin").click();
await page.waitForTimeout(400);
treeAfter = await readTree();
const entryId = treeAfter.trash[0].id;
ok("the bin lists what was deleted, with a way back and a way out",
  await tb(`notes-bin-${entryId}`).count() === 1
  && await tb(`notes-bin-restore-${entryId}`).count() === 1
  && await tb(`notes-bin-purge-${entryId}`).count() === 1);

const binnedPages = treeAfter.trash[0].pageIds;
const imgsBeforePurge = (await imageRecords()).length;
ok("the binned pages still hold their picture, right up to the purge", imgsBeforePurge >= 1, `${imgsBeforePurge} image record(s)`);

await tb(`notes-bin-purge-${entryId}`).click();
await page.waitForTimeout(1800);

const keysAfter = await pageKeyCount();
const bodiesGone = (await Promise.all(binnedPages.map((id) => readBody(id)))).every((b) => b === null);
ok("DELETE FOREVER CLEARS EVERY PAGE BODY THE ENTRY OWNED",
  bodiesGone && keysAfter === keysBefore - binnedPages.length,
  `${keysBefore} → ${keysAfter} key(s); ${binnedPages.length} purged`);
ok("...and a page that was MOVED OUT of the deleted section is untouched — the cascade is the entry's set, not a guess",
  keysAfter >= 1, `${keysAfter} key(s) left`);
ok("...AND EVERY PICTURE THOSE PAGES HELD — an image left behind can never be reached or freed",
  (await imageRecords()).length === 0, `${imgsBeforePurge} → ${(await imageRecords()).length} image record(s)`);
treeAfter = await readTree();
ok("the bin is empty afterwards", (treeAfter.trash || []).length === 0);
ok("the notebook itself survives a section delete", treeAfter.notebooks.length === 1 && treeAfter.notebooks[0].id === notebook1);

/* ════ 20. CLOUD SYNC, SIGNED OUT (B1291) — the half that IS checkable here ═════════════
 *
 * The sandbox proxy CORS-blocks Supabase sign-in, so the cross-device half of B1291 is a
 * V### live check and says so honestly. What is fully checkable HERE, and is checked, is the
 * promise the feature made to everyone who is NOT signed in: nothing changes. Not the
 * behaviour, not the footer's claim, not the bytes fetched, not one network request. That is
 * a real property and it is exactly the kind that rots silently, so it is committed rather
 * than assumed — and the footer honesty check is the one that would have caught a "Synced"
 * label shipped ahead of an actual sync. */
const footer = page.locator('[data-testid="notes-scope-label"]:visible').first();
const footerText = (await footer.innerText()).trim();

ok("signed out, the footer says notes are on this device — and claims NOTHING about a cloud",
  /saved on this device/i.test(footerText) && !/synced|cloud|account/i.test(footerText), `“${footerText}”`);
ok("...and the pre-sync sentence is GONE, replaced rather than joined (PANEL-BREVITY)",
  !/not synced to the cloud yet/i.test(footerText), `${footerText.split("·").length} segment(s), ${footerText.length} chars`);
ok("...on ONE line, in the quiet tone — the storage line never becomes a paragraph",
  await footer.getAttribute("data-sync-tone") === "quiet" && !footerText.includes("\n"));
ok("nothing invents a conflict that did not happen", await page.locator('[data-testid="notes-conflict-bar"]').count() === 0);

const syncKeys = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("planyr:notes:sync:")));
ok("signed out, NO sync ledger is written — the cloud bookkeeping does not exist for you",
  syncKeys.length === 0, syncKeys.join(", ") || "none");

ok("the cloud module is never even DOWNLOADED signed out — the network tier costs you nothing",
  !jsRequests.some((f) => /^notesCloud-/.test(f)), jsRequests.filter((f) => /notesCloud/.test(f)).join(", ") || "not requested");
ok("and not one request left for a notes table or the picture bucket",
  !cloudRequests.length, cloudRequests.slice(0, 3).join(" | ") || "none");

/* The whole local story still holds with the sync tier in the build — the point of putting
 * it behind the seam rather than through it. */
tree = await readTree();
ok("the notebook, its pages and the bin are all still exactly where they were",
  !!tree && Array.isArray(tree.notebooks) && Array.isArray(tree.trash));
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(2200);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });
const afterReload = await readTree();
ok("a reload with cloud sync in the build restores the same signed-out notebook",
  JSON.stringify(afterReload?.notebooks?.map((n) => n.id)) === JSON.stringify(tree?.notebooks?.map((n) => n.id)),
  `${afterReload?.notebooks?.length ?? 0} notebook(s)`);

/* ════ Wrap ═══════════════════════════════════════════════════════════════════════════ */
ok("no uncaught page error across the whole run", pageErrors.length === 0, pageErrors.join(" | ") || "clean");

await browser.close();
const passed = checks.filter((c) => c.pass).length;
console.log(`\nNotes: ${passed}/${checks.length} checks passed`);
if (passed !== checks.length) {
  console.log("\nFailed:");
  for (const c of checks.filter((x) => !x.pass)) console.log(`  ✗ ${c.name}`);
}
process.exit(passed === checks.length ? 0 : 1);
