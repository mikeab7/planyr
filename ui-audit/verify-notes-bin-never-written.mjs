/* verify-notes-bin-never-written — NEW-2, reopened 2026-08-28: owner created an empty page,
 * binned it, and its bin card read "Its writing was permanently deleted and cannot be brought
 * back" — copy that should only appear when content once existed and was destroyed. Fixed in
 * `collectBinFacts` (lib/notesStore.js): `gone` now also requires `everTouched` (the tree's
 * `updatedAt` moved off `createdAt`, which only happens once a real save has landed), not just
 * "no body found on this device". Unit-tested against the pure function in
 * test/notesBinFacts.test.js; this drives the real UI to confirm the copy on screen agrees.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await assertMeasurable(page, "verify-notes-bin-never-written");
await page.addInitScript(() => { window.__PLANYR_E2E = true; });
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

let pass = 0; let fail = 0;
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

// A never-written page ("fresh") next to an older empty page that HAS a stored (empty) body
// ("old-empty") and a genuinely destroyed page ("purged" — touched, then its body wiped).
await page.evaluate(([treeKey]) => {
  localStorage.clear();
  const now = Date.now();
  localStorage.setItem(treeKey, JSON.stringify({
    v: 3, tombs: [],
    pages: [],
    trash: [
      { id: "e1", node: { id: "fresh", title: "Untitled page", createdAt: now, updatedAt: now, pages: [] }, pageIds: ["fresh"], deletedAt: now, expiresAt: now + 30 * 86400000 },
      { id: "e2", node: { id: "old-empty", title: "Untitled page", createdAt: now - 90000, updatedAt: now - 90000, pages: [] }, pageIds: ["old-empty"], deletedAt: now, expiresAt: now + 30 * 86400000 },
      { id: "e3", node: { id: "purged", title: "Untitled page", createdAt: now - 90000, updatedAt: now - 9000, pages: [] }, pageIds: ["purged"], deletedAt: now, expiresAt: now + 30 * 86400000 },
    ],
  }));
  // "old-empty" has a stored (empty) body; "fresh" and "purged" have none at all.
  localStorage.setItem("planyr:notes:page:v1:local:old-empty", JSON.stringify({ type: "doc", content: [{ type: "paragraph" }] }));
}, [TREE_KEY]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForTimeout(400);

await page.getByTestId("notes-view-bin").click().catch(() => page.locator('[data-testid="notes-view-bin"]').click());
await pacedWait(page, 300);

const rows = await page.evaluate(() => ({
  fresh: document.querySelector('[data-testid="notes-bin-preview-e1"]')?.textContent || "",
  oldEmpty: document.querySelector('[data-testid="notes-bin-preview-e2"]')?.textContent || "",
  purged: document.querySelector('[data-testid="notes-bin-preview-e3"]')?.textContent || "",
}));
console.log(JSON.stringify(rows, null, 2));

ok("⛔ a never-written page reads 'Empty — nothing was ever written', NOT 'permanently deleted'",
  rows.fresh.includes("Empty") && !rows.fresh.includes("permanently deleted"), rows.fresh);
ok("an older empty (but stored) page still reads 'Empty — nothing was ever written'",
  rows.oldEmpty.includes("Empty") && !rows.oldEmpty.includes("permanently deleted"), rows.oldEmpty);
ok("⛔ a page that was really touched and lost its body still reads 'permanently deleted'",
  rows.purged.includes("permanently deleted"), rows.purged);

console.log(`\n${pass}/${pass + fail} checks passed`);
console.log(`page errors: ${errs.length ? errs.slice(0, 5).join(" | ") : "clean"}`);
await browser.close();
process.exit(fail ? 1 : 0);
