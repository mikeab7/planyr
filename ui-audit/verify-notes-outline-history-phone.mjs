/* verify-notes-outline-history-phone — B1203505 (Outline) + B1215536 (History): neither side
 * panel may push a note's own body text off-screen at phone width, in any configuration.
 *
 * ⛔ THIS IS THE HARNESS THAT FOUND B1215536, AND IT MUST KEEP FINDING ITS CLASS. B1203505 fixed
 * `NoteOutline.jsx`; while proving it live, `NoteHistory.jsx` was found to carry the exact same
 * defect (a docked side panel sharing the mat's flex row, no narrow-width treatment) — confirmed
 * by DRIVING it, never assumed from the similarity alone (WRONG-CASE: verify before reporting).
 * Both panels are fixed the same way (never join the row below the phone breakpoint; open as a
 * `position: fixed` overlay instead) and both are checked here, in one run, so a THIRD panel added
 * later to this same row has a harness ready-made to catch it too.
 *
 * MEASURED PROPERLY, not eyeballed: every checkpoint compares `document.scrollWidth` against
 * `window.innerWidth` AND walks the DOM for any element whose right edge escapes the viewport
 * (excluding one legitimately clipped by its own horizontally-scrolling ancestor — the header's
 * sideways-scrolling row on a phone is not a bug). A note is seeded through the REAL UI (real
 * clicks and keystrokes — SYNTHETIC-KEYS-DONT-EDIT), once per engine, then reused across every
 * viewport/theme permutation via a localStorage dump rather than re-typing each time.
 *
 * Run against a local preview server (default) or a live deploy:
 *   npm run build && npm run preview -- --port 4321 --strictPort &
 *   node ui-audit/verify-notes-outline-history-phone.mjs
 *   BASE_URL=https://planyr.io node ui-audit/verify-notes-outline-history-phone.mjs
 *
 * Chromium AND WebKit both run by default — see VERIFICATION.md's "🤖 Self-verification" section
 * for why a claim that WebKit is unavailable here is stale, and for the finding this harness
 * itself produced: WebKit reaches an external URL through this sandbox's proxy where Chromium's
 * own TLS handshake gets the tunnel closed (`--webkit-only` / `--chromium-only` narrow a run).
 */
import { chromium, webkit } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4321";
const CHROME_EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const proxyOpt = REMOTE && PROXY ? { proxy: { server: PROXY, bypass: "localhost,127.0.0.1" } } : {};

const ONLY = process.argv.includes("--webkit-only") ? "webkit" : process.argv.includes("--chromium-only") ? "chromium" : null;
const ENGINES = ONLY ? [ONLY] : ["chromium", "webkit"];

let failures = 0;
let checks = 0;
const fail = (msg) => { failures += 1; console.log(`  ❌ ${msg}`); };
const pass = (msg) => console.log(`  ✅ ${msg}`);

async function launch(engineName) {
  if (engineName === "chromium") {
    return chromium.launch({ executablePath: CHROME_EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"], ...proxyOpt });
  }
  return webkit.launch(proxyOpt);
}

/* ---- ONE-TIME SEED, PER ENGINE: a realistic note authored through the real UI --------------- */

async function seedNote(engineName) {
  const browser = await launch(engineName);
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.goto(`${BASE}/#/notes`, { waitUntil: "domcontentloaded" });
  await assertMeasurable(page, "verify-notes-outline-history-phone");

  const createSel = '[data-testid="notes-empty-create"], [data-testid="notes-new-page"]';
  await page.waitForSelector(createSel, { timeout: 15000 });
  await page.click(createSel);
  await page.waitForSelector('[data-testid="note-mat"]', { timeout: 15000 });
  await page.waitForTimeout(300);

  const title = page.locator('[data-testid="note-title"]').first();
  if (await title.count()) { await title.click(); await page.keyboard.type("Phone Outline/History Fixture"); }

  // ⛔ Click the REAL first paragraph's own text line, not the mat's blank padding below it — a
  // press on blank space in this app places a floating anchored box (B342993/B357008/B350004)
  // instead of the document's own initial paragraph, which is not the shape this fixture wants.
  const firstPara = page.locator(".ProseMirror > p").first();
  const box = await firstPara.boundingBox();
  await page.mouse.click(box.x + 4, box.y + box.height / 2);
  await page.keyboard.type("Opening paragraph before any heading.");
  await page.keyboard.press("Enter");

  const setBlock = async (value) => {
    if (!(await page.locator('[data-testid="nt-block"]').isVisible().catch(() => false))) {
      await page.click('[data-testid="nt-more"]');
      await page.waitForTimeout(150);
    }
    await page.click('[data-testid="nt-block"]');
    await page.click(`[data-testid="nt-block-opt-${value}"]`);
  };

  for (const [level, heading, body] of [
    ["h1", "Overview", "Body text under Overview."],
    ["h2", "Details", "Body text under Details."],
    ["h3", "Sub-detail", "Body text under Sub-detail."],
    ["h4", "Deepest level", "Body text under the deepest heading, long enough to wrap onto more than one line on a narrow phone screen so the overflow check has real prose to look at."],
  ]) {
    await setBlock(level);
    await page.keyboard.type(heading);
    await page.keyboard.press("Enter");
    await page.keyboard.type(body);
    await page.keyboard.press("Enter");
  }

  await page.waitForTimeout(1200); // let the debounced write-through land
  const dump = await page.evaluate(() => {
    const out = {};
    for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); out[k] = localStorage.getItem(k); }
    return out;
  });
  const pageId = Object.keys(dump).find((k) => k.startsWith("planyr:notes:page:v1:"))?.split(":").pop();
  await browser.close();
  return { dump, pageId };
}

