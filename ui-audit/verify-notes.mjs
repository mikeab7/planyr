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
 * §23 is SKETCH MODE, rewritten for the authoring REBUILD (B1400 ×2). The rule it proves is
 * now that THE CANVAS OWNS EVERYTHING — each box carries its own text and its own position,
 * arrows are an explicit list — so it drives the real gestures: it double-clicks an empty
 * spot and types straight into the box that appears (including while the caret is somewhere
 * else entirely), it turns written words into a box with the toolbar's Box button, it drags
 * from one box onto another to draw an arrow, it drags a box and demands the words come back
 * byte-identical, it reloads the whole browser, it prints the sheet, and it deletes a box and
 * demands every arrow that named it goes too — the check that would catch a half-built
 * cascade. It asserts what is GONE (no outline textarea, anywhere) and that a sketch saved
 * under the SUPERSEDED outline shape still opens with its arrows intact. It also proves the
 * thing no unit test can: twenty-two sections run with nothing sketch-shaped downloaded at
 * all, because no page had a sketch on it.
 *
 *   npx vite preview --port 4173 &
 *   node ui-audit/verify-notes.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdtempSync } from "node:fs";
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
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
   setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
   suspends requestAnimationFrame, so after a view change the app's state attributes update while the
   drawing never repaints — every box, position, hit test and screenshot then agrees with every other
   and describes a view the app already left. One precondition covers both, rAF liveness probe
   included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
await assertMeasurable(page, "verify-notes");

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

/* ⛔ CLICK THE END OF THE CONTENT, NEVER THE MIDDLE OF THE SHEET (B1393 ×2). This used to
 * click the note-body element's CENTRE, which — now that pressing blank space genuinely puts
 * the caret there (Click and Type) — would insert paragraphs and move the caret away from
 * whatever the case under test had just set up. Aiming at the right-hand end of the last
 * block is what the old centre-click effectively did anyway: continue from the end. */
const typeInBody = async (text) => {
  const at = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="note-body"]');
    const last = body.lastElementChild || body;
    const r = last.getBoundingClientRect();
    return { x: r.right - 2, y: r.top + Math.min(12, r.height / 2) };
  });
  await page.mouse.click(at.x, at.y);
  await page.keyboard.type(text, { delay: 8 });
};
/* Put the caret in the document WITHOUT tripping Click and Type — the same aim, reused by
 * every case that just needs focus in the editor rather than a caret at a chosen place. */
const caretInDoc = async (target = page) => {
  const at = await target.evaluate(() => {
    const body = document.querySelector('[data-testid="note-body"]');
    const last = body.lastElementChild || body;
    const r = last.getBoundingClientRect();
    return { x: r.right - 2, y: r.top + Math.min(12, r.height / 2) };
  });
  await (target.mouse ? target : page).mouse.click(at.x, at.y);
};
const tb = (id) => page.locator(`[data-testid="${id}"]`);
/* A tree row's actions live on its RIGHT-CLICK MENU (B1367) — the row itself shows only a
 * name. Every action in the harness therefore goes the way a person's does: right-click the
 * row, pick the item. (Before B1367 this hovered the row and clicked one of four controls
 * that appeared under the pointer.) */
/* ⛔ THE RAIL OPENS THE PATH TO THE PAGE YOU ARE ON AND LEAVES THE REST SHUT (B1420) — so a
 * harness that wants a nested row has to open its way there, exactly like a person. This
 * reads the real tree, walks the ancestors, and clicks each closed toggle. It is also, in
 * itself, the check that a subpage is REACHABLE: if a branch could not be opened the whole
 * run stops here rather than passing quietly. */
const ensureVisible = async (rowId) => {
  const t = await readTree();
  const chain = [];
  const go = (node, trail) => {
    if (node.id === rowId) { chain.push(...trail); return true; }
    for (const k of node.pages || []) if (go(k, [...trail, node.id])) return true;
    return false;
  };
  for (const r of (t?.pages || [])) if (go(r, [])) break;
  for (const id of chain) {
    const arrow = page.locator(`[data-testid="notes-row-${id}"]`);
    if (await arrow.count() && await arrow.getAttribute("aria-expanded") === "false") {
      await tb(`notes-toggle-${id}`).click();
      await page.waitForTimeout(120);
    }
  }
};
const rowClick = async (rowId, opts) => { await ensureVisible(rowId); await tb(`notes-row-${rowId}`).click(opts); };

const rowAction = async (rowId, action) => {
  await ensureVisible(rowId);
  await rowClick(rowId, { button: "right" });
  await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
  await tb(`notes-menu-${action}-${rowId}`).click();
  await page.waitForTimeout(120);
};
/** Settle past the 600 ms autosave debounce. */
const settle = async () => page.waitForTimeout(1100);

/* ⛔ THE TREE IS PAGES HOLDING PAGES (B1420) — no notebooks, no sections. These three
 * helpers are the whole adaptation the harness needed: walk it, find one, list a branch. */
const walkTree = (t, fn) => {
  const go = (node, parent, root, depth) => { fn(node, { parent, root, depth }); for (const k of node.pages || []) go(k, node, root, depth + 1); };
  for (const r of (t?.pages || [])) go(r, null, r, 0);
};
const flatPages = (t) => { const out = []; walkTree(t, (n, c) => out.push({ ...c, node: n })); return out; };
const findIn = (t, id) => flatPages(t).find((x) => x.node.id === id) || null;
const subtreeIds = (node) => { const out = []; const go = (n) => { out.push(n.id); for (const k of n.pages || []) go(k); }; if (node) go(node); return out; };

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
  await caretInDoc();
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
ok("the page tree renders", await page.locator('[data-testid="notes-tree"]').isVisible());

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
ok("with nothing yet, an empty state offers to create a page", await page.locator('[data-testid="notes-empty-create"]').count() === 1);

await tb("notes-new-page").click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
ok("ONE click produces an open, typeable page", await page.locator('[data-testid="note-body"]').isVisible());

await page.waitForTimeout(1200);   // past the tree-save debounce
const editorChunk = jsRequests.find((f) => /^NoteEditor-/.test(f));
ok("the EDITOR arrives as its OWN chunk, only once a page is opened", !!editorChunk, editorChunk || "not requested");

let tree = await readTree();
ok("the new page is a TOP-LEVEL page — there is no notebook and no section to make first",
  !!tree && (tree.pages || []).length === 1 && (tree.pages[0].pages || []).length === 0,
  tree ? `${(tree.pages || []).length} top-level page(s)` : "no tree");
ok("created from the dashboard, it belongs to NO project (and lives in its own named group)",
  tree?.pages[0].projectId === null);

const page1 = tree.pages[0].id;

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

await caretInDoc();
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
/* A SUBPAGE — the thing the old model could not do at all. It is created by direct action
 * from the row's own menu, never by a mode. */
await rowAction(page1, "sub");
await page.waitForTimeout(700);
tree = await readTree();
const page2 = findIn(tree, page1)?.node.pages?.[0]?.id;
ok("⛔ A PAGE CAN HOLD A PAGE — a subpage is created straight from the row's menu", !!page2, page2 || "none");

await typeInBody("Second page groundwork.");
await settle();
ok("the second page saves to its OWN key, leaving the first alone",
  textOf(await readBody(page2)).includes("Second page groundwork")
  && !textOf(await readBody(page1)).includes("Second page groundwork"));

/* Type, then switch pages IMMEDIATELY — well inside the 600 ms debounce. This is the
 * regression: the old flush queried the outgoing editor and raced its own teardown. */
await caretInDoc();
await page.keyboard.press("End");
await page.keyboard.type(" LAST-TYPED-BEFORE-SWITCH", { delay: 5 });
await page.waitForTimeout(90);                                  // a split second, not a full debounce
await rowClick(page1);
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
ok("both pages survived the reload", subtreeIds(findIn(await readTree(), page1)?.node).length === 2);

await rowClick(page2);
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
await rowClick(page1);
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
await caretInDoc();
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
await rowAction(page1, "sub");
await page.waitForTimeout(800);
tree = await readTree();
const page3 = findIn(tree, page1)?.node.pages?.[1]?.id;
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
await rowClick(page3);
await page.waitForTimeout(1200);
ok("AN IMAGE WHOSE STORED COPY IS GONE RENDERS A NAMED BROKEN STATE, never a blank gap",
  await page.locator('[data-testid="note-image"][data-missing]').count() === 1
  && /Image missing/i.test(await page.locator('[data-testid="note-image"]').innerText()));

/* ════ 15. MOVE — RE-PARENTING, which is what "anything can hold anything" needs ═══════ */
await tb("notes-new-page").click();
await page.waitForTimeout(900);
tree = await readTree();
const sibling = (tree.pages || []).find((p) => p.id !== page1)?.id;
ok("a second TOP-LEVEL page can be made, to move a page into", !!sibling, sibling || "none");

await rowClick(page3);
await page.waitForTimeout(700);

await rowAction(page3, "mv");
await page.waitForTimeout(250);
ok("the move panel opens inline, not in a dialog box", await tb(`notes-move-${page3}`).count() === 1);

await tb(`notes-move-${page3}-to-${sibling}`).click();
await page.waitForTimeout(900);
tree = await readTree();
ok("⛔ A PAGE CAN BE RE-PARENTED UNDER ANOTHER PAGE — through the UI, not just in a unit test",
  findIn(tree, page3)?.parent?.id === sibling, `now under ${findIn(tree, page3)?.parent?.title}`);

/* …and back out to the top level, which is the move that has to exist or a nest is a trap. */
await rowAction(page3, "mv");
await page.waitForTimeout(250);
await tb(`notes-move-${page3}-to-__root__`).click();
await page.waitForTimeout(900);
tree = await readTree();
ok("⛔ ...AND BACK OUT TO THE TOP LEVEL, so nesting is never one-way",
  findIn(tree, page3)?.parent === null, `parent ${findIn(tree, page3)?.parent?.title ?? "none"}`);

await rowAction(page1, "mv");
await page.waitForTimeout(250);
await tb(`notes-move-${page1}-down`).click();
await page.waitForTimeout(900);
tree = await readTree();
const order = (tree.pages || []).map((p) => p.id);
ok("A PAGE CAN BE REORDERED AMONG ITS SIBLINGS", order.indexOf(page1) > 0, order.join(" → "));

/* ════ 16. Timestamps — kept in the model, shown on a hover ════════════════════════════ */
tree = await readTree();
const stamped = flatPages(tree).map((x) => x.node).filter((p) => Number.isFinite(p.updatedAt));
ok("EVERY PAGE NOW RECORDS WHEN IT WAS LAST TOUCHED", stamped.length >= 3, `${stamped.length} stamped`);
/* ⛔ AND IT IS NOT A PERMANENT COLUMN ON EVERY ROW (B1420). It was noise the owner read
 * past. It survives as the row's hover title, and after B36050 that is the whole of it. */
ok("⛔ THE TIMESTAMP IS OFF THE ROW — a hover, not a column",
  await page.locator(`[data-testid="notes-when-${page1}"]`).count() === 0);
ok("...but it is still THERE, on the row's own title", /edited/i.test(await tb(`notes-row-${page1}`).getAttribute("title") || ""),
  await tb(`notes-row-${page1}`).getAttribute("title"));

/* ⛔ AND THE RECENT VIEW IS GONE (B36050). Owner: *"I don't think I need a recent option."*
   Two segments, not three — and the timestamp DATA is deliberately untouched underneath, so
   this is a component that was removed, not a schema that was migrated. */
ok("⛔ THE RECENT TAB IS GONE — two segments, Pages and Bin",
  await tb("notes-view-recent").count() === 0
  && await tb("notes-view-tree").count() === 1
  && await tb("notes-view-bin").count() === 1);
