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
 * ROUND THREE is §21 (plus the rewritten table section in §5). Every one of these guards a
 * thing the owner could not do, or could do by accident: the caret landing when you click the
 * empty part of a page, the document's left edge staying put as the window widens, a hovered
 * row surviving a Delete keypress, the rail carrying names instead of controls, colour and
 * highlight being told apart without hovering, font size on the row and in the saved
 * document, a table sized by sweeping a grid — and a tab running an old deploy admitting it,
 * both from a route it cannot resolve and from the served build stamp.
 *
 * §22 is the round's biggest item (B1374): a notebook BELONGS to a project. It drives the
 * owner's own report end to end — make a notebook inside one project, bind the other one to
 * it too so the account is in exactly his state, then walk into a second project and find an
 * empty rail. Every half of the fix is asserted there: the empty rail explains itself, one
 * click reaches every notebook, the row says where it belongs, the binding can be CHANGED
 * (the call `setNotebookProject` never had), a loose notebook really is visible everywhere,
 * the scope is never sticky, search follows it, and the binding survives a reload — which is
 * what proves it rides in the tree blob and therefore syncs.
 *
 * §23 is SKETCH MODE, and every check in it is one half of the rule the feature is built on:
 * the OUTLINE is the single source of truth for what exists and what connects to what, the
 * CANVAS stores nothing but POSITION. So it types an outline and watches boxes and arrows
 * appear; it drags a box and asserts the stored text is BYTE-IDENTICAL either side; it draws
 * an extra arrow and reloads the browser to find it still there; it prints the sheet and
 * finds the same boxes plus every body; and then it deletes one outline line and demands the
 * box, its position AND every arrow that named it go with it — the check that would catch a
 * half-built cascade. It also proves the thing no unit test can: twenty-two sections run with
 * nothing sketch-shaped downloaded at all, because no page had a sketch on it.
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
/* A tree row's actions live on its RIGHT-CLICK MENU (B1367) — the row itself shows only a
 * name. Every action in the harness therefore goes the way a person's does: right-click the
 * row, pick the item. (Before B1367 this hovered the row and clicked one of four controls
 * that appeared under the pointer.) */
