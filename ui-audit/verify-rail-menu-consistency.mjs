/* B849584–B849588 — Site module right-rail design-consistency block, live headless verify.
 * ATTEMPT-BEFORE-YOU-PARK: every one of these is checkable logged-out on a seeded, zero-parcel
 * site (the exact repro Michael measured), so this drives the real app instead of filing a V###.
 *
 * Checks, one block per item:
 *   NEW-1 (B849584) — an open flyout trigger reads as menu-open, distinct from the orange
 *     active-tool fill; an unrelated row (Select) is unaffected.
 *   NEW-2 (B849585) — a disabled Parcel-tools row is measurably different (opacity) from an
 *     enabled sibling; a fully-disabled group states its reason once.
 *   NEW-3 (B849586) — the Parcel tools flyout sits flush against the rail (an unbroken shared
 *     edge) and does not internally scroll at 720/760px viewport heights.
 *   NEW-4 (B849587) — every flyout-bearing rail row uses the same caret affordance (a separate
 *     26px caret button), and the flyout lands right under the caret that opened it, not off to
 *     the left of the whole row.
 *   NEW-5 (B849588) — the empty-state card names the control that actually adds a parcel from
 *     county records, in the same words the Parcel tools menu itself uses.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5183/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

let failed = false;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`); if (!ok) failed = true; };

// Zero parcels, origin SET (hasOrigin true) — the exact repro: a real, on-the-map site with no
// parcels yet, so "Draw new parcel"/"Click a lot on the map"/"Add by address" are enabled and the
// nine modify/remove-group rows are disabled (matches Michael's own measured 4-enabled/9-disabled split).
const site = {
  id: "rail-consistency-demo", groupId: "rail-consistency-demo", site: "Rail Consistency Demo", name: "Plan 1",
  origin: { lat: 29.786, lon: -95.83 }, county: "harris",
  parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null,
  updatedAt: Date.now(), data: { status: "active" },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [site.id]: site })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(site.id)});
} catch (e) {} })();`;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-rail-menu-consistency");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2200);
  return { ctx, page };
}

const { ctx: ctx1, page } = await newPage({ width: 1440, height: 900 });
const svg = await page.$("svg[aria-label='Site plan canvas']");
check("planner canvas rendered", !!svg);
if (!svg) { await browser.close(); process.exit(1); }

const dismiss = () => page.mouse.click(5, 5);

/* ── NEW-5: empty-state vocabulary ─────────────────────────────────────────────────────────────── */
const emptyStateText = await page.evaluate(() => {
  const el = [...document.querySelectorAll("div")].find((d) => d.textContent.trim() === "Start your site");
  return el ? el.parentElement.textContent : "";
});
check('empty state says "Click a lot on the map"', emptyStateText.includes("Click a lot on the map"), emptyStateText);
check('empty state points at "Parcel tools"', emptyStateText.includes("Parcel tools"), emptyStateText);
check('empty state no longer sends a new user to the "Map" button', !/["“]Map["”]\s*button/i.test(emptyStateText), emptyStateText);

/* ── NEW-4: caret affordance — every flyout trigger has its own 26px caret button ─────────────── */
const parcelToolsBtn = page.locator('[data-testid="rail-parcel-tools"]');
check("Parcel tools trigger renders (main row)", (await parcelToolsBtn.count()) === 1);
const parcelCaret = page.locator('button[aria-label="Parcel tools"]');
check("Parcel tools now has its own separate caret button", (await parcelCaret.count()) === 1);
if (await parcelCaret.count()) {
  const w = await parcelCaret.evaluate((el) => Math.round(el.getBoundingClientRect().width));
  check("Parcel tools caret is 26px wide (matches the other five)", w === 26, `measured ${w}px`);
}
for (const [label, caretLabel] of [["Measure", "Measure modes"], ["Building", "Dock layout"], ["Road", "Road presets"], ["Parking", "Parking type"], ["Easement", "Easement options"]]) {
  const caret = page.getByRole("button", { name: caretLabel });
  const w = await caret.evaluate((el) => Math.round(el.getBoundingClientRect().width)).catch(() => null);
  check(`${label} caret is a separate 26px button`, w === 26, `measured ${w}px`);
}
const pavingHasNoCaret = await page.evaluate(() => {
  const paving = [...document.querySelectorAll(".rbtn")].find((b) => b.textContent.trim().startsWith("Paving"));
  if (!paving) return null;
  const sib = paving.nextElementSibling;
  return !(sib && sib.tagName === "BUTTON" && Math.round(sib.getBoundingClientRect().width) === 26);
});
check("Paving (no submenu) still has no caret button", pavingHasNoCaret === true, `pavingHasNoCaret=${pavingHasNoCaret}`);

/* ── NEW-4: placement — the flyout lands under the caret, not off the whole row's left edge ────── */
const measureCaret = page.getByRole("button", { name: "Measure modes" });
const measureCaretBox = await measureCaret.boundingBox();
await measureCaret.click();
await page.waitForTimeout(200);
const measureMenuPanel = page.locator("body > div.menu").last();
const measureMenuBox = await measureMenuPanel.boundingBox();
const gapFromCaret = measureCaretBox && measureMenuBox ? Math.abs(measureCaretBox.x + measureCaretBox.width - (measureMenuBox.x + measureMenuBox.width)) : null;
check("Measure flyout's right edge lands near the caret's right edge (not ~150px off to the left)", gapFromCaret != null && gapFromCaret < 20, `Δ=${gapFromCaret}`);
await dismiss();
await page.waitForTimeout(150);

