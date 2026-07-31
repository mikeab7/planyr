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
page.on("request", (r) => { if (r.url().endsWith(".js")) jsRequests.push(r.url().split("/").pop()); });

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

/* ════ 10. Deleting a section clears EVERY page body it owned (TOMBSTONE-DELETES) ══════ */
const keysBefore = await pageKeyCount();
ok("both page bodies are on disk before the delete", keysBefore === 2, `${keysBefore} key(s)`);

await rowAction(section1, "rm");
await page.waitForTimeout(300);
ok("delete asks inline rather than with a dialog box", await tb(`notes-del-${section1}-yes`).count() === 1);

await tb(`notes-del-${section1}-yes`).click();
await page.waitForTimeout(1200);

const keysAfter = await pageKeyCount();
ok("DELETING A SECTION CLEARS EVERY PAGE BODY IT OWNED", keysAfter === 0, `${keysBefore} → ${keysAfter} key(s)`);
const treeAfter = await readTree();
ok("the section is gone from the tree too", (treeAfter.notebooks[0]?.sections || []).length === 0);
ok("the notebook itself survives a section delete", treeAfter.notebooks.length === 1 && treeAfter.notebooks[0].id === notebook1);

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