const rowAction = async (rowId, action) => {
  await tb(`notes-row-${rowId}`).click({ button: "right" });
  await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
  await tb(`notes-menu-${action}-${rowId}`).click();
  await page.waitForTimeout(120);
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

/* ════ 5. Tables — sized by DRAGGING A GRID (B1372) — and controls only inside one ═════ */
ok("the table controls are HIDDEN while the caret is not in a table", await tb("nt-table-group").count() === 0);

await tb("nt-table").click();
await page.waitForSelector('[data-testid="nt-table-grid"]', { timeout: 5000 });
ok("the table button opens a GRID to sweep, not a fixed 3×3 and not a dialog box",
  await tb("nt-table-grid").count() === 1);

/* Sweep across the grid the way a pointer does, and watch the running size follow. */
await tb("nt-table-cell-2-3").hover();
await page.waitForTimeout(90);
const sweep1 = await tb("nt-table-size").innerText();
await tb("nt-table-cell-4-5").hover();
await page.waitForTimeout(90);
const sweep2 = await tb("nt-table-size").innerText();
ok("the size follows the pointer and is written out, so nobody counts squares",
  /3 × 2/.test(sweep1) && /5 × 4/.test(sweep2), `${sweep1} → ${sweep2}`);

/* Reaching the edge of the grid GROWS it — a big table needs no dialog. */
await tb("nt-table-cell-6-6").hover();
await page.waitForTimeout(120);
ok("...and the grid grows when the sweep reaches its edge", await tb("nt-table-cell-7-7").count() === 1);

await tb("nt-table-cell-4-5").hover();
await page.waitForTimeout(80);
await tb("nt-table-cell-4-5").click();
await page.waitForTimeout(400);
ok("the grid closes on the pick", await tb("nt-table-grid").count() === 0);
ok("the table controls APPEAR once the caret is inside a table", await tb("nt-table-group").count() === 1);

await settle();
doc = await readBody(page1);
ok("inserting a table writes a real table node", nodesOf(doc, "table").length === 1);
const rows0 = nodesOf(doc, "tableRow").length;
const cols0 = nodesOf(doc, "tableRow")[0]?.content?.length || 0;
ok("THE TABLE IS THE SIZE THAT WAS SWEPT — 5 wide by 4 tall, not a fixed 3×3",
  rows0 === 4 && cols0 === 5, `${rows0} rows × ${cols0} cols`);
ok("the inserted table has a header row", nodesOf(doc, "tableHeader").length > 0);

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
/* Land the caret in the LAST block explicitly rather than clicking the middle of the note
 * and trusting Ctrl+End: the page now ends in a table, and the middle of a note is a cell.
 * The bullet has to be a top-level list for this export check to mean anything. */
await page.locator('[data-testid="note-body"] > *').last().click();
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

/* ════ 21. ROUND THREE — the page you can click, the rail that shows names, the bar you
        can read, and a build that admits it is old (B1365–B1373) ══════════════════════ */

const r3Page = afterReload?.notebooks?.[0]?.sections?.[0]?.pages?.[0]?.id;
await tb(`notes-row-${r3Page}`).click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await page.waitForTimeout(500);

/* ---- B1369: the document reads left, and STAYS left as the window widens ---- */
const edges = async () => page.evaluate(() => {
  const bar = document.querySelector('[data-testid="note-toolbar"]');
  const body = document.querySelector('[data-testid="note-body"]');
  const firstControl = bar?.querySelector("button, select");
  return {
    control: firstControl ? firstControl.getBoundingClientRect().left : null,
    body: body ? body.getBoundingClientRect().left : null,
  };
});
const narrow = await edges();
await page.setViewportSize({ width: 1900, height: 950 });
await page.waitForTimeout(400);
const wide = await edges();
ok("the text starts at the toolbar's left edge, not adrift in the middle of the pane",
  Math.abs(wide.body - wide.control) <= 10, `toolbar ${Math.round(wide.control)} · text ${Math.round(wide.body)}`);
ok("...and it does NOT slide right as the window widens — the whole 'aligned to the right' report",
  Math.abs(wide.body - narrow.body) <= 2, `${Math.round(narrow.body)} → ${Math.round(wide.body)}`);

/* ---- B1368: the empty part of the page takes the caret ---- */
const mat = await tb("note-mat").boundingBox();
const bodyBox = await tb("note-body").boundingBox();
await page.mouse.click(bodyBox.x + 40, Math.min(mat.y + mat.height - 40, bodyBox.y + bodyBox.height + 60));
await page.waitForTimeout(200);
const focusedAfterBlankClick = await page.evaluate(() => !!document.activeElement?.closest?.(".ProseMirror"));
await page.keyboard.type("CLICKED-THE-BLANK-PART", { delay: 6 });
await settle();
ok("clicking the empty space BELOW the text puts the caret in the document",
  focusedAfterBlankClick && textOf(await readBody(r3Page)).includes("CLICKED-THE-BLANK-PART"));

/* Beside the text, out to the right of a short line — the other half of the dead zone. */
await page.mouse.click(bodyBox.x + bodyBox.width - 20, bodyBox.y + 12);
await page.waitForTimeout(200);
ok("...and clicking BESIDE a line does too, rather than doing nothing at all",
  await page.evaluate(() => !!document.activeElement?.closest?.(".ProseMirror")));

/* ---- B1367: the rail shows names; actions are on a right-click menu ---- */
const r3Section = afterReload.notebooks[0].sections[0].id;
await tb(`notes-row-${r3Section}`).hover();
await page.waitForTimeout(200);
const hoverButtons = await page.evaluate((id) => {
  const row = document.querySelector(`[data-testid="notes-row-${id}"]`);
  return [...(row?.querySelectorAll("button") || [])].map((b) => b.getAttribute("data-testid") || "");
}, r3Section);
ok("a hovered row sprouts NO action controls — only its expand arrow",
  hoverButtons.every((t) => t.startsWith("notes-toggle-")), hoverButtons.join(", ") || "none");

/* ---- B1366: and the keyboard does not destroy the row the mouse is over ---- */
const beforeDeleteKey = JSON.stringify(await readTree());
await page.keyboard.press("Delete");
await page.waitForTimeout(300);
await page.keyboard.press("Backspace");
await page.waitForTimeout(400);
ok("HOVERING A ROW AND PRESSING DELETE DESTROYS NOTHING — hovering is not intent",
  JSON.stringify(await readTree()) === beforeDeleteKey);
ok("...and nothing was even offered to be deleted", await tb("notes-undo-bar").count() === 0);

await tb(`notes-row-${r3Section}`).click({ button: "right" });
await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
ok("right-click opens the row's menu with add / rename / move / delete",
  await tb(`notes-menu-add-${r3Section}`).count() === 1
  && await tb(`notes-menu-rn-${r3Section}`).count() === 1
  && await tb(`notes-menu-mv-${r3Section}`).count() === 1
  && await tb(`notes-menu-rm-${r3Section}`).count() === 1);
await tb(`notes-menu-rn-${r3Section}`).click();
await page.waitForTimeout(250);
ok("Rename from the menu opens the INLINE field on the row, never a dialog box",
  await tb(`notes-rename-${r3Section}`).count() === 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

/* ---- B1365: the per-notebook export links are off the rail, and on the menu ---- */
const r3Notebook = afterReload.notebooks[0].id;
ok("the rail no longer repeats a Markdown + Print pair under every notebook",
  await tb(`notes-export-${r3Notebook}`).count() === 0 && await tb(`notes-print-${r3Notebook}`).count() === 0);
await tb(`notes-row-${r3Notebook}`).click({ button: "right" });
await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
ok("...but notebook-level export and print are still reachable, on the notebook's menu",
  await tb(`notes-menu-md-${r3Notebook}`).count() === 1 && await tb(`notes-menu-print-${r3Notebook}`).count() === 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

/* ---- B1370: text colour and highlight are told apart without hovering ---- */
const glyphs = await page.evaluate(() => {
  const g = (id) => document.querySelector(`[data-testid="${id}"]`)?.innerHTML || "";
  return { color: g("nt-color"), highlight: g("nt-highlight") };
});
ok("the text-colour and highlight buttons draw DIFFERENT glyphs, not the same 'A' twice",
  !!glyphs.color && !!glyphs.highlight && glyphs.color !== glyphs.highlight);
ok("...and only the highlight one is a marker/pen, so which is which is readable at a glance",
  glyphs.highlight.includes("svg") && !glyphs.color.includes("svg"));

/* ---- B1371: font size is ON the row, and it survives the save ---- */
ok("the font-size control is on the visible row, not buried in More",
  await page.locator('[data-testid="note-toolbar"] > [data-testid="nt-size"]').count() === 1);
ok("...and it is not ALSO in the More drawer — it moved, it did not multiply",
  await tb("nt-size").count() === 1);

await tb("note-body").click();
await page.keyboard.press("Control+a");
await tb("nt-size").selectOption("24");
await settle();
const sizedDoc = await readBody(r3Page);
const sizeMarks = JSON.stringify(sizedDoc).match(/"fontSize":"24px"/g) || [];
ok("PICKING A SIZE WRITES A REAL MARK INTO THE DOCUMENT that round-trips through storage",
  sizeMarks.length > 0, `${sizeMarks.length} run(s) at 24px`);
ok("...and the bar reads the size back off the document rather than remembering it",
  await tb("nt-size").inputValue() === "24");

/* ---- B1373: a build that admits it is old ---- */
ok("nothing claims an update on a build that IS the served one", await tb("app-update-banner").count() === 0);

/* A route slug this build has no module for is the definitive skew signal — it is exactly
 * what `#/notes` looked like from inside the owner's pre-Notes build. */
await page.evaluate(() => { window.location.hash = "#/amoduleshippedlater"; });
await page.waitForTimeout(600);
ok("A ROUTE THIS BUILD CANNOT RESOLVE OFFERS A RELOAD instead of silently falling back to Site",
  await tb("app-update-banner").count() === 1
  && await tb("app-update-banner").getAttribute("data-reason") === "route-miss");
ok("...and it is a dismissible strip with a Reload button, never a takeover",
  await tb("app-update-reload").count() === 1 && await tb("app-update-dismiss").count() === 1);
await tb("app-update-dismiss").click();
await page.waitForTimeout(200);
ok("...that goes away when dismissed", await tb("app-update-banner").count() === 0);

await page.evaluate(() => { window.location.hash = "#/notes"; });
await page.waitForTimeout(500);

/* The other half: the server has moved on while this tab stayed open. */
await ctx.route("**/version.json", (route) => route.fulfill({
  status: 200, contentType: "application/json", body: JSON.stringify({ build: "a-newer-deploy" }),
}));
await page.evaluate(() => window.dispatchEvent(new Event("focus")));
await page.waitForTimeout(900);
const skewBanner = await tb("app-update-banner").count();
ok("a tab left open across a DEPLOY notices and says so, without reloading anything itself",
  skewBanner === 1 && await tb("app-update-banner").getAttribute("data-reason") === "newer-build");
await tb("app-update-dismiss").click();
await page.waitForTimeout(200);
ok("...and one dismissal silences THAT deploy, not every future one",
  await tb("app-update-banner").count() === 0);
await ctx.unroute("**/version.json");

/* ════ 22. NOTES BELONG TO A PROJECT (B1374) — the owner's own report, driven end to end.
 *
 *   "if I have Grand Port notes, then when I'm in Grand Port project and I click on Notes,
 *    that's where it should take me."
 *
 * He opened a project, clicked Notes, and found nothing — because both of his notebooks were
 * bound to two OTHER projects and there was no way to see that, no way to change it, and no
 * way to reach them from where he was standing. This section reproduces exactly that shape
 * (two projects, a notebook born in one, then walk into the other) and asserts each half of
 * the fix. It needs no signed-in account: a project is a route id, so the whole flow is
 * drivable logged out. ══════════════════════════════════════════════════════════════════ */

const PROJ_A = "e2e-project-alpha";
const PROJ_B = "e2e-project-bravo";
const goProject = async (pid) => {
  await page.evaluate((p) => { window.location.hash = p ? `#/project/${p}/notes` : "#/notes"; }, pid);
  await page.waitForTimeout(700);
};

await goProject(PROJ_A);
ok("inside a project, the rail says WHOSE notebooks it is showing and offers the way out",
  await tb("notes-scope-switch").count() === 1
  && await tb(`notes-scope-${"project"}`).count() === 1
  && await tb(`notes-scope-${"all"}`).count() === 1);

await tb("notes-new-notebook").click();
await page.waitForTimeout(900);
let scopedTree = await readTree();
const projNotebook = scopedTree.notebooks.find((n) => n.projectId === PROJ_A);
ok("A NOTEBOOK CREATED INSIDE A PROJECT BELONGS TO IT, with no extra step",
  !!projNotebook, projNotebook ? `bound to ${projNotebook.projectId}` : "not bound");
ok("...and it is on screen where it was made", await tb(`notes-row-${projNotebook.id}`).count() === 1);

/* Bind the pre-existing (loose) notebook to this project too, so the account is in EXACTLY
 * the state the owner's was: every notebook bound, none loose. That state is what made the
 * next screen empty, and it is also the first exercise of the re-bind path — which had no
 * caller at all before this item. */
const looseNotebook = scopedTree.notebooks.find((n) => n.id !== projNotebook.id && n.projectId == null);
await tb(`notes-row-${looseNotebook.id}`).click({ button: "right" });
await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
await tb(`notes-menu-bind-${looseNotebook.id}`).click();
await page.waitForTimeout(300);
await tb(`notes-bind-${looseNotebook.id}-to-${PROJ_A}`).click();
await page.waitForTimeout(1000);
ok("AN EXISTING NOTEBOOK CAN BE RE-BOUND TO A PROJECT — the half that had no caller at all",
  (await readTree()).notebooks.find((n) => n.id === looseNotebook.id)?.projectId === PROJ_A);

/* Walk into a DIFFERENT project — the owner's exact move. */
await goProject(PROJ_B);
ok("in another project, those notebooks are correctly OUT of scope",
  await tb(`notes-row-${projNotebook.id}`).count() === 0 && await tb(`notes-row-${looseNotebook.id}`).count() === 0);
const emptyLine = await tb("notes-empty-scope").count() ? await tb("notes-empty-scope").innerText() : "";
ok("THE EMPTY RAIL EXPLAINS ITSELF instead of implying the notes are gone",
  /belong to a different project/i.test(emptyLine), emptyLine.slice(0, 90) || "no explanation");
ok("...and offers the one click that finds them", await tb("notes-show-all").count() === 1);

await tb("notes-show-all").click();
await page.waitForTimeout(500);
ok("NOTHING IS UNREACHABLE — one click from inside the wrong project shows every notebook",
  await tb(`notes-row-${projNotebook.id}`).count() === 1);
const rowText = await page.evaluate((id) => {
  const row = document.querySelector(`[data-testid="notes-row-${id}"]`);
  return (row?.innerText || "").toLowerCase();
}, projNotebook.id);
ok("...and the row SAYS where it belongs, rather than leaving you to guess",
  /other project|alpha/.test(rowText), rowText.replace(/\n/g, " · ").slice(0, 60));

/* The half that never existed: change the binding. `setNotebookProject` shipped with the
 * module, was unit-tested, and had no caller at all — so a notebook could only ever be bound
 * by being born inside a project, and never re-bound. */
await tb(`notes-row-${projNotebook.id}`).click({ button: "right" });
await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
ok("a notebook's menu can change which project it belongs to", await tb(`notes-menu-bind-${projNotebook.id}`).count() === 1);
await tb(`notes-menu-bind-${projNotebook.id}`).click();
await page.waitForTimeout(300);
ok("...through an inline panel on the row, never a dialog box", await tb(`notes-bind-${projNotebook.id}`).count() === 1);

await tb(`notes-bind-${projNotebook.id}-to-__loose__`).click();
await page.waitForTimeout(1000);
scopedTree = await readTree();
ok("BINDING IT LOOSE STICKS, in the stored tree",
  (scopedTree.notebooks.find((n) => n.id === projNotebook.id) || {}).projectId === null);

/* A loose notebook is visible from EVERYWHERE — the decision written down in the store
 * header, asserted here rather than left to a comment. */
await goProject(PROJ_B);
ok("a LOOSE notebook shows up inside a project you are standing in",
  await tb(`notes-row-${projNotebook.id}`).count() === 1);
await goProject(PROJ_A);
ok("...and inside the one it used to belong to", await tb(`notes-row-${projNotebook.id}`).count() === 1);
await goProject(null);
ok("...and from the dashboard", await tb(`notes-row-${projNotebook.id}`).count() === 1);

/* Bind it back to a project, then confirm the scope RESETS on entering a project — the
 * "take me to Grand Port's notes" half of the report. A sticky ALL would quietly undo it. */
await goProject(PROJ_A);
await tb(`notes-row-${projNotebook.id}`).click({ button: "right" });
await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
await tb(`notes-menu-bind-${projNotebook.id}`).click();
await page.waitForTimeout(300);
await tb(`notes-bind-${projNotebook.id}-to-${PROJ_A}`).click();
await page.waitForTimeout(900);
ok("re-binding it to THIS project puts it back where it was made",
  (await readTree()).notebooks.find((n) => n.id === projNotebook.id)?.projectId === PROJ_A);

await goProject(PROJ_B);
await goProject(PROJ_A);
ok("ENTERING A PROJECT LANDS YOU IN THAT PROJECT'S NOTEBOOKS — the scope is never sticky",
  await tb("notes-scope-project").getAttribute("aria-selected") === "true"
  && await tb(`notes-row-${projNotebook.id}`).count() === 1);

/* Search follows the scope both ways, so a mis-filed note is findable rather than hidden. */
await goProject(PROJ_B);
await tb("notes-search").fill("Page 1");
await page.waitForTimeout(600);
const narrowHits = await page.locator('[data-testid="notes-search-results"] button').count();
await tb("notes-search").fill("");
await tb("notes-scope-all").click();
await page.waitForTimeout(300);
await tb("notes-search").fill("Page 1");
await page.waitForTimeout(600);
const wideHits = await page.locator('[data-testid="notes-search-results"] button').count();
ok("SEARCH OBEYS THE SAME SCOPE THE RAIL DOES — widen it and the other project's notes are findable",
  wideHits > narrowHits, `${narrowHits} in this project → ${wideHits} across all`);
await tb("notes-search").fill("");
await page.waitForTimeout(300);

/* And the binding is in the TREE BLOB, which is what syncs — so it round-trips a reload. */
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(2200);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });
ok("THE BINDING RIDES IN THE TREE BLOB — it survives a reload, which is what makes it sync",
  (await readTree()).notebooks.find((n) => n.id === projNotebook.id)?.projectId === PROJ_A);

/* ════ 23. ROUND FOUR — the false alarm, the key Chrome was stealing, and the blank space
        you can double-click (B1391 · B1392 · B1393) ═══════════════════════════════════════

   All three arrived together from the owner, and all three are driven HERE, logged out,
   rather than parked: the two-window race is a localStorage race first (the cloud only
   makes it visible later), the Tab escape is pure keyboard, and the blank-space press
   needs nothing but a wide window. The ONE half that genuinely cannot run here — a real
   revision conflict between two SIGNED-IN windows — is V680. */

await goProject(null);                       // a LOOSE notebook, so the second window sees it
await tb("notes-new-notebook").click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await page.waitForTimeout(1200);
const r4Tree = await readTree();
const r4Notebook = r4Tree.notebooks[r4Tree.notebooks.length - 1];
const r4Page = r4Notebook.sections[0].pages[0].id;

const inDoc = () => page.evaluate(() => !!document.activeElement?.closest?.(".ProseMirror"));
const clearBody = async () => {
  await tb("note-body").click();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(120);
};
/* Every node type in the document, so a NESTED list can be told from a flat one. */
const typesIn = (doc) => { const out = []; const walk = (n) => { if (!n || typeof n !== "object") return; if (n.type) out.push(n.type); (n.content || []).forEach(walk); }; walk(doc); return out; };
const nested = (doc) => { let found = false; const walk = (n, insideItem) => { if (!n || typeof n !== "object") return; if (insideItem && (n.type === "bulletList" || n.type === "orderedList")) found = true; (n.content || []).forEach((c) => walk(c, insideItem || n.type === "listItem")); }; walk(doc, false); return found; };

/* ---- B1392: Tab belongs to the DOCUMENT ---- */

/* A PLAIN PARAGRAPH was the commonest escape: nothing in the editor claimed Tab, so Chrome
   took it and the caret was gone mid-sentence. */
await clearBody();
await page.keyboard.type("Detention pond notes", { delay: 6 });
await page.keyboard.press("Tab");
await page.waitForTimeout(150);
const heldInParagraph = await inDoc();
await settle();
ok("TAB IN A PLAIN PARAGRAPH STAYS IN THE NOTE — the press Chrome used to steal",
  heldInParagraph && textOf(await readBody(r4Page)).includes("\t"), heldInParagraph ? "indented" : "focus left the document");

/* An EMPTY page escaped too — the very first thing you do on a new note. */
await clearBody();
await page.keyboard.press("Tab");
await page.waitForTimeout(150);
const heldInEmpty = await inDoc();
await settle();
ok("...and on a brand-new EMPTY page, where it escaped on the first keystroke of all",
  heldInEmpty && textOf(await readBody(r4Page)).includes("\t"));

/* THE FIRST ITEM OF A LIST — the case that made the report read as "sometimes". The list
   extension claims Tab and then declines it (there is nothing above to indent into), so the
   press fell through. It must be swallowed, and it must NOT wedge a tab character into a
   bullet, which is a document you cannot outdent again. */
await clearBody();
await page.keyboard.type("- first bullet", { delay: 6 });
await page.keyboard.press("Tab");
await page.waitForTimeout(150);
const heldInFirstItem = await inDoc();
await settle();
const firstItemDoc = await readBody(r4Page);
ok("TAB IN THE FIRST ITEM OF A LIST STAYS PUT — and puts no stray tab inside the bullet",
  heldInFirstItem && !textOf(firstItemDoc).includes("\t"), heldInFirstItem ? "swallowed cleanly" : "focus left the document");

/* ...while a SECOND item still really indents. The fallback must not have eaten the feature
   it was written to sit behind. */
await page.keyboard.press("Enter");
await page.keyboard.type("second bullet", { delay: 6 });
await page.keyboard.press("Tab");
await page.waitForTimeout(150);
await settle();
ok("...and a SECOND list item still INDENTS, exactly as it did before the fallback existed",
  nested(await readBody(r4Page)), typesIn(await readBody(r4Page)).join(","));

/* A TABLE's own Tab — next cell — is the other handler that must still win. */
await clearBody();
await tb("nt-table").click();
await page.waitForSelector('[data-testid="nt-table-grid"]', { timeout: 5000 });
await tb("nt-table-cell-2-2").click();
await page.waitForTimeout(400);
await page.keyboard.type("A1", { delay: 6 });
await page.keyboard.press("Tab");
await page.keyboard.type("B1", { delay: 6 });
await settle();
const tableDoc = await readBody(r4Page);
const cellTexts = nodesOf(tableDoc, "tableCell").concat(nodesOf(tableDoc, "tableHeader")).map((c) => textOf(c));
ok("TAB IN A TABLE STILL MOVES TO THE NEXT CELL — the fallback sits behind it, not over it",
  cellTexts.includes("A1") && cellTexts.includes("B1") && !textOf(tableDoc).includes("\t"),
  cellTexts.filter(Boolean).join(" | ") || "no cells");

/* ⛔ THE ESCAPE HATCH. A key that can never leave is a keyboard trap: someone working
   without a mouse would be sealed inside the note. Escape releases the next Tab. */
await clearBody();
await page.keyboard.type("about to leave", { delay: 6 });
await page.keyboard.press("Escape");
await page.keyboard.press("Tab");
await page.waitForTimeout(200);
ok("ESCAPE THEN TAB LEAVES THE NOTE — the keyboard-only escape hatch is real, not a promise",
  !(await inDoc()));

/* ...and the release is single-use: typing takes it back, so you cannot end up in a mode
   where Tab silently stopped indenting. */
await tb("note-body").click();
await page.keyboard.type("back inside", { delay: 6 });
await page.keyboard.press("Tab");
await page.waitForTimeout(150);
ok("...and typing takes the release back — the next Tab indents again, no lingering mode",
  await inDoc());
await settle();

/* ---- B1393: double-click the blank part of the page and start typing ---- */

/* AUDIT-FIRST, and it is worth stating plainly: single-click-anywhere (B1368) was VERIFIED
   WORKING on a wide window in a real browser before any of this was written, and the same
   handler was already in the deployed bundle. Double-click worked only as a side effect of
   the press path. These checks make it a stated contract in all four blank regions. */
await clearBody();
await page.keyboard.type("Short line.", { delay: 6 });
await settle();
const r4Mat = await tb("note-mat").boundingBox();
const r4Body = await tb("note-body").boundingBox();
const blankSpots = [
  ["far RIGHT of the text column", r4Mat.x + r4Mat.width - 40, r4Body.y + 10],
  ["BELOW the last paragraph", r4Body.x + 60, Math.min(r4Mat.y + r4Mat.height - 30, r4Body.y + r4Body.height + 90)],
  ["the margin BESIDE the first line", r4Body.x + r4Body.width - 12, r4Body.y + 6],
  ["low and far right, where the sheet has nothing at all", r4Mat.x + r4Mat.width - 80, r4Mat.y + r4Mat.height - 60],
];
for (const [where, x, y] of blankSpots) {
  await page.locator("body").click({ position: { x: 4, y: 4 } });     // blur first, every time
  await page.waitForTimeout(120);
  await page.mouse.dblclick(x, y);
  await page.waitForTimeout(180);
  const landed = await inDoc();
  const stamp = `DBL${blankSpots.indexOf(blankSpots.find((b) => b[0] === where))}`;
  await page.keyboard.type(stamp, { delay: 6 });
  await settle();
  ok(`DOUBLE-CLICKING ${where} lands the caret and you can type straight away`,
    landed && textOf(await readBody(r4Page)).includes(stamp));
}

/* ⛔ …and double-clicking a WORD still SELECTS that word. The new behaviour is for blank
   space only; taking word-select away would be a worse bug than the one being fixed. */
await clearBody();
await page.keyboard.type("alpha beta gamma", { delay: 6 });
await settle();
const betaBox = await page.evaluate(() => {
  const node = document.querySelector('[data-testid="note-body"] p')?.firstChild;
  if (!node) return null;
  const r = document.createRange();
  const i = node.textContent.indexOf("beta");
  r.setStart(node, i); r.setEnd(node, i + 4);
  const b = r.getBoundingClientRect();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
});
await page.mouse.dblclick(betaBox.x, betaBox.y);
await page.waitForTimeout(150);
await page.keyboard.type("BRAVO", { delay: 6 });
await settle();
ok("DOUBLE-CLICKING A WORD STILL SELECTS IT — only blank space got the new behaviour",
  textOf(await readBody(r4Page)).replace(/\s+/g, " ").includes("alpha BRAVO gamma"),
  textOf(await readBody(r4Page)));

/* ---- B1391: TWO WINDOWS OF THE SAME PERSON, which is the state the false alarm came from ----

   The owner's report was "it thought someone else was editing this file… it's literally just
   me." What was actually true is that his account was open in more than one window. That is
   a normal state, and the half of it that does not need a sign-in is driven right here: two
   tabs of this browser, the same note open in both. */
await clearBody();
await page.keyboard.type("WINDOW-ONE-PARAGRAPH", { delay: 6 });
await settle();

const win2 = await ctx.newPage();
const win2Errors = [];
win2.on("pageerror", (e) => win2Errors.push(e.message));
await win2.goto(BASE, { waitUntil: "load" });
await win2.waitForTimeout(1800);
await win2.locator('[data-testid="module-tab-notes"]:visible').first().click();
await win2.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await win2.locator(`[data-testid="notes-row-${r4Page}"]`).click();
await win2.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
await win2.waitForTimeout(900);
ok("a SECOND window of the same browser opens the same note",
  (await win2.locator('[data-testid="note-body"]').innerText()).includes("WINDOW-ONE-PARAGRAPH"));

/* The second window types. The first window has the same page open and has NOT touched it. */
await win2.locator('[data-testid="note-body"]').click();
await win2.keyboard.press("Control+End");
await win2.keyboard.type(" ADDED-IN-WINDOW-TWO", { delay: 6 });
await win2.waitForTimeout(1400);
await page.waitForTimeout(900);

const win1Text = await page.locator('[data-testid="note-body"]').innerText();
ok("⛔ THE OPEN EDITOR IN THE FIRST WINDOW RE-READS THE NOTE — it does not sit on a stale copy",
  win1Text.includes("ADDED-IN-WINDOW-TWO"), win1Text.slice(0, 80));

/* THE SELF-RACE ITSELF: the first window now types. If it were still holding its stale
   document, this keystroke would write that whole document back and the second window's
   sentence would vanish — cleanly, past a revision guard, with no conflict and nothing to
   notice. That silent loss is the actual bug the false prompt was a symptom of. */
await tb("note-body").click();
await page.keyboard.press("Control+End");
await page.keyboard.type(" THEN-WINDOW-ONE-AGAIN", { delay: 6 });
await settle();
const bothText = textOf(await readBody(r4Page));
ok("⛔ AND THE NEXT KEYSTROKE DOES NOT WIPE THE OTHER WINDOW'S SENTENCE — the self-race is dead",
  bothText.includes("ADDED-IN-WINDOW-TWO") && bothText.includes("THEN-WINDOW-ONE-AGAIN"), bothText.slice(0, 110));

ok("NEITHER WINDOW WAS EVER ASKED TO PICK BETWEEN TWO COPIES — a no-op raises no bar",
  await tb("notes-conflict-bar").count() === 0 && await win2.locator('[data-testid="notes-conflict-bar"]').count() === 0);
ok("...and the second window ran clean too", win2Errors.length === 0, win2Errors.join(" | ") || "clean");
await win2.close();

/* ════ 23. SKETCH MODE — the outline governs, the canvas only remembers where ══════════
 *
 * THE RULE THIS SECTION EXISTS TO PROVE, in the browser rather than in a comment: the
 * OUTLINE is the single source of truth for what exists and what connects to what, and the
 * CANVAS stores nothing but POSITION. Everything below is one half of that claim:
 *   • typing an indented outline produces boxes AND arrows — no other way to author one;
 *   • dragging a box moves it and leaves the stored text BYTE-IDENTICAL;
 *   • an extra arrow (the kind an outline cannot express) persists and survives a reload;
 *   • deleting a line takes its box, its position AND every arrow that named it, with
 *     nothing left dangling — the check that would have caught a half-built cascade;
 *   • the label/body pair survives save, reload, Markdown export and the printed sheet.
 *
 * It also proves the BUNDLE claim, which no unit test can: nothing sketch-shaped is fetched
 * until a sketch is genuinely on the page. */
const sketchBefore = jsRequests.filter((f) => /Sketch/i.test(f));
ok("⛔ NOTHING SKETCH-SHAPED HAS BEEN DOWNLOADED — twenty-two sections in, with no sketch on any page",
  sketchBefore.length === 0, sketchBefore.join(", ") || "not requested");

/* A fresh notebook, so this section owns its own page and cannot be confused by the earlier
 * ones (which carry tables, pictures and a bin history). */
await tb("notes-new-notebook").click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await page.waitForTimeout(900);
const skTree = await readTree();
const skNotebook = skTree.notebooks[skTree.notebooks.length - 1];
const skPage = skNotebook.sections[0].pages[0].id;

await tb("note-title").fill("Deal sequence");
await tb("note-body").click();
await tb("nt-sketch").click();
await page.waitForSelector('[data-testid="note-sketch"]', { timeout: 15000 });
await page.waitForTimeout(900);

ok("the toolbar inserts a sketch, and it lands IN the note", await tb("note-sketch").count() === 1);
const sketchChunk = jsRequests.find((f) => /Sketch/i.test(f));
ok("...and ONLY THEN is the sketch editor fetched — its own chunk, on demand",
  !!sketchChunk, sketchChunk || "never requested");

/* A sketch's document node — read straight out of storage, which is the only place that
 * settles whether the canvas and the outline agree. */
const sketchNode = async () => {
  const doc = await readBody(skPage);
  let found = null;
  const walk = (n) => { if (!n || typeof n !== "object") return; if (n.type === "noteSketch") found = n; (n.content || []).forEach(walk); };
  walk(doc);
  return found;
};
const outlineText = (n) => (n?.attrs?.outline || []).map((x) => `${x.depth}|${x.label}|${x.body}`).join("\n");

/* ---- typing an outline is what draws the chart ------------------------------------- */
const OUTLINE_TEXT = "Acquisition\n  Title review\n  > Order the commitment from Stewart; 30-day cure.\n  Environmental\n    Phase I\nEntitlement";
await tb("sketch-outline").fill(OUTLINE_TEXT);
await page.waitForTimeout(700);
await settle();

ok("TYPING AN INDENTED OUTLINE DRAWS THE BOXES", await page.locator("[data-sketch-node]").count() === 5,
  `${await page.locator("[data-sketch-node]").count()} box(es)`);
ok("...and the parent→child ARROWS, without anyone drawing one",
  await page.locator('[data-sketch-edge-kind="tree"]').count() === 3);
ok("the outline pane is the ONLY authoring surface — there is no 'add a box' control",
  await page.locator('[data-testid="note-sketch"] button').count() === 3);

let node = await sketchNode();
ok("the sketch is stored INSIDE the page's document — not in a second store",
  !!node && node.attrs.outline.length === 5, node ? `${node.attrs.outline.length} nodes` : "no sketch node");
ok("the LABEL and the BODY are stored as one node, as designed from the start",
  node.attrs.outline[1].label === "Title review" && /Stewart/.test(node.attrs.outline[1].body),
  `${node.attrs.outline[1].label} / ${node.attrs.outline[1].body.slice(0, 24)}`);
const noSketchKey = await page.evaluate(() => Object.keys(localStorage).filter((k) => /sketch/i.test(k)));
ok("⛔ NO SKETCH KEY ANYWHERE IN STORAGE — the document IS the persistence", noSketchKey.length === 0, noSketchKey.join(", ") || "none");

/* ---- the body opens in place, no dialog -------------------------------------------- */
ok("only the box that HAS a body offers to open it", await page.locator("[data-sketch-toggle]").count() === 1);
await page.locator("[data-sketch-toggle]").first().click();
await page.waitForTimeout(400);
ok("the detail opens IN PLACE, inside its own box — no dialog box (house rule)",
  await page.locator(".planyr-sketch-body").count() > 0 && await page.locator(".planyr-sketch-node-open").count() === 1);
await page.locator("[data-sketch-toggle]").first().click();
await page.waitForTimeout(300);

/* ---- dragging moves ONE box and touches NOTHING else -------------------------------- */
const textBeforeDrag = outlineText(node);
const dragTarget = page.locator("[data-sketch-node]").nth(1);
const bb = await dragTarget.boundingBox();
await page.mouse.move(bb.x + 30, bb.y + 14);
await page.mouse.down();
await page.mouse.move(bb.x + 250, bb.y + 190, { steps: 14 });
await page.mouse.up();
await settle();

node = await sketchNode();
const dragged = Object.keys(node.attrs.positions);
ok("DRAGGING A BOX SAVES A POSITION", dragged.length === 1, JSON.stringify(node.attrs.positions));
ok("⛔ AND LEAVES THE TEXT BYTE-IDENTICAL — a drag is layout, never content",
  outlineText(node) === textBeforeDrag);
ok("the outline pane still reads exactly what was typed", (await tb("sketch-outline").inputValue()) === OUTLINE_TEXT);

/* ---- an extra arrow: the one thing an outline cannot express ------------------------ */
await tb("sketch-arrow-mode").click();
await page.locator("[data-sketch-node]").nth(3).click();     // Phase I
await page.locator("[data-sketch-node]").nth(4).click();     // Entitlement
await settle();
node = await sketchNode();
const linkFrom = node.attrs.links[0]?.from;
const linkTo = node.attrs.links[0]?.to;
ok("AN EXTRA ARROW IS STORED AS AN EXPLICIT {from,to} — never inferred, never hidden in layout",
  node.attrs.links.length === 1 && !!linkFrom && !!linkTo, JSON.stringify(node.attrs.links));
ok("...and it is DRAWN, told apart from the outline's own arrows",
  await page.locator('[data-sketch-edge-kind="link"]').count() === 1);

/* An arrow the outline already draws is refused OUT LOUD rather than silently ignored. */
await tb("sketch-arrow-mode").click();
await page.locator("[data-sketch-node]").nth(0).click();
await page.locator("[data-sketch-node]").nth(1).click();
await page.waitForTimeout(500);
ok("a duplicate of an arrow the outline already draws is REFUSED, and SAYS WHY (LOUD-FAILURE)",
  /outline already/.test(await tb("sketch-status").innerText()), await tb("sketch-status").innerText());

/* ---- it all survives a real reload -------------------------------------------------- */
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1800);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });
await tb(`notes-row-${skPage}`).click();
await page.waitForSelector('[data-testid="note-sketch"]', { timeout: 15000 });
await page.waitForTimeout(1200);