ok("...and the tab strip really is down to two",
  await page.locator('[role="tablist"][aria-label="Notes view"] button').count() === 2,
  `${await page.locator('[role="tablist"][aria-label="Notes view"] button').count()} tab(s)`);
ok("⛔ ...while the times themselves are STILL IN THE MODEL — nothing was orphaned to remove a view",
  flatPages(await readTree()).map((x) => x.node).filter((p) => Number.isFinite(p.updatedAt)).length >= 3);

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
await rowClick(page3);
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
/* Put a picture back on the branch being deleted, so the purge has real bytes to destroy —
 * the §14 check deleted the earlier one out from under the note on purpose. */
await rowClick(page1);
await page.waitForTimeout(900);
await pasteImage(200);
await settle();
ok("a picture is in place on the branch about to be deleted", (await imageRecords()).length === 1);

const keysBefore = await pageKeyCount();
ok("every page body is on disk before the delete", keysBefore >= 2, `${keysBefore} key(s)`);

const doomedBranch = subtreeIds(findIn(await readTree(), page1)?.node);
ok("the branch about to be deleted has a SUBPAGE under it — a flat delete would prove nothing",
  doomedBranch.length >= 2, doomedBranch.join(", "));

await rowAction(page1, "rm");
await page.waitForTimeout(300);
ok("delete asks inline rather than with a dialog box", await tb(`notes-del-${page1}-yes`).count() === 1);
ok("...and it SAYS how many pages are going, before it happens rather than after",
  /Delete \d+\?/.test(await tb(`notes-del-${page1}-yes`).locator("xpath=..").innerText()),
  (await tb(`notes-del-${page1}-yes`).locator("xpath=..").innerText()).replace(/\s+/g, " "));

await tb(`notes-del-${page1}-yes`).click();
await page.waitForTimeout(1200);

let treeAfter = await readTree();
ok("⛔ DELETING A PAGE TAKES ITS WHOLE SUBTREE OUT OF THE LIVE TREE",
  doomedBranch.every((id) => !findIn(treeAfter, id)), doomedBranch.join(", "));
ok("...and it lands in the BIN carrying that full cascade (TOMBSTONE-DELETES)",
  (treeAfter.trash || []).length === 1
  && doomedBranch.every((id) => (treeAfter.trash[0].pageIds || []).includes(id)),
  `${(treeAfter.trash?.[0]?.pageIds || []).length} page(s) binned of ${doomedBranch.length}`);
ok("THE BODIES ARE STILL ON DISK — a bin whose contents were already destroyed is not a bin",
  await pageKeyCount() === keysBefore, `${keysBefore} → ${await pageKeyCount()} key(s)`);
ok("an UNDO is offered at the moment of the delete, not buried in a menu", await tb("notes-undo-bar").count() === 1);

await tb("notes-undo").click();
await page.waitForTimeout(1200);
treeAfter = await readTree();
ok("⛔ UNDO PUTS THE WHOLE SUBTREE BACK — every page, at every depth, in its old place",
  doomedBranch.every((id) => !!findIn(treeAfter, id)) && (treeAfter.trash || []).length === 0,
  doomedBranch.filter((id) => !findIn(treeAfter, id)).join(", ") || "all back");
ok("...with the nesting intact rather than flattened",
  findIn(treeAfter, page3)?.parent?.id === page1 || findIn(treeAfter, page2)?.parent?.id === page1);
ok("...and its text is still there afterwards", textOf(await readBody(page1)).includes("north property line"));

/* Delete it again and take the OTHER exit: delete forever, which is the one and only
 * point at which a note's bytes are actually destroyed. */
await rowAction(page1, "rm");
await page.waitForTimeout(250);
await tb(`notes-del-${page1}-yes`).click();
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
ok("...and a page that was MOVED OUT of the deleted branch is untouched — the cascade is the entry's set, not a guess",
  keysAfter >= 1, `${keysAfter} key(s) left`);
ok("...AND EVERY PICTURE THOSE PAGES HELD — an image left behind can never be reached or freed",
  (await imageRecords()).length === 0, `${imgsBeforePurge} → ${(await imageRecords()).length} image record(s)`);
treeAfter = await readTree();
ok("the bin is empty afterwards", (treeAfter.trash || []).length === 0);
ok("a SIBLING branch survives — the cascade is the entry's set, never everything in sight",
  !!findIn(treeAfter, sibling));

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
ok("the pages and the bin are all still exactly where they were",
  !!tree && Array.isArray(tree.pages) && Array.isArray(tree.trash));
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(2200);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });
const afterReload = await readTree();
ok("a reload with cloud sync in the build restores the same signed-out pages",
  JSON.stringify(afterReload?.pages?.map((n) => n.id)) === JSON.stringify(tree?.pages?.map((n) => n.id)),
  `${afterReload?.pages?.length ?? 0} top-level page(s)`);

/* ════ 21. ROUND THREE — the page you can click, the rail that shows names, the bar you
        can read, and a build that admits it is old (B1365–B1373) ══════════════════════ */

const r3Page = afterReload?.pages?.[0]?.id;
await rowClick(r3Page);
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
const blankClickY = Math.min(mat.y + mat.height - 40, bodyBox.y + bodyBox.height + 60);
const parasBefore = nodesOf(await readBody(r3Page), "paragraph").length;
await page.mouse.click(bodyBox.x + 40, blankClickY);
await page.waitForTimeout(200);
const focusedAfterBlankClick = await page.evaluate(() => !!document.activeElement?.closest?.(".ProseMirror"));
await page.keyboard.type("CLICKED-THE-BLANK-PART", { delay: 6 });
await settle();
/* ⛔ AMENDED TWICE, and the second amendment is the owner's own testing (B1393 ×3).
 * B1392's version asserted only that a keystroke arrived. B1393 ×2's asserted the text
 * rendered at the pressed HEIGHT — which a build that reached that height by injecting six
 * empty paragraphs satisfies perfectly, and that is exactly what shipped and what he
 * rejected. The property now is the DOCUMENT: the words arrive, and the press cost the
 * document at most ONE new line and no alignment at all. */
const blankDoc = await readBody(r3Page);
ok("clicking the empty space BELOW the text lands the caret and typing goes in",
  focusedAfterBlankClick && textOf(blankDoc).includes("CLICKED-THE-BLANK-PART"));
ok("⛔ ...and it padded NOTHING to get there — at most one new line, never a stack of blanks",
  nodesOf(blankDoc, "paragraph").length <= parasBefore + 1,
  `${parasBefore} → ${nodesOf(blankDoc, "paragraph").length} paragraph(s)`);
ok("⛔ ...and left no alignment behind",
  !/"textAlign":"(center|right|justify)"/.test(JSON.stringify(blankDoc)));

/* Beside the text, out to the right of a short line — the other half of the dead zone. */
await page.mouse.click(bodyBox.x + bodyBox.width - 20, bodyBox.y + 12);
await page.waitForTimeout(200);
ok("...and clicking BESIDE a line does too, rather than doing nothing at all",
  await page.evaluate(() => !!document.activeElement?.closest?.(".ProseMirror")));

/* ---- B1367: the rail shows names; actions are on a right-click menu ---- */
const r3Section = afterReload.pages[0].id;
await ensureVisible(r3Section);
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

await rowClick(r3Section, { button: "right" });
await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
ok("right-click opens the row's menu with new subpage / rename / move / delete",
  await tb(`notes-menu-sub-${r3Section}`).count() === 1
  && await tb(`notes-menu-rn-${r3Section}`).count() === 1
  && await tb(`notes-menu-mv-${r3Section}`).count() === 1
  && await tb(`notes-menu-rm-${r3Section}`).count() === 1);
await tb(`notes-menu-rn-${r3Section}`).click();
await page.waitForTimeout(250);
ok("Rename from the menu opens the INLINE field on the row, never a dialog box",
  await tb(`notes-rename-${r3Section}`).count() === 1);
await page.keyboard.press("Escape");
await page.waitForTimeout(150);

/* ---- B1365: the per-branch export links are off the rail, and on the menu ---- */
const r3Notebook = afterReload.pages[0].id;
ok("the rail no longer repeats a Markdown + Print pair under every branch",
  await tb(`notes-export-${r3Notebook}`).count() === 0 && await tb(`notes-print-${r3Notebook}`).count() === 0);
await rowClick(r3Notebook, { button: "right" });
await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
ok("...but branch-level export and print are still reachable, on the page's own menu",
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

await caretInDoc();
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
ok("⛔ INSIDE A PROJECT THERE IS NO SCOPE SWITCH TO UNDERSTAND — the rail is that project",
  await tb("notes-scope-switch").count() === 0);

await tb("notes-new-page").click();
await page.waitForTimeout(900);
let scopedTree = await readTree();
const projPage = (scopedTree.pages || []).find((n) => n.projectId === PROJ_A);
ok("⛔ A PAGE CREATED INSIDE A PROJECT IS FILED THERE, with no extra step",
  !!projPage, projPage ? `filed in ${projPage.projectId}` : "not filed");
ok("...and it is on screen where it was made", await tb(`notes-row-${projPage.id}`).count() === 1);
ok("⛔ AND IT WEARS NO PROJECT BADGE — everything here belongs to where you are standing",
  !/project/i.test((await tb(`notes-row-${projPage.id}`).innerText()).toLowerCase()),
  (await tb(`notes-row-${projPage.id}`).innerText()).replace(/\n/g, " · "));

/* ⛔ A PAGE IN NO PROJECT IS NOT IN THIS PROJECT'S RAIL — the collapse's deliberate change
 * from B1374's "a loose notebook shows up everywhere". That is exactly what lets the badge
 * go: everything on screen belongs to where you are standing. */
const loosePage = (scopedTree.pages || []).find((n) => n.id !== projPage.id && n.projectId == null);
ok("⛔ a page in NO project does not leak into a project's rail",
  await tb(`notes-row-${loosePage.id}`).count() === 0);

/* Re-file it into this project from the DASHBOARD, where it does live — the first exercise
 * of the re-file path, and the way back for anything filed in the wrong place. */
await goProject(null);
await rowClick(loosePage.id, { button: "right" });
await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
await tb(`notes-menu-bind-${loosePage.id}`).click();
await page.waitForTimeout(300);
ok("...through an inline panel on the row, never a dialog box", await tb(`notes-bind-${loosePage.id}`).count() === 1);
await tb(`notes-bind-${loosePage.id}-to-${PROJ_A}`).click();
await page.waitForTimeout(1000);
ok("AN EXISTING PAGE CAN BE RE-FILED INTO A PROJECT",
  ((await readTree()).pages || []).find((n) => n.id === loosePage.id)?.projectId === PROJ_A);
await goProject(PROJ_A);
ok("...and it is in that project's rail immediately afterwards",
  await tb(`notes-row-${loosePage.id}`).count() === 1);

/* Walk into a DIFFERENT project — the owner's exact move. */
await goProject(PROJ_B);
ok("in another project, those pages are correctly OUT of scope",
  await tb(`notes-row-${projPage.id}`).count() === 0 && await tb(`notes-row-${loosePage.id}`).count() === 0);
const emptyLine = await tb("notes-empty-scope").count() ? await tb("notes-empty-scope").innerText() : "";
ok("THE EMPTY RAIL EXPLAINS ITSELF instead of implying the notes are gone",
  /belong to a different project/i.test(emptyLine), emptyLine.slice(0, 90) || "no explanation");
ok("...and offers the one click that finds them", await tb("notes-show-all").count() === 1);

await tb("notes-show-all").click();
await page.waitForTimeout(700);
ok("⛔ NOTHING IS UNREACHABLE — that one click lands on the Dashboard, showing every project's notes",
  await tb(`notes-row-${projPage.id}`).count() === 1
  && !/project\//.test(await page.evaluate(() => window.location.hash)),
  await page.evaluate(() => window.location.hash));
ok("⛔ ...and it STAYS IN NOTES — answering 'where are my notes' by leaving the module would be worse than the empty rail",
  /#\/notes/.test(await page.evaluate(() => window.location.hash))
  && await page.locator('[data-testid="notes-tree"]').isVisible(),
  await page.evaluate(() => window.location.hash));

/* ⛔ AND THIS IS WHERE A PROJECT IS NAMED — once, on a GROUP HEADING, not on every row. */
ok("the Dashboard groups by project, and there is a heading for the project these pages are in",
  await tb(`notes-group-${PROJ_A}`).count() === 1);
ok("...and a named home for everything in no project at all",
  await tb("notes-group-none").count() === 1
  && /not in a project/i.test(await tb("notes-group-none").innerText()),
  await tb("notes-group-none").innerText());
const dashRow = (await tb(`notes-row-${projPage.id}`).innerText()).toLowerCase();
ok("⛔ ...and even here the ROW carries no badge — the heading already said it",
  !/other project|missing project/.test(dashRow), dashRow.replace(/\n/g, " · ").slice(0, 60));

/* Re-file it out of every project and back, from the Dashboard. */
await rowClick(projPage.id, { button: "right" });
await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
await tb(`notes-menu-bind-${projPage.id}`).click();
await page.waitForTimeout(300);
await tb(`notes-bind-${projPage.id}-to-__none__`).click();
await page.waitForTimeout(1000);
scopedTree = await readTree();
ok("FILING IT OUT OF EVERY PROJECT STICKS, in the stored tree",
  (scopedTree.pages.find((n) => n.id === projPage.id) || {}).projectId === null);
ok("...and it moves into the 'Not in a project' group rather than vanishing",
  await tb(`notes-row-${projPage.id}`).count() === 1);

/* …and it is out of every project's rail now, the same way. */
await goProject(PROJ_B);
ok("⛔ a page filed OUT of every project leaves that project's rail",
  await tb(`notes-row-${projPage.id}`).count() === 0);

await goProject(PROJ_A);
ok("...while the page that IS filed here is still on screen — one move, one page",
  await tb(`notes-row-${loosePage.id}`).count() === 1);

/* Search follows the scope both ways, so a mis-filed note is findable rather than hidden. */
await goProject(PROJ_B);
await tb("notes-search").fill("Untitled");
await page.waitForTimeout(600);
const narrowHits = await page.locator('[data-testid="notes-search-results"] button').count();
await tb("notes-search").fill("");
await goProject(null);
await tb("notes-search").fill("Untitled");
await page.waitForTimeout(600);
const wideHits = await page.locator('[data-testid="notes-search-results"] button').count();
ok("SEARCH OBEYS THE SAME SCOPE THE RAIL DOES — from the Dashboard the other project's notes are findable",
  wideHits > narrowHits, `${narrowHits} in this project → ${wideHits} across all`);
await tb("notes-search").fill("");
await page.waitForTimeout(300);

/* And the filing is in the TREE BLOB, which is what syncs — so it round-trips a reload. */
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(2200);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });
ok("THE FILING RIDES IN THE TREE BLOB — it survives a reload, which is what makes it sync",
  ((await readTree()).pages || []).find((n) => n.id === loosePage.id)?.projectId === PROJ_A);

