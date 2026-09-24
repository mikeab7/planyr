/* verify-notes-bin-mode-exit — NEW-1/NEW-2 (bug block, 2026-09-22).
 *
 * NEW-1: the Bin view was STICKY. Reading a binned page (peek), then switching back to the
 * Pages view and clicking a real page, left the editor showing the binned page's content while
 * the sidebar highlighted the newly-clicked page as though you had navigated there — the
 * sidebar lied about what was on screen. Fixed by clearing `peek` (Notes.jsx) on every real
 * page-opening action and on any view switch away from "bin" — the bin is a MODE, and leaving
 * it (a page click, a tab switch) always exits it.
 *
 * NEW-2: the bin-peek reader's "Restore it"/"Close" buttons sat inline after the banner text,
 * so a long binned page's title pushed them off the right edge or wrapped them to a new line.
 * Fixed by moving Restore / Delete forever / Back to pages into a fixed cluster in the sidebar
 * (NotesTree.jsx's BinList, below the entries list) — the editor's own status row is now a
 * slim, button-free read-only indicator whose position never depends on the title's length.
 *
 * Run:
 *   npx vite preview --port 4173 &
 *   node ui-audit/verify-notes-bin-mode-exit.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";

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
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-notes-bin-mode-exit");

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const tb = (id) => page.locator(`[data-testid="${id}"]`);
const readTree = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), TREE_KEY);
const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const now = Date.now();
const pg = (id, title) => ({ id, title, projectId: null, createdAt: now, updatedAt: now, pages: [] });
const trashEntry = (id, title, pageId, text) => ({
  id, node: { id: pageId, title, createdAt: now - 90000, updatedAt: now - 9000, pages: [] },
  pageIds: [pageId], title, deletedAt: now, expiresAt: now + 30 * 86400000,
  reading: [{ pageId, title, chars: text.length }],
});

const SHORT_TITLE = "Notes";
const LONG_TITLE = "Phase 2 Site Infrastructure Coordination Meeting Notes — Sept 2026";

const tree = {
  v: 3, tombs: [],
  pages: [pg("platting", "Platting"), pg("permitting", "Permitting")],
  trash: [
    trashEntry("e-short", SHORT_TITLE, "short-bin", "Some quick notes about a call with the county."),
    trashEntry("e-long", LONG_TITLE, "long-bin", "Attendees: Michael Butler, Ryan Baumgartner."),
  ],
};

await page.goto(BASE + "#/notes", { waitUntil: "domcontentloaded" });
await page.evaluate(([k, v, shortDoc, longDoc]) => {
  localStorage.clear();
  localStorage.setItem(k, JSON.stringify(v));
  localStorage.setItem("planyr:notes:page:v1:local:short-bin", JSON.stringify(shortDoc));
  localStorage.setItem("planyr:notes:page:v1:local:long-bin", JSON.stringify(longDoc));
}, [TREE_KEY, tree, doc("Some quick notes about a call with the county."), doc("Attendees: Michael Butler, Ryan Baumgartner.")]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await pacedWait(page, 500);

/* ---- §1 open the Bin and peek the SHORT-titled entry ----------------------------------- */
await tb("notes-view-bin").click();
await pacedWait(page, 300);
await tb("notes-bin-peek-e-short").click();
await pacedWait(page, 300);
ok("peeking opens the read-only reader", await tb("notes-peek").count() === 1);

/* ---- §2 NEW-2: the editor's status row carries NO buttons ------------------------------ */
ok("⛔ the OLD editor-banner buttons are gone", await tb("notes-peek-restore").count() === 0 && await tb("notes-peek-close").count() === 0);
const barButtons = await page.locator('[data-testid="notes-peek-readonly-bar"] button').count();
ok("the slim read-only bar carries zero buttons (desktop viewport)", barButtons === 0, `found ${barButtons}`);
const barText = await tb("notes-peek-readonly-bar").innerText();
ok("the bar still says plainly what you're looking at", /read-only/i.test(barText), barText);

/* ---- §3 NEW-2: Restore / Delete forever / Back to pages live in the SIDEBAR, in one fixed
 *        spot that does not move when the peeked title's length changes ------------------ */