ok("A RELOAD BRINGS THE WHOLE SKETCH BACK — boxes, arrows and the extra arrow",
  await page.locator("[data-sketch-node]").count() === 5
  && await page.locator('[data-sketch-edge-kind="link"]').count() === 1);
node = await sketchNode();
ok("...with the hand-placed box still where it was put", Object.keys(node.attrs.positions).length === 1);
ok("...and the LABEL/BODY pair intact after a round trip through storage",
  /Stewart/.test(node.attrs.outline[1].body));
ok("the reloaded sketch renders with no crash and no error boundary",
  await page.locator("text=Something went wrong").count() === 0);

/* ---- Markdown export: lossless for content, NAMED for what a list cannot say -------- */
const skDir = mkdtempSync(join(tmpdir(), "notes-sketch-"));
const [skDownload] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  tb("nt-export").click(),
]);
const skSaved = join(skDir, skDownload.suggestedFilename());
await skDownload.saveAs(skSaved);
const skMd = readFileSync(skSaved, "utf8");

ok("THE EXPORTED MARKDOWN CARRIES THE OUTLINE AS A PLAIN INDENTED LIST",
  /^- Acquisition$/m.test(skMd) && /^ {2}- Title review$/m.test(skMd) && /^ {4}- Phase I$/m.test(skMd));
