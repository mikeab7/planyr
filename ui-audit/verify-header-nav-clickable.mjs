/* NEW-2 — NAVIGATION WINS. The jurisdiction pill must shrink, truncate or collapse before it ever
 * overlaps the project / plan chips, and EVERY pixel of the plan chip — the caret especially — must
 * resolve to the plan chip.
 *
 * THE REPORT (owner, 2026-08-11): "if I am looking at a site on a normal sized laptop screen, I
 * can't change between the concepts or the plans because the unincorporated / city of Houston / ETJ
 * / Harris County chip is too big and it covers it." REPRODUCED AND MEASURED by him at a 1280×800
 * window (1191 px viewport) on Bain / "Concept - Original":
 *     plan chip "Concept - Original ▾"   x 264 → right 404
 *     jurisdiction pill                  x 396 → right 815, WIDTH 419 px
 *     overlap 8 px of box — but `elementFromPoint` along the chip's own right edge, at −4, −8, −12,
 *     −20 and −30 px, returned THE PILL'S SPAN every time. The last stretch of the chip, INCLUDING
 *     THE ▾ CARET, was not clickable. That is why he could not open it.
 *
 * ⛔ IT IS NOT A Z-INDEX OR OVERLAY PROBLEM, and reading it as one is how it would have been
 * "fixed" wrongly: the pill is `position: static`, `z-index: auto`, `pointer-events: auto`. It is
 * plain flex overflow — a 419 px pill that does not shrink, running over its neighbour.
 *
 * ⛔ AND THE BOX-OVERLAP NUMBER IS NOT THE MEASUREMENT. Eight pixels of box overlap cost thirty
 * pixels of hit target, because what actually eats the press is a neighbour's inline text span,
 * not the pill's own border. So this harness asks the browser the question the user asks — WHAT
 * ANSWERS THIS POINT — rather than comparing rectangles, and it samples the chip's whole box
 * instead of its centre. A centre-only check passes on the defect.
 *
 * ⛔ GUARDED AT A LAPTOP WIDTH, NOT ONLY AT HIS 1600 px MONITOR (his explicit instruction), and on
 * the LONGEST jurisdiction string his portfolio produces rather than a short one — a short string
 * cannot show this defect at any width, which is exactly how it shipped.
 *
 * Logged out, no network, no GIS: the real components mounted in the dev server's own harness page.
 *
 * Run:  npm run dev -- --port 5199 --strictPort      (separate shell)
 *       node ui-audit/verify-header-nav-clickable.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5199";
const PAGE_URL = `${BASE}/ui-audit/header-jur-badge-harness.html`;
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/* His laptop, a mid-size window, and his monitor. 1280 is the width he measured the defect at. */
/* 1024 is deliberately included and is NOT a width he named: it is where the pill genuinely runs
 * out of room, so it is the only place the ABBREVIATION path is exercised at all. Without it the
 * shortening code could rot dead behind a green score. */
const WIDTHS = [1024, 1280, 1440, 1600];
/* `bain` is the reported plan; `portfolio` is the longest string his 28 sites produce. The two
 * short-string scopes ride along as the control — they must pass on the pre-fix build too. */
const SCOPES = ["bain", "portfolio", "uninc", "long"];

const results = [];
/* The abbreviation path must be OBSERVED somewhere in the run — a guard nobody has seen fire is a
 * guard that rots green (VIEW-INDEPENDENT-ONCE §6). */