/* ---- Seed variants, derived from the one authored document ----------------------------------- */

function stripHeadings(dump, pageId) {
  const out = { ...dump };
  const pageKey = Object.keys(out).find((k) => k.includes(":page:") && k.endsWith(pageId));
  const doc = JSON.parse(out[pageKey]);
  doc.content = doc.content.filter((n) => n.type !== "heading");
  out[pageKey] = JSON.stringify(doc);
  return out;
}

function onlyFirstHeading(dump, pageId) {
  const out = { ...dump };
  const pageKey = Object.keys(out).find((k) => k.includes(":page:") && k.endsWith(pageId));
  const doc = JSON.parse(out[pageKey]);
  const idx = doc.content.findIndex((n) => n.type === "heading");
  doc.content = doc.content.slice(0, idx + 2);
  out[pageKey] = JSON.stringify(doc);
  return out;
}

/* ---- Overflow measurement --------------------------------------------------------------------- */

async function measureOverflow(page, label) {
  checks += 1;
  const result = await page.evaluate(() => {
    const innerWidth = window.innerWidth;
    const scrollWidth = document.documentElement.scrollWidth;
    function clippedByScrollAncestor(el, innerW) {
      let node = el.parentElement;
      while (node && node !== document.body) {
        const cs = getComputedStyle(node);
        const scrolls = cs.overflowX === "auto" || cs.overflowX === "scroll" || cs.overflowX === "hidden";
        if (scrolls) {
          const nr = node.getBoundingClientRect();
          if (nr.right <= innerW + 1) return true;
        }
        node = node.parentElement;
      }
      return false;
    }
    const offenders = [];
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      if (r.right > innerWidth + 1 && !clippedByScrollAncestor(el, innerWidth)) {
        offenders.push({ tag: el.tagName, testid: el.getAttribute("data-testid"), right: Math.round(r.right) });
      }
    }
    return { innerWidth, scrollWidth, offenders: offenders.slice(0, 6), offenderCount: offenders.length };
  });
  const ok = result.scrollWidth <= result.innerWidth && result.offenderCount === 0;
  if (ok) { pass(`${label}: scrollWidth=${result.scrollWidth} innerWidth=${result.innerWidth}, 0 offenders`); }
  else {
    fail(`${label}: scrollWidth=${result.scrollWidth} innerWidth=${result.innerWidth} offenders=${result.offenderCount}`);
    for (const o of result.offenders) console.log(`      - ${o.tag}${o.testid ? `[data-testid=${o.testid}]` : ""} right=${o.right} (viewport ${result.innerWidth})`);
  }
  return ok;
}

/* ---- Open the seeded page, robust to the phone drill-in racing list vs detail ----------------- */

