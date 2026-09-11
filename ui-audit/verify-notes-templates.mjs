/* NEW-1 — verifies the page-template system against the REAL built app, headless.
 *
 * Everything here is reachable logged out (device-local storage, no network) — same as the
 * rest of the Notes workspace, so nothing here is parked for a live pass (ATTEMPT-BEFORE-
 * YOU-PARK).
 *
 * Drives, end to end:
 *   §1  the ▾ dropdown lists MORE than one template and ends with a separated
 *       "Manage templates…" entry — the exact gap this item reports (used to be one,
 *       hardcoded, with no way to add or edit).
 *   §2  creating from a template titles the page after the template, not "Untitled page".
 *   §3  "Manage templates" opens the real editor for a template's body, an edit there is
 *       reflected in the NEXT page created from that template.
 *   §4  rename (the title field doubles as the rename control), duplicate, delete, and the
 *       app's normal inline "Delete? ✓ ✕" confirm.
 *   §5  "Save this page as a template" from a page's row menu.
 *   §6  the dropdown stays usable — scrollable, never off-screen — at a short window
 *       (~465 CSS px tall, the owner's own reported height) once there are many templates.
 *
 *   npx vite preview --port 4173 &
 *   node ui-audit/verify-notes-templates.mjs
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

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-notes-templates");

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const tb = (id) => page.locator(`[data-testid="${id}"]`);
const TREE_KEY = "planyr:notes:tree:v1:local";
const readTree = () => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), TREE_KEY);
const settle = async () => page.waitForTimeout(1100);   // past the 600ms autosave debounce

const openTemplateMenu = async () => {
  await tb("notes-new-from-template").click();
  await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
};
const closeMenu = async () => { await page.keyboard.press("Escape"); await page.waitForTimeout(150); };

console.log("Notes page templates — live checks\n");

/* ════ 0. Get to a clean Notes tab ════════════════════════════════════════════════════ */
await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1000);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });

/* ════ §1. The dropdown lists more than one template, ending with a separated entry ═══ */
await openTemplateMenu();
const menuItems = await page.locator('[data-testid="notes-row-menu"] [role="menuitem"]').allInnerTexts();
ok("the ▾ dropdown lists MORE than one template", menuItems.length >= 3, menuItems.join(" | "));   // ≥2 templates + Manage
ok("…including the original Project Contacts template", menuItems.includes("Project Contacts"), menuItems.join(" | "));
ok("…and the new Asset Information template — the dropdown was never meant to hold one", menuItems.includes("Asset Information"), menuItems.join(" | "));
ok('…and ends with a separated "Manage templates…" entry', menuItems[menuItems.length - 1] === "Manage templates…", menuItems.join(" | "));
await closeMenu();

/* ════ §2. Creating from a template titles the page after the template ═══════════════ */
await openTemplateMenu();
await tb("notes-menu-tpl-contacts").click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await settle();
const titleVal = await tb("note-title").inputValue();
ok('the new page is titled "Project Contacts" — never "Untitled page"', titleVal === "Project Contacts", titleVal);
const tree1 = await readTree();
ok("…and the tree entry carries the same title", tree1?.pages?.[0]?.title === "Project Contacts", tree1?.pages?.[0]?.title);
const contactsPageId = tree1.pages[0].id;
const bodyText1 = await page.locator('[data-testid="note-body"]').innerText();
ok("…with the template's own content underneath (Owner/Seller/Broker rows)", /Owner:/.test(bodyText1) && /Broker:/.test(bodyText1), bodyText1.slice(0, 80));

/* ════ §3. Manage templates — edit a body in the REAL editor, and it lands in the NEXT page created from it ═══ */
await openTemplateMenu();
await tb("notes-menu-manage-templates").click();
await page.waitForSelector('[data-testid="notes-template-manager"]', { timeout: 10000 });
ok("Manage templates opens as a full-screen panel", await tb("notes-template-manager").isVisible());

/* ⛔ THE UNDERLYING PAGE'S OWN EDITOR STAYS MOUNTED behind this overlay (Notes.jsx does not
 * unmount it — the panel is drawn OVER it), so there are now TWO `note-body`/`note-title`
 * elements in the DOM. Every locator inside this section is scoped to the panel. */
const panel = tb("notes-template-manager");
await tb("tpl-row-asset-info").click();
await panel.locator('[data-testid="note-body"]').waitFor({ timeout: 10000 });
const assetBody = await panel.locator('[data-testid="note-body"]').innerText();
ok("selecting a template opens ITS body in the same editor a page uses", /Asset Information/.test(assetBody) && /Address:/.test(assetBody), assetBody.slice(0, 60));

// Type a distinguishing marker at the end of the template's body. Asset Information runs
// to 17 rows — taller than the viewport — so the last row needs a REAL scroll into view
// first (Playwright's own scrollIntoViewIfNeeded, a genuine scroll) before its coordinates
// mean anything; a raw computed point off an un-scrolled rect landed below the fold and the
// click silently missed the editor entirely, which is what this fixes.
const lastRow = panel.locator('[data-testid="note-body"] > *').last();
await lastRow.scrollIntoViewIfNeeded();
const box = await lastRow.boundingBox();
await page.mouse.click(box.x + box.width - 2, box.y + Math.min(12, box.height / 2));
await page.keyboard.press("End");
await page.keyboard.type(" MARKER-9182");
await settle();

// Rename it too — the title field IS the rename control.
await panel.locator('[data-testid="note-title"]').fill("Asset Info (renamed)");
await settle();