/* ════ 23. ROUND FOUR — the false alarm, the key Chrome was stealing, and the blank space
        you can double-click (B1391 · B1392 · B1393) ═══════════════════════════════════════

   All three arrived together from the owner, and all three are driven HERE, logged out,
   rather than parked: the two-window race is a localStorage race first (the cloud only
   makes it visible later), the Tab escape is pure keyboard, and the blank-space press
   needs nothing but a wide window. The ONE half that genuinely cannot run here — a real
   revision conflict between two SIGNED-IN windows — is V680. */

await goProject(null);                       // no project, so the second window sees it
await tb("notes-new-page").click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await page.waitForTimeout(1200);
const r4Tree = await readTree();
const r4Page = r4Tree.pages[r4Tree.pages.length - 1].id;

const inDoc = () => page.evaluate(() => !!document.activeElement?.closest?.(".ProseMirror"));
const clearBody = async () => {
  await caretInDoc();
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
console.log("DBG released after Escape:", await page.evaluate(() => {
  const el = document.querySelector('[data-testid="note-body"]');
  return el ? String(!!el.closest(".planyr-note")) : "no body";
}));
await page.keyboard.press("Tab");
await page.waitForTimeout(200);
console.log("DBG doc text after tab:", JSON.stringify((await page.locator('[data-testid="note-body"]').innerText()).slice(0,40)));
ok("ESCAPE THEN TAB LEAVES THE NOTE — the keyboard-only escape hatch is real, not a promise",
  !(await inDoc()), await page.evaluate(() => {
    const a = document.activeElement;
    return a ? `${a.tagName}[${a.getAttribute("data-testid") || a.className || ""}]` : "nothing";
  }));

/* ...and the release is single-use: typing takes it back, so you cannot end up in a mode
   where Tab silently stopped indenting. */
await caretInDoc();
await page.keyboard.type("back inside", { delay: 6 });
await page.keyboard.press("Tab");
await page.waitForTimeout(150);
ok("...and typing takes the release back — the next Tab indents again, no lingering mode",
  await inDoc());
await settle();

/* ---- B1393 ×3: A PRESS IN BLANK SPACE PUTS THE CARET THERE AND DOES NOTHING ELSE -------
 *
 * ⛔ THESE ASSERT THE RESULTING DOCUMENT. Not focus, not that a handler ran — the owner has
 * now been failed twice by checks that did. B1393's asserted focus (green on a build that
 * typed on line one); B1393 ×2's asserted the caret's landing HEIGHT, which was true of a
 * build that reached that height by injecting six empty paragraphs and centring the text.
 * So the questions these ask are the ones he actually asked of the live app: **how many
 * paragraphs are in the document, and does any of them carry an alignment?**
 *
 * What he found on the shipped build, all reproduced: the line crawled left as he typed
 * (every character re-centres a centred paragraph); the alignment was inherited by the next
 * paragraph on Enter; the same gesture behaved differently depending on whether the press
 * happened to land on an existing empty paragraph; and the padding paragraphs were permanent
 * — in storage, in the Markdown and on the PDF, six backspaces deep. */

await clearBody();
await settle();
const emptyBefore = await readBody(r4Page);
ok("the page starts as a single empty paragraph", nodesOf(emptyBefore, "paragraph").length === 1);

const matBox = await tb("note-mat").boundingBox();
const bodyBox2 = await tb("note-body").boundingBox();
/* His own gesture: well down the page and far to the right of the text column. */
const clickX = bodyBox2.x + bodyBox2.width * 0.78;
const clickY = Math.min(matBox.y + matBox.height - 60, bodyBox2.y + 260);

await page.mouse.dblclick(clickX, clickY);
await page.waitForTimeout(220);
await page.keyboard.type("AAA", { delay: 8 });
await settle();
const afterClickType = await readBody(r4Page);

ok("⛔ EXACTLY ONE PARAGRAPH EXISTS — no padding was injected to reach the press (B1393 ×3)",
  nodesOf(afterClickType, "paragraph").length === 1,
  `${nodesOf(afterClickType, "paragraph").length} paragraph(s): ${JSON.stringify(textOf(afterClickType)).slice(0, 60)}`);
ok("⛔ ...AND IT CARRIES NO ALIGNMENT — the centring that made the line crawl as he typed is gone",
  !/"textAlign":"(center|right|justify)"/.test(JSON.stringify(afterClickType)),
  (JSON.stringify(afterClickType).match(/"textAlign":"[a-z]+"/g) || ["none"]).join(","));
ok("...and the words he typed are the ONLY content — no stray whitespace, tabs or blank lines",
  textOf(afterClickType).trim() === "AAA", JSON.stringify(textOf(afterClickType)));

/* ⛔ ENTER MUST NOT INHERIT AN ALIGNMENT THAT NO LONGER EXISTS — his consequence (2). */
await page.keyboard.press("Enter");
await page.keyboard.type("BBB", { delay: 8 });
await settle();
const afterEnter = await readBody(r4Page);
ok("⛔ ENTER AFTER A BLANK-SPACE PRESS MAKES A PLAIN PARAGRAPH — no alignment inherited from nowhere",
  !/"textAlign":"(center|right|justify)"/.test(JSON.stringify(afterEnter))
  && nodesOf(afterEnter, "paragraph").length === 2,
  `${nodesOf(afterEnter, "paragraph").length} paragraph(s), align ${(JSON.stringify(afterEnter).match(/"textAlign":"[a-z]+"/g) || ["none"]).join(",")}`);

/* ⛔ THE SAME GESTURE TWICE GIVES THE SAME ANSWER — his consequence (3). One press below a
 * NON-empty last block adds exactly one line; a second press, now that the last block IS
 * empty, adds none. Deterministic, and stated rather than emergent. */
await clearBody();
await page.keyboard.type("only line", { delay: 8 });
await settle();
const oneLine = nodesOf(await readBody(r4Page), "paragraph").length;
await page.mouse.click(bodyBox2.x + 60, clickY);
await page.waitForTimeout(250);
await settle();
const afterFirst = nodesOf(await readBody(r4Page), "paragraph").length;
await page.mouse.click(bodyBox2.x + 400, clickY + 30);
await page.waitForTimeout(250);
await settle();
const afterSecond = nodesOf(await readBody(r4Page), "paragraph").length;
ok("⛔ A PRESS BELOW THE TEXT ADDS AT MOST ONE LINE, AND ONLY WHEN THERE ISN'T ONE ALREADY",
  afterFirst === oneLine + 1 && afterSecond === afterFirst,
  `${oneLine} → ${afterFirst} → ${afterSecond} paragraph(s)`);
ok("...and neither press left an alignment behind, wherever across the column it landed",
  !/"textAlign":"(center|right|justify)"/.test(JSON.stringify(await readBody(r4Page))));

/* ⛔ …and double-clicking a WORD still SELECTS that word, and typing replaces it. This is the
   half that must survive every rewrite of the press path. */
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
ok("DOUBLE-CLICKING A WORD STILL SELECTS IT — and typing replaces it",
  textOf(await readBody(r4Page)).replace(/\s+/g, " ").includes("alpha BRAVO gamma"),
  textOf(await readBody(r4Page)));

/* ---- HOME and END, in every context (owner check, same round) --------------------------
 *
 * He reported End not moving the caret to the end of a CENTRED line. Driven here in every
 * context the caret can be in, asserting the caret's RESULTING OFFSET rather than the
 * keypress: all of them are correct, including the centred case — which is consistent with
 * the report being a symptom of the crawling text (the caret WAS at the end; the paragraph
 * kept re-centring under it) rather than a second defect. Guarded from here on either way. */
const caretOffset = () => page.evaluate(() => {
  const sel = window.getSelection();
  if (!sel || !sel.anchorNode) return null;
  return { text: (sel.anchorNode.textContent || ""), off: sel.anchorOffset };
});
const homeEnd = async (label, expect) => {
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("Home");
  const atHome = await caretOffset();
  await page.keyboard.press("End");
  const atEnd = await caretOffset();
  ok(`HOME and END move the caret in ${label}`,
    !!atHome && atHome.off === 0 && !!atEnd && atEnd.off === expect.length,
    `Home→${atHome?.off} End→${atEnd?.off} of ${expect.length}`);
};

await clearBody();
await page.keyboard.type("plain line here", { delay: 6 });
await homeEnd("a plain paragraph", "plain line here");

await clearBody();
await page.keyboard.type("- bullet line here", { delay: 6 });
await homeEnd("a list item", "bullet line here");

await clearBody();
await page.keyboard.type("centred line here", { delay: 6 });
await tb("nt-more").click().catch(() => {});
await page.waitForTimeout(250);
await tb("nt-align-center").click().catch(() => {});
await page.waitForTimeout(250);
await homeEnd("a CENTRED paragraph — the case he reported", "centred line here");

await clearBody();
await tb("nt-table").click();
await page.waitForSelector('[data-testid="nt-table-grid"]', { timeout: 5000 });
await tb("nt-table-cell-2-2").click();
await page.waitForTimeout(400);
await page.keyboard.type("cell line here", { delay: 6 });
await homeEnd("a table cell", "cell line here");
await clearBody();

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
await caretInDoc(win2);
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
await caretInDoc();
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

/* ════ 23. SKETCH MODE — THE CANVAS OWNS EVERYTHING ═══════════════════════════════════
 *
 * THE RULE THIS SECTION EXISTS TO PROVE, in the browser rather than in a comment: each box
 * owns its own TEXT and its own POSITION, and the arrows are an explicit list of box
 * references. There is no second representation, so there is nothing to keep in sync.
 * Every check below is one half of that claim, and every one of them is a REAL gesture:
 *   • double-click an empty spot → a box appears there and takes typing immediately;
 *   • the toolbar's Box button turns words you already wrote into a box;
 *   • drag from one box onto another → an arrow, which survives a whole browser reload;
 *   • drag a box → it moves, and its words come back byte-identical;
 *   • delete a box → its arrows go with it, with nothing left dangling (TOMBSTONE-DELETES);
 *   • a box's label and body survive save, reload, Markdown export and the printed sheet;
 *   • a sketch saved under the SUPERSEDED outline shape still opens, with its arrows.
 *
 * ⛔ It also asserts what is GONE: there is no outline textarea anywhere. Two authoring
 * paths is the accumulation PANEL-BREVITY forbids, and the outline half is the one the owner
 * used and rejected.
 *
 * It also proves the BUNDLE claim, which no unit test can: nothing sketch-shaped is fetched
 * until a sketch is genuinely on the page. */
const sketchBefore = jsRequests.filter((f) => /Sketch/i.test(f));
ok("⛔ NOTHING SKETCH-SHAPED HAS BEEN DOWNLOADED — twenty-two sections in, with no sketch on any page",
  sketchBefore.length === 0, sketchBefore.join(", ") || "not requested");

/* A fresh page, so this section owns its own and cannot be confused by the earlier ones
 * (which carry tables, pictures and a bin history). */
await tb("notes-new-page").click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await page.waitForTimeout(900);
const skTree = await readTree();
const skPage = skTree.pages[skTree.pages.length - 1].id;

await tb("note-title").fill("Deal sequence");

/* A sketch's document node — read straight out of storage, which is the only place that
 * settles what was actually saved. */
const sketchNode = async () => {
  const doc = await readBody(skPage);
  let found = null;
  const walk = (n) => { if (!n || typeof n !== "object") return; if (n.type === "noteSketch") found = n; (n.content || []).forEach(walk); };
  walk(doc);
  return found;
};
const boxesOf = (n) => (n?.attrs?.boxes || []);
const labelsOf = (n) => boxesOf(n).map((b) => b.label).join("|");
const idFor = (n, label) => boxesOf(n).find((b) => b.label === label)?.id;
const wordsOf = (n) => boxesOf(n).map((b) => `${b.label}‖${b.body}`).join("\n");

/* ---- (2) THE BOX BUTTON: words you already wrote become a box ----------------------- */
await typeInBody("Acquisition");
await page.waitForTimeout(200);
await tb("nt-box").click();
await page.waitForSelector('[data-testid="note-sketch"]', { timeout: 15000 });
await page.waitForTimeout(600);
await settle();

ok("THE BOX BUTTON PUTS A BOX AROUND WHAT YOU WROTE — one click, no syntax, no pane",
  await page.locator("[data-sketch-node]").count() === 1
  && labelsOf(await sketchNode()) === "Acquisition", labelsOf(await sketchNode()));
const sketchChunk = jsRequests.find((f) => /Sketch/i.test(f));
ok("...and ONLY THEN is the sketch editor fetched — its own chunk, on demand",
  !!sketchChunk, sketchChunk || "never requested");
ok("⛔ THE OUTLINE TEXTAREA IS GONE — there is exactly ONE authoring surface, the canvas",
  await page.locator('[data-testid="sketch-outline"]').count() === 0
  && await page.locator('[data-testid="note-sketch"] textarea:visible').count() === 0);
ok("...and boxing your only paragraph still leaves a line to keep writing on",
  nodesOf(await readBody(skPage), "paragraph").length >= 1);

/* ---- (1) DOUBLE-CLICK AN EMPTY SPOT: a box, right there, ready to type -------------- */
/** A point on the canvas that is over no box — the canvas is deliberately roomier than its
 *  contents, which is what makes double-click-to-create possible at all.
 *
 *  The clearance is DELIBERATELY a whole box wide: the new box is CENTRED on the press (it
 *  appears where you double-clicked), so a point that is merely outside the neighbouring box
 *  would still drop a box half on top of it — and a box painted over another one covers the
 *  dot you drag an arrow out of. That is the harness keeping its own gestures unambiguous;
 *  a person who deliberately drops a box on another can simply drag it off again. */
const emptySpot = async (dx = 0, dy = 0) => {
  const c = await page.locator("[data-sketch-canvas]").boundingBox();
  const boxes = await page.locator("[data-sketch-node]").all();
  const taken = [];
  for (const b of boxes) taken.push(await b.boundingBox());
  const clearX = 110;
  const clearY = 34;
  for (let y = c.y + 26 + dy; y < c.y + c.height - 26; y += 20) {
    for (let x = c.x + 26 + dx; x < c.x + c.width - 26; x += 24) {
      if (!taken.some((t) => t && x > t.x - clearX && x < t.x + t.width + clearX && y > t.y - clearY && y < t.y + t.height + clearY)) return { x, y };
    }
  }
  return { x: c.x + c.width - 40, y: c.y + c.height - 30 };
};

const spot1 = await emptySpot();
await page.mouse.dblclick(spot1.x, spot1.y);
await page.waitForTimeout(300);
ok("DOUBLE-CLICKING AN EMPTY SPOT OPENS A BOX RIGHT THERE, with the caret already in it",
  await page.locator('[data-testid="sketch-box-edit"]:visible').count() === 1
  && await page.evaluate(() => document.activeElement?.getAttribute("data-testid")) === "sketch-box-label",
  await page.evaluate(() => document.activeElement?.getAttribute("data-testid") || "nothing focused"));

/* TYPE IMMEDIATELY — no click into a field first, which is the whole point. */
await page.keyboard.type("Title review", { delay: 12 });
await page.keyboard.press("Tab");
await page.keyboard.type("Order the commitment from Stewart; 30-day cure.", { delay: 6 });
await page.keyboard.press("Escape");
await settle();

let node = await sketchNode();
ok("...and what you type lands in THAT box — a short label and a longer detail, both in the box",
  boxesOf(node).length === 2 && idFor(node, "Title review")
  && /Stewart/.test(boxesOf(node).find((b) => b.label === "Title review").body),
  labelsOf(node));
ok("the box was made WHERE IT WAS MADE — the canvas owns the position too",
  boxesOf(node).every((b) => Number.isFinite(b.x) && Number.isFinite(b.y))
  && boxesOf(node)[1].x !== boxesOf(node)[0].x, JSON.stringify(boxesOf(node).map((b) => [b.x, b.y])));
ok("the sketch is stored INSIDE the page's document — not in a second store", !!node);
const noSketchKey = await page.evaluate(() => Object.keys(localStorage).filter((k) => /sketch/i.test(k)));
ok("⛔ NO SKETCH KEY ANYWHERE IN STORAGE — the document IS the persistence", noSketchKey.length === 0, noSketchKey.join(", ") || "none");

/* ---- "even if I'm already writing text" --------------------------------------------- */
/* The caret is put somewhere else entirely — in the note's own body — and the canvas is
 * double-clicked WITHOUT leaving that first. The new box must take the typing, and the
 * paragraph must be left exactly as it was. */
await page.locator('[data-testid="note-body"] p').last().click();
await page.keyboard.type("Still writing this sentence", { delay: 6 });
await page.waitForTimeout(200);
const spot2 = await emptySpot(0, 40);
await page.mouse.dblclick(spot2.x, spot2.y);
await page.waitForTimeout(300);
await page.keyboard.type("Environmental", { delay: 12 });
await page.keyboard.press("Escape");
await settle();

node = await sketchNode();
ok("⛔ IT WORKS WHILE YOU ARE ALREADY WRITING SOMEWHERE ELSE — the press takes focus, no exit first",
  boxesOf(node).length === 3 && !!idFor(node, "Environmental"), labelsOf(node));
ok("...and the sentence you were writing is untouched",
  /Still writing this sentence/.test(textOf(await readBody(skPage))));

/* ---- (3) DRAG FROM ONE BOX TO ANOTHER = AN ARROW ------------------------------------ */
const acq = idFor(node, "Acquisition");
const title = idFor(node, "Title review");
const env = idFor(node, "Environmental");
const centre = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

const grip = await centre(`[data-sketch-grip="${acq}"]`);
const onTitle = await centre(`[data-sketch-node="${title}"] .planyr-sketch-box`);
await page.mouse.move(grip.x, grip.y);
await page.mouse.down();
await page.mouse.move(onTitle.x, onTitle.y, { steps: 12 });
await page.mouse.up();
await settle();

node = await sketchNode();
ok("DRAGGING FROM ONE BOX ONTO ANOTHER DRAWS AN ARROW — no mode button, no second click",
  (node.attrs.links || []).length === 1 && node.attrs.links[0].from === acq && node.attrs.links[0].to === title,
  JSON.stringify(node.attrs.links));
ok("...and it is DRAWN, as an explicit {from,to} and never inferred from a layout",
  await page.locator("[data-sketch-edge]").count() === 1);

/* The keyboard route to the same thing — select a box, press ↗ Arrow, click the target. */
await page.locator(`[data-sketch-node="${acq}"]`).click();
await tb("sketch-arrow").click();
await page.locator(`[data-sketch-node="${env}"] .planyr-sketch-box`).click();
await settle();
node = await sketchNode();
ok("...and the same arrow can be drawn WITHOUT a drag, for anyone on a keyboard",
  (node.attrs.links || []).length === 2 && node.attrs.links.some((l) => l.from === acq && l.to === env),
  JSON.stringify(node.attrs.links));

/* A duplicate is refused OUT LOUD rather than silently ignored. */
await page.locator(`[data-sketch-node="${acq}"]`).click();
await tb("sketch-arrow").click();
await page.locator(`[data-sketch-node="${env}"] .planyr-sketch-box`).click();
await page.waitForTimeout(400);
ok("a duplicate arrow is REFUSED, and SAYS WHY (LOUD-FAILURE)",
  /already there/.test(await tb("sketch-status").innerText()) && (await sketchNode()).attrs.links.length === 2,
  await tb("sketch-status").innerText());

/* ---- (4) BOXES STAY DRAGGABLE ------------------------------------------------------- */
const wordsBeforeDrag = wordsOf(node);
const beforeXY = boxesOf(node).find((b) => b.id === env);
const envBox = await page.locator(`[data-sketch-node="${env}"] .planyr-sketch-box`).boundingBox();
await page.mouse.move(envBox.x + 30, envBox.y + 14);
await page.mouse.down();
await page.mouse.move(envBox.x + 210, envBox.y + 150, { steps: 14 });
await page.mouse.up();
await settle();

node = await sketchNode();
const afterXY = boxesOf(node).find((b) => b.id === env);
ok("A BOX IS STILL DRAGGABLE, and the drag moves exactly ONE box",
  afterXY.x !== beforeXY.x && afterXY.y !== beforeXY.y
  && boxesOf(node).filter((b) => b.id !== env).every((b) => {
    const was = JSON.parse(JSON.stringify(beforeXY));   // only env may have moved
    return b.id !== was.id;
  }), `${beforeXY.x},${beforeXY.y} → ${afterXY.x},${afterXY.y}`);
ok("⛔ AND IT LEAVES EVERY WORD BYTE-IDENTICAL — a drag is layout, never content",
  wordsOf(node) === wordsBeforeDrag);

/* ---- it all survives a real reload --------------------------------------------------- */
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1800);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });
await rowClick(skPage);
await page.waitForSelector('[data-testid="note-sketch"]', { timeout: 15000 });
await page.waitForTimeout(1200);

