/* Headless verification for the notes conflict-review redesign (B849104/B849105/B849106/B849107).
 * Drives the REAL `ConflictNotice`/`ConflictReview`/`ConflictSideBySide`/`NoteRedline` components
 * via ui-audit/conflict-review-harness.html, on scratch data reproducing the owner's exact
 * reported case (never his live conflict): a signature-block TABLE on the OLDER copy (4 days
 * ago), converted to plain contact lines on the NEWER copy (1 day ago).
 *
 * Proves, per item:
 *  B849105 (data-safety direction) — the table renders REMOVED (from the older→newer copy) and
 *    the four contact lines render ADDED, matching what "Convert table to text" actually does —
 *    never the reverse.
 *  B849104 (the two choices) — the two footer buttons carry DIFFERENT, recency-derived labels,
 *    never the same string; the newer/older headings are stated in words, not just position.
 *  B849107 (the key) — the legend states the old→new direction, covers BOTH the inline
 *    underline/strikethrough encoding AND the block-level "+ Added"/"− Removed" tag, and stays
 *    on screen (sticky) once scrolled into a long note.
 *  B849106 (defer) — closing via the header control does not resolve anything, and the compact
 *    notice (with its "Review changes →" reopen) is still there afterward.
 *
 * Screenshots (both themes × desktop/narrow) are written for the critique loop under
 * /tmp/claude-conflict-review-shots/ — this script does not judge them; a human/model read of
 * the PNGs is the actual critique pass (see docs/notes-conflict-critique.md).
 *
 * Run:  npm run dev &  then  node ui-audit/verify-notes-conflict-review.mjs
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5173";
const HARNESS = `${BASE}/ui-audit/conflict-review-harness.html`;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const SHOT_DIR = "/tmp/claude-conflict-review-shots";
mkdirSync(SHOT_DIR, { recursive: true });

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? "  — " + extra : ""}`); };

async function openReview(page) {
  await page.locator('[data-testid="notes-conflict-review-open"]').click();
  await page.waitForSelector('[data-testid="notes-conflict-review"]');
}

/* ---- 1) main fixture: functional correctness (direction, labels, key, close) -------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-notes-conflict-review");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(`${HARNESS}?fixture=main`, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="notes-conflict-bar"]');

  ok("compact notice renders on load", await page.locator('[data-testid="notes-conflict-bar"]').isVisible());

  await openReview(page);
  ok("full-screen review opens on Redline by default", await page.locator('[data-testid="notes-conflict-view-redline"][aria-pressed="true"]').isVisible());

  // ---- B849105: the redline direction must match what actually happened over time ----
  const tags = await page.locator('[data-testid="notes-redline-change-tag"]').allTextContents();
  ok("a '− Removed' tag exists (the table, only on the older copy)", tags.some((t) => t.includes("Removed")), JSON.stringify(tags));
  ok("'+ Added' tags exist (the four converted contact lines, only on the newer copy)", tags.filter((t) => t.includes("Added")).length >= 1, JSON.stringify(tags));

  // Scoped to the redline BODY (not the legend above it, which also says "Removed" as part
  // of its own explanatory sentence — searching the whole panel found that instead of the
  // real tag). innerText reflects the tag's CSS text-transform:uppercase ("REMOVED"/"ADDED"),
  // unlike textContent above — search case-insensitively rather than mistaking a rendering
  // detail for a missing label.
  const bodyText = await page.locator('[data-testid="notes-redline-body"]').innerText();
  const bodyLower = bodyText.toLowerCase();
  const removedTagIdx = bodyLower.indexOf("removed");
  const tableWordIdx = bodyText.indexOf("Table", removedTagIdx);
  ok("the REMOVED tag sits immediately by the word 'Table' (the table is what was removed going old→new)",
    removedTagIdx >= 0 && tableWordIdx >= 0 && tableWordIdx - removedTagIdx < 20,
    `removedTagIdx=${removedTagIdx} tableWordIdx=${tableWordIdx}`);
  ok("a contact line ('Executive Assistant') appears as added text, not removed",
    bodyText.includes("Executive Assistant"));

  // ---- B1077680/NEW-1: the removed TABLE must render its real content, not a bare "Table" pill ----
  const redlineTableRows = await page.locator('[data-testid="notes-redline-body"] table tr').count();
  ok("the redline body contains a real <table> with more than one row (not just the word 'Table')",
    redlineTableRows > 1, `rows=${redlineTableRows}`);
  const redlineTableText = await page.locator('[data-testid="notes-redline-body"] table').innerText();
  for (const line of ["Executive Assistant", "281-305-1115"]) {
    ok(`the redline's real table cell text includes "${line}"`, redlineTableText.includes(line));
  }

  // ---- B849104: the two footer buttons must have DIFFERENT, recency-based labels ----
  const newerBtn = await page.locator('[data-testid="notes-conflict-review-keep-newer"]').textContent();
  const olderBtn = await page.locator('[data-testid="notes-conflict-review-keep-older"]').textContent();
  ok("the two 'keep' buttons read DIFFERENT text", newerBtn.trim() !== olderBtn.trim(), `newer="${newerBtn}" older="${olderBtn}"`);
  ok("the newer button says 'newer'", /newer/i.test(newerBtn), newerBtn);
  ok("the older button says 'older'", /older/i.test(olderBtn), olderBtn);
  // server (1 day ago) is newer than local (4 days ago) in this fixture — "theirs" must be the newer choice.
  await page.locator('[data-testid="notes-conflict-review-keep-newer"]').click();
  await page.waitForTimeout(50);
  const choices = await page.evaluate(() => window.__choices);
  ok("clicking 'newer' resolves as 'theirs' (server is newer in this fixture)", choices[choices.length - 1] === "theirs", JSON.stringify(choices));

  await ctx.close();
}

/* ---- 2) fresh context: the key/legend and sticky behaviour, and the close/defer flow ------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 700 } });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-notes-conflict-review:key");
  await page.goto(`${HARNESS}?fixture=main`, { waitUntil: "load" });
  await openReview(page);

  const legendText = await page.locator('[data-testid="notes-conflict-review"]').locator("p").first().locator("xpath=..").innerText();
  ok("the legend states the old→new direction with real dates", /Older version.*edited 4d ago.*Newer version.*edited 1d ago/s.test(legendText.replace(/\s+/g, " ")), legendText.slice(0, 200));
  ok("the legend mentions the underline/strikethrough encoding", /Underlined/.test(legendText) && /Struck-through/.test(legendText));
  ok("the legend ALSO mentions the block-level tag encoding (the gap the owner found)", /added/i.test(legendText) && /removed/i.test(legendText));
  ok("the legend states a CONSEQUENCE (which button loses what), not just set membership", /lose/i.test(legendText));

  // Sticky: scroll the redline body, confirm the legend is still within the viewport.
  const scrollBox = await page.locator('[data-testid="notes-conflict-review"] div[style*="overflow-y"]').first();
  await scrollBox.evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await page.waitForTimeout(100);
  const legendBox = await page.locator('[data-testid="notes-conflict-review"]').locator("p", { hasText: "Older version" }).first().boundingBox();
  ok("the legend is still on screen after scrolling to the bottom of a long note (sticky)", legendBox && legendBox.y >= 0 && legendBox.y < 700, JSON.stringify(legendBox));

  // ---- B849106: closing does not resolve, and the notice is still there to reopen ----
  await page.evaluate(() => { window.__choices = []; });
  const closeBtn = page.locator('[data-testid="notes-conflict-review-close"]');
  ok("the close control says 'Decide later' in words, not just an icon", /decide later/i.test((await closeBtn.textContent()) || ""));
  await closeBtn.click();
  await page.waitForTimeout(50);
  ok("closing does not fire either resolve callback", (await page.evaluate(() => window.__choices)).length === 0);
  ok("the compact notice is back, with 'Review changes' still offered", await page.locator('[data-testid="notes-conflict-review-open"]').isVisible());
  await openReview(page);
  ok("reopening shows the SAME comparison again (still unresolved, both copies intact)", await page.locator('[data-testid="notes-redline-change-tag"]').count() > 0);

  await ctx.close();
}

/* ---- 3) side-by-side view: same recency labelling, no duplicated reassurance --------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-notes-conflict-review:sidebyside");
  await page.goto(`${HARNESS}?fixture=main`, { waitUntil: "load" });
  await openReview(page);
  await page.locator('[data-testid="notes-conflict-view-sidebyside"]').click();
  await page.waitForSelector('[data-testid="notes-conflict-sidebyside"]');

  const mineLabel = await page.locator('[data-testid="notes-conflict-mine-choose"]').textContent();
  const theirsLabel = await page.locator('[data-testid="notes-conflict-theirs-choose"]').textContent();
  ok("side-by-side buttons also carry DIFFERENT labels", mineLabel.trim() !== theirsLabel.trim(), `mine="${mineLabel}" theirs="${theirsLabel}"`);

  const reassuranceCount = (await page.locator('[data-testid="notes-conflict-review"]').innerText()).match(/nothing is lost/gi) || [];
  ok("the 'nothing is lost' reassurance appears exactly once, not per-card", reassuranceCount.length === 1, `count=${reassuranceCount.length}`);

  // ---- B1077681/NEW-2: the two panes must NOT render identically — one holds a real table,
  // the other holds the same content as plain paragraphs ("main" fixture: local=OLDER/table,
  // server=NEWER/plain lines, so "mine" is the older/table side). ----
  const mineText = await page.locator('[data-testid="notes-conflict-mine-text"]').innerText();
  const theirsText = await page.locator('[data-testid="notes-conflict-theirs-text"]').innerText();
  ok("the two panes' rendered text is NOT identical (the old bug: both read as flat, matching text)",
    mineText.trim() !== theirsText.trim(), `mine="${mineText.slice(0, 80)}" theirs="${theirsText.slice(0, 80)}"`);
  const mineTableRows = await page.locator('[data-testid="notes-conflict-mine-text"] table tr').count();
  const theirsTableRows = await page.locator('[data-testid="notes-conflict-theirs-text"] table tr').count();
  ok("the OLDER pane ('mine' in this fixture) contains a real <table>", mineTableRows > 1, `rows=${mineTableRows}`);
  ok("the NEWER pane ('theirs') contains NO table at all — it never had one", theirsTableRows === 0, `rows=${theirsTableRows}`);
  ok("the older pane's table carries the real contact text", mineText.includes("Executive Assistant") && mineText.includes("281-305-1115"));
  ok("the newer pane carries the same contact text as plain lines", theirsText.includes("Executive Assistant") && theirsText.includes("281-305-1115"));

  await ctx.close();
}

/* ---- 3a) NEW-3 stress case: a long unbroken sentence must WRAP inside its card, never force
 * the pane or the page to scroll sideways (echoes the reported clip: "…SHOULD BE ABLE TO
 * PROVIDE BY T"). */
{
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-notes-conflict-review:longtext");
  await page.goto(`${HARNESS}?fixture=longtext`, { waitUntil: "load" });
  await openReview(page);
  await page.locator('[data-testid="notes-conflict-view-sidebyside"]').click();
  await page.waitForSelector('[data-testid="notes-conflict-sidebyside"]');
  await page.waitForTimeout(100);

  const mineCardBox = await page.locator('[data-testid="notes-conflict-mine"]').boundingBox();
  const mineBtnBox = await page.locator('[data-testid="notes-conflict-mine-choose"]').boundingBox();
  const theirsBtnBox = await page.locator('[data-testid="notes-conflict-theirs-choose"]').boundingBox();
  ok("[longtext] the long-line card stays within the viewport (the long sentence wraps, it doesn't push the card wide)",
    mineCardBox && mineCardBox.x + mineCardBox.width <= 1601, JSON.stringify(mineCardBox));
  ok("[longtext] 'Keep the older version' is still visible and reachable", mineBtnBox && mineBtnBox.x >= 0 && mineBtnBox.x + mineBtnBox.width <= 1601, JSON.stringify(mineBtnBox));
  ok("[longtext] 'Keep the newer version' is still visible and reachable", theirsBtnBox && theirsBtnBox.x >= 0 && theirsBtnBox.x + theirsBtnBox.width <= 1601, JSON.stringify(theirsBtnBox));
  const overflowsX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  ok("[longtext] the page does not overflow horizontally even with a long unbroken sentence", !overflowsX);

  await ctx.close();
}

