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
 *   (4) NEW-2 (2026-09-10) — a FOURTH report on the same header: "on the second schedule dropdown
 *       we don't need... [the chip is] 54px right of centre" — measured live on Goose Creek at a
 *       1489px row, chip center 798 vs row center 744.5. B1012560's own design (equal gaps to the
 *       tabs/toolbar zones) is only the row's true center when those two zones are equal width,
 *       which its own comment already called "a deliberate choice, not an oversight" — the owner
 *       has now overridden that choice. The chip centers on the ROW'S OWN midpoint whenever a
 *       measured bound (reusing Row 1's `centerSlotMaxWidth`, proven algebraically identical to
 *       the owner's own two-inequality form) proves it clears both zones, with hysteresis against
 *       flicker during a continuous resize; otherwise it falls back to EXACTLY the pre-existing
 *       B1012560 layout. This is what the WIDE-WIDTHS section below now checks (true row-center,
 *       not equal-neighbor-gaps), plus a new THRESHOLD-BAND section proving the hysteresis holds
 *       under a slow drag in both directions.
 *
 * THIS HARNESS now checks the RIGHT thing at every width: on a single line where the chip is
 * CENTERED, its own midpoint must sit at the row's true center within a small tolerance; on a
 * single line where it is NOT (the row too narrow for a true center to clear both sides), every
 * module tab must still resolve to itself and neither zone may overlap the chip; on two lines, the
 * center group's real content and the toolbar's real content must not intersect as actual 2D
 * rectangles — never a same-line-assuming 1D gap.
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
// B1547280 — the owner's own real CSS viewport width, at ~215% browser zoom on a 1600px physical
// window. The width that surfaced the bug: at 1191px the pre-fix chip (ViewToggle + review button
// bundled as one 222px unit) did not fit the row's measured bound and fell back to flow, landing
// 51px right of the row's true center — exactly what he measured and reported.
const MICHAEL_VIEWPORT_WIDTH = 1191;
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
    // B1547280 (AMENDMENT to B1511712) — the center group is now the Grid/Split/Gantt toggle
    // ALONE. The review-inbox button used to be measured here too (a NEW-2-era comment on this
    // line said "the center group is TWO controls"), which is exactly the bug the owner caught:
    // AppHeader's Row-2 centering was measuring and positioning a combined bundle wider than the
    // control he was actually asking about. The button now lives in the right-hand action zone
    // (ScheduleActions) and is picked up by `toolbarParts` below instead. (NEW-1, 2026-09-10 —
    // the "Schedules" switcher button that used to be a third member here was removed earlier;
    // the Row-1 breadcrumb's schedule crumb now does that job, outside this zone entirely.)
    const centerParts = [
      root.querySelector('[role="group"][aria-label="View"]'),
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
    // NEW-2 — the row itself (Row 2's own container, now `position:"relative"`) and the reported
    // centering mode, so the harness can check "is the chip at the ROW'S true center" rather than
    // "are the two neighbor gaps equal" (B1012560's superseded rule).
    // `data-schedule-center-mode` is stamped directly on the center zone div itself; its immediate
    // parent is Row 2's own container (the one AppHeader.jsx gave `position:"relative"`).
    const modeEl = root.querySelector("[data-schedule-center-mode]");
    const row2 = modeEl ? modeEl.parentElement : null;
    return {
      vw: window.innerWidth,
      tabCount: tabs.length,
      tabSweeps: tabs.map((t) => ({ id: t.getAttribute("data-testid"), ...sweep(t) })),
      lastTabBox: lastTab ? box(lastTab) : null,
      centerBox: unionBox(centerParts),
      toolbarBox: unionBox(toolbarParts),
      centerMode: modeEl ? modeEl.getAttribute("data-schedule-center-mode") : null,
      rowBox: row2 ? box(row2) : null,
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
  /* ⛔ REVERT BUG FOUND AND FIXED HERE (2026-09-10, while adding the NEW-2 tablet-width section
   * below) — `el.style.flexWrap = ""` does not "put it back," it PERMANENTLY REMOVES the inline
   * property from the live DOM node for the rest of this run. React only re-applies an inline
   * style property on a render where that property's OWN VALUE actually changes between the
   * previous and next style object — `narrow` never flips again for the rest of this script, so
   * React's diff sees `flexWrap: "wrap"` as unchanged from what it already believes is on the DOM
   * and never re-writes it, leaving the row PERMANENTLY UNABLE TO WRAP for every later section.
   * MEASURED, not assumed: this file's own new tablet-width check (adjacent case below) failed —
   * `split@820` reported a same-line NEGATIVE gap (real overlap, -103.4px) — and reproducing the
   * exact preceding sequence confirmed the row was still stuck `flexWrap:"nowrap"` at 820px purely
   * because this revert ran earlier in the SAME page session; loading 820px fresh (skipping the
   * mutation section) wraps correctly. The fix writes back the actual value React set before the
   * mutation — `"wrap"` (this section always runs above the 760px narrow breakpoint) — rather
   * than clearing the property and hoping React notices. */
  await page.evaluate(() => {
    const el = document.querySelector('[data-mutated-nowrap="1"]');
    if (el) { el.style.flexWrap = "wrap"; delete el.dataset.mutatedNowrap; }
  });

  /* ⛔ NEW-2 — SUPERSEDED SECTION. This used to assert the two neighbor gaps were equal, which was
   * B1012560's own (now-overridden) definition of "centered." At wide widths with unequal-width
   * tabs/toolbar zones that check would PASS on the exact defect the owner reported — equal gaps
   * to unequal neighbors is precisely how the chip landed 54px off the row's true center. The
   * table below is the adjacent-case matrix the dispatch asked for, printed regardless of pass/
   * fail so it lands in the PR verbatim; the checks driving it follow immediately after. */
  const adjacentCaseRows = [];
  console.log("\n── ADJACENT CASES — measured offset from the row's true center, and which state it was in ──");
  const rowCenterOf = (m) => (m.rowBox ? (m.rowBox.left + m.rowBox.right) / 2 : null);
  const chipCenterOf = (m) => (m.centerBox ? (m.centerBox.left + m.centerBox.right) / 2 : null);
  const recordCase = (label, m, w) => {
    const rc = rowCenterOf(m), cc = chipCenterOf(m);
    const offset = rc != null && cc != null ? cc - rc : null;
    adjacentCaseRows.push({ label, w, mode: m.centerMode, offset });
    console.log(`  ${label.padEnd(46)} w=${String(w).padEnd(5)} mode=${String(m.centerMode).padEnd(9)} offset=${offset == null ? "n/a" : offset.toFixed(1) + "px"}`);
    return { rc, cc, offset };
  };

  console.log("\n── wide widths — the chip's own center must match the ROW'S TRUE center when centered ──");
  for (const scope of SCOPES.concat(["gantt"])) {
    console.log(`\n  scope: ${scope}`);
    for (const w of WIDE_WIDTHS) {
      await page.setViewportSize({ width: w, height: 700 });
      await page.waitForTimeout(150);
      const m = await probe(scope);
      const { offset } = recordCase(`desktop wide — ${scope}`, m, w);

      if (!m.centerBox || !m.toolbarBox || !m.lastTabBox || !m.rowBox) {
        ok(`${scope}@${w}: centering nodes present`, false, "lastTab / center / toolbar / row missing");
        continue;
      }
      ok(`${scope}@${w}: reports centered mode at this comfortably-wide width`, m.centerMode === "centered", `mode=${m.centerMode}`);
      ok(`${scope}@${w}: the chip's own center matches the ROW'S true center (±${GAP_TOLERANCE_PX}px)`,
        offset != null && Math.abs(offset) <= GAP_TOLERANCE_PX, `offset ${offset == null ? "n/a" : offset.toFixed(1)}px`);

      const leftGap = m.centerBox.left - m.lastTabBox.right;
      const rightGap = m.toolbarBox.left - m.centerBox.right;
      ok(`${scope}@${w}: never overlaps either neighbor (both real gaps are non-negative)`,
        leftGap >= 0 && rightGap >= 0, `left ${leftGap.toFixed(1)}px, right ${rightGap.toFixed(1)}px`);
    }
  }

  console.log("\n── independence — Row 1's content must never move Row 2's chip ──");
  {
    const w = 1600;
    await page.setViewportSize({ width: w, height: 700 });
    await page.waitForTimeout(150);
    const short = await probe("split");
    const long = await probe("split-long");
    recordCase("long project name in breadcrumb (Row 1)", long, w);
    const same = short.centerBox && long.centerBox
      && Math.abs(short.centerBox.left - long.centerBox.left) < 0.5
      && Math.abs(short.centerBox.right - long.centerBox.right) < 0.5;
    ok(`@${w}: a long project name in the OTHER row does not move the chip`, same,
      `short center=[${short.centerBox?.left.toFixed(1)},${short.centerBox?.right.toFixed(1)}] long center=[${long.centerBox?.left.toFixed(1)},${long.centerBox?.right.toFixed(1)}]`);
  }

  console.log("\n── 1191px — the owner's own real viewport (215% browser zoom on a 1600px window), named ──");
  {
    const w = MICHAEL_VIEWPORT_WIDTH;
    await page.setViewportSize({ width: w, height: 700 });
    await page.waitForTimeout(150);
    for (const scope of ["grid", "split", "gantt"]) {
      const m = await probe(scope);
      const { offset } = recordCase(`owner's viewport (1191) — ${scope}`, m, w);
      ok(`${scope}@${w}: reports centered mode (the view toggle alone now fits the bound)`, m.centerMode === "centered", `mode=${m.centerMode}`);
      ok(`${scope}@${w}: the view toggle's own center matches the ROW'S true center (±${GAP_TOLERANCE_PX}px)`,
        offset != null && Math.abs(offset) <= GAP_TOLERANCE_PX, `offset ${offset == null ? "n/a" : offset.toFixed(1)}px`);
      if (m.centerBox && m.toolbarBox && m.lastTabBox) {
        const leftGap = m.centerBox.left - m.lastTabBox.right;
        const rightGap = m.toolbarBox.left - m.centerBox.right;
        ok(`${scope}@${w}: never overlaps either neighbor (both real gaps are non-negative)`,
          leftGap >= 0 && rightGap >= 0, `left ${leftGap.toFixed(1)}px, right ${rightGap.toFixed(1)}px`);
      }
    }
  }

  console.log("\n── tablet width — an explicit mid-range check, not just narrow/wide extremes ──");
  {
    const w = 820;
    await page.setViewportSize({ width: w, height: 700 });
    await page.waitForTimeout(150);
    for (const scope of SCOPES) {
      const m = await probe(scope);
      recordCase(`tablet — ${scope}`, m, w);
      if (m.centerBox && m.toolbarBox) {
        const sameLine = Math.abs(m.centerBox.top - m.toolbarBox.top) < 2;
        if (sameLine) {
          const gap = m.toolbarBox.left - m.centerBox.right;
          ok(`${scope}@${w} (tablet): center/toolbar gap non-negative on one line`, gap >= 0, `${gap.toFixed(1)}px`);
        } else {
          ok(`${scope}@${w} (tablet): wrapped to two lines with no overlap`, !rectsOverlap(m.centerBox, m.toolbarBox));
        }
      }
    }
  }

  console.log("\n── phone width — narrow mode never attempts centering ──");
  {
    const w = 400;
    await page.setViewportSize({ width: w, height: 700 });
    await page.waitForTimeout(150);
    const m = await probe("split");
    recordCase("phone (narrow, horizontal scroll)", m, w);
    ok(`@${w} (phone): never reports centered mode — narrow always falls back to flow`, m.centerMode !== "centered", `mode=${m.centerMode}`);
  }

  console.log("\n── THRESHOLD BAND — hysteresis holds under a slow drag in BOTH directions, no flicker ──");
  {
    // Binary-search the width where "split" (the wider real toolbar case) flips mode, then walk
    // 1px at a time across a window around it in both directions, counting transitions.
    const modeAt = async (w) => { await page.setViewportSize({ width: w, height: 700 }); await page.waitForTimeout(40); return (await probe("split")).centerMode; };
    let lo = 900, hi = 2000; // centered by hi, not by lo (narrower than the tab strip alone needs)
    for (let i = 0; i < 20 && hi - lo > 1; i++) {
      const mid = Math.round((lo + hi) / 2);
      const mode = await modeAt(mid);
      if (mode === "centered") hi = mid; else lo = mid;
    }
    const threshold = hi;
    console.log(`  approximate enter-threshold for "split": ${threshold}px`);

    const WINDOW = 40;
    const countTransitions = async (widths) => {
      let prevMode = null, transitions = 0;
      const trail = [];
      for (const w of widths) {
        const mode = await modeAt(w);
        trail.push({ w, mode });
        if (prevMode != null && mode !== prevMode) transitions++;
        prevMode = mode;
      }
      return { transitions, trail };
    };
    const upWidths = []; for (let w = threshold - WINDOW; w <= threshold + WINDOW; w++) upWidths.push(w);
    const downWidths = [...upWidths].reverse();
    const up = await countTransitions(upWidths);
    const down = await countTransitions(downWidths);
    console.log(`  widening ${threshold - WINDOW}→${threshold + WINDOW}: ${up.transitions} transition(s)`);
    console.log(`  narrowing ${threshold + WINDOW}→${threshold - WINDOW}: ${down.transitions} transition(s)`);
    ok("widening through the threshold band flips mode AT MOST once (no flicker)", up.transitions <= 1, `${up.transitions} transitions`);
    ok("narrowing through the threshold band flips mode AT MOST once (no flicker)", down.transitions <= 1, `${down.transitions} transitions`);
    // The hysteresis band itself must be real — entering and leaving at the identical width would
    // mean ROW2_CENTER_HYSTERESIS_PX is doing nothing measurable.
    const enterW = up.trail.find((t) => t.mode === "centered")?.w;
    const exitW = down.trail.find((t) => t.mode !== "centered")?.w;
    ok("the band has real width — entering and leaving happen at DIFFERENT widths",
      enterW != null && exitW != null && enterW !== exitW, `enter@${enterW} exit@${exitW}`);
    recordCase("just below threshold (not centered)", { centerMode: "flow", centerBox: null, rowBox: null }, threshold - 1);
    recordCase("just above threshold (centered)", { centerMode: "centered", centerBox: null, rowBox: null }, threshold + 1);
  }

  console.log("\n── all three views — the chip's own content must not overlap either neighbor whichever pill is selected ──");
  {
    const w = 1600;
    await page.setViewportSize({ width: w, height: 700 });
    await page.waitForTimeout(150);
    for (const scope of ["grid", "split", "gantt"]) {
      const m = await probe(scope);
      recordCase(`view selected — ${scope}`, m, w);
      ok(`${scope}@${w}: reports centered and matches the row's true center`,
        m.centerMode === "centered" && m.centerBox && m.rowBox && Math.abs((m.centerBox.left + m.centerBox.right) / 2 - (m.rowBox.left + m.rowBox.right) / 2) <= GAP_TOLERANCE_PX,
        `mode=${m.centerMode}`);
    }
  }

  console.log("\n── adjacent-case table (paste-ready) ──");
  console.log("| Case | Width | State | Offset from row center |");
  console.log("|---|---|---|---|");
  for (const r of adjacentCaseRows) {
    console.log(`| ${r.label} | ${r.w}px | ${r.mode} | ${r.offset == null ? "n/a" : r.offset.toFixed(1) + "px"} |`);
  }

  ok("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? "❌" : "✅"} ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const f of failed) console.log(`   ❌ ${f.n}`); process.exit(1); }