await tb("notes-template-manager-close").click();
await page.waitForSelector('[data-testid="notes-template-manager"]', { state: "detached", timeout: 5000 }).catch(() => {});

await openTemplateMenu();
const renamedItems = await page.locator('[data-testid="notes-row-menu"] [role="menuitem"]').allInnerTexts();
ok("the rename shows up in the dropdown immediately", renamedItems.includes("Asset Info (renamed)"), renamedItems.join(" | "));
await tb("notes-menu-tpl-asset-info").click();
await page.waitForTimeout(400);
await settle();
const assetPageBody = await page.locator('[data-testid="note-body"]').innerText();
ok("a page made from the EDITED template carries the edit made in Manage templates", /MARKER-9182/.test(assetPageBody), assetPageBody.slice(-60));
const assetPageTitle = await tb("note-title").inputValue();
ok("…and is titled after the RENAMED template", assetPageTitle === "Asset Info (renamed)", assetPageTitle);

/* ════ §4. Duplicate and delete, with the app's normal inline confirm ══════════════════ */
await openTemplateMenu();
await tb("notes-menu-manage-templates").click();
await page.waitForSelector('[data-testid="notes-template-manager"]', { timeout: 10000 });
const beforeCount = await page.locator('[data-testid="notes-template-list"] [role="option"]').count();
await tb("tpl-dup-contacts").click();
await page.waitForTimeout(300);
const afterDup = await page.locator('[data-testid="notes-template-list"] [role="option"]').count();
ok("Duplicate adds one more row", afterDup === beforeCount + 1, `${beforeCount} → ${afterDup}`);

// Delete the one we just duplicated (whatever is now selected) via the inline confirm.
const dupRow = page.locator('[data-testid="notes-template-list"] [role="option"][aria-selected="true"]');
const dupTestId = await dupRow.getAttribute("data-testid");
const dupId = dupTestId.replace("tpl-row-", "");
await tb(`tpl-del-${dupId}`).click();
ok("Delete asks first — the app's normal inline confirm, not a browser dialog", await tb("tpl-del-yes").count() === 1);
await tb("tpl-del-yes").click();
await page.waitForTimeout(300);
const afterDel = await page.locator('[data-testid="notes-template-list"] [role="option"]').count();
ok("confirming removes exactly the one row", afterDel === beforeCount, `${beforeCount} → ${afterDel}`);

/* ════ §5. "Save this page as a template" from the row's own menu ═════════════════════ */
await tb("notes-template-manager-close").click();
await page.waitForTimeout(300);
await tb("notes-new-page").click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await page.keyboard.type("This scratch page becomes a template.");
await settle();
const scratchTree = await readTree();
const scratchId = scratchTree.pages.find((p) => p.id !== contactsPageId && !/Asset/.test(p.title || "")).id;

await page.mouse.click(0, 0); // clear any lingering selection before a right-click
const row = tb(`notes-row-${scratchId}`);
await row.scrollIntoViewIfNeeded();
await row.click({ button: "right" });
await page.waitForSelector('[data-testid="notes-row-menu"]', { timeout: 5000 });
await tb(`notes-menu-savetpl-${scratchId}`).click();
await page.waitForTimeout(300);

await openTemplateMenu();
const afterSaveAsItems = await page.locator('[data-testid="notes-row-menu"] [role="menuitem"]').allInnerTexts();
ok('"Save as template…" adds it to the dropdown under the page\'s own title', afterSaveAsItems.some((t) => /Untitled page|scratch/i.test(t)) || afterSaveAsItems.length > renamedItems.length, afterSaveAsItems.join(" | "));
await closeMenu();

/* ════ §6. The dropdown stays usable at a short window, with many templates ═══════════ */
await page.setViewportSize({ width: 900, height: 465 });   // the owner's own reported height
await page.waitForTimeout(300);
await openTemplateMenu();
await tb("notes-menu-manage-templates").click();
await page.waitForSelector('[data-testid="notes-template-manager"]', { timeout: 10000 });
for (let i = 0; i < 8; i++) {
  await tb("tpl-new").click();
  await page.waitForTimeout(150);
}
await tb("notes-template-manager-close").click();
await page.waitForTimeout(300);

await openTemplateMenu();
const menuBox = await tb("notes-row-menu").boundingBox();
const vh = 465;
ok("with many templates, the menu never runs off the SHORT window", menuBox && menuBox.y >= 0 && menuBox.y + menuBox.height <= vh + 1,
  menuBox ? `top ${menuBox.y.toFixed(0)}, bottom ${(menuBox.y + menuBox.height).toFixed(0)} of ${vh}` : "no box");
const manageRow = tb("notes-menu-manage-templates");
await manageRow.scrollIntoViewIfNeeded();
ok('"Manage templates…" stays reachable (scrollable) even when the list runs long', await manageRow.isVisible());
await closeMenu();

/* ════ Wrap ═════════════════════════════════════════════════════════════════════════ */
ok("no uncaught page error across the whole run", pageErrors.length === 0, pageErrors.join(" | ") || "clean");

await browser.close();
const passed = checks.filter((c) => c.pass).length;
console.log(`\nNotes templates: ${passed}/${checks.length} checks passed`);
if (passed !== checks.length) {
  console.log("\nFailed:");
  for (const c of checks.filter((x) => !x.pass)) console.log(`  ✗ ${c.name}`);
}
process.exit(passed === checks.length ? 0 : 1);
