/* B1012560 — Schedule header: the Row-2 3-zone layout (tabs | center group | toolbar) used to
 * split leftover space 50/50 between the tabs zone and the toolbar zone regardless of what
 * either actually needed. One cause, two owner reports four days apart:
 *
 *   (1) NARROW — "the header breaks on the schedule module" (owner, 2026-09-01). Measured on
 *       planyr.io, Bain project, /schedule route: below the width where the equal split gave
 *       the tabs zone less than its own content width, the tab strip silently clipped. Break
 *       point 1108px container width.
 *   (2) WIDE — "i had it on my large laptop and it messed up" (owner, same thread). Measured on
 *       the same route: the Grid/Split/Gantt center group sat a CONSTANT ~135px off-center at
 *       every width from 1280 to 2560 — the gap right of it was always larger than the gap left
 *       of it, because equal side boxes don't center a middle item between two side groups
 *       whose real content widths differ (tabs ~448px, toolbar cluster ~313px).
 *
 * THE FIX: tabs and toolbar zones are content-sized and never grow; the center zone is the ONLY
 * zone that grows, so it alone absorbs the leftover width and splits it evenly on both sides of
 * its own centered content — fixing the clip (tabs never lose space) and the off-center (equal
 * gaps) with one change.
 *
 * This harness proves BOTH in a real browser: the narrow widths the dispatch named (900/960/
 * 1024, plus the old exact break point 1108) get the tab-strip-not-clipped sweep
 * (verify-header-nav-clickable.mjs's technique); the wide widths the owner's second report named
 * (1440/1600/1920/2560) get a gap-equality measurement with a small tolerance.
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

// 900/960/1024 are the widths the dispatch named as clipped pre-fix; 1108 is the exact measured
// break point. 1440/1600/1920/2560 are the wide widths the owner's second report measured the
// off-center gap at (his own numbers also covered 1280/1512/1728/1792 — a representative subset
// is enough here since the claim is "constant at every width", which four spread widths proves
// or disproves as well as eight).
const NARROW_WIDTHS = [900, 960, 1024, 1108];
const WIDE_WIDTHS = [1440, 1600, 1920, 2560];
// A gap difference below this reads as "centered" to the eye; the pre-fix defect was ~135px.
const GAP_TOLERANCE_PX = 3;

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
  const probe = () => page.evaluate(() => {
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
    const tabs = [...document.querySelectorAll('[data-testid^="module-tab-"]')];
    // The last tab (Model) and the toolbar's own first control — used to measure the two gaps
    // either side of the center group's REAL rendered content on wide widths. The center group
    // is TWO controls (the Grid/Split/Gantt segmented toggle + the review-inbox button, with a
    // small gap between them) — its tight content box is the union of both, not just the
    // segmented toggle alone, or the inbox button's own width would be double-counted as if it
    // were empty space on the "right gap" side.
    const lastTab = tabs[tabs.length - 1];
    const centerParts = [
      document.querySelector('[role="group"][aria-label="View"]'),
      document.querySelector('[title="Review suggested updates from forwarded emails"]'),
    ].filter(Boolean);
    const toolbarFirst = document.querySelector('[title^="Zoom out"]') || document.querySelector('[title^="Export"]');
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width }; };
    const unionBox = (els) => {
      if (!els.length) return null;
      const rects = els.map((el) => el.getBoundingClientRect());
      return { left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)) };
    };
    return {
      vw: window.innerWidth,
      tabCount: tabs.length,
      tabSweeps: tabs.map((t) => ({ id: t.getAttribute("data-testid"), ...sweep(t) })),
      lastTabBox: lastTab ? box(lastTab) : null,
      centerBox: unionBox(centerParts),
      toolbarFirstBox: toolbarFirst ? box(toolbarFirst) : null,
    };
  });

  console.log("── narrow widths — the reported clip ──");
  for (const w of NARROW_WIDTHS) {
    await page.setViewportSize({ width: w, height: 700 });
    await page.waitForTimeout(200);
    const m = await probe();
    console.log(`\n  viewport ${w}px — ${m.tabCount} tabs`);

    ok(`@${w}: all six module tabs are rendered`, m.tabCount === 6, `${m.tabCount} tabs`);

    const lost = m.tabSweeps.filter((t) => t.bad.length);
    ok(`@${w}: every module tab resolves to itself (not clipped/overlapped)`, m.tabSweeps.length > 0 && lost.length === 0,
      lost.length
        ? lost.map((t) => `${t.id} [${t.box.left.toFixed(0)}→${t.box.right.toFixed(0)}] ${t.bad.length}/${t.sampled} lost, nearest hit: ${JSON.stringify(t.bad[0])}`).join("; ")
        : `${m.tabSweeps.length} tabs, ${m.tabSweeps.reduce((n, t) => n + t.sampled, 0)} points`);

    const zeroWidth = m.tabSweeps.filter((t) => t.box.width <= 0);
    ok(`@${w}: no tab collapsed to zero width`, zeroWidth.length === 0, zeroWidth.map((t) => t.id).join(", "));

    await page.screenshot({ path: `${OUT}schedule-header-${w}.png` });
  }

  console.log("\n── wide widths — the reported off-center dead space ──");
  for (const w of WIDE_WIDTHS) {
    await page.setViewportSize({ width: w, height: 700 });
    await page.waitForTimeout(200);
    const m = await probe();

    if (!m.lastTabBox || !m.centerBox || !m.toolbarFirstBox) {
      ok(`@${w}: gap-equality nodes present`, false, "lastTab / center View group / toolbar's first control missing");
      continue;
    }
    const leftGap = m.centerBox.left - m.lastTabBox.right;
    const rightGap = m.toolbarFirstBox.left - m.centerBox.right;
    const diff = Math.abs(rightGap - leftGap);
    console.log(`\n  viewport ${w}px — left gap ${leftGap.toFixed(1)}px, right gap ${rightGap.toFixed(1)}px, diff ${diff.toFixed(1)}px`);
    ok(`@${w}: the center group is equally spaced from the tabs and the toolbar (±${GAP_TOLERANCE_PX}px)`,
      diff <= GAP_TOLERANCE_PX, `left ${leftGap.toFixed(1)}px vs right ${rightGap.toFixed(1)}px, diff ${diff.toFixed(1)}px`);
    // Sanity: both gaps must be real, positive space — a zero/negative gap would mean
    // something overlapped, which "equal" could otherwise paper over.
    ok(`@${w}: both gaps are real, non-negative space`, leftGap >= 0 && rightGap >= 0, `left ${leftGap.toFixed(1)}px, right ${rightGap.toFixed(1)}px`);

    await page.screenshot({ path: `${OUT}schedule-header-wide-${w}.png` });
  }

  ok("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? "❌" : "✅"} ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const f of failed) console.log(`   ❌ ${f.n}`); process.exit(1); }
