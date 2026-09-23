/* NEW-1 "Copy a notebook" — drives the REAL built app, headless, logged out (device-local
 * storage, no network — nothing here needs a live pass; ATTEMPT-BEFORE-YOU-PARK).
 *
 * Seeds a project-less notebook "Entitlements" › "Bonding" › "Surety" (Surety holds a picture
 * whose bytes live in IndexedDB), then right-clicks the top row → "Make a copy" and asserts, off
 * STORAGE rather than the screen:
 *   §1  the menu offers "Make a copy"
 *   §2  the copy lands right under the original as "Entitlements (copy)", with the same nesting
 *       under all-new ids, and it opens
 *   §3  every copied page has a body, with the original's words
 *   §4  the copied picture has its OWN id and its own bytes in IndexedDB (the original's stay)
 *   §5  KNOWN-GOOD ARM: the original subtree is byte-for-byte unchanged — if this does not hold
 *       the run is VOID, because the harness could not tell a copy from a move
 *   §6  it survives a reload
 *
 *   npx vite preview --port 4173 &
 *   node ui-audit/verify-notes-copy-notebook.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const TREE_KEY = "planyr:notes:tree:v1:local";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-notes-copy-notebook");
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));
const tb = (id) => page.locator(`[data-testid="${id}"]`);

console.log("Notes — copy a notebook\n");

const openNotes = async () => {
  await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
  await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });
};

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(800);
await openNotes();   // lets the app create its IndexedDB schema

/* ════ seed ════ */
const now = Date.now();
const node = (id, title, pages = [], extra = {}) => ({ id, title, createdAt: now, updatedAt: now, pages, ...extra });
const seedTree = {
  v: 3,
  pages: [
    node("pg_ent", "Entitlements", [node("pg_bond", "Bonding", [node("pg_sur", "Surety")])], { projectId: null }),
    node("pg_coord", "Coordination", [], { projectId: null }),
  ],
  trash: [], tombs: [],
};
const para = (text) => ({ type: "paragraph", content: [{ type: "text", text }] });
const bodies = {
  pg_ent: { type: "doc", content: [para("Entitlement tracker for the Katy site.")] },
  pg_bond: { type: "doc", content: [para("Bond amounts and sureties.")] },
  pg_sur: { type: "doc", content: [para("Surety letter photo:"), { type: "noteImage", attrs: { imageId: "img_seed" } }, { type: "paragraph" }] },
  pg_coord: { type: "doc", content: [para("Coordination log.")] },
};
await page.evaluate(async ({ TREE_KEY, seedTree, bodies, PNG }) => {
  localStorage.setItem(TREE_KEY, JSON.stringify(seedTree));
  for (const [id, doc] of Object.entries(bodies)) localStorage.setItem(`planyr:notes:page:v1:local:${id}`, JSON.stringify(doc));
  await new Promise((resolve, reject) => {
    const req = indexedDB.open("planyr-notes");
    req.onsuccess = () => {
      const db = req.result;
      const t = db.transaction("images", "readwrite");
      t.objectStore("images").put({ key: "local:img_seed", scope: "local", id: "img_seed", pageId: "pg_sur", dataUrl: PNG, mime: "image/png", w: 1, h: 1, bytes: PNG.length, createdAt: Date.now() });
      t.oncomplete = () => { db.close(); resolve(); };
      t.onerror = () => reject(t.error);
    };
    req.onerror = () => reject(req.error);
  });
}, { TREE_KEY, seedTree, bodies, PNG });
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(800);
await openNotes();

const snapshot = () => page.evaluate(async ({ TREE_KEY }) => {
  const tree = JSON.parse(localStorage.getItem(TREE_KEY) || "null");
  const pages = {};
  for (let i = 0; i < localStorage.length; i += 1) {
    const k = localStorage.key(i);
    if (k.startsWith("planyr:notes:page:v1:local:")) pages[k.slice("planyr:notes:page:v1:local:".length)] = localStorage.getItem(k);
  }
  const images = await new Promise((resolve) => {
    const req = indexedDB.open("planyr-notes");
    req.onsuccess = () => {
      const db = req.result;
      const all = db.transaction("images").objectStore("images").getAll();
      all.onsuccess = () => { db.close(); resolve(all.result.map((r) => ({ id: r.id, pageId: r.pageId, dataUrl: r.dataUrl }))); };
    };
  });
  return { tree, pages, images };
}, { TREE_KEY });

const before = await snapshot();
const subtree = (n) => [n, ...(n.pages || []).flatMap(subtree)];
const origBefore = JSON.stringify(subtree(before.tree.pages[0]).map((p) => [p.id, p.title, before.pages[p.id]]));

