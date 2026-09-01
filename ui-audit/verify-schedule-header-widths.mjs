/* B1012560/B1017840 — Schedule header Row 2 (tabs | center group | toolbar), the ONE 3-zone
 * layout in this app. Three owner reports on the same header, in order:
 *
 *   (1) NARROW — "the header breaks on the schedule module" (2026-09-01). The old equal 50/50
 *       split clipped the tab strip below ~1108px container width.
 *   (2) WIDE — "i had it on my large laptop and it messed up." The old split also left the
 *       Grid/Split/Gantt center group sitting a CONSTANT ~135px off-center at every width from
 *       1280 to 2560.
 *   (1) and (2) were fixed together (B1012560): tabs and toolbar zones are content-sized and
 *       never grow; the center zone is the only zone that grows, splitting leftover width evenly.
 *
 *   (3) RESIDUAL, reported after that fix merged — a NEGATIVE gap ("overlap") measured on the
 *       DEPLOYED production build at 960px and below, where total content (tabs + center +
 *       toolbar) genuinely exceeds the container width. INVESTIGATED (B1017840) and REFUTED as a
 *       real defect: at 960/900/800 the row correctly WRAPS the toolbar cluster onto its own
 *       second line (Row 2's `flexWrap:"wrap"`, working exactly as the file's own long-standing
 *       comment says it should) — proven with real screenshots and precise DOM geometry showing
 *       the center group's content and the toolbar's content sit on two DIFFERENT vertical
 *       positions (rows), never touching. The reported "-158px gap" was a real number produced by
 *       a probe that measured the horizontal (left/right) distance between the center group and
 *       the toolbar WITHOUT checking whether they were on the same line — exactly the kind of
 *       instrument gap this repo's own house rules warn about (a 1D gap between two elements on
 *       different rows reads as a large negative overlap even when nothing touches). No overlap.
 *       No clipping. Confirmed at every width tested, in BOTH real toolbar-width states Schedule
 *       can be in (Grid view — no zoom cluster; Split/Gantt view — with one, which is wider and
 *       so wraps at a different container width).
 *
 * THIS HARNESS now checks the RIGHT thing at every width: on a single line, the two gaps either
 * side of the center group must be equal (or, at the narrow end, every module tab must still
 * resolve to itself); on two lines, the center group's real content and the toolbar's real
 * content must not intersect as actual 2D rectangles — never a same-line-assuming 1D gap.
 *
 * Run:  npm run dev -- --port 5199 --strictPort      (separate shell)
 *       node ui-audit/verify-schedule-header-widths.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5199";
const PAGE_URL = `${BASE}/ui-audit/header-schedule-harness.html`;
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

// 900/960/1024 are the widths the first report named as clipped pre-fix; 1108 is the exact
// measured break point of the ORIGINAL bug. 800 and 761 (just above the 760px phone breakpoint,
// where the row switches to horizontal-scroll instead) extend coverage down through the
// wrap-to-second-line range the residual report was about.
const NARROW_WIDTHS = [900, 960, 1024, 1108];
const WRAP_RANGE_WIDTHS = [1024, 975, 960, 900, 800, 761];
const WIDE_WIDTHS = [1440, 1600, 1920, 2560];
// A gap difference below this reads as "centered" to the eye; the pre-fix defect was ~135px.
const GAP_TOLERANCE_PX = 3;
const SCOPES = ["grid", "split"]; // Schedule's two real toolbar-width states

const results = [];
const ok = (n, pass, d = "") => { results.push({ n, pass }); console.log(`  ${pass ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); };

/* The sandbox ships Chromium under /opt/pw-browsers (PLAYWRIGHT_BROWSERS_PATH); the pinned build
 * number moves, so resolve the newest one present rather than hardcoding a revision. */
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]
    .find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, deviceScaleFactor: 1 });
  await assertMeasurable(page, "verify-schedule-header-widths");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(PAGE_URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__READY__ === true, { timeout: 15000 });

  /* Every point inside `el`, 1px inside each edge — same sweep verify-header-nav-clickable.mjs
   * uses. A tab that has been squeezed under the equal split answers with the neighbouring
   * zone's content instead of itself somewhere inside its own reported box. */
  const probe = (scope) => page.evaluate((scope) => {
    const root = document.querySelector(`[data-scope="${scope}"]`);
    const sweep = (el) => {
      const r = el.getBoundingClientRect();
      const bad = [];
      const xs = [], ys = [];
      for (let x = Math.ceil(r.left) + 1; x <= Math.floor(r.right) - 1; x += 2) xs.push(x);
      for (const f of [0.25, 0.5, 0.75]) ys.push(Math.round(r.top + r.height * f));
      for (const x of xs) for (const y of ys) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(el.contains(hit) || hit === el)) {
          bad.push({ x, y, hit: hit ? (hit.getAttribute("data-testid") || hit.tagName + (hit.textContent || "").slice(0, 24)) : "null" });
        }
      }
      return { sampled: xs.length * ys.length, bad, box: { left: r.left, right: r.right, width: r.width } };
    };
    const tabs = [...root.querySelectorAll('[data-testid^="module-tab-"]')];
    // The center group is TWO controls (Grid/Split/Gantt toggle + the review-inbox button) — its
    // tight content box is the union of both, never just the toggle alone, or the inbox button's
    // own width gets mistaken for empty space on one side.
    const centerParts = [
      root.querySelector('[role="group"][aria-label="View"]'),
      root.querySelector('[title="Review suggested updates from forwarded emails"]'),
    ].filter(Boolean);
    // The toolbar's tight content box is the union of EVERY one of its children (not just the
    // first), because the overlap question is "does the center group's content touch ANY part of
    // the toolbar's content" — the first child alone would miss an overlap further along the row.
    const toolbarFirst = root.querySelector('[title^="Zoom out"]') || root.querySelector('[title^="Export"]');
    const toolbarParts = toolbarFirst ? [...toolbarFirst.parentElement.children] : [];
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width }; };
    const unionBox = (els) => {
      if (!els.length) return null;
      const rects = els.map((el) => el.getBoundingClientRect());
      return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)), top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)) };
    };
    const lastTab = tabs[tabs.length - 1];
    return {
      vw: window.innerWidth,
      tabCount: tabs.length,
      tabSweeps: tabs.map((t) => ({ id: t.getAttribute("data-testid"), ...sweep(t) })),
      lastTabBox: lastTab ? box(lastTab) : null,
      centerBox: unionBox(centerParts),
      toolbarBox: unionBox(toolbarParts),
    };
  }, scope);

  /* Standard AABB (axis-aligned bounding box) rectangle intersection — the only correct way to
   * ask "do these two things overlap" once they can be on different lines. A 1D left/right gap
   * comparison is what produced the false "-158px overlap" this harness exists to refute. */
  const rectsOverlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  console.log("── narrow widths — the original reported clip ──");
  for (const scope of SCOPES) {
    console.log(`\n  scope: ${scope}`);
    for (const w of NARROW_WIDTHS) {
      await page.setViewportSize({ width: w, height: 700 });
      await page.waitForTimeout(150);
      const m = await probe(scope);

      ok(`${scope}@${w}: all six module tabs are rendered`, m.tabCount === 6, `${m.tabCount} tabs`);

      const lost = m.tabSweeps.filter((t) => t.bad.length);
      ok(`${scope}@${w}: every module tab resolves to itself (not clipped/overlapped)`, m.tabSweeps.length > 0 && lost.length === 0,
        lost.length
          ? lost.map((t) => `${t.id} [${t.box.left.toFixed(0)}→${t.box.right.toFixed(0)}] ${t.bad.length}/${t.sampled} lost, nearest hit: ${JSON.stringify(t.bad[0])}`).join("; ")
          : `${m.tabSweeps.length} tabs, ${m.tabSweeps.reduce((n, t) => n + t.sampled, 0)} points`);

      const zeroWidth = m.tabSweeps.filter((t) => t.box.width <= 0);
      ok(`${scope}@${w}: no tab collapsed to zero width`, zeroWidth.length === 0, zeroWidth.map((t) => t.id).join(", "));
    }
    await page.screenshot({ path: `${OUT}schedule-header-${scope}-narrow.png` });
  }

  console.log("\n── wrap-range widths — the residual report: NO OVERLAP, checked as real 2D rectangles ──");
  for (const scope of SCOPES) {
    console.log(`\n  scope: ${scope}`);
    for (const w of WRAP_RANGE_WIDTHS) {
      await page.setViewportSize({ width: w, height: 700 });
      await page.waitForTimeout(150);
      const m = await probe(scope);
      if (!m.centerBox || !m.toolbarBox) { ok(`${scope}@${w}: center/toolbar content present`, false, "missing nodes"); continue; }

      const sameLine = Math.abs(m.centerBox.top - m.toolbarBox.top) < 2;
      const overlap = rectsOverlap(m.centerBox, m.toolbarBox);
      console.log(`    ${w}px: sameLine=${sameLine} center=[${m.centerBox.left.toFixed(0)},${m.centerBox.right.toFixed(0)}]@${m.centerBox.top.toFixed(0)} toolbar=[${m.toolbarBox.left.toFixed(0)},${m.toolbarBox.right.toFixed(0)}]@${m.toolbarBox.top.toFixed(0)}`);

      ok(`${scope}@${w}: the center group and the toolbar cluster never overlap`, !overlap,
        overlap ? `center ${JSON.stringify(m.centerBox)} intersects toolbar ${JSON.stringify(m.toolbarBox)}` : "");

      if (sameLine) {
        // On one line, a real gap is meaningful and must be non-negative — this is the case a
        // naive 1D check gets right, so it's still worth asserting explicitly here.
        const gap = m.toolbarBox.left - m.centerBox.right;
        ok(`${scope}@${w}: same-line gap between center and toolbar is non-negative`, gap >= 0, `${gap.toFixed(1)}px`);
      }
    }
    await page.screenshot({ path: `${OUT}schedule-header-${scope}-wraprange.png` });
  }

  console.log("\n── MUTATION CHECK — prove the overlap detector has teeth ──");
  // Force the row to a single line by disabling flexWrap on the live DOM (a runtime style
  // override, not a source edit) at a width where content genuinely does not fit — this
  // reproduces what a REAL overlap bug would look like, and the detector above must catch it.
  await page.setViewportSize({ width: 900, height: 700 });
  await page.waitForTimeout(150);
  await page.evaluate(() => {
    const root = document.querySelector('[data-scope="split"]');
    const view = root.querySelector('[role="group"][aria-label="View"]');
    let row2 = view;
    for (let i = 0; i < 4 && row2; i++) { row2 = row2.parentElement; if (row2 && row2.style && row2.style.flexWrap) break; }
    if (row2) { row2.dataset.mutatedNowrap = "1"; row2.style.flexWrap = "nowrap"; }
  });
  await page.waitForTimeout(150);
  const mutated = await probe("split");
  const mutatedOverlap = mutated.centerBox && mutated.toolbarBox ? rectsOverlap(mutated.centerBox, mutated.toolbarBox) : null;
  ok("mutation: forcing nowrap at 900px produces a DETECTABLE real overlap (proves the check has teeth)",
    mutatedOverlap === true, mutatedOverlap === null ? "nodes missing" : `overlap=${mutatedOverlap}`);
  await page.screenshot({ path: `${OUT}schedule-header-mutation-forced-overlap.png` });
  // Revert the live DOM mutation before any later check reuses this page — a forced nowrap only
  // matters when content doesn't fit on one line, so it happened not to affect the wide-width
  // section below, but leaving a mutated node behind is still the wrong hygiene for a script
  // whose later sections assume the unmodified build.
  await page.evaluate(() => {
    const el = document.querySelector('[data-mutated-nowrap="1"]');
    if (el) { el.style.flexWrap = ""; delete el.dataset.mutatedNowrap; }
  });

  console.log("\n── wide widths — the second reported off-center dead space (unaffected by this investigation) ──");
  for (const scope of SCOPES) {
    console.log(`\n  scope: ${scope}`);
    for (const w of WIDE_WIDTHS) {
      await page.setViewportSize({ width: w, height: 700 });
      await page.waitForTimeout(150);
      const m = await probe(scope);

      if (!m.lastTabBox || !m.centerBox || !m.toolbarBox) {
        ok(`${scope}@${w}: gap-equality nodes present`, false, "lastTab / center / toolbar missing");
        continue;
      }
      const leftGap = m.centerBox.left - m.lastTabBox.right;
      const rightGap = m.toolbarBox.left - m.centerBox.right;
      const diff = Math.abs(rightGap - leftGap);
      ok(`${scope}@${w}: the center group is equally spaced from the tabs and the toolbar (±${GAP_TOLERANCE_PX}px)`,
        diff <= GAP_TOLERANCE_PX, `left ${leftGap.toFixed(1)}px vs right ${rightGap.toFixed(1)}px, diff ${diff.toFixed(1)}px`);
      ok(`${scope}@${w}: both gaps are real, non-negative space`, leftGap >= 0 && rightGap >= 0, `left ${leftGap.toFixed(1)}px, right ${rightGap.toFixed(1)}px`);
    }
  }

  ok("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? "❌" : "✅"} ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const f of failed) console.log(`   ❌ ${f.n}`); process.exit(1); }