/* ── NEW-1: open state — Parcel tools reads as open, Select (unrelated) is unaffected ──────────── */
const selectBtn = page.getByRole("button", { name: /^Select\b/ }).first();
const selectBgBefore = await selectBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
const parcelToolsBgClosed = await parcelToolsBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
await parcelToolsBtn.click();
await page.waitForTimeout(150);
const parcelToolsBgOpen = await parcelToolsBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
const selectBgAfter = await selectBtn.evaluate((el) => getComputedStyle(el).backgroundColor);
check("Parcel tools trigger's background changes when its own menu opens", parcelToolsBgOpen !== parcelToolsBgClosed, `${parcelToolsBgClosed} → ${parcelToolsBgOpen}`);
check("Select's own background is unaffected by Parcel tools' menu opening", selectBgAfter === selectBgBefore, `${selectBgBefore} → ${selectBgAfter}`);
// The open state must not be the ember active-tool fill (rgb(194, 65, 12) family) — never claim "armed".
check("Parcel tools' open background is NOT the ember active-tool fill", !/194,\s*65,\s*12/.test(parcelToolsBgOpen), parcelToolsBgOpen);

/* ── NEW-3: tether — flush against the rail, no gap ─────────────────────────────────────────────── */
const railEl = selectBtn.locator("xpath=ancestor::div[contains(@class,'dark-scroll')]");
const railBox = await railEl.boundingBox();
const toolMenuPanel = page.locator("body > div.menu").last();
const toolMenuBox = await toolMenuPanel.boundingBox();
// "Unbroken shared edge" means no sliver of exposed canvas between the panel and the rail's own
// OUTER edge — the panel's right edge must reach at least that far (gap={0} on the AnchoredMenu
// call anchors it to the row's own left edge, which sits *inside* the rail's own padding, so the
// panel overlapping a few px into the rail's padding is the correct, seamless outcome — a literal
// gap back to the rail's outer boundary is the defect this guards against).
const railOuterLeft = railBox ? railBox.x : null;
const menuRight = toolMenuBox ? toolMenuBox.x + toolMenuBox.width : null;
const exposedCanvasGap = railOuterLeft != null && menuRight != null ? railOuterLeft - menuRight : null;
check("Parcel tools flyout sits flush against the rail (no exposed-canvas gap)", exposedCanvasGap != null && exposedCanvasGap <= 1, `exposedGap=${exposedCanvasGap}`);

/* ── NEW-2: disabled rows are measurably different + fully-disabled groups state a reason ──────── */
const drawRow = page.locator('[data-parcel-action="draw"]');
const deleteRow = page.locator('[data-parcel-action="deleteSelected"]');
const drawOpacity = await drawRow.evaluate((el) => getComputedStyle(el).opacity);
const deleteOpacity = await deleteRow.evaluate((el) => getComputedStyle(el).opacity);
check("enabled row (Draw new parcel) renders at full opacity", parseFloat(drawOpacity) === 1, drawOpacity);
check("disabled row (Delete this parcel) renders at a measurably lower opacity", parseFloat(deleteOpacity) < 0.9 && parseFloat(deleteOpacity) > 0, deleteOpacity);
check("disabled vs enabled opacity actually differs", drawOpacity !== deleteOpacity, `${drawOpacity} vs ${deleteOpacity}`);
const deleteDisabledAttr = await deleteRow.getAttribute("disabled");
check("disabled row carries the native `disabled` attribute", deleteDisabledAttr !== null);

const modifyReason = page.locator('[data-parcel-group-reason="modify"]');
const removeReason = page.locator('[data-parcel-group-reason="remove"]');
check('"Change a parcel" group states a reason (fully disabled)', (await modifyReason.count()) === 1, await modifyReason.textContent().catch(() => ""));
check('"Remove" group states a reason (fully disabled)', (await removeReason.count()) === 1, await removeReason.textContent().catch(() => ""));
const createReasonCount = await page.locator('[data-parcel-group-reason="create"]').count();
check('"Add land" group (not fully disabled) has NO reason line', createReasonCount === 0);

await dismiss();
await page.waitForTimeout(150);
await ctx1.close();

/* ── NEW-3: no internal scroll at 720 / 760px viewport heights ─────────────────────────────────── */
for (const h of [720, 760]) {
  const { ctx, page: p } = await newPage({ width: 1440, height: h });
  const parcelBtn = p.locator('[data-testid="rail-parcel-tools"]');
  await parcelBtn.click();
  await p.waitForTimeout(200);
  const panel = p.locator("body > div.menu").last();
  const overflow = await panel.evaluate((el) => ({ scrollH: el.scrollHeight, clientH: el.clientHeight }));
  check(`Parcel tools flyout does not internally scroll at ${h}px viewport height`, overflow.scrollH <= overflow.clientH + 1, JSON.stringify(overflow));
  await ctx.close();
}

await browser.close();
console.log(failed ? "\n✗ FAIL — see above" : "\n✓ ALL PASS");
process.exit(failed ? 1 : 0);