ok("...INCLUDING THE BODY, still attached to its own label",
  /^ {4}> Order the commitment from Stewart/m.test(skMd));
ok("...and the EXTRA ARROW is written out, not silently dropped",
  /Also connected:/.test(skMd) && /Phase I → Entitlement/.test(skMd));
await page.waitForTimeout(400);
const skNotice = await tb("notes-export-notice").count() ? await tb("notes-export-notice").innerText() : "";
ok("...and the ONE thing a list genuinely cannot say is NAMED, not silently dropped",
  /dragged to/.test(skNotice), skNotice.slice(0, 110) || "no notice shown");

/* ---- the printed sheet (PDF-PARITY) ------------------------------------------------- */
await tb("nt-print").click();
await page.waitForTimeout(1600);
const skSheet = await page.evaluate(() => {
  const f = document.querySelector('[data-testid="notes-print-frame"]');
  const d = f && f.contentDocument;
  if (!d) return null;
  return {
    boxes: d.querySelectorAll("[data-sketch-node]").length,
    treeEdges: d.querySelectorAll('[data-sketch-edge-kind="tree"]').length,
    linkEdges: d.querySelectorAll('[data-sketch-edge-kind="link"]').length,
    chevrons: d.querySelectorAll("[data-sketch-toggle]").length,
    detail: d.querySelector("ul.planyr-sketch-detail")?.textContent || "",
    payload: d.querySelector("[data-note-sketch]") ? "yes" : "no",
    boxFill: (() => { const b = d.querySelector(".planyr-sketch-box"); return b ? getComputedStyle(b).fill : ""; })(),
  };
});
ok("THE PRINTED SHEET DRAWS THE SAME SKETCH — every box and every arrow",
  skSheet?.boxes === 5 && skSheet?.treeEdges === 3 && skSheet?.linkEdges === 1, JSON.stringify(skSheet && { b: skSheet.boxes, t: skSheet.treeEdges, l: skSheet.linkEdges }));