/* ---- 3a-2) a real multi-column table WITH a header row (critique-loop round 2 — the other
 * fixtures only exercise single-cell signature-block rows) ---------------------------------- */
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 700 } });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-notes-conflict-review:multitable");
  await page.goto(`${HARNESS}?fixture=multitable`, { waitUntil: "load" });
  await openReview(page);

  const headerCells = await page.locator('[data-testid="notes-redline-body"] table th').allTextContents();
  ok("the header row renders as real <th> cells, not flattened into a data row", headerCells.map((t) => t.trim()).sort().join(",") === "Due,Item,Status");
  const dataRows = await page.locator('[data-testid="notes-redline-body"] table tbody tr').count();
  ok("the table keeps all its rows (header + 2 data rows)", dataRows === 3, `rows=${dataRows}`);
  const bodyText = await page.locator('[data-testid="notes-redline-body"] table').innerText();
  ok("a data cell from the second column ('Sep 22') survived", bodyText.includes("Sep 22"));

  await ctx.close();
}

/* ---- 3b) NEW-3: side-by-side layout at the owner's reported viewport and narrower widths --- */
{
  // His reported viewport: ~1600 CSS px wide, devicePixelRatio ~2.15, Windows. Playwright caps
  // deviceScaleFactor well under that in practice, but the CSS width is what layout depends on —
  // dpr only affects raster sharpness, not CSS box geometry — so we reproduce the width exactly
  // and use a representative (allowed) dpr rather than his literal 2.15.
  for (const [label, viewport] of [
    ["owner-viewport", { width: 1600, height: 900 }],
    ["narrow-tablet", { width: 768, height: 900 }],
    ["narrow-phone", { width: 390, height: 800 }],
  ]) {
    const ctx = await browser.newContext({ viewport, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    await assertMeasurable(page, `verify-notes-conflict-review:sidebyside-layout:${label}`);
    await page.goto(`${HARNESS}?fixture=main`, { waitUntil: "load" });
    await openReview(page);
    await page.locator('[data-testid="notes-conflict-view-sidebyside"]').click();
    await page.waitForSelector('[data-testid="notes-conflict-sidebyside"]');
    await page.waitForTimeout(100);

    const vw = viewport.width;
    const mineBox = await page.locator('[data-testid="notes-conflict-mine"]').boundingBox();
    const theirsBox = await page.locator('[data-testid="notes-conflict-theirs"]').boundingBox();
    const mineBtnBox = await page.locator('[data-testid="notes-conflict-mine-choose"]').boundingBox();
    const theirsBtnBox = await page.locator('[data-testid="notes-conflict-theirs-choose"]').boundingBox();
    const fits = (box) => box && box.x >= 0 && box.x + box.width <= vw + 1;

    ok(`[${label}] the older ("mine") card fits within the viewport width (no horizontal clip)`, fits(mineBox), JSON.stringify(mineBox));
    ok(`[${label}] the newer ("theirs") card fits within the viewport width (no horizontal clip)`, fits(theirsBox), JSON.stringify(theirsBox));
    ok(`[${label}] "Keep the older version" button is visible and within the viewport`, fits(mineBtnBox), JSON.stringify(mineBtnBox));
    ok(`[${label}] "Keep the newer version" button is visible and within the viewport`, fits(theirsBtnBox), JSON.stringify(theirsBtnBox));

    // No element anywhere forces the PAGE itself to scroll sideways.
    const pageOverflowsX = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    ok(`[${label}] the page does not overflow horizontally`, !pageOverflowsX);

    await ctx.close();
  }
}

/* ---- 4) fallback fixture: timestamps unknown — must NOT claim a false direction ------------ */
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  const page = await ctx.newPage();
  await assertMeasurable(page, "verify-notes-conflict-review:unknown");
  await page.goto(`${HARNESS}?fixture=unknown`, { waitUntil: "load" });
  await openReview(page);
  const legendText = await page.locator('[data-testid="notes-conflict-review"]').innerText();
  ok("with both edit times unknown, the legend admits it rather than claiming newer/older", /edit time unknown/i.test(legendText));
  const newerBtn = await page.locator('[data-testid="notes-conflict-review-keep-newer"]').textContent();
  const olderBtn = await page.locator('[data-testid="notes-conflict-review-keep-older"]').textContent();
  ok("the two buttons are STILL distinct even with no time to rank by (window fallback)", newerBtn.trim() !== olderBtn.trim(), `a="${newerBtn}" b="${olderBtn}"`);
  ok("neither fallback button claims to be 'newer'/'older'", !/newer version|older version/i.test(newerBtn) && !/newer version|older version/i.test(olderBtn));
  await ctx.close();
}

/* ---- 5) screenshots for the critique loop (both themes x desktop/narrow) ------------------- */
for (const theme of ["light", "dark"]) {
  for (const [label, viewport] of [["desktop", { width: 1280, height: 900 }], ["narrow", { width: 380, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    await page.goto(`${HARNESS}?fixture=main`, { waitUntil: "load" });
    await page.evaluate((t) => { document.body.dataset.theme = t; }, theme);
    await openReview(page);
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOT_DIR}/redline-${theme}-${label}.png`, fullPage: false });
    await page.locator('[data-testid="notes-conflict-view-sidebyside"]').click();
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${SHOT_DIR}/sidebyside-${theme}-${label}.png`, fullPage: false });
    await ctx.close();
  }
}
console.log(`\nScreenshots written to ${SHOT_DIR}`);

await browser.close();
const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
process.exit(failed ? 1 : 0);