const abbrevSeen = [];
const ok = (n, pass, d = "") => { results.push({ n, pass }); console.log(`  ${pass ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); };

/* The sandbox ships Chromium under /opt/pw-browsers (PLAYWRIGHT_BROWSERS_PATH); the pinned build
 * number moves, so resolve the newest one present rather than hardcoding a revision. */
const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]
    .find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, deviceScaleFactor: 1 });
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout AND suspends requestAnimationFrame, so after a layout change every box, hit test and
     screenshot agrees with every other and describes a view the app already left. One precondition
     covers both, rAF liveness probe included; see ui-audit/lib/tabTiming.mjs. */
  await assertMeasurable(page, "verify-header-nav-clickable");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(PAGE_URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__READY__ === true, { timeout: 15000 });

  /* THE PROBE. For one header case: measure the nav chips and the pill, then ask the browser what
   * answers a grid of points inside each chip's own box — every column across it at three rows, so
   * the caret at the right end is sampled and cannot be averaged away by a passing centre. */
  const probe = (scope) => page.evaluate((scope) => {
    const root = document.querySelector(`[data-scope="${scope}"]`);
    const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
    const plan = root.querySelector('[data-testid="plan-crumb"]');
    const caret = root.querySelector('[data-testid="plan-caret"]');
    const proj = root.querySelector('[data-testid="project-crumb"]');
    const pill = root.querySelector('[data-testid="jurisdiction-badge"]');
    /* His dedupe question, answered by measurement rather than by reading the source: do the row-2
       workspace tabs have the same exposure at narrower widths? */
    const tabs = [...root.querySelectorAll('[data-testid^="module-tab-"]')];

    // Every point inside `el`, 1 px inside each edge, answered by whatever the browser hit-tests.
    const sweep = (el) => {
      const r = el.getBoundingClientRect();
      const bad = [];
      const xs = [], ys = [];
      for (let x = Math.ceil(r.left) + 1; x <= Math.floor(r.right) - 1; x += 2) xs.push(x);
      for (const f of [0.25, 0.5, 0.75]) ys.push(Math.round(r.top + r.height * f));
      for (const x of xs) for (const y of ys) {
        const hit = document.elementFromPoint(x, y);
        if (!hit || !(el.contains(hit) || hit === el)) {
          bad.push({ x, y, dxFromRight: Math.round(r.right - x), hit: hit ? (hit.getAttribute("data-testid") || hit.tagName + (hit.textContent || "").slice(0, 28)) : "null" });
        }
      }
      return { sampled: xs.length * ys.length, bad };
    };

    /* ⛔ READ THE VISIBLE SPAN, NOT THE PILL'S textContent — the pill also carries a hidden copy of
       the FULL string (the measuring ghost), so `textContent` returns the label twice and any
       assertion about what the user SEES would be reading the ghost too. */
    const visible = pill ? pill.querySelector('[data-jurisdiction-text]') : null;
    const pillText = visible ? visible.textContent : null;
    return {
      vw: window.innerWidth,
      plan: plan ? box(plan) : null,
      caret: caret ? box(caret) : null,
      proj: proj ? box(proj) : null,
      pill: pill ? box(pill) : null,
      pillFull: pill ? pill.getAttribute("data-jurisdiction-full") : null,
      pillAbbrev: pill ? pill.getAttribute("data-jurisdiction-abbrev") === "1" : null,
      pillTitle: pill ? pill.getAttribute("title") : null,
      pillText,
      tabSweeps: tabs.map((t) => ({ id: t.getAttribute("data-testid"), ...sweep(t), width: t.getBoundingClientRect().width })),
      planSweep: plan ? sweep(plan) : null,
      caretSweep: caret ? sweep(caret) : null,
      projSweep: proj ? sweep(proj) : null,
    };
  }, scope);

  for (const w of WIDTHS) {
    /* ⛔ TALL ENOUGH FOR EVERY CASE TO BE ON SCREEN. `elementFromPoint` answers null for a point
       outside the viewport, so a stacked harness in a short window reports EVERY chip below the
       fold as "lost" — a false failure indistinguishable from the real one. */
    await page.setViewportSize({ width: w, height: 700 });
    await page.waitForTimeout(200);
    console.log(`\n── viewport ${w}px ──`);
    for (const scope of SCOPES) {
      const m = await probe(scope);
      const tag = `${scope} @${w}`;
      if (!m.plan || !m.pill) { ok(`${tag}: chips + pill present`, false, "a required node is missing"); continue; }

      const overlap = Math.max(0, Math.min(m.plan.right, m.pill.right) - Math.max(m.plan.left, m.pill.left));
      console.log(`     plan ${m.plan.left.toFixed(0)}→${m.plan.right.toFixed(0)}  pill ${m.pill.left.toFixed(0)}→${m.pill.right.toFixed(0)} (${m.pill.width.toFixed(0)}px)  boxOverlap ${overlap.toFixed(1)}  "${(m.pillText || "").trim()}"`);

      // 1 — THE REPORTED FAILURE. Every pixel of the plan chip answers to the plan chip.
      const bad = m.planSweep.bad;
      ok(`${tag}: every pixel of the plan chip resolves to the plan chip`, bad.length === 0,
        bad.length ? `${bad.length}/${m.planSweep.sampled} points lost — nearest to the right edge: ${JSON.stringify(bad.slice(-3))}` : `${m.planSweep.sampled} points`);

      // 2 — THE CARET SPECIFICALLY. It is the last thing on the chip and the first thing eaten.
      ok(`${tag}: the ▾ caret is clickable`, !!m.caretSweep && m.caretSweep.bad.length === 0,
        m.caretSweep && m.caretSweep.bad.length ? `${m.caretSweep.bad.length}/${m.caretSweep.sampled} points lost` : "");

      // 3 — the project crumb beside it, same question.
      ok(`${tag}: every pixel of the project crumb resolves to it`, !!m.projSweep && m.projSweep.bad.length === 0,
        m.projSweep && m.projSweep.bad.length ? `${m.projSweep.bad.length}/${m.projSweep.sampled} points lost` : "");

      // 4 — NAVIGATION WINS, stated as geometry too: the pill never overlaps the nav chips.
      ok(`${tag}: the pill does not overlap the plan chip`, overlap === 0, overlap ? `${overlap.toFixed(1)}px of box` : "");

      // 5 — …and the chips are not squeezed to nothing to buy that. A chip with no width is a
      //     different way to lose the same click.
      ok(`${tag}: the chips keep a usable width`, m.plan.width >= 40 && m.proj.width >= 40,
        `plan ${m.plan.width.toFixed(0)}px, project ${m.proj.width.toFixed(0)}px`);

      // 6 — the jurisdiction is INFORMATION, not deleted: whatever the visible text does, the full
      //     string stays readable on hover and readable by a headless check.
      const full = m.pillFull || "";
      ok(`${tag}: the full jurisdiction string is still in the DOM`, full.length > 0 && (m.pillTitle || "").includes(full),
        full ? `"${full}"` : "no data-jurisdiction-full");

      // 7 — and the pill is still SHOWING something (collapsing to nothing at a laptop width would
      //     trade one defect for another).
      ok(`${tag}: the pill still shows a jurisdiction`, m.pill.width > 0 && (m.pillText || "").trim().length > 1,
        `${m.pill.width.toFixed(0)}px`);

      // 8 — THE DEDUPE ARM. Row 2's tabs come FIRST and do not shrink while the toolbar beside
      //     them clips its own contents, so they have no overlap exposure — measured, not assumed.
      const lostTabs = m.tabSweeps.filter((t) => t.bad.length);
      ok(`${tag}: every workspace tab resolves to itself`, m.tabSweeps.length > 0 && lostTabs.length === 0,
        lostTabs.length ? lostTabs.map((t) => `${t.id} ${t.bad.length}/${t.sampled}`).join(", ") : `${m.tabSweeps.length} tabs`);

      // 9 — WHEN it does shorten, it drops whole facts and says how many, rather than cutting a
      //     word in half ("Part in City of Bayto…" reads as a different answer, not a short one).
      if (m.pillAbbrev) {
        const shown = (m.pillText || "").trim();
        ok(`${tag}: the shortened pill names the governing fact and the count`, /\s\+\d+$/.test(shown) && full.startsWith(shown.replace(/\s\+\d+$/, "")),
          `"${shown}"`);
        abbrevSeen.push(tag);
      }
    }
    await page.screenshot({ path: `${OUT}header-nav-${w}.png` });
  }

  ok("the shortening path was actually exercised", abbrevSeen.length > 0, abbrevSeen.join(", "));
  ok("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? "❌" : "✅"} ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const f of failed) console.log(`   ❌ ${f.n}`); process.exit(1); }