ok("⛔ AND IT PRINTS EVERY BODY, because a chevron cannot be pressed on paper",
  /Title review/.test(skSheet?.detail || "") && /Stewart/.test(skSheet?.detail || ""), (skSheet?.detail || "").slice(0, 60));
ok("...so the sheet carries no chevrons at all — nothing on paper pretends to be clickable",
  skSheet?.chevrons === 0);
ok("the printed box is drawn on WHITE, not in the app's theme", /255/.test(skSheet?.boxFill || ""), skSheet?.boxFill);

/* ---- THE CASCADE: deleting a line takes its box, its position AND its arrows -------- */
const beforeDelete = await sketchNode();
const doomed = beforeDelete.attrs.outline.find((n) => n.label === "Phase I").id;
const placedId = Object.keys(beforeDelete.attrs.positions)[0];
ok("before the delete: the doomed line has a box, and an arrow that names it",
  beforeDelete.attrs.links.some((l) => l.from === doomed || l.to === doomed));

/* Put a position on the doomed node too, so the delete has BOTH dependants to cascade. */
const doomedBox = page.locator("[data-sketch-node]").nth(3);
const dbb = await doomedBox.boundingBox();
await page.mouse.move(dbb.x + 30, dbb.y + 14);
await page.mouse.down();
await page.mouse.move(dbb.x + 160, dbb.y + 120, { steps: 10 });
await page.mouse.up();
await settle();
const armed = await sketchNode();
ok("...and now a hand-placed position as well — both dependants are armed",
  Object.keys(armed.attrs.positions).length === 2 && doomed in armed.attrs.positions);