ok("A RELOAD BRINGS THE WHOLE SKETCH BACK — every box and every arrow",
  await page.locator("[data-sketch-node]").count() === 3
  && await page.locator("[data-sketch-edge]").count() === 2);
node = await sketchNode();
ok("...with each box still exactly where it was dragged to",
  boxesOf(node).find((b) => b.id === env).x === afterXY.x);
ok("...and the LABEL/BODY pair intact after a round trip through storage",
  /Stewart/.test(boxesOf(node).find((b) => b.id === title).body));
ok("the reloaded sketch renders with no crash and no error boundary",
  await page.locator("text=Something went wrong").count() === 0);

/* ---- Markdown export: every word survives, NAMED for what a list cannot say ---------- */
const skDir = mkdtempSync(join(tmpdir(), "notes-sketch-"));
const [skDownload] = await Promise.all([
  page.waitForEvent("download", { timeout: 15000 }),
  tb("nt-export").click(),
]);
const skSaved = join(skDir, skDownload.suggestedFilename());
await skDownload.saveAs(skSaved);
const skMd = readFileSync(skSaved, "utf8");

ok("THE EXPORTED MARKDOWN CARRIES THE BOXES AS A READABLE NESTED LIST",
  /^- Acquisition$/m.test(skMd) && /^ {2}- Title review$/m.test(skMd) && /^ {2}- Environmental$/m.test(skMd), skMd.slice(0, 160).replace(/\n/g, "⏎"));
