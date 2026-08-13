/* NEW-1 — THE ROW-1 CENTRE SLOT IS CENTRED ON THE HEADER, NOT ON THE LEFTOVER SPACE.
 *
 * THE REPORT (owner, 2026-08-09): "now the jurisdiction is not centered." Measured on Clay & Porter
 * (project smqh35mzsju1) on production, viewport 1600 px, true centre x = 800:
 *     chip span      776 → 1012 (width 236), centre x = 894  →  94 px RIGHT of the centre
 *     its slot       410 → 1378 (width 968), centre x = 894  →  the chip is PERFECTLY centred in it
 * So the chip was never mis-centred in its slot; the SLOT was off-centre, because `flex: 1 1 0%`
 * makes it the space left over between the breadcrumb and the account controls, and the left group is
 * ~94 px the wider of the two.
 *
 * ⛔ THIS WAS NEVER A REGRESSION FROM THE LABEL CHANGE (B367296), and this harness is what proves it
 * rather than asserting it: the CRUMB axis below holds the jurisdiction string fixed and changes only
 * the project / plan names. On the pre-fix build the chip's offset MOVES with the breadcrumb (a
 * rename relocates it) — a leftover-space slot has always behaved that way, and the new label text
 * only made a long-standing offset visible.
 *
 * ⛔ MEASURED WITH getBoundingClientRect, NEVER EYEBALLED FROM A SCREENSHOT. The whole defect is
 * ~90 px of horizontal offset on a 1600 px header, which looks like "roughly the middle" in a picture.
 *
 * ⛔ AND IT ASSERTS TWO THINGS AT ONCE, because the fix's own risk is the opposite defect: the slot is
 * OUT OF FLOW now, so nothing but the measured bound stops it running back over the plan chip —
 * NAVIGATION WINS (B371361). Every case therefore checks the centring AND that the chip clears both
 * side groups AND that the nav chips keep a usable width.
 *
 * Logged out, no network, no GIS: the real AppHeader + ProjectBreadcrumb + JurisdictionBadge in the
 * dev server's own harness page.
 *
 * Run:  npm run dev -- --port 5199 --strictPort      (separate shell)
 *       node ui-audit/verify-header-center.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
// The SHIPPED rule, re-run against the browser's own boxes — never a second copy of it here.
import { centerSlotMaxWidth, CENTER_SLOT_MIN } from "../src/shared/ui/headerCenterFit.js";

const BASE = process.env.BASE_URL || "http://localhost:5199";
const PAGE_URL = `${BASE}/ui-audit/header-jur-badge-harness.html`;
const OUT = new URL("./out/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

/* His laptop, a mid-size window, his monitor — and 900, the NARROW case the item asks for, where a
 * long breadcrumb genuinely crowds the centre and the bound has to bite. */
const WIDTHS = [900, 1024, 1280, 1600];
/* The four corners: {shortest, longest} label × {shortest, longest} breadcrumb. The claim is that the
 * chip's centre is the same in all four, so fewer than four cannot state it. */
const SCOPES = ["ctr-short-short", "ctr-short-long", "ctr-long-short", "ctr-long-long"];
/* How far the chip's centre may sit from the viewport's. One px of sub-pixel rounding is real; the
 * reported defect was 94. */
const CENTER_TOL_PX = 1.5;

