/* verify-library-home-delete-live-touch — V1504304 step 5 (touch half), signed in as the test account on planyr.io.
 * TOUCH EMULATION (Playwright "Pixel 7": hasTouch + isMobile, so `(pointer: coarse)` matches) — NOT a real finger on real glass;
 * that part stays parked as `real-phone`. Saves one throwaway .txt, measures every ✕ in the Library, bins + purges it, sweeps.
 * Run: node ui-audit/verify-library-home-delete-live-touch.mjs [https://planyr.io] */
import { mkdirSync, writeFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
const BASE = process.argv[2] || "https://planyr.io";
const SCRATCH = process.env.SCRATCH_DIR || "/tmp/claude-0/-home-user/scratch-v1504304";
mkdirSync(SCRATCH, { recursive: true });
const TOKEN = "zzv1504304t" + Date.now().toString(36);
const TXT = `${SCRATCH}/${TOKEN}-note.txt`; writeFileSync(TXT, `throwaway ${TOKEN}\n`);
let failures = 0;
const ok = (n, c, x = "") => { console.log(`${c ? "PASS" : "FAIL"} — ${n}${x ? "  ::  " + x : ""}`); if (!c) failures++; };
const s = await openSignedIn({ base: BASE, device: "Pixel 7" });
const { page } = s;
const settle = (ms = 1500) => page.waitForTimeout(ms);
const sweep = () => page.evaluate(async () => {
  const q = await window.pfSupabase.from("doc_reviews").select("id,title").ilike("title", "%zzv1504304%");
  return q.error ? { error: String(q.error.message) } : { rows: q.data };
});
try {
  await assertMeasurable(page, "verify-library-home-delete-live-touch");
  const build = (await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()))).build;
  console.log(`served build: ${build}   account: ${s.proof.email}`);
  ok("coarse pointer is emulated", await page.evaluate(() => matchMedia("(pointer: coarse)").matches));
  await page.evaluate(() => { location.hash = "#/markup"; });
  await page.waitForSelector('[data-testid="review-file-input"]', { state: "attached", timeout: 30000 });
  await page.setInputFiles('[data-testid="review-file-input"]', TXT);
  await page.waitForSelector('[data-testid="doc-editor"]:visible', { timeout: 60000 }); await settle(800);
  await page.locator('[data-testid="doc-editor-page"]:visible').first().click().catch(() => {});
  await page.keyboard.type(" touch");
  await page.locator('[data-testid="doc-save"]:visible').first().click(); await settle(3500);
  await page.evaluate(() => { location.hash = "#/library"; });
  await page.waitForSelector('[data-testid="library-home"]', { timeout: 30000 }); await settle(2500);
  const row = page.locator('[data-testid="unfiled-row"]').filter({ hasText: TOKEN });
  ok("KNOWN-GOOD ARM: the throwaway reached Unfiled on the phone-sized view", (await row.count()) === 1);
  if ((await row.count()) === 1) {
    const boxes = await page.locator('[data-testid="library-home"] [data-testid="trash-delete"]').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; }));
    ok("every ✕ in the Library is at least 44×44 under touch emulation", boxes.length >= 1 && boxes.every(([w, h]) => w >= 44 && h >= 44), `${boxes.length} ✕ → ${JSON.stringify(boxes.slice(0, 4))}…`);
    const r = await row.boundingBox();
    ok("the row does not overflow the phone width (no horizontal scroll)", r && r.x >= 0 && r.x + r.width <= 412, JSON.stringify(r && { x: Math.round(r.x), w: Math.round(r.width) }));
    await row.locator('[data-testid="trash-delete"]').tap(); await row.locator('[data-testid="trash-confirm"]').tap(); await settle(2500);
    ok("a TAP on ✕ then ✓ deletes it", (await row.count()) === 0);
  }
  // cleanup: purge anything of ours via the app, then confirm the database is clean
  const pill = page.locator('[data-testid="library-home-recently-deleted"]');
  if (await pill.count()) { await pill.tap(); await settle(800); }
  for (let g = 0; g < 6; g++) {
    const left = page.locator('[data-testid="deleted-row"]').filter({ hasText: "zzv1504304" });
    if (!(await left.count())) break;
    await left.first().locator('[data-testid="deleted-purge"]').tap();
    await page.locator('[data-testid="deleted-purge-confirm"]').tap(); await settle(3500);
  }
  const db = await sweep();
  ok("cleanup: no throwaway row remains in the database", db.rows && db.rows.length === 0, JSON.stringify(db.rows));
  ok("pageerrors during the run", s.errors.length === 0, s.errors.slice(0, 2).join(" | "));
} finally { await s.close(); }
console.log(failures === 0 ? "\n✓ Live touch checks passed." : `\n✗ ${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