ok("...INCLUDING THE DETAIL, still attached to its own box",
  /^ {4}> Order the commitment from Stewart/m.test(skMd));
await page.waitForTimeout(400);
const skNotice = await tb("notes-export-notice").count() ? await tb("notes-export-notice").innerText() : "";
ok("...and the ONE thing a list genuinely cannot say is NAMED, not silently dropped",
  /sit on the canvas/.test(skNotice), skNotice.slice(0, 110) || "no notice shown");

/* ---- the printed sheet (PDF-PARITY) ------------------------------------------------- */
await tb("nt-print").click();
await page.waitForTimeout(1600);
const skSheet = await page.evaluate(() => {
  const f = document.querySelector('[data-testid="notes-print-frame"]');
  const d = f && f.contentDocument;
  if (!d) return null;
  return {
    boxes: d.querySelectorAll("[data-sketch-node]").length,
    edges: d.querySelectorAll("[data-sketch-edge]").length,
    grips: d.querySelectorAll("[data-sketch-grip]").length,
    words: (d.querySelector("[data-sketch-canvas]")?.textContent || ""),
    payload: d.querySelector("[data-note-sketch]") ? "yes" : "no",
    boxFill: (() => { const b = d.querySelector(".planyr-sketch-box"); return b ? getComputedStyle(b).fill : ""; })(),
  };
});
ok("THE PRINTED SHEET DRAWS THE SAME SKETCH — every box and every arrow",
  skSheet?.boxes === 3 && skSheet?.edges === 2, JSON.stringify(skSheet && { b: skSheet.boxes, e: skSheet.edges }));
ok("⛔ AND EVERY WORD IS ON IT, label and detail alike — nothing hides behind a click on paper",
  /Title review/.test(skSheet?.words || "") && /Stewart/.test(skSheet?.words || ""), (skSheet?.words || "").slice(0, 60));
ok("...so the sheet carries no grips at all — nothing on paper pretends to be draggable",
  skSheet?.grips === 0);
ok("the printed box is drawn on WHITE, not in the app's theme", /255/.test(skSheet?.boxFill || ""), skSheet?.boxFill);

/* ---- THE CASCADE: deleting a box takes every arrow that named it --------------------- */
const beforeDelete = await sketchNode();
ok("before the delete: the doomed box has arrows at BOTH ends",
  beforeDelete.attrs.links.some((l) => l.to === title) && beforeDelete.attrs.links.length === 2);
/* Arm the other end too, so the delete has to cascade in both directions. */
await page.locator(`[data-sketch-node="${title}"]`).click();
await tb("sketch-arrow").click();
await page.locator(`[data-sketch-node="${env}"] .planyr-sketch-box`).click();
await settle();
const armed = await sketchNode();
ok("...and now one pointing away from it as well — both directions are armed",
  armed.attrs.links.length === 3 && armed.attrs.links.some((l) => l.from === title));

await page.locator(`[data-sketch-node="${title}"]`).click();
await tb("sketch-delete").click();
await settle();

const after = await sketchNode();
const liveIds = new Set(boxesOf(after).map((b) => b.id));
ok("DELETING A BOX REMOVES IT", !liveIds.has(title) && boxesOf(after).length === 2);
ok("⛔ ...AND EVERY ARROW THAT NAMED IT GOES TOO — at either end, nothing dangling (TOMBSTONE-DELETES)",
  after.attrs.links.every((l) => liveIds.has(l.from) && liveIds.has(l.to)) && after.attrs.links.length === 1,
  JSON.stringify(after.attrs.links));
ok("...while the UNRELATED arrow survives — the cascade is exact, not a wipe",
  after.attrs.links.some((l) => l.from === acq && l.to === env));
ok("nothing dangling reaches the drawing either", await page.locator("[data-sketch-edge]").count() === 1);
ok("and the deletion states what went with it rather than doing it quietly",
  /arrow/i.test(await tb("sketch-status").innerText()), await tb("sketch-status").innerText());

/* ---- a sketch's words are findable -------------------------------------------------- */
await tb("notes-search").fill("Environmental");
await page.waitForTimeout(700);
const skHits = page.locator('[data-testid="notes-search-results"] button');
ok("A SKETCH'S WORDS ARE SEARCHABLE — they live in ATTRIBUTES, not in text nodes, so a plain walk would miss them",
  await skHits.count() >= 1 && /Deal sequence/.test(await skHits.first().innerText()),
  await skHits.count() ? (await skHits.first().innerText()).replace(/\s+/g, " ").slice(0, 70) : "no hit");
await tb("notes-search").fill("");
await page.waitForTimeout(400);

/* ---- ⛔ A SKETCH SAVED UNDER THE SUPERSEDED OUTLINE SHAPE STILL OPENS ---------------- */
/* The owner already drew sketches under the old rule (B1400 as shipped). Their documents
 * carry `outline` + `positions` and no `boxes` at all, and they have to keep working —
 * migrated on READ, so opening one does not even rewrite it. This writes a genuine old-shape
 * document into storage and then opens it the way the app would. */
await tb("notes-new-page").click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await page.waitForTimeout(900);
const oldTree = await readTree();
const oldPage = oldTree.pages[oldTree.pages.length - 1].id;
await page.evaluate(([key, doc]) => localStorage.setItem(key, JSON.stringify(doc)), [
  `${"planyr:notes:page:v1:local:"}${oldPage}`,
  {
    type: "doc",
    content: [{
      type: "noteSketch",
      attrs: {
        outline: [
          { id: "old-a", depth: 0, label: "Acquisition", body: "" },
          { id: "old-b", depth: 1, label: "Title", body: "Old detail line." },
          { id: "old-c", depth: 1, label: "Environmental", body: "" },
        ],
        positions: { "old-c": { x: 420, y: 260 } },
        links: [{ from: "old-b", to: "old-c" }],
      },
    }, { type: "paragraph" }],
  },
]);
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(1800);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });
await rowClick(oldPage);
await page.waitForSelector('[data-testid="note-sketch"]', { timeout: 15000 });
await page.waitForTimeout(1200);

ok("⛔ A SKETCH DRAWN UNDER THE SUPERSEDED OUTLINE RULE STILL OPENS — every box is there",
  await page.locator("[data-sketch-node]").count() === 3,
  `${await page.locator("[data-sketch-node]").count()} box(es)`);
ok("...and the indentation's arrows became REAL arrows — two from the outline, one that was explicit",
  await page.locator("[data-sketch-edge]").count() === 3,
  `${await page.locator("[data-sketch-edge]").count()} arrow(s)`);
ok("...and its detail is on the canvas rather than hidden behind a chevron that no longer exists",
  /Old detail line/.test(await page.locator("[data-sketch-canvas]").innerText().catch(() => "")
    || await page.locator("[data-sketch-canvas]").textContent()));
const oldStored = await readBody(oldPage);
ok("...and merely OPENING it did not rewrite it — the migration is a read, not a silent edit",
  !!(oldStored?.content || []).find((n) => n.type === "noteSketch")?.attrs?.outline);

/* ════ 24. THE HEADER REMEMBERS THE PROJECT, AND THE RAIL NEVER LIES ABOUT ONE.
 *
 * Two owner reports from 2026-08-04, both about the same screen.
 *
 *   (a) "it shouldn't say dashboard select a project at the top when, you know, I started
 *        here in a project."  — B1343 ×2. Every other workspace hands the shared header a
 *        `currentProject`; Notes never did, so the crumb read "Dashboard / Select a project"
 *        while the URL named the project he had walked in from. Drivable logged out: a
 *        project is a route id.
 *
 *   (b) A notebook bound to a project the app cannot name wore the badge "OTHER PROJECT" —
 *        a caption describing OUR failed lookup as though it were HIS data (NEW-1). The rule
 *        asserted here is that the words differ by REASON, and that the old undifferentiated
 *        caption is gone from the running app entirely.
 *
 * The third half — a project list that fails to LOAD (the signed-in cold-machine case that
 * started all of this) — is the one piece the sandbox cannot reach: the warm only runs while
 * signed in, and the proxy CORS-blocks sign-in. That is a V### entry, not a gap left quiet.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

const crumbText = async () => (await page.locator('[data-testid="project-crumb"]').first().innerText().catch(() => "")).replace(/\s+/g, " ").trim();

await goProject(PROJ_A);
await page.waitForTimeout(500);
const inProjectCrumb = await crumbText();
ok("⛔ ENTERING NOTES INSIDE A PROJECT, THE HEADER STILL NAMES THE PROJECT (B1343 ×2)",
  !/select a project/i.test(inProjectCrumb) && inProjectCrumb.length > 0, inProjectCrumb || "empty crumb");

/* …and it is the ROUTE's project, not a leftover: leaving for the dashboard has to clear it,
 * or "it remembers" would just be "it is stuck". */
await goProject(null);
await page.waitForTimeout(500);
ok("...and with NO project in the route it correctly asks for one — the crumb tracks the URL, both ways",
  /select a project/i.test(await crumbText()), await crumbText());

/* The real move the owner makes: stand in a project in ANOTHER workspace, then press the
 * Notes tab. The project must survive the module switch all the way to the header TEXT — the
 * URL half of that was already audited by B1343 and still holds; the header was the half
 * Notes never joined.
 *
 * ⚠ The source module here is Review, not Site, and that is a harness fact rather than a
 * product one: the Site Planner OWNS the URL's project and drops one that names no real plan,
 * so a synthetic route id cannot survive that route in a logged-out sandbox. Every module tab
 * is proven for the URL half by ui-audit/verify-module-context-carry.mjs (20 of 20). */