const results = [];
const ok = (n, pass, d = "") => { results.push({ n, pass }); console.log(`  ${pass ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); };

const EXEC = process.env.PW_CHROME
  || ["/opt/pw-browsers/chromium-1234/chrome-linux64/chrome", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium"]
    .find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, deviceScaleFactor: 1 });
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels: rAF is suspended, so
     every box read after a viewport change describes a view the page already left, self-consistently.
     This harness is nothing BUT boxes read after viewport changes. (FOREGROUND-OR-VOID.) */
  await assertMeasurable(page, "verify-header-center");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(PAGE_URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__READY__ === true, { timeout: 15000 });

  const probe = (scope) => page.evaluate((scope) => {
    const root = document.querySelector(`[data-scope="${scope}"]`);
    if (!root) return null;
    const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, width: r.width, center: r.left + r.width / 2 }; };
    const pill = root.querySelector('[data-testid="jurisdiction-badge"]');
    const slot = root.querySelector("[data-header-center]");
    /* ⛔ READ THE VISIBLE SPAN, not the pill's textContent — the pill carries a hidden measuring copy
       of the full string, so textContent returns the label twice. */
    const visible = pill ? pill.querySelector("[data-jurisdiction-text]") : null;
    return {
      vw: window.innerWidth,
      mode: slot ? slot.getAttribute("data-center-mode") : null,
      pill: box(pill),
      slot: box(slot),
      left: box(root.querySelector('[data-header-zone="left"]')),
      right: box(root.querySelector('[data-header-zone="right"]')),
      plan: box(root.querySelector('[data-testid="plan-crumb"]')),
      proj: box(root.querySelector('[data-testid="project-crumb"]')),
      text: visible ? visible.textContent.trim() : null,
      full: pill ? pill.getAttribute("data-jurisdiction-full") : null,
      title: pill ? pill.getAttribute("title") : null,
    };
  }, scope);

  /* Per width: every case's own offset, plus the SPREAD across the four cases — the spread is the
   * assertion the item actually asks for ("the chip centre does not move"). */
  for (const w of WIDTHS) {
    await page.setViewportSize({ width: w, height: 1100 });
    await page.waitForTimeout(250);
    console.log(`\n── viewport ${w}px (true centre ${w / 2}) ──`);
    const centers = [];
    for (const scope of SCOPES) {
      const m = await probe(scope);
      if (!m || !m.pill) { ok(`${scope} @${w}: the chip is present`, false, "missing node"); continue; }
      const off = m.pill.center - w / 2;
      centers.push({ scope, center: m.pill.center, off, mode: m.mode });
      console.log(`     ${scope.padEnd(16)} chip ${m.pill.left.toFixed(0)}→${m.pill.right.toFixed(0)} centre ${m.pill.center.toFixed(1)} (off ${off >= 0 ? "+" : ""}${off.toFixed(1)})  mode=${m.mode}  "${m.text}"`);

      // 1 — THE REPORT. The chip is centred on the HEADER whenever a true centre fits. `tight` is the
      //     stated degradation (a wide breadcrumb in a narrow window: readable-but-off-centre beats a
      //     sliver), so it is REPORTED rather than asserted — and rule 6 below still holds it to the
      //     no-overlap contract. `unmeasured` is never acceptable here: the row IS measurable.
      if (m.mode === "tight") {
        /* ⛔ AND `tight` IS AUDITED, NOT TAKEN ON TRUST — otherwise a header that silently stopped
           centring altogether would report `tight` everywhere and pass. The shipped pure rule is
           re-run against the boxes the BROWSER measured: it must independently agree that a true
           centre would leave less than the minimum slot. */
        const would = centerSlotMaxWidth({ rowW: w, leftW: m.left.width, rightW: m.right.width });
        console.log(`     ↳ tight: a true centre would leave ${would.toFixed(0)}px < ${CENTER_SLOT_MIN}px minimum, so it stays in flow (off ${off.toFixed(1)}px)`);
        ok(`${scope} @${w}: the tight fallback is a REAL constraint, independently re-derived`,
          would < CENTER_SLOT_MIN, `would be ${would.toFixed(0)}px against a ${CENTER_SLOT_MIN}px floor`);
      } else {
        ok(`${scope} @${w}: the chip is centred on the header`, Math.abs(off) <= CENTER_TOL_PX,
          `centre ${m.pill.center.toFixed(1)} vs ${w / 2} (off ${off.toFixed(1)}px)`);
      }

      // 2 — the fix's own risk, the other way: out of flow, only the measured bound keeps it clear.
      const overPlan = m.plan ? Math.max(0, Math.min(m.plan.right, m.pill.right) - Math.max(m.plan.left, m.pill.left)) : 0;
      const overRight = m.right ? Math.max(0, Math.min(m.right.right, m.pill.right) - Math.max(m.right.left, m.pill.left)) : 0;
      ok(`${scope} @${w}: NAVIGATION WINS — the chip overlaps neither side group`, overPlan === 0 && overRight === 0,
        `plan ${overPlan.toFixed(1)}px, account ${overRight.toFixed(1)}px`);

      // 3 — …and the nav chips were not squeezed to nothing to buy the centring.
      ok(`${scope} @${w}: the nav chips keep a usable width`, !!m.plan && !!m.proj && m.plan.width >= 30 && m.proj.width >= 30,
        m.plan && m.proj ? `plan ${m.plan.width.toFixed(0)}px, project ${m.proj.width.toFixed(0)}px` : "a crumb is missing");

      // 4 — the jurisdiction is INFORMATION: whatever the visible text does, the full string stays.
      ok(`${scope} @${w}: the full jurisdiction string is still in the DOM and on hover`,
        !!m.full && (m.title || "").includes(m.full), m.full ? `"${m.full}"` : "no data-jurisdiction-full");

      // 5 — the row MEASURED itself. `unmeasured` means the layout effect never got a box — the
      //     LOUD-FAILURE path — and a header stuck there would silently be the pre-fix build.
      ok(`${scope} @${w}: the row measured itself`, m.mode === "centered" || m.mode === "tight", `mode=${m.mode}`);
    }

    // 6 — THE ITEM'S OWN ASSERTION: longest/shortest label × longest/shortest breadcrumb, and the
    //     chip's centre does not move between them. Pre-fix this is where the breadcrumb axis shows.
    //     (Over the cases where a true centre fits — a `tight` case is off-centre BY DECISION and
    //     would drown the signal. At 1440+ every corner of the matrix is `centered`, so the assertion
    //     is made across the full matrix there, which is the width the owner reported from.)
    const fit = centers.filter((c) => c.mode === "centered");
    if (fit.length > 1) {
      const xs = fit.map((c) => c.center);
      const spread = Math.max(...xs) - Math.min(...xs);
      ok(`@${w}: the chip's centre does not move with the label or the breadcrumb (${fit.length} cases)`,
        spread <= CENTER_TOL_PX,
        `spread ${spread.toFixed(1)}px across ${fit.map((c) => `${c.scope} ${c.center.toFixed(1)}`).join(", ")}`);
    }
    // …and the widest case must exercise the WHOLE matrix, or the assertion above could quietly
    // shrink to one trivially-passing case.
    if (w === 1600) {
      ok("@1600: every corner of the matrix is truly centred", fit.length === SCOPES.length,
        `${fit.length}/${SCOPES.length} centered`);
    }
    await page.screenshot({ path: `${OUT}header-center-${w}.png` });
  }

  ok("no page errors", errors.length === 0, errors.join(" | "));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? "❌" : "✅"} ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { for (const f of failed) console.log(`   ❌ ${f.n}`); process.exit(1); }