/* ════ §1 ════ */
await page.mouse.click(0, 0);
const row = tb("notes-row-pg_ent");
await row.scrollIntoViewIfNeeded();
await row.click({ button: "right" });
await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
const items = await page.locator('[data-testid="notes-row-menu"] [role="menuitem"]').allInnerTexts();
ok('the row menu offers "Make a copy"', items.includes("Make a copy"), items.join(" | "));
await tb("notes-menu-cp-pg_ent").click();
await page.waitForTimeout(900);

/* ════ §2 ════ */
const after = await snapshot();
const roots = after.tree.pages;
ok("the copy lands right under the original", roots.map((p) => p.title).join(" | ") === "Entitlements | Entitlements (copy) | Coordination", roots.map((p) => p.title).join(" | "));
const copy = roots[1];
const copyNodes = subtree(copy);
ok("…with the same nesting (Bonding › Surety)", copy.pages?.[0]?.title === "Bonding" && copy.pages[0].pages?.[0]?.title === "Surety");
ok("…under all-new ids", copyNodes.every((n) => !["pg_ent", "pg_bond", "pg_sur"].includes(n.id)), copyNodes.map((n) => n.id).join(","));
ok("…and in the original's project (none)", copy.projectId == null);
const titleVal = await tb("note-title").inputValue().catch(() => "");
ok("the copy opens", titleVal === "Entitlements (copy)", titleVal);
const notice = await tb("notes-export-notice").innerText().catch(() => "");
ok("a notice says what was copied", /Copied the page and its 2 subpages/.test(notice), notice);

/* ════ §3 ════ */
const text = (raw) => (raw ? JSON.stringify(JSON.parse(raw)).match(/"text":"([^"]+)"/)?.[1] : null);
ok("every copied page has a body with the original's words",
  text(after.pages[copyNodes[0].id]) === "Entitlement tracker for the Katy site."
  && text(after.pages[copyNodes[1].id]) === "Bond amounts and sureties."
  && text(after.pages[copyNodes[2].id]) === "Surety letter photo:");

/* ════ §4 ════ */
const surCopyDoc = JSON.parse(after.pages[copyNodes[2].id] || "{}");
const imgRef = surCopyDoc.content?.find((n) => n.type === "noteImage")?.attrs?.imageId;
const imgRec = after.images.find((r) => r.id === imgRef);
ok("the copied picture has its OWN id", imgRef && imgRef !== "img_seed", imgRef);
ok("…with its own bytes, owned by the copied page", imgRec?.dataUrl === PNG && imgRec.pageId === copyNodes[2].id);
ok("…and the original's picture is still there", after.images.some((r) => r.id === "img_seed" && r.dataUrl === PNG));
/* Open a page through the rail the way a person would: expand each folded ancestor, then
 * click the row. Returns whether a real, decoded picture is on the page. */
const openAndSeeImage = async (chain) => {
  for (const id of chain.slice(0, -1)) {
    const row = tb(`notes-row-${id}`);
    if ((await row.getAttribute("aria-expanded")) === "false") await tb(`notes-toggle-${id}`).click();
    await page.waitForTimeout(150);
  }
  await tb(`notes-row-${chain[chain.length - 1]}`).click();
  await page.waitForTimeout(1200);
  return page.evaluate(() => [...document.querySelectorAll('[data-testid="note-body"] .planyr-note-image img')].some((i) => i.naturalWidth > 0));
};
/* KNOWN-GOOD ARM for the render check: the ORIGINAL Surety must show its picture, or this
 * instrument cannot see pictures at all and the copy's row below says nothing. */
const origShows = await openAndSeeImage(["pg_ent", "pg_bond", "pg_sur"]);
ok("KNOWN-GOOD: the original Surety page renders its picture", origShows);
const copyShows = await openAndSeeImage(copyNodes.map((n) => n.id));
ok("…and the copied Surety page renders ITS picture", copyShows);

/* ════ §5 KNOWN-GOOD ARM ════ */
const origAfter = JSON.stringify(subtree(after.tree.pages[0]).map((p) => [p.id, p.title, after.pages[p.id]]));
const knownGood = origAfter === origBefore && origShows;
ok("KNOWN-GOOD: the original notebook is byte-for-byte unchanged", knownGood);

/* ════ §6 ════ */
await page.reload({ waitUntil: "load" });
await page.waitForTimeout(800);
await openNotes();
const reloaded = await snapshot();
ok("the copy survives a reload", reloaded.tree.pages.map((p) => p.title).join(" | ") === "Entitlements | Entitlements (copy) | Coordination");

ok("no page errors", pageErrors.length === 0, pageErrors.join(" ; "));
await browser.close();

const failed = checks.filter((c) => !c.pass);
if (!knownGood) { console.log("\nVOID — the known-good arm failed, so no verdict is reported."); process.exit(2); }
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