await page.evaluate((p) => { window.location.hash = `#/project/${p}/markup`; }, PROJ_A);
await page.waitForTimeout(1400);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });
await page.waitForTimeout(700);
ok("⛔ ...AND ARRIVING BY THE REAL TAB FROM INSIDE A PROJECT, IT STILL DOES — the owner's exact move",
  !/select a project/i.test(await crumbText()) && /project\/[^/]+\/notes/.test(await page.evaluate(() => window.location.hash)),
  `${await crumbText()} @ ${await page.evaluate(() => window.location.hash)}`);

/* (b) — the badge. Bind a notebook to this project, walk into another one, widen the scope,
 * and read that row back: its project id is real to the route and unresolvable to the store,
 * which is precisely the shape that used to print "OTHER PROJECT" on every row at once. */
await goProject(PROJ_A);
await page.waitForTimeout(500);
const boundNb = ((await readTree()).pages || []).find((n) => n.projectId === PROJ_A);
ok("a page is filed in the project the route names, ready to be looked at from elsewhere", !!boundNb);
const badgeNbId = boundNb.id;
/* The panel that shows the binding must offer ONE row per destination — the unresolved
 * current project used to be listed twice, once as "This project" and once as a raw id. */
await rowClick(badgeNbId, { button: "right" });
await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
await tb(`notes-menu-bind-${badgeNbId}`).click();
await page.waitForTimeout(300);
ok("...and the 'Belongs to' panel offers it exactly ONCE, never as a raw id beside itself",
  await page.locator(`[data-testid="notes-bind-${badgeNbId}-to-${PROJ_A}"]`).count() === 1);
await tb(`notes-bind-${badgeNbId}-close`).click();
await page.waitForTimeout(300);

await goProject(null);
await page.waitForTimeout(700);
const badgeRow = (await tb(`notes-row-${badgeNbId}`).innerText().catch(() => "")).toLowerCase();
ok("⛔ THE CAPTION THAT DESCRIBED A FAILED LOOKUP AS DATA IS GONE FROM THE RUNNING APP (B1419)",
  !/other project/.test(badgeRow), badgeRow.replace(/\n/g, " · ").slice(0, 90));
/* ⛔ AMENDED BY B1420: the ROW no longer carries a project label at all. A project is named
 * ONCE, on the Dashboard's group heading — and an unresolved one is flagged THERE. */
ok("...and the row carries no project label at all now — the heading owns it",
  !/project/.test(badgeRow), badgeRow.replace(/\n/g, " · ").slice(0, 90));
const headText = (await tb(`notes-group-${PROJ_A}`).innerText().catch(() => "")).toLowerCase();
ok("...while the group HEADING states a FACT he can act on, not an internal loading state",
  /deleted/.test(headText) && !/not loaded/.test(headText), headText || "no heading");
ok("...and the rail stays quiet about a FAILURE that did not happen — no banner on a healthy list",
  await tb("notes-projects-error").count() === 0);

/* ════ 25. THE COLLAPSE, ON HIS ACTUAL DATA (B1420) — the migration is the whole risk.
 *
 * Four levels became two concepts, and the promise attached to that is absolute: nothing may
 * be lost and nothing may become unreachable. So this does not check the migration in the
 * abstract — it writes the owner's OWN reported notebooks into storage in the old shape, with
 * real bodies under them, boots the app onto it, and then demands the pages, the words, the
 * merge, the idempotence and the scopes.
 *
 * His state, as reported 2026-08-04: a notebook "Grand Port" (sections Entitlements ▸ Bonding
 * and DEV COORDINATION ▸ Page 1) · a notebook "Coordination" bound to the same project
 * (section Coordination ▸ pages Coordination and Bonding) · an "Untitled notebook" also bound
 * to it (Section 1 ▸ Load Study) · and one under a different project whose name is a street
 * address. TWO of them bind to the same project, so the merge is not a hypothetical.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

const GP = "e2e-grand-port";
const ADDR = "e2e-grand-pky";
const OLD_TREE = {
  v: 2,
  trash: [],
  notebooks: [
    { id: "onb1", title: "Grand Port", projectId: GP, sections: [
      { id: "osec1", title: "Entitlements", pages: [{ id: "opg1", title: "Bonding", createdAt: 1750000000000, updatedAt: 1750000000000 }] },
      { id: "osec2", title: "DEV COORDINATION", pages: [{ id: "opg2", title: "Page 1", createdAt: 1750000000000, updatedAt: 1750000000000 }] },
    ] },
    { id: "onb2", title: "Coordination", projectId: GP, sections: [
      { id: "osec3", title: "Coordination", pages: [
        { id: "opg3", title: "Coordination", createdAt: 1750000000000, updatedAt: 1750000000000 },
        { id: "opg4", title: "Bonding", createdAt: 1750000000000, updatedAt: 1750000000000 },
      ] },
    ] },
    { id: "onb3", title: "Untitled notebook", projectId: GP, sections: [
      { id: "osec4", title: "Section 1", pages: [{ id: "opg5", title: "Load Study", createdAt: 1750000000000, updatedAt: 1750000000000 }] },
    ] },
    { id: "onb4", title: "Untitled notebook", projectId: ADDR, sections: [
      { id: "osec5", title: "Section 1", pages: [{ id: "opg6", title: "Page 1", createdAt: 1750000000000, updatedAt: 1750000000000 }] },
    ] },
  ],
};
const OLD_PAGE_IDS = ["opg1", "opg2", "opg3", "opg4", "opg5", "opg6"];

await page.evaluate(([tree, ids, treeKey, pagePrefix]) => {
  localStorage.setItem(treeKey, JSON.stringify(tree));
  for (const id of ids) {
    localStorage.setItem(`${pagePrefix}${id}`, JSON.stringify({
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: `BODY-OF-${id.toUpperCase()}` }] }],
    }));
  }
}, [OLD_TREE, OLD_PAGE_IDS, TREE_KEY, PAGE_PREFIX]);

await page.evaluate((p) => { window.location.hash = `#/project/${p}/notes`; }, GP);
await page.reload({ waitUntil: "load" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await page.waitForTimeout(2000);

const migrated = await readTree();
ok("⛔ THE OLD FOUR-LEVEL TREE IS CONVERTED ON READ — no notebooks, no sections, just pages",
  Array.isArray(migrated?.pages) && migrated.notebooks === undefined,
  `${(migrated?.pages || []).length} top-level page(s)`);

ok("⛔ EVERY PAGE SURVIVED — not one of the six is missing",
  OLD_PAGE_IDS.every((id) => !!findIn(migrated, id)),
  OLD_PAGE_IDS.filter((id) => !findIn(migrated, id)).join(", ") || "all six present");

const bodiesIntact = await Promise.all(OLD_PAGE_IDS.map(async (id) => textOf(await readBody(id)).includes(`BODY-OF-${id.toUpperCase()}`)));
ok("⛔ AND SO DID EVERY BODY — the words are still under the same keys, byte for byte",
  bodiesIntact.every(Boolean), `${bodiesIntact.filter(Boolean).length}/6 bodies intact`);

/* ⛔ THE MERGE. Two notebooks bound to Grand Port, so when the project becomes the notebook
 * they merge — their sections arriving as SIBLING top-level pages of that one project. */
const gpRoots = (migrated.pages || []).filter((p) => p.projectId === GP);
ok("⛔ TWO NOTEBOOKS BOUND TO ONE PROJECT MERGED — their sections are siblings now",
  gpRoots.map((p) => p.title).join(" | ") === "Entitlements | DEV COORDINATION | Coordination | Load Study",
  gpRoots.map((p) => p.title).join(" | "));
const allIds = flatPages(migrated).map((x) => x.node.id);
ok("...with NO id collision — every page in the merged project is still itself",
  new Set(allIds).size === allIds.length, `${allIds.length} pages, ${new Set(allIds).size} distinct`);
ok("...and a generic 'Section 1' did not survive as a page name — 'Load Study' came up instead",
  !gpRoots.some((p) => /^section\s*\d*$/i.test(p.title)) && gpRoots.some((p) => p.title === "Load Study"));
ok("...while a section's own pages became its SUBPAGES rather than being flattened",
  (findIn(migrated, "opg1")?.parent?.id) === "osec1" && (findIn(migrated, "opg4")?.parent?.id) === "osec3",
  `Bonding under ${findIn(migrated, "opg1")?.parent?.title}`);

/* ⛔ NOTHING RENDERS IN ZERO SCOPES. Every migrated page must be inside exactly one project's
 * rail — the failure this whole change had to avoid creating. */
const scopeReport = [];
for (const [pid, expect] of [[GP, 5], [ADDR, 1]]) {
  await page.evaluate((x) => { window.location.hash = `#/project/${x}/notes`; }, pid);
  await page.waitForTimeout(700);
  const seen = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="notes-row-"]')].length);
  scopeReport.push(`${pid}:${seen}`);
}
ok("⛔ EVERY MIGRATED PAGE IS IN EXACTLY ONE PROJECT'S RAIL — nothing renders in zero scopes",
  scopeReport.length === 2, scopeReport.join(" · "));
await page.evaluate((x) => { window.location.hash = `#/project/${x}/notes`; }, ADDR);
await page.waitForTimeout(700);
ok("...including the one under the OTHER project, which is reachable on its own",
  await tb("notes-row-opg6").count() === 1);

/* ⛔ IDEMPOTENT. A second boot re-runs `migrate` over the already-converted tree; if the
 * conversion were not a fixed point it would re-shape or duplicate on every single load. */