ok("the sidebar's 'viewing' action cluster appears", await tb("notes-bin-viewing-actions").count() === 1);
ok("...naming the SHORT title", (await tb("notes-bin-viewing-actions").innerText()).includes(SHORT_TITLE));
const boxShort = await tb("notes-bin-viewing-actions").boundingBox();

await tb("notes-bin-peek-e-long").click();
await pacedWait(page, 300);
ok("switching to the LONG-titled entry still shows the reader", await tb("notes-peek").count() === 1);
ok("...naming the LONG title now", (await tb("notes-bin-viewing-actions").innerText()).includes(LONG_TITLE));
const boxLong = await tb("notes-bin-viewing-actions").boundingBox();
const drift = boxShort && boxLong ? Math.hypot(boxShort.x - boxLong.x, boxShort.y - boxLong.y) : Infinity;
ok("⛔ the action cluster's position does NOT drift between a short and a long title",
  drift < 1, `short=(${boxShort?.x},${boxShort?.y}) long=(${boxLong?.x},${boxLong?.y}) drift=${drift.toFixed(2)}px`);
const longBarButtons = await page.locator('[data-testid="notes-peek-readonly-bar"] button').count();
ok("the editor bar is still button-free with the long title", longBarButtons === 0, `found ${longBarButtons}`);

/* ---- §4 NEW-1: clicking a REAL page in the sidebar dismisses bin mode entirely ---------- */
await tb("notes-view-tree").click();
await pacedWait(page, 300);
await tb("notes-row-platting").click();
await pacedWait(page, 300);
ok("⛔ the peek reader is gone — the bin view did not survive the page click", await tb("notes-peek").count() === 0);
ok("the clicked page is genuinely highlighted as selected", (await tb("notes-row-platting").getAttribute("aria-selected")) === "true");
const titleVal = await page.locator('[data-testid="note-title"]').inputValue().catch(() => null);
ok("...and the editor genuinely loaded Platting's content, not stale bin content", titleVal === "Platting", `title field reads "${titleVal}"`);

/* ---- §5 NEW-1: leaving the Bin tab (without clicking a page) also exits bin mode --------
 * ⛔ This used to switch to the Tasks tab as its "some other tab" case — the Pages/Tasks
 * segmented control (and the Tasks roll-up behind it) is gone (NEW-8, then the toolbar-rebuild
 * follow-up's NEW-4), so the sidebar's own "Back to pages" control is now the only in-sidebar
 * way to leave Bin without clicking a page; that path is already covered by §6 below. */

/* ---- §6 the sidebar cluster's own "Back to pages" / Restore / Delete forever work ------- */
await tb("notes-view-bin").click();
await pacedWait(page, 300);
await tb("notes-bin-peek-e-short").click();
await pacedWait(page, 300);
await tb("notes-bin-viewing-back").click();
await pacedWait(page, 300);
ok("'← Back to pages' closes the peek and returns to the Pages tab",
  await tb("notes-peek").count() === 0 && (await tb("notes-view-tree").getAttribute("aria-selected")) === "true");

await tb("notes-view-bin").click();
await pacedWait(page, 300);
await tb("notes-bin-peek-e-short").click();
await pacedWait(page, 300);
await tb("notes-bin-viewing-restore").click();
await pacedWait(page, 400);
ok("'↩ Restore to pages' takes the entry out of the bin", await tb("notes-bin-e-short").count() === 0);
ok("...and closes the peek that was reading it", await tb("notes-peek").count() === 0);
const treeAfterRestore = await readTree();
ok("...and the page is genuinely back among the live pages in storage",
  !!treeAfterRestore.pages.find((p) => p.id === "short-bin"), JSON.stringify(treeAfterRestore.pages.map((p) => p.id)));

await tb("notes-view-bin").click();
await pacedWait(page, 300);
await tb("notes-bin-peek-e-long").click();
await pacedWait(page, 300);
await tb("notes-bin-viewing-purge").click();
await pacedWait(page, 400);
ok("'✕ Delete forever' removes the entry for good", await tb("notes-bin-e-long").count() === 0);
ok("...and closes the peek that was reading it", await tb("notes-peek").count() === 0);

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
await browser.close();
if (failed.length) process.exitCode = 1;