await tb("sketch-outline").fill(OUTLINE_TEXT.replace("\n    Phase I", ""));
await page.waitForTimeout(700);
await settle();

const after = await sketchNode();
const ids = new Set(after.attrs.outline.map((n) => n.id));
ok("DELETING THE LINE REMOVES ITS BOX", !ids.has(doomed) && after.attrs.outline.length === 4);
ok("⛔ ...AND ITS POSITION GOES WITH IT — no dangling position (TOMBSTONE-DELETES)",
  !(doomed in after.attrs.positions), JSON.stringify(after.attrs.positions));
ok("⛔ ...AND EVERY ARROW THAT NAMED IT GOES TOO — no dangling arrow",
  after.attrs.links.every((l) => ids.has(l.from) && ids.has(l.to)) && after.attrs.links.length === 0,
  JSON.stringify(after.attrs.links));
ok("...while the UNRELATED box keeps its own position — the cascade is exact, not a wipe",
  placedId in after.attrs.positions);
ok("nothing dangling reaches the drawing either", await page.locator('[data-sketch-edge-kind="link"]').count() === 0);
ok("and the deletion is stated rather than silent", /arrow/i.test(await tb("sketch-status").innerText()), await tb("sketch-status").innerText());

/* ---- putting a box back under the automatic layout ---------------------------------- */
await tb("sketch-tidy").click();
await settle();
const tidied = await sketchNode();
ok("“Tidy up” returns every box to the outline's own layout, and says nothing you typed changed",
  Object.keys(tidied.attrs.positions).length === 0 && tidied.attrs.outline.length === 4);
ok("...and the text is STILL byte-identical through all of it",
  tidied.attrs.outline.map((n) => n.label).join("|") === "Acquisition|Title review|Environmental|Entitlement",
  tidied.attrs.outline.map((n) => n.label).join("|"));

/* ---- a sketch's words are findable -------------------------------------------------- */
await tb("notes-search").fill("Stewart");
await page.waitForTimeout(700);
const skHits = page.locator('[data-testid="notes-search-results"] button');
ok("A SKETCH'S WORDS ARE SEARCHABLE — they live in ATTRIBUTES, not in text nodes, so a plain walk would miss them",
  await skHits.count() >= 1 && /Deal sequence/.test(await skHits.first().innerText()),
  await skHits.count() ? (await skHits.first().innerText()).replace(/\s+/g, " ").slice(0, 70) : "no hit");
await tb("notes-search").fill("");
await page.waitForTimeout(400);

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