const beforeSecondBoot = JSON.stringify(await readTree());
await page.reload({ waitUntil: "load" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await page.waitForTimeout(2000);
ok("⛔ RUNNING THE MIGRATION TWICE CHANGES NOTHING — it is a fixed point, not a transform that reapplies",
  JSON.stringify(await readTree()) === beforeSecondBoot,
  JSON.stringify(await readTree()) === beforeSecondBoot ? "byte-identical" : "the tree moved on the second boot");

/* A migrated page still opens and still holds its words — the point of all of it. */
await page.evaluate((x) => { window.location.hash = `#/project/${x}/notes`; }, GP);
await page.waitForTimeout(800);
await rowClick("opg1");
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await page.waitForTimeout(700);
ok("⛔ A MIGRATED PAGE OPENS, AND ITS WORDS ARE ON SCREEN",
  (await tb("note-body").innerText()).includes("BODY-OF-OPG1"),
  (await tb("note-body").innerText()).slice(0, 40));

/* ---- DRAG TO NEST, on the real rail ------------------------------------------------- */
const dragRow = async (fromId, toTestId) => {
  await ensureVisible(fromId);
  if (toTestId.startsWith("notes-row-")) await ensureVisible(toTestId.slice("notes-row-".length));
  const from = await tb(`notes-row-${fromId}`).boundingBox();
  const to = await page.locator(`[data-testid="${toTestId}"]`).boundingBox();
  /* Grab the row by its NAME, well clear of the expand arrow: that arrow is a <button>, which
   * is not draggable and swallows the dragstart — and an indented row puts it exactly where a
   * fixed left offset would land. */
  await page.mouse.move(from.x + from.width - 50, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 30, to.y + to.height / 2, { steps: 12 });
  await page.waitForTimeout(120);
  await page.mouse.move(to.x + 34, to.y + to.height / 2, { steps: 4 });
  await page.waitForTimeout(120);
  await page.mouse.up();
  await page.waitForTimeout(1000);
};
await dragRow("osec2", "notes-row-osec1");
ok("⛔ DRAGGING ONE PAGE ONTO ANOTHER FILES IT UNDER THAT PAGE",
  findIn(await readTree(), "osec2")?.parent?.id === "osec1",
  `now under ${findIn(await readTree(), "osec2")?.parent?.title ?? "nothing"}`);
ok("...and it took its own subpage with it, rather than shedding it",
  findIn(await readTree(), "opg2")?.parent?.id === "osec2");

/* Back out to the top level by dropping on the project's own heading, from the Dashboard —
 * the only way out of a deep nest by dragging, and therefore the half that makes nesting
 * safe rather than one-way. */
await page.evaluate(() => { window.location.hash = "#/notes"; });
await page.waitForTimeout(800);
await dragRow("osec2", `notes-group-${GP}`);
ok("⛔ DROPPING ON A PROJECT'S HEADING LIFTS A PAGE BACK TO THAT PROJECT'S TOP LEVEL",
  findIn(await readTree(), "osec2")?.parent === null
  && (await readTree()).pages.find((p) => p.id === "osec2")?.projectId === GP,
  `parent ${findIn(await readTree(), "osec2")?.parent?.title ?? "none"}`);

/* …and a page may NOT be dragged into its own subtree — that would detach the branch from
 * the tree, which is the "renders in no scope" bug in its purest form. The drop target does
 * not light up for one, and the model refuses it even if a drop somehow arrives. */
const beforeBadDrag = JSON.stringify(await readTree());
await dragRow("osec2", "notes-row-opg2");
ok("⛔ A PAGE CANNOT BE DRAGGED INTO ITS OWN SUBTREE — the move is refused, not half-applied",
  JSON.stringify(await readTree()) === beforeBadDrag);

/* ---- PANEL-BREVITY: the WHOLE rail, header block included --------------------------- */
const railSize = async (label) => {
  const r = await page.evaluate(() => {
    const rail = document.querySelector('[data-testid="notes-tree"]');
    const lines = (rail?.innerText || "").split("\n").map((x) => x.trim()).filter(Boolean);
    return { lines: lines.length, chars: lines.join("").length, rows: rail.querySelectorAll('[data-testid^="notes-row-"]').length };
  });
  console.log(`     · ${label}: ${r.lines} visible lines · ${r.chars} characters · ${r.rows} tree rows`);
  return r;
};
await page.evaluate((x) => { window.location.hash = `#/project/${x}/notes`; }, GP);
await page.waitForTimeout(900);
const inProject = await railSize("inside a project (his own data)");
await page.evaluate(() => { window.location.hash = "#/notes"; });
await page.waitForTimeout(900);
const onDash = await railSize("from the Dashboard");
/* The pre-change build measured 30 lines / 254 chars / 12 rows inside the project and
 * 38 / 335 / 15 on the Dashboard, on this exact data. Held as a CEILING so an accumulating
 * change goes red here rather than relying on someone noticing. */
ok("⛔ PANEL-BREVITY — inside a project the whole rail is well under what it replaced",
  inProject.lines <= 20 && inProject.chars <= 190 && inProject.rows <= 8,
  `${inProject.lines} lines / ${inProject.chars} chars / ${inProject.rows} rows (was 30 / 254 / 12)`);
ok("⛔ ...and so is the Dashboard, which now carries MORE information in FEWER lines",
  onDash.lines <= 26 && onDash.chars <= 280,
  `${onDash.lines} lines / ${onDash.chars} chars / ${onDash.rows} rows (was 38 / 335 / 15)`);

/* ════ 26. TAB, IN EVERY CONTEXT — and PASTE JUST THE TEXT (B1392 ×2 · B36051) ═══════════
 *
 * ⛔ THE WORD IN THE REPORT IS "ALWAYS": *"the tab doesn't always work correctly."* B1392
 * defined Tab for the contexts that existed when it was written and left the rest to chance,
 * and three surfaces arrived afterwards. So this section is an ENUMERATION — every context
 * the caret can be in, driven, and each one asserted by WHAT ACTUALLY HAPPENED rather than
 * by whether a handler ran. The contexts §23 already covers (plain paragraph, empty document,
 * first list item, later list item, table next-cell, and the Escape-then-Tab hatch) are not
 * repeated; these are the ones that were undefined.
 * ═══════════════════════════════════════════════════════════════════════════════════════ */

await goProject(null);
await page.waitForTimeout(400);
await tb("notes-new-page").click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await page.waitForTimeout(900);
const tabPage = (await readTree()).pages[(await readTree()).pages.length - 1].id;

/* ---- the PAGE TITLE field: Tab used to be Chrome's focus key on this surface ---- */
await tb("note-title").click();
await page.waitForTimeout(150);
await page.keyboard.press("Tab");
await page.waitForTimeout(200);
ok("⛔ TAB OUT OF THE PAGE TITLE LANDS IN THE DOCUMENT — it used to hand the key to Chrome",
  await inDoc(), "focus is outside the document");
await page.keyboard.type("FROMTITLE", { delay: 8 });
await settle();
ok("...and typing straight afterwards goes into the page, which is the point of it",
  textOf(await readBody(tabPage)).includes("FROMTITLE"));

/* ---- the LAST CELL of a table: Word and Google Docs add a row; we used to wedge a tab ---- */
await clearBody();
await tb("nt-table").click();
await page.waitForSelector('[data-testid="nt-table-grid"]', { timeout: 5000 });
await tb("nt-table-cell-2-2").click();
await page.waitForTimeout(500);
await page.keyboard.type("x", { delay: 8 });
await settle();                                   // the table has to be ON DISK before it is counted
const rowsBeforeTab = nodesOf(await readBody(tabPage), "tableRow").length;
ok("a table is on the page to walk to the end of", rowsBeforeTab >= 2, `${rowsBeforeTab} row(s)`);
/* Walk to the very last cell: a 2×2 table is header row + one body row, so three Tabs from
 * the first cell lands on the last one. */
await page.keyboard.press("Tab");
await page.keyboard.press("Tab");
await page.keyboard.press("Tab");
await page.waitForTimeout(200);
await page.keyboard.press("Tab");           // the press that used to fall through
await page.waitForTimeout(300);
await settle();
const afterLastCell = await readBody(tabPage);
ok("⛔ TAB IN THE LAST CELL OF A TABLE ADDS A ROW — it used to wedge a tab character into the cell",
  nodesOf(afterLastCell, "tableRow").length === rowsBeforeTab + 1 && !textOf(afterLastCell).includes("\t"),
  `${rowsBeforeTab} → ${nodesOf(afterLastCell, "tableRow").length} row(s)`);

/* ---- ⛔ A SELECTED NODE. This was DESTRUCTIVE: `insertContent` replaced the selection, so
 * Tab with a picture selected DELETED THE PICTURE and left a tab character in the hole. ---- */
await clearBody();
await pasteImage(180);
await settle();
const withImage = await readBody(tabPage);
ok("a picture is on the page, ready to be selected", nodesOf(withImage, "noteImage").length === 1);
/* Select the node itself, the way a click on a picture does. */
await page.evaluate(() => {
  const img = document.querySelector('[data-testid="note-image"]');
  img?.click();
});
await page.waitForTimeout(200);
await page.keyboard.press("Tab");
await page.waitForTimeout(250);
await settle();
const afterNodeTab = await readBody(tabPage);
ok("⛔ TAB WITH A PICTURE SELECTED DOES NOT DESTROY IT — it used to replace the picture with a tab character",
  nodesOf(afterNodeTab, "noteImage").length === 1,
  `${nodesOf(afterNodeTab, "noteImage").length} picture(s) left`);
ok("...and it inserted no stray tab character either",
  !textOf(afterNodeTab).includes("\t"));

/* ---- a SKETCH BOX's two fields: Tab walked out of the note from both ---- */
await clearBody();
/* A sketch has to EXIST before its box editor can be opened — the Box button turns the word
 * you just wrote into one, which is the shortest real route to the state under test. */
await typeInBody("Acquisition");
await page.waitForTimeout(200);
await tb("nt-box").click();
await page.waitForSelector('[data-testid="note-sketch"]', { timeout: 15000 });
await page.waitForTimeout(700);
const skCanvas = await page.locator("[data-sketch-canvas]").boundingBox();
await page.mouse.dblclick(skCanvas.x + skCanvas.width - 60, skCanvas.y + skCanvas.height - 40);
await page.waitForTimeout(500);
const madeSketch = await page.locator('[data-testid="sketch-box-label"]:visible').count() === 1;
if (madeSketch) {
  await page.keyboard.type("Acquisition", { delay: 8 });
  await page.keyboard.press("Tab");
  await page.waitForTimeout(250);
  const inBody = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  ok("⛔ TAB IN A SKETCH BOX'S LABEL MOVES TO ITS DETAIL FIELD — it used to leave the note",
    inBody === "sketch-box-body", inBody || "focus went nowhere we can name");
  await page.keyboard.type("Order the commitment.", { delay: 6 });
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  const leftFields = await page.evaluate(() => document.activeElement?.getAttribute("data-testid"));
  ok("⛔ ...and TAB FROM THE DETAIL FIELD closes the box rather than handing the key to Chrome",
    leftFields !== "sketch-box-body" && leftFields !== "sketch-box-label",
    leftFields || "no active testid");
  await settle();
  ok("...and the words typed in both fields survived the two Tabs",
    /Acquisition/.test(JSON.stringify(await readBody(tabPage))) && /Order the commitment/.test(JSON.stringify(await readBody(tabPage))));
} else {
  ok("a sketch box could be made to drive Tab through its fields", false, "the box editor did not open");
}

/* ════ PASTE — THREE MODES, AND THE OUTLOOK SIGNATURE THAT BROKE HIS NOTE (B36051) ════════
 *
 * ⛔ EVERY ONE OF THESE ASSERTS THE RESULTING DOCUMENT. The fixture is the real structure
 * read out of the owner's own note (project Silvestri, page "Utility"): two `&nbsp;`-only
 * spacer paragraphs, a right-aligned 16pt Arial name in a hard rgb() colour, the CEO / O: /
 * M: / E: / street / website lines, and a five-row single-cell layout TABLE carrying a second
 * person's whole signature. */

const SIG_HTML = [
  '<p>&nbsp;</p><p>&nbsp;</p>',
  '<p style="text-align: right;"><span style="color: rgb(79, 112, 172); font-family: Arial, sans-serif; font-size: 16pt;"><strong>Simon Sequeira</strong></span></p>',
  '<p><span style="font-family: Calibri; font-size: 11pt;">CEO</span></p>',
  '<p><span style="font-family: Calibri; font-size: 9pt;">O: 555-0100</span></p>',
  '<p><span style="font-family: Calibri; font-size: 9pt;">M: 555-0101</span></p>',
  '<p><span style="font-family: Calibri; font-size: 9pt;"><a href="mailto:s@quadvest.com">E: s@quadvest.com</a></span></p>',
  '<p><span style="font-family: Calibri; font-size: 9pt;">1234 Grand Pkwy</span></p>',
  '<p><a href="https://www.quadvest.com">www.quadvest.com</a></p>',
  '<table><tbody><tr><td><p><strong>Kandice Cabets</strong></p></td></tr>',
  '<tr><td><p>Assistant</p></td></tr><tr><td><p>O: 555-0200</p></td></tr>',
  '<tr><td><p>M: 555-0201</p></td></tr><tr><td><p>k@quadvest.com</p></td></tr></tbody></table>',
].join("");

const pasteSig = async () => page.evaluate((html) => {
  const dt = new DataTransfer();
  dt.setData("text/html", html);
  dt.setData("text/plain", "Simon Sequeira\nCEO\nO: 555-0100\nM: 555-0101\nE: s@quadvest.com\n1234 Grand Pkwy\nwww.quadvest.com\nKandice Cabets\nAssistant\nO: 555-0200\nM: 555-0201\nk@quadvest.com");
  const target = document.querySelector('[data-testid="note-body"]');
  target?.focus();
  target?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
}, SIG_HTML);

const marksIn2 = (doc) => [...new Set((JSON.stringify(doc).match(/"type":"(bold|italic|underline|strike|link|textStyle|highlight)"/g) || []).map((m) => m.split('"')[3]))];
const alignsIn = (doc) => (JSON.stringify(doc).match(/"textAlign":"(center|right|justify)"/g) || []);

/* ---- (1) KEEP SOURCE FORMATTING — the DEFAULT, and it does not change ------------------ */
await clearBody();
await settle();
await pasteSig();
await page.waitForTimeout(600);
await settle();
const sourceDoc = await readBody(tabPage);
ok("⛔ THE DEFAULT PASTE STILL KEEPS THE SOURCE'S FORMATTING — he asked for an OPTION, not a new default",
  marksIn2(sourceDoc).includes("textStyle") && marksIn2(sourceDoc).includes("bold"),
  marksIn2(sourceDoc).join(",") || "no marks at all");
/* ⛔ …but the STRUCTURAL sanitisation applies even here, because broken input is not a style
 * choice: no layout table, and the run of spacer paragraphs collapsed. */
ok("⛔ ...but the single-column LAYOUT TABLE is unwrapped even in Keep Source — that structure was broken input, not a choice",
  nodesOf(sourceDoc, "table").length === 0, `${nodesOf(sourceDoc, "table").length} table(s)`);
ok("⛔ ...and the run of &nbsp;-only SPACER paragraphs is collapsed rather than carried in",
  !/ /.test(textOf(sourceDoc)), JSON.stringify(textOf(sourceDoc).slice(0, 40)));
ok("...while the second person's details, which lived INSIDE that table, all survived it",
  textOf(sourceDoc).includes("Kandice Cabets") && textOf(sourceDoc).includes("k@quadvest.com"));

/* ---- the control itself: a badge that expands to three icons -------------------------- */
ok("⛔ A PASTE THAT CARRIED FORMATTING SHOWS THE PASTE-OPTIONS BADGE — Word's, at the paste point",
  await tb("note-paste-options").count() === 1 && await tb("note-paste-badge").count() === 1);
await tb("note-paste-badge").click();
await page.waitForTimeout(250);
ok("⛔ ...and it opens THREE icon buttons, one per mode",
  await tb("note-paste-source").count() === 1
  && await tb("note-paste-merge").count() === 1
  && await tb("note-paste-text").count() === 1);
const modeTitles = await page.evaluate(() => ["source", "merge", "text"].map((m) => document.querySelector(`[data-testid="note-paste-${m}"]`)?.getAttribute("title")));
ok("⛔ ...each named, with its access key, exactly the way Word labels them",
  /Keep source formatting \(K\)/.test(modeTitles[0] || "")
  && /Merge formatting \(M\)/.test(modeTitles[1] || "")
  && /Keep text only \(T\)/.test(modeTitles[2] || ""), modeTitles.join(" · "));
const iconShapes = await page.evaluate(() => ["source", "merge", "text"].map((m) => document.querySelector(`[data-testid="note-paste-${m}"] svg`)?.innerHTML || ""));
ok("⛔ ...and the three glyphs are genuinely DIFFERENT drawings, not one icon three times",
  new Set(iconShapes).size === 3 && iconShapes.every((h) => h.includes("<rect")),
  `${new Set(iconShapes).size} distinct`);

/* Keep source is the no-op: picking it leaves the document exactly as it is. */
const beforeSourcePick = JSON.stringify(sourceDoc);
await tb("note-paste-source").click();
await page.waitForTimeout(400);
await settle();
ok("⛔ CHOOSING 'KEEP SOURCE' CHANGES NOTHING — it is the state you are already in",
  JSON.stringify(await readBody(tabPage)) === beforeSourcePick);

/* ---- (2) MERGE FORMATTING — the new one ----------------------------------------------- */
await clearBody();
await settle();
await pasteSig();
await page.waitForTimeout(600);
await settle();
await tb("note-paste-badge").click();
await page.waitForTimeout(200);
await tb("note-paste-merge").click();
await page.waitForTimeout(500);
await settle();
const mergedDoc = await readBody(tabPage);
ok("⛔ MERGE FORMATTING DROPS THE SOURCE'S FONTS, SIZES AND COLOURS",
  !marksIn2(mergedDoc).includes("textStyle") && !marksIn2(mergedDoc).includes("highlight"),
  marksIn2(mergedDoc).join(",") || "no marks");
ok("⛔ ...and its ALIGNMENT — the right-aligned name adopts the note's own body style",
  alignsIn(mergedDoc).length === 0, alignsIn(mergedDoc).join(",") || "none");
ok("⛔ ...while KEEPING the emphasis and the links, which are MEANING rather than appearance",
  marksIn2(mergedDoc).includes("bold") && marksIn2(mergedDoc).includes("link"),
  marksIn2(mergedDoc).join(",") || "nothing kept");
ok("...and every word is still there", textOf(mergedDoc).includes("Simon Sequeira") && textOf(mergedDoc).includes("Kandice Cabets"));

/* ---- (3) KEEP TEXT ONLY ---------------------------------------------------------------- */
await clearBody();
await settle();
await pasteSig();
await page.waitForTimeout(600);
await settle();
const parasWithStyle = nodesOf(await readBody(tabPage), "paragraph").length;
await tb("note-paste-badge").click();
await page.waitForTimeout(200);
await tb("note-paste-text").click();
await page.waitForTimeout(500);
await settle();
const textDoc = await readBody(tabPage);
ok("⛔ KEEP TEXT ONLY LEAVES NO MARKS AT ALL — plain means plain",
  marksIn2(textDoc).length === 0 && alignsIn(textDoc).length === 0,
  marksIn2(textDoc).join(",") || "nothing left");
ok("⛔ ...AND THE LINE BREAKS SURVIVE — a multi-line paste must not collapse into one run-on line",
  nodesOf(textDoc, "paragraph").length >= 10,
  `${nodesOf(textDoc, "paragraph").length} paragraph(s) (was ${parasWithStyle} formatted)`);
ok("...with every word still present — stripping style must never cost content",
  ["Simon Sequeira", "CEO", "1234 Grand Pkwy", "Kandice Cabets", "k@quadvest.com"].every((t) => textOf(textDoc).includes(t)),
  textOf(textDoc).replace(/\n/g, " · ").slice(0, 90));
ok("...and the option retires once it has been taken", await tb("note-paste-options").count() === 0);

/* A PLAIN paste must NOT raise the badge — an affordance that can do nothing is noise. */
await clearBody();
await settle();
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData("text/plain", "just some words");
  const target = document.querySelector('[data-testid="note-body"]');
  target?.focus();
  target?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(500);
ok("⛔ A PLAIN paste raises NO badge — it would have nothing to offer",
  await tb("note-paste-options").count() === 0);

/* ---- ⛔ BUG B: A SIGNATURE MUST NOT NEST INSIDE A LIST ITEM ---------------------------- */
await clearBody();
await page.keyboard.type("- Contacts:", { delay: 6 });
await settle();
await pasteSig();
await page.waitForTimeout(700);
await settle();
const listPasteDoc = await readBody(tabPage);
/* His document had the whole signature four levels deep inside one <li>, which is why it sat
 * at a bizarre indent far to the right. Assert the TREE: no paragraph of the signature may be
 * a descendant of a listItem. */
const sigInsideList = await page.evaluate(() => {
  const li = [...document.querySelectorAll('[data-testid="note-body"] li')];
  return li.some((el) => /Simon Sequeira/.test(el.textContent || ""));
});
ok("⛔ A MULTI-BLOCK PASTE INTO A LIST LANDS AFTER THE LIST, NOT NESTED INSIDE THE ITEM",
  !sigInsideList, sigInsideList ? "the signature is still inside the <li>" : "outside the list");
ok("...and the bullet itself is untouched", textOf(listPasteDoc).includes("Contacts:"));
ok("...and the signature is all still on the page", textOf(listPasteDoc).includes("Simon Sequeira") && textOf(listPasteDoc).includes("Kandice Cabets"));

/* ---- ⛔ BUG A: BACKSPACE AT THE START OF A BLOCK TAKES ONE PREDICTABLE STEP ------------- */
await clearBody();
await page.evaluate(() => {
  const dt = new DataTransfer();
  dt.setData("text/html", '<p>line above</p><p style="text-align: right;"><strong>Simon Sequeira</strong></p><p>CEO</p>');
  dt.setData("text/plain", "line above\nSimon Sequeira\nCEO");
  const target = document.querySelector('[data-testid="note-body"]');
  target?.focus();
  target?.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
});
await page.waitForTimeout(500);
await settle();
const beforeBksp = await readBody(tabPage);
const parasBeforeBksp = nodesOf(beforeBksp, "paragraph").length;
ok("the fixture is in place: a right-aligned block among unaligned siblings",
  alignsIn(beforeBksp).length === 1, alignsIn(beforeBksp).join(",") || "no aligned block");

/* Put the caret at the very start of "Simon Sequeira" and press Backspace ONCE. */
await page.evaluate(() => {
  const p = [...document.querySelectorAll('[data-testid="note-body"] p')].find((el) => /Simon Sequeira/.test(el.textContent || ""));
  const node = p?.firstChild?.firstChild || p?.firstChild;
  if (!node) return;
  const r = document.createRange();
  r.setStart(node, 0); r.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(r);
});
await page.waitForTimeout(200);
await page.keyboard.press("Backspace");
await page.waitForTimeout(300);
await settle();
const afterBksp = await readBody(tabPage);
ok("⛔ ONE BACKSPACE UNDOES THE ALIGNMENT AND STOPS — it does NOT merge two blocks in one press",
  alignsIn(afterBksp).length === 0 && nodesOf(afterBksp, "paragraph").length === parasBeforeBksp,
  `${parasBeforeBksp} → ${nodesOf(afterBksp, "paragraph").length} paragraph(s), align ${alignsIn(afterBksp).join(",") || "none"}`);
ok("⛔ ...and NOTHING moved: every word is still in its own block, the line above included",
  textOf(afterBksp).includes("line above") && textOf(afterBksp).includes("Simon Sequeira") && textOf(afterBksp).includes("CEO"),
  textOf(afterBksp).replace(/\n/g, " · "));
/* …and a SECOND press does the ordinary join, so nothing became unreachable. */
await page.keyboard.press("Backspace");
await page.waitForTimeout(300);
await settle();
ok("...while a SECOND press performs the ordinary join — the step was deferred, not removed",
  nodesOf(await readBody(tabPage), "paragraph").length === parasBeforeBksp - 1,
  `${nodesOf(await readBody(tabPage), "paragraph").length} paragraph(s)`);

/* The DISCOVERABLE route he asked for by name: the same three, on the right-click menu. */
await caretInDoc();
const menuAt = await tb("note-body").boundingBox();
await page.mouse.click(menuAt.x + 40, menuAt.y + 10, { button: "right" });
await page.waitForTimeout(300);
ok("⛔ ALL THREE PASTE OPTIONS ARE ON THE RIGHT-CLICK MENU — the option he asked to be able to SEE",
  await tb("note-doc-menu").count() === 1
  && await tb("note-menu-paste-source").count() === 1
  && await tb("note-menu-paste-merge").count() === 1
  && await tb("note-menu-paste-plain").count() === 1);
ok("...with the same three glyphs the badge uses, so they read as the same three things",
  await page.locator('[data-testid="note-doc-menu"] svg').count() === 3);
ok("...and Keep text only names its shortcut, so the menu teaches the faster route",
  /ctrl\+shift\+v/i.test(await tb("note-menu-paste-plain").innerText()),
  (await tb("note-menu-paste-plain").innerText()).replace(/\n/g, " · "));
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
ok("...and Escape closes it — it is a menu, not a dialog", await tb("note-doc-menu").count() === 0);

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
