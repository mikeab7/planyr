#!/usr/bin/env node
/* B850240/NEW-1 — Michael, screenshots on Richfield: "fix that the measurement shows where my
 * cursor is when taking measurement... it gets annoying when trying to click something and
 * there's something over what you're trying to click." Every draft tool's live SF/feet readout
 * used to render as a floating <text> glued to the pointer, directly over the map. This harness
 * proves the fix at the only place that matters — the real rendered app, driven with real mouse
 * gestures — for two representative surfaces: the Measure tool's live Area (SF) readout (the
 * source of his "26,169,663 SF" screenshot, per NEW-2's trace) and an element rect-draw's live
 * w′×h′ readout (Building — the likely source of his "40'" screenshot).
 *
 * WHAT WOULD HAVE MADE A HIT-TEST GUARD MEANINGLESS, so it is not the primary assertion here:
 * every one of these labels already carried pointerEvents:"none" BEFORE this fix (confirmed by
 * reading the source), so `elementFromPoint` at the cursor already skipped the text pre-fix —
 * that check would pass on both the broken and fixed build and prove nothing. The property that
 * actually differs pre/post fix is POSITION: pre-fix the number rendered as an SVG <text> AT the
 * cursor; post-fix no such text exists near the cursor at all, and the value renders instead in
 * a fixed, non-interactive bottom-center strip. So the guard asserts POSITION (this FAILS on the
 * pre-fix source, restorable with `git stash`/`git show HEAD~1` — see the mutation check below)
 * and, as a corroborating secondary check, that elementFromPoint at the old cursor position now
 * resolves to canvas content, never a text node carrying the readout string.
 *
 * USAGE  node ui-audit/verify-live-draft-readout.mjs [--url=http://localhost:4173] [--json]
 * Exit 0 = both scenarios pass. Requires `npm run build && npx vite preview` (or an
 * already-running preview) at --url.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : d; };
const URL_ = arg("url", "http://localhost:4173");
const asJson = process.argv.includes("--json");
const EXEC = process.env.PW_CHROMIUM || "/opt/pw-browsers/chromium";

const NEAR_CURSOR_PX = 60; // generous — pre-fix labels sat 6-14px off the cursor
const NUMERIC_RE = /[\d,]+(\.\d+)?\s*(SF|′|ft)/i;

async function textNodesNearCursor(page, cx, cy) {
  return page.evaluate(({ cx, cy, r }) => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    if (!svg) return [];
    const out = [];
    for (const t of svg.querySelectorAll("text")) {
      const box = t.getBoundingClientRect();
      const tx = box.x + box.width / 2, ty = box.y + box.height / 2;
      const d = Math.hypot(tx - cx, ty - cy);
      if (d <= r && t.textContent && t.textContent.trim()) out.push({ text: t.textContent, dist: Math.round(d) });
    }
    return out;
  }, { cx, cy, r: NEAR_CURSOR_PX });
}

async function readoutState(page) {
  const el = page.getByTestId("live-draft-readout");
  const count = await el.count();
  if (!count) return { present: false };
  const box = await el.first().boundingBox();
  const text = await el.first().textContent();
  return { present: true, box, text: (text || "").trim() };
}

const results = [];
async function scenario(name, fn) {
  const r = { name, ok: false, notes: [] };
  try { await fn(r); r.ok = r.notes.every((n) => !n.startsWith("✗")) && r.notes.some((n) => n.startsWith("✓")); }
  catch (e) { r.notes.push(`✗ threw: ${e.message}`); }
  results.push(r);
}

const run = async () => {
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await assertMeasurable(page, "verify-live-draft-readout");
  page.on("pageerror", (e) => console.log("  ‼ pageerror:", e.message));
  await page.goto(URL_, { waitUntil: "domcontentloaded" });

  await page.getByRole("button", { name: /Site/i }).first().click().catch(() => {});
  await page.getByTestId("map-start-blank-menu-btn").first().click();
  await page.getByTestId("map-start-blank-menu-item").first().click();
  const svg = page.getByTestId("planner-canvas");
  await svg.waitFor({ state: "visible", timeout: 20000 });
  const box = await svg.boundingBox();

  // ── Scenario 1: Measure tool, Area mode — the "26,169,663 SF" surface (NEW-2). ──
  await scenario("measure-area", async (r) => {
    await page.getByLabel("Measure modes").click();
    await page.getByRole("button", { name: "Area" }).click();
    await page.waitForTimeout(150);

    const p1 = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.35 };
    const p2 = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.35 };
    const p3 = { x: box.x + box.width * 0.55, y: box.y + box.height * 0.55 };
    const live = { x: box.x + box.width * 0.35, y: box.y + box.height * 0.55 }; // still mid-draw here
    await page.mouse.click(p1.x, p1.y);
    await page.mouse.click(p2.x, p2.y);
    await page.mouse.click(p3.x, p3.y);
    await page.mouse.move(live.x, live.y, { steps: 4 });
    await page.waitForTimeout(150);

    const near = await textNodesNearCursor(page, live.x, live.y);
    const numericNear = near.filter((n) => NUMERIC_RE.test(n.text));
    r.notes.push(numericNear.length === 0
      ? `✓ no SF/feet <text> within ${NEAR_CURSOR_PX}px of the cursor (${JSON.stringify(near)})`
      : `✗ found a cursor-following readout: ${JSON.stringify(numericNear)}`);

    const ro = await readoutState(page);
    const hasSf = ro.present && /SF/i.test(ro.text);
    r.notes.push(hasSf ? `✓ bottom strip shows "${ro.text}"` : `✗ bottom-center readout missing or wrong: ${JSON.stringify(ro)}`);
    if (ro.present) {
      const paneCenterX = box.x + box.width / 2, chipCenterX = ro.box.x + ro.box.width / 2;
      const centered = Math.abs(chipCenterX - paneCenterX) < box.width * 0.15;
      const nearBottom = (ro.box.y + ro.box.height / 2) > box.y + box.height * 0.7;
      r.notes.push(centered ? "✓ readout is horizontally centered on the canvas" : `✗ readout not centered (chip cx=${chipCenterX}, pane cx=${paneCenterX})`);
      r.notes.push(nearBottom ? "✓ readout sits in the bottom band of the canvas" : `✗ readout not near the bottom (y=${ro.box.y})`);
    }

    const hit = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      return el ? { tag: el.tagName, text: (el.textContent || "").slice(0, 40) } : null;
    }, live);
    const hitIsText = hit && hit.tag === "text" && NUMERIC_RE.test(hit.text);
    r.notes.push(!hitIsText ? `✓ elementFromPoint at the cursor is not the readout (${JSON.stringify(hit)})` : `✗ cursor point still hits the readout text`);

    await page.keyboard.press("Escape").catch(() => {});
  });

  // ── Scenario 2: Building rect-draw — the likely "40'" surface. ──
  await scenario("building-rect", async (r) => {
    await page.getByRole("button", { name: "Select" }).click().catch(() => {});
    await page.getByRole("button", { name: /^Building$/ }).first().click();
    const x0 = box.x + box.width * 0.3, y0 = box.y + box.height * 0.3;
    const x1 = box.x + box.width * 0.42, y1 = box.y + box.height * 0.4; // small drag, > 2ft threshold
    await page.mouse.move(x0, y0); await page.mouse.down();
    await page.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 4 });
    await page.mouse.move(x1, y1, { steps: 4 });
    await page.waitForTimeout(150); // still held down — draftRect is live now

    const near = await textNodesNearCursor(page, x1, y1);
    const numericNear = near.filter((n) => NUMERIC_RE.test(n.text));
    r.notes.push(numericNear.length === 0
      ? `✓ no w′×h′ <text> within ${NEAR_CURSOR_PX}px of the cursor (${JSON.stringify(near)})`
      : `✗ found a cursor-following readout: ${JSON.stringify(numericNear)}`);

    const ro = await readoutState(page);
    const hasFt = ro.present && /×/.test(ro.text);
    r.notes.push(hasFt ? `✓ bottom strip shows "${ro.text}"` : `✗ bottom-center readout missing or wrong: ${JSON.stringify(ro)}`);

    await page.mouse.up();
    await page.keyboard.press("Escape").catch(() => {});
  });

  await browser.close();

  if (asJson) { console.log(JSON.stringify({ url: URL_, results }, null, 2)); }
  else {
    console.log("\n=== live-draft-readout — B850240/NEW-1 ===");
    for (const r of results) {
      console.log(`\n[${r.ok ? "PASS" : "FAIL"}] ${r.name}`);
      for (const n of r.notes) console.log("  " + n);
    }
  }
  const ok = results.every((r) => r.ok);
  console.log(ok ? "\n✓ ALL PASS" : "\n✗ FAILURES ABOVE");
  process.exit(ok ? 0 : 1);
};
run().catch((e) => { console.error(e); process.exit(1); });
