/* verify-notes-reload-active-page — B1883840 (×2), 2026-09-25.
 *
 * Reload used to always bounce Notes back to the tree's FIRST page, even though clicking a page
 * correctly writes its id to `planyr:notes:activePage:v1:<scope>` (readActivePageId/
 * writeActivePageId, lib/notesStore.js, PR #1838). Root cause: `Notes.jsx`'s mount effect and its
 * "keep the open page inside the visible set" effect both fire in the SAME passive-effect pass,
 * off render 1's stale closure (tree=emptyTree(), activePageId=null). The visibility-guard effect
 * ran FIRST against that empty tree, concluded nothing was visible, and called
 * `goToPage(null)` — which WROTE `null` over the just-read stored page id before the mount
 * effect's own resolved value ever committed. The next render then had activePageId=null with a
 * now-populated tree, so the guard fired again and landed on the tree's first page.
 *
 * Fix: the guard effect returns early while `tree.pages.length === 0` — a not-yet-loaded tree is
 * not evidence the active page is invisible.
 *
 * Run:
 *   npm run dev -- --port 5173 &        (or a `vite preview` build)
 *   BASE_URL=http://localhost:5173 node ui-audit/verify-notes-reload-active-page.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const ACTIVE_KEY = "planyr:notes:activePage:v1:local";

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
await assertMeasurable(page, "verify-notes-reload-active-page");

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const tb = (id) => page.locator(`[data-testid="${id}"]`);
const readActive = () => page.evaluate((k) => localStorage.getItem(k), ACTIVE_KEY);

const now = Date.now();
const pg = (id, title) => ({ id, title, projectId: null, createdAt: now, updatedAt: now, pages: [] });
const doc = (text) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] });

const tree = {
  v: 3, tombs: [],
  pages: [
    pg("coordination", "Coordination"),
    pg("permit-entitlements", "Permit & Entitlements Info"),
    pg("bonding", "Bonding"),
  ],
  trash: [],
};

await page.goto(BASE + "#/notes", { waitUntil: "domcontentloaded" });
await page.evaluate(([k, v, coordDoc, permitDoc, bondDoc]) => {
  localStorage.clear();
  localStorage.setItem(k, JSON.stringify(v));
  localStorage.setItem("planyr:notes:page:v1:local:coordination", JSON.stringify(coordDoc));
  localStorage.setItem("planyr:notes:page:v1:local:permit-entitlements", JSON.stringify(permitDoc));
  localStorage.setItem("planyr:notes:page:v1:local:bonding", JSON.stringify(bondDoc));
}, [TREE_KEY, tree, doc("Coordination notes."), doc("Permit and entitlements tracking."), doc("Bonding status.")]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await pacedWait(page, 500);

/* ---- §1 known-good arm: opening the app lands on the FIRST page (no stored active id yet) --- */
ok("known-good arm — fresh load with no stored active page lands on the first page",
  (await readActive()) === "coordination", `stored=${await readActive()}`);

/* ---- §2 click the SECOND (non-first) page, confirm it is both on screen and stored --------- */
await tb("notes-row-permit-entitlements").click();
await pacedWait(page, 400);
const titleAfterClick = await page.locator('[data-testid="note-title"]').inputValue().catch(() => null);
ok("clicking a non-first page opens it", titleAfterClick === "Permit & Entitlements Info", `title="${titleAfterClick}"`);
ok("...and writes its id to storage", (await readActive()) === "permit-entitlements", `stored=${await readActive()}`);

/* ---- §3 THE BUG — reload and the SAME page must stay open, not bounce to the first ---------- */
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await pacedWait(page, 600);
const titleAfterReload = await page.locator('[data-testid="note-title"]').inputValue().catch(() => null);
ok("⛔ a reload keeps the SAME page open, does not bounce to the first page",
  titleAfterReload === "Permit & Entitlements Info", `title="${titleAfterReload}" (bug reads "Coordination")`);
ok("...and the highlighted sidebar row agrees",
  (await tb("notes-row-permit-entitlements").getAttribute("aria-selected")) === "true");
ok("...and storage still names the right page (not clobbered mid-mount)",
  (await readActive()) === "permit-entitlements", `stored=${await readActive()}`);

/* ---- §4 repeat once more (a second reload) — must not merely be a lucky first bounce -------- */
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await pacedWait(page, 600);
const titleAfterSecondReload = await page.locator('[data-testid="note-title"]').inputValue().catch(() => null);
ok("a SECOND reload also keeps the same page open",
  titleAfterSecondReload === "Permit & Entitlements Info", `title="${titleAfterSecondReload}"`);

/* ---- §5 the third page too, so this is not special-cased to index 1 ------------------------- */
await tb("notes-row-bonding").click();
await pacedWait(page, 400);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await pacedWait(page, 600);
const titleThirdPage = await page.locator('[data-testid="note-title"]').inputValue().catch(() => null);
ok("the LAST page also survives a reload", titleThirdPage === "Bonding", `title="${titleThirdPage}"`);

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
await browser.close();
if (failed.length) process.exitCode = 1;