async function openSeededPage(page, pageId) {
  await page.goto(`${BASE}/#/notes`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction((id) => {
    const mat = document.querySelector('[data-testid="note-mat"]');
    if (mat && mat.offsetParent !== null) return true;
    const row = document.querySelector(`[data-testid="notes-row-${id}"]`);
    return !!(row && row.offsetParent !== null);
  }, pageId, { timeout: 15000 });
  await page.waitForTimeout(300);
  if (!(await page.locator('[data-testid="note-mat"]').isVisible().catch(() => false))) {
    const row = page.locator(`[data-testid="notes-row-${pageId}"]`);
    if (await row.isVisible().catch(() => false)) await row.click({ timeout: 5000 }).catch(() => {});
  }
  await page.waitForSelector('[data-testid="note-mat"]', { timeout: 15000, state: "visible" });
  await page.waitForTimeout(250);
}

/* ---- One scenario: open the note, exercise Outline (if any headings) and History ------------- */

async function openHistory(page, narrow) {
  if (!(await page.locator('[data-testid="nt-more"]').isVisible().catch(() => false))) {
    // Wide pane — History's toggle sits in the main row already.
  } else {
    await page.click('[data-testid="nt-more"]');
    await page.waitForTimeout(150);
  }
  const historyBtn = page.locator("button", { hasText: /History/i }).first();
  await historyBtn.click();
  await page.waitForTimeout(narrow ? 300 : 150);
}

async function closeHistory(page) {
  const closeBtn = page.locator('[data-testid="note-history-close"]');
  if (await closeBtn.count()) await closeBtn.click();
  await page.waitForTimeout(150);
}

async function runScenario(engineName, browser, { label, viewport, theme, dumpBuilder, pageId }) {
  const context = await browser.newContext({ viewport, colorScheme: theme, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const dump = dumpBuilder();
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate((entries) => { localStorage.clear(); for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v); }, dump);
  await openSeededPage(page, pageId);
  await assertMeasurable(page, "verify-notes-outline-history-phone");

  console.log(`\n[${engineName}] ${label} (${viewport.width}x${viewport.height}, ${theme})`);
  let ok = await measureOverflow(page, "initial render");
  const narrow = viewport.width < 760;

  /* ---- Outline (only when the note has headings) ---- */
  const hasOutline = await page.locator('[data-testid="note-outline"], [data-testid="note-outline-open"]').count();
  if (hasOutline) {
    if (narrow) {
      const openBtn = page.locator('[data-testid="note-outline-open"]');
      if (await openBtn.count()) {
        const pos = await openBtn.evaluate((el) => getComputedStyle(el).position);
        if (pos !== "fixed") fail(`Outline toggle position is "${pos}", expected "fixed"`); else pass("Outline toggle is position:fixed (costs the row zero width)");
        await openBtn.click();
        await page.waitForTimeout(150);
        ok = (await measureOverflow(page, "Outline opened")) && ok;
        const firstRow = page.locator('[data-testid^="note-outline-row-"]').first();
        if (await firstRow.count()) {
          await firstRow.click();
          await page.waitForTimeout(150);
          const stillOpen = await page.locator('[data-testid="note-outline"]').count();
          if (stillOpen) { fail("Outline drawer did not close after selecting a heading"); ok = false; }
          ok = (await measureOverflow(page, "Outline: after heading tap (drawer closed)")) && ok;
        }
      } else { fail("narrow pane but no floating Outline toggle for a note with headings"); ok = false; }
    } else {
      const docked = await page.locator('[data-testid="note-outline"]').count();
      if (!docked) { fail("wide pane lost its docked Outline rail (regression)"); ok = false; }
      ok = (await measureOverflow(page, "Outline: wide docked rail")) && ok;
    }
  } else {
    console.log("  (no headings — Outline correctly absent)");
  }

  /* ---- History (every scenario — its overflow does not depend on heading count) ---- */
  await openHistory(page, narrow);
  const historyPanel = page.locator('[data-testid="note-history"]');
  if (!(await historyPanel.count())) { fail("History panel did not open at all"); ok = false; }
  else {
    if (narrow) {
      const pos = await historyPanel.evaluate((el) => getComputedStyle(el).position);
      if (pos !== "fixed") fail(`History panel position is "${pos}", expected "fixed"`); else pass("History panel is position:fixed on a phone (never docks in the row)");
    } else {
      const pos = await historyPanel.evaluate((el) => getComputedStyle(el).position);
      if (pos === "fixed") fail("History panel is position:fixed on a WIDE pane (regression — should stay docked)"); else pass("History panel stays docked on a wide pane");
    }
    ok = (await measureOverflow(page, "History opened")) && ok;
    await closeHistory(page);
    const stillOpen = await page.locator('[data-testid="note-history"]').count();
    if (stillOpen) { fail("History panel did not close via its ✕"); ok = false; }
    ok = (await measureOverflow(page, "History: after close")) && ok;
  }

  await context.close();
  return ok;
}

/* ---- Main sweep, per engine -------------------------------------------------------------------- */

async function runEngine(engineName) {
  console.log(`\n==================== ${engineName} ====================`);
  const { dump, pageId } = await seedNote(engineName);
  const browser = await launch(engineName);

  const widths = [320, 360, 375, 390];
  const themes = ["light", "dark"];

  for (const width of widths) {
    for (const theme of themes) {
      await runScenario(engineName, browser, {
        label: "nested headings, portrait", viewport: { width, height: 800 }, theme,
        dumpBuilder: () => dump, pageId,
      });
    }
  }
  for (const viewport of [{ width: 640, height: 320 }, { width: 740, height: 360 }]) {
    await runScenario(engineName, browser, { label: "nested headings, landscape", viewport, theme: "light", dumpBuilder: () => dump, pageId });
  }
  await runScenario(engineName, browser, { label: "NO headings", viewport: { width: 375, height: 800 }, theme: "light", dumpBuilder: () => stripHeadings(dump, pageId), pageId });
  await runScenario(engineName, browser, { label: "ONE heading", viewport: { width: 375, height: 800 }, theme: "dark", dumpBuilder: () => onlyFirstHeading(dump, pageId), pageId });
  await runScenario(engineName, browser, { label: "wide desktop pane (regression)", viewport: { width: 1280, height: 900 }, theme: "light", dumpBuilder: () => dump, pageId });

  await browser.close();
}

async function main() {
  for (const engineName of ENGINES) await runEngine(engineName);
  console.log(`\n${checks} overflow checks run, ${failures} failed.`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
