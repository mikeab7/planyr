#!/usr/bin/env node
/* verify-delete-drive — NEW-3's POSITIVE CONTROL. Re-measures, against the real app, the claim the
 * browser-driving rule rests on: **a synthetic Delete keystroke does not delete.**
 *
 * WHY A HARNESS AND NOT A PARAGRAPH. The rule is a statement about how the app's keyboard handling
 * is wired — bound to `window`, and `new KeyboardEvent(…)` defaults `bubbles: false`. That wiring
 * can change. A markdown note cannot notice; this can. It drives BOTH halves every run:
 *
 *   • the BANNED shape — `document.dispatchEvent(new KeyboardEvent("keydown", {key:"Delete"}))`,
 *     with a selected feature — which must leave the feature EXACTLY WHERE IT IS. If it ever starts
 *     working, the rule is stale and this fails saying so, rather than quietly agreeing.
 *   • the DOCUMENTED path — `deleteFeatureUntilGone`, which uses the driver's real key input and
 *     escalates to the Properties panel — which must remove it and PROVE it removed it.
 *
 * ⛔ IT ALSO ASSERTS THE INSTRUMENT SAW SOMETHING. A run where the fixture never drew, or the
 * feature was never selected, would pass both halves trivially (nothing to delete, nothing deleted)
 * — the permanent-green failure mode VIEW-INDEPENDENT-ONCE §6 names. So the census is read before
 * and after and the run refuses to report unless it moved by exactly one.
 *
 *   xvfb-run -a --server-args="-screen 0 1600x1000x24" node ui-audit/verify-delete-drive.mjs
 *   ... --json      (needs a build being served at BASE_URL, default :4173)
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { readFeatureCensus, censusDiff } from "./lib/featureCensus.mjs";
import { deleteFeatureUntilGone, featurePresent } from "./lib/deleteFeature.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4173/").replace(/\/?$/, "/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const JSON_OUT = process.argv.includes("--json");

/* THE BANNED SHAPES, driven verbatim. Kept as source strings so the file states the exact thing the
 * rule forbids, and so `findsSyntheticDelete` finds them here (this file is one of the two the
 * source sweep exempts, precisely because it must contain what it bans). */
const SYNTHETIC = [
  ["document", `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }))`],
  ["document.body", `document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete" }))`],
  ["document (Backspace)", `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace" }))`],
];

async function boot(page) {
  await page.goto(BASE);
  await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click();
  await page.getByRole("button", { name: /Start blank/i }).first().click();
  await page.locator('[data-testid="planner-canvas"]').waitFor({ state: "visible", timeout: 30_000 });
}

/** Draw one building with the real tool, and return its feature key. */
async function drawBuilding(page) {
  const box = await page.locator('[data-testid="planner-canvas"]').boundingBox();
  await page.getByRole("button", { name: /^Building$/ }).first().click();
  const x0 = box.x + box.width * 0.35, y0 = box.y + box.height * 0.30;
  const x1 = box.x + box.width * 0.60, y1 = box.y + box.height * 0.55;
  await page.mouse.move(x0, y0);
  await page.mouse.down();
  await page.mouse.move(x1, y1, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: /^Select V$/ }).click();
  const key = await page.evaluate(() => {
    const n = document.querySelector('[data-feature^="el:"]');
    return n ? n.getAttribute("data-feature") : null;
  });
  return key;
}

async function selectIt(page, key) {
  const bb = await page.locator(`[data-feature="${key}"]`).first().boundingBox();
  await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await page.waitForTimeout(300);
}

const out = { base: BASE, synthetic: [], documented: null, faults: [] };

const browser = await chromium.launch({
  executablePath: EXEC, headless: false,
  args: ["--no-sandbox", "--ignore-certificate-errors", "--disable-dev-shm-usage"],
});
try {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels (FOREGROUND-OR-VOID).
     Geometry read after a view change on a hidden tab is a stale frame that agrees with itself. */
  await assertMeasurable(page, "verify-delete-drive");
  await boot(page);

  const key = await drawBuilding(page);
  if (!key) throw new Error("the fixture never drew — nothing to delete, so neither half means anything");
  const before = await readFeatureCensus(page);
  if (!before || before.total < 1) throw new Error(`census read ${before ? before.total : "null"} features — the instrument is not observing`);

  /* ── HALF 1: the banned shape must do NOTHING ───────────────────────────────────────────── */
  for (const [where, code] of SYNTHETIC) {
    await selectIt(page, key);
    await page.evaluate(code);
    await page.waitForTimeout(400);
    const still = await featurePresent(page, key);
    out.synthetic.push({ where, stillPresent: still });
    if (!still) out.faults.push(`⛔ THE RULE IS STALE: a synthetic Delete dispatched on ${where} DID delete. The app's key wiring has changed — re-measure the table in ui-audit/lib/deleteFeature.mjs and update the browser-driving rule in CLAUDE.md before trusting either.`);
  }

  /* ── HALF 2: the documented path must delete it, and prove it ───────────────────────────── */
  await selectIt(page, key);
  const rec = await deleteFeatureUntilGone(page, key);
  const after = await readFeatureCensus(page);
  const diff = censusDiff(before, after);
  out.documented = { key, attempts: rec.attempts, why: rec.why, removed: diff.removed, added: diff.added };

  if (diff.removed.length !== 1 || diff.removed[0] !== key) {
    out.faults.push(`the documented path did not remove exactly ${key} — census moved ${before.total} → ${after.total}, removed ${JSON.stringify(diff.removed)}`);
  }
  out.census = { before: before.total, after: after.total };
} catch (e) {
  out.faults.push(String(e && e.message ? e.message : e));
} finally {
  await browser.close();
}

if (JSON_OUT) {
  console.log(JSON.stringify(out, null, 2));
} else {
  console.log(`\nverify-delete-drive — ${out.base}\n`);
  console.log(`  A SYNTHETIC Delete, with the feature selected (must NOT delete):`);
  for (const s of out.synthetic) console.log(`    ${s.stillPresent ? "✅ still there" : "⛔ IT DELETED"}  ← dispatched on ${s.where}`);
  if (out.documented) {
    console.log(`\n  THE DOCUMENTED PATH (real key input, escalating to the Properties panel):`);
    console.log(`    ${out.documented.why}`);
    console.log(`    attempts: ${out.documented.attempts.map((a) => `${a.route}${a.stillPresent ? " (no-op)" : " ✓"}`).join(" → ") || "none"}`);
    console.log(`    census ${out.census.before} → ${out.census.after} features · removed ${JSON.stringify(out.documented.removed)}`);
  }
}
if (out.faults.length) {
  console.error(`\n⛔ ${out.faults.length} fault(s):`);
  for (const f of out.faults) console.error(`   ${f}`);
  process.exit(1);
}
console.log(`\n✅ the rule holds: a synthetic keystroke is a silent no-op, and the documented path removes the feature and proves it.\n`);
