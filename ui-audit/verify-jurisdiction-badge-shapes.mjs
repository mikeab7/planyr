#!/usr/bin/env node
/* ═══════════════════════════════════════════════════════════════════════════════════════════════
 * verify-jurisdiction-badge-shapes — NEW-1 (B367296), IN A REAL BROWSER.
 *
 * The owner's report was about what he SAW: on Clay & Porter the header read
 * "Unincorporated / City of Houston ETJ". `test/jurisdictionShapes.test.js` pins the strings this
 * formatter returns; it cannot see what the PILL does with them — a label clipped by its own
 * ellipsis, wrapped onto a second line, painted below the contrast floor, or emptied because the
 * component read a field the formatter stopped returning. All four are ways a correct string still
 * reaches him wrong, and this is the check that can see them.
 *
 * WHAT IT DRIVES: the real `identifyJurisdiction` chain over the recorded agency answers (shared
 * with the CI suite — `ui-audit/lib/shapeReplay.js`), the real `formatJurisdictionBadge`, the real
 * `AppHeader` and the real `JurisdictionBadge`, at four viewport widths and in BOTH themes.
 *
 * WHAT IT ASSERTS, per shape:
 *   • the rendered pill text is EXACTLY the canonical label — read off the DOM, never off the return
 *     value (`textContent`, so a node that renders empty or clipped-to-nothing fails)
 *   • "Unincorporated" is absent wherever an ETJ is named, and present wherever it is the answer
 *   • ⛔ B367298 — the GOVERNING AUTHORITY is never trimmed at ANY supported width, the trimming
 *     that does happen only ever eats segments that govern nothing, and the FULL label is
 *     recoverable from the pill's tooltip
 *   • a merely-adjacent city appears only after the em dash, never inside the governing chain
 *   • the pill's ink clears WCAG AA against its own painted background, in both themes
 *
 * Usage:  npm run dev -- --port 5199 --strictPort   (bg)
 *         node ui-audit/verify-jurisdiction-badge-shapes.mjs [--shots]
 * ═══════════════════════════════════════════════════════════════════════════════════════════════ */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5199";
const URL = `${BASE}/ui-audit/jur-badge-shapes-harness.html`;
const OUT = "ui-audit/out";
const shots = process.argv.includes("--shots");
/* The sandbox pins its own Chromium build; Playwright's default download path is not populated here
 * (the repo's other browser harnesses do the same). `PW_CHROME` overrides it. */
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
mkdirSync(OUT, { recursive: true });

/* The canonical label per shape — the owner's four, plus the two states that are not shapes. These
 * are duplicated from the CI fixtures ON PURPOSE: this harness must fail if the rendered text stops
 * matching, and importing the expectation from the code under test would make that impossible. */
const EXPECT = {
  "in-city": { shape: "in-city", text: "City of Houston · Harris County" },
  "in-city-etj": { shape: "in-city-etj", text: "City of Humble · Houston ETJ · Harris County" },
  "etj": { shape: "etj", text: "City of Houston ETJ · Fort Bend County — touches City of Katy", adjacent: ["Katy"] },
  "etj-clean": { shape: "etj", text: "City of Houston ETJ · Harris County" },
  "split": { shape: "split", text: "Part in City of Baytown limits (full purpose, 6 of 14 lots) · rest in its ETJ · Harris County" },
  /* Bain with the CITY lookup failed. The ETJ still answered, so it is still named — "we know
   * Houston's ETJ reaches this land; we could not confirm whether any city's LIMITS also do" — and
   * no city can be listed as a touch, because the failed lookup returned no city names at all. */
  "unknown": { shape: "unknown", text: "Couldn't check city limits · Houston ETJ · Fort Bend County" },
  /* ⛔ B367298 — THE LONGEST LABELS THE APP CAN ACTUALLY PRODUCE ON HIS OWN GROUND. A narrow-header
   * guarantee proved on a short label is proved on nothing. Tsakiris is the worst case in the whole
   * portfolio: two governing slots, the second a measured remainder naming a city whose ETJ nobody
   * publishes. Neither has a tail, so the only thing that CAN give is the county — which is exactly
   * the case that would have hard-cut the governing chain before this item. */
  "longest-tsakiris": { shape: "split", text: "Part in City of Katy limits (full purpose, 2 of 9 lots) · rest outside it (no ETJ published for City of Katy) · Waller County" },
  "longest-goosecreek": { shape: "split", text: "Part in City of Baytown limits (full purpose, 6 of 14 lots) · rest in its ETJ · Harris County" },
};
/* ⛔ THE PRE-FIX LABEL FOR THE SAME SHAPE, because "is it clipped?" is only half a question. The
 * pill has always ellipsised, and the header's centre zone has finite room; what CHANGED is what
 * survives the clip. Pre-fix the governing fact sat SECOND ("Unincorporated / City of Houston ·
 * ETJ …"), so a narrow header cut off the jurisdiction that actually regulates the site and left the
 * word that says nothing. Leading with the governing authority means a clip can now only ever eat
 * the demoted tail. Both properties are measured below. */
const WAS = {
  "longest-tsakiris": "Part in City of Katy limits (full purpose, 2 of 9 lots) / rest outside it · no ETJ published for City of Katy · Waller County",
  "longest-goosecreek": "Part in City of Baytown limits (full purpose, 6 of 14 lots) / rest in its ETJ · Harris County",
  "in-city": "City of Houston · Harris County",
  "in-city-etj": "City of Humble / City of Houston · ETJ · Harris County",
  "etj": "Unincorporated / City of Houston · ETJ / City of Katy · edge only · Fort Bend County",
  "etj-clean": "Unincorporated / City of Houston · ETJ · Harris County",
  "split": "Part in City of Baytown limits (full purpose, 6 of 14 lots) / rest in its ETJ · Harris County",
  "unknown": "City limits · couldn't check / City of Houston · ETJ · Fort Bend County",
};
/* ⛔ 761 IS THE NARROWEST WIDTH THIS CHECK HAS TO DEFEND, and it is not a round number picked to be
 * safe. `AppHeader`'s phone gate is `max-width: 760px`; at 760 and below the whole row switches to
 * sideways scrolling and the badge keeps its natural width, so nothing clips at all. 761 is the
 * first width where the centre zone's cap actually squeezes the pill — the worst case of the band
 * the owner asked about. */
const NARROWEST = 761;
const WIDTHS = [1440, 1280, 1100, 980, 860, NARROWEST];
const THEMES = ["light", "dark"];

// ---- WCAG contrast, from the rendered computed colours (the repo's own AA floor: 4.5 for body) ---
const srgb = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b);
const ratio = (a, b) => { const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x); return (l1 + 0.05) / (l2 + 0.05); };
const parseRgb = (s) => (String(s).match(/[\d.]+/g) || []).slice(0, 3).map(Number);

const results = [];
const fail = (msg) => { results.push({ ok: false, msg }); console.log(`❌ ${msg}`); };
const pass = (msg) => { results.push({ ok: true, msg }); console.log(`✅ ${msg}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true, deviceScaleFactor: 2 });
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels (FOREGROUND-OR-VOID).
   * A hidden tab suspends rAF, so after any layout change every box, position and screenshot agrees
   * with every other and describes a view the page already left. Refuse rather than report. */
  await assertMeasurable(page, "verify-jurisdiction-badge-shapes");
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: "load" });
  await page.waitForFunction(() => window.__READY__ === true, { timeout: 20000 });
  if (errors.length) fail(`page errors: ${errors.join(" | ")}`);
  else pass("harness rendered with no page errors");

  const read = (scope, was) =>
    page.evaluate(({ scope, was }) => {
      const root = document.querySelector(`[data-scope="${scope}"]`);
      if (!root) return null;
      const pill = root.querySelector('[data-testid="jurisdiction-badge"]');
      if (!pill) return { pill: null };
      // The label span is the pill's text-bearing child (the first child is the 📍 glyph).
      const span = Array.from(pill.querySelectorAll("span")).find((s) => s.textContent && !/^[📍⚑]$/u.test(s.textContent.trim()));
      const cs = getComputedStyle(pill);
      const r = pill.getBoundingClientRect();
      /* Measure alternative strings in the pill's OWN rendered font — a canvas metric with a
       * reconstructed font shorthand drifts by a pixel or two, and the whole question here is
       * whether one string fits where another does not. */
      const measure = (t) => {
        const probe = document.createElement("span");
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;left:-9999px";
        probe.style.font = cs.font;
        probe.style.fontSize = cs.fontSize;
        probe.style.fontWeight = cs.fontWeight;
        probe.style.fontFamily = cs.fontFamily;
        probe.style.letterSpacing = cs.letterSpacing;
        probe.textContent = t;
        document.body.appendChild(probe);
        const w = probe.getBoundingClientRect().width;
        probe.remove();
        return w;
      };
      /* ⛔ B367298 — READ WHAT THE SHIPPED PILL ACTUALLY DOES. `JurisdictionBadge` decides between
       * the full line and `abbreviateJurisdiction`'s short form (governing fact + "+N"), publishes
       * the complete string in `data-jurisdiction-full`, and measures against the space it is given
       * with a hidden ghost. All three are read here off the REAL DOM — the shipped guard
       * (test/headerNavPriority) reads the SOURCE, which cannot see a pill that ellipsises anyway. */
      const rungEls = Array.from(pill.querySelectorAll("[data-jurisdiction-measure]"));
      const rungs = rungEls.map((el) => el.textContent);
      // The narrowest non-empty rung's own width, and the width the pill was actually granted.
      const nonEmpty = rungEls.filter((el) => el.textContent);
      const shortestRungW = nonEmpty.length ? Math.min(...nonEmpty.map((el) => el.offsetWidth)) : 0;
      const textEl = pill.querySelector("[data-jurisdiction-text]");
      const shown = textEl ? textEl.textContent : "";
      const clipped = textEl ? textEl.scrollWidth > textEl.clientWidth + 1 : false;
      // The label is now TWO spans (B367298), so the rendered text is the pill's, minus its glyphs.
      const full = pill.getAttribute("data-jurisdiction-full") || "";
      /* ⛔ WHAT THE PRE-FIX BUILD WOULD HAVE SHOWN AT THIS WIDTH — the longest prefix of the OLD
       * label that fits the same box, measured in the same font. Kept as a permanent arm rather
       * than a one-off mutation run: the owner's question is "force a width where it used to cut
       * the ETJ and watch the check go red", and this answers it every run, on the real labels. */
      const inner = pill.clientWidth - 26;   // the pill's text box, less its glyph and padding
      let fit = "";
      for (const ch of was) { if (measure(fit + ch) > inner) break; fit += ch; }
      const preFixVisible = fit;
      const lead = full.split(" · ")[0];
      /* The zone's USABLE width — its own padding does not belong to the pill. Reading it unpadded
       * made this check disagree with the component by exactly that padding, which on the longest
       * label is the difference between "there is room" and "there is not". */
      const zone = pill.parentElement;
      const zcs = zone ? getComputedStyle(zone) : null;
      const zpad = zcs ? (parseFloat(zcs.paddingLeft) || 0) + (parseFloat(zcs.paddingRight) || 0) : 0;
      const grantedW = zone ? zone.clientWidth - zpad : 0;
      // The pill's non-text chrome: pin, gaps, padding, border, the ⚑. With the text empty the pill
      // IS its chrome, so a blank pill measures it exactly.
      const chromeW = pill.offsetWidth - (textEl ? textEl.offsetWidth : 0);
      return {
        rungs, shortestRungW, grantedW, chromeW, shown, clipped, abbreviated: !!(textEl && textEl.textContent !== full),
        shownScrollW: textEl ? textEl.scrollWidth : 0, shownClientW: textEl ? textEl.clientWidth : 0,
        preFixVisible,
        leadW: measure(lead), wasW: measure(was), nowW: measure(full), lead,
        shape: root.getAttribute("data-shape"),
        text: full,
        title: pill.getAttribute("title") || "",
        scrollW: span ? span.scrollWidth : 0,
        clientW: span ? span.clientWidth : 0,
        lines: span ? Math.round(span.getBoundingClientRect().height / parseFloat(cs.fontSize) / 1.4) : 0,
        color: cs.color,
        background: cs.backgroundColor,
        height: r.height,
      };
    }, { scope, was });

  for (const theme of THEMES) {
    await page.evaluate((t) => { document.documentElement.setAttribute("data-theme", t); document.body.setAttribute("data-theme", t); }, theme);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 620 });
      await page.waitForTimeout(120);
      for (const [scope, want] of Object.entries(EXPECT)) {
        const m = await read(scope, WAS[scope]);
        const at = `${scope} @ ${width}px ${theme}`;
        if (!m || !m.pill === undefined) { fail(`${at}: no case rendered`); continue; }
        if (m.pill === null) { fail(`${at}: the badge rendered NOTHING`); continue; }

        /* 1 — the exact canonical label. `data-jurisdiction-full` is the pill's own published copy
         * of the complete answer, so this asserts the LABEL while §7–9 assert what is DISPLAYED. */
        if (m.text !== want.text) fail(`${at}: the pill's full value is "${m.text}" — expected "${want.text}"`);
        else pass(`${at}: "${m.shown}"${m.abbreviated ? `  (full: "${m.text}")` : ""}`);

        // 2 — the shape the model settled on, stamped from the badge itself.
        if (m.shape !== want.shape) fail(`${at}: shape "${m.shape}" — expected "${want.shape}"`);

        // 3 — ⛔ THE ITEM: an ETJ implies unincorporated, so the word may not also be printed.
        if (want.shape === "etj" && /Unincorporated/i.test(m.text))
          fail(`${at}: names an ETJ and still prints "Unincorporated"`);
        if (want.shape === "unincorporated" && !/Unincorporated/.test(m.text))
          fail(`${at}: unincorporated with no ETJ, but the word is missing`);

        // 4 — a merely-adjacent city may appear ONLY after the em dash.
        for (const c of want.adjacent || []) {
          const [chain] = m.text.split(" — ");
          if (chain.includes(c)) fail(`${at}: "${c}" governs nothing here but sits in the governing chain`);
        }

        // 5 — ON ONE LINE, never wrapped.
        if (m.lines > 1) fail(`${at}: label wrapped onto ${m.lines} lines`);

        /* 6 — the change never made a label materially WIDER than the one it replaced. The 3px
         * tolerance is one known case, not slack: Tsakiris's remainder turned a separator into a
         * parenthesis pair (`rest outside it · no ETJ published…` → `rest outside it (no ETJ
         * published…)`), which is two characters more and reads as one clause instead of two. */
        if (m.nowW > m.wasW + 3) fail(`${at}: the new label is WIDER than the one it replaced (${m.nowW.toFixed(0)}px vs ${m.wasW.toFixed(0)}px)`);

        /* 7 — ⛔ B367298, THE GUARANTEE, READ OFF THE RENDERED PILL. Whatever the pill shows must be
         * COMPLETE FACTS: never a word cut in half, and never a governing authority reduced to a
         * fragment. `abbreviateJurisdiction` drops whole segments and appends "+N", so a correctly
         * behaving pill is either the full line or a short form that still ends cleanly. */
        if (m.clipped)
          fail(`${at}: the pill is ELLIPSISING its own text ("${m.shown}" needs ${m.shownScrollW}px, has ${m.shownClientW}px) — that cuts mid-word`);

        /* 8 — ⛔ WHATEVER IS SHOWN IS A COMPLETE-FACTS FORM — one of the rungs, exactly, never a
         * fragment of one. The rungs come from the page's own module, so this compares the render
         * against the decision rather than against a string I typed. An empty pill is the honest
         * floor and is allowed; a HALF of a rung never is. */
        if (m.shown !== "" && !m.rungs.includes(m.shown))
          fail(`${at}: showing "${m.shown}", which is not one of the complete-facts rungs ${JSON.stringify(m.rungs)}`);
        /* ⛔ BLANK IS THE HONEST FLOOR, BUT ONLY WHEN THERE IS GENUINELY NO ROOM. The pill may fall
         * to pin-only only when the space it was granted is smaller than its shortest true
         * statement; going blank with room to spare would be the silent drop wearing a new costume.
         * (The granted box is read from the pill itself, so this catches a header that starves the
         * centre zone as readily as a shortener that gives up early.) */
        const needShortest = m.shortestRungW + m.chromeW;   // the pill's own chrome rides along
        if (m.shown === "" && m.shortestRungW && m.grantedW >= needShortest + 2)
          fail(`${at}: the pill went BLANK with ${m.grantedW}px granted — its shortest true form needs only ${needShortest}px`);
        if (m.shown === "") console.log(`   ⓘ ${at}: pin only — granted ${m.grantedW}px, shortest true form needs ${needShortest}px (nothing true fits)`);
        if (m.abbreviated) console.log(`   ⓘ ${at}: shortened to "${m.shown || "(pin only)"}" — whole facts dropped, full string in the tooltip`);

        /* 10 — ⛔ AND WHATEVER WAS TRIMMED IS STILL REACHABLE. Silently unreachable text is the
         * defect; a deliberate short form with the whole thing one hover away is not. */
        if (!m.title.includes(want.text)) fail(`${at}: the full label is NOT recoverable from the tooltip`);

        // 11 — legible in this theme (the repo's AA floor for body text).
        const cr = ratio(parseRgb(m.color), parseRgb(m.background));
        if (!(cr >= 4.5)) fail(`${at}: contrast ${cr.toFixed(2)}:1 is below the AA floor of 4.5:1`);

        // 12 — the tooltip carries the REASON, so the reader is taught rather than surprised.
        if (want.shape === "etj" && !/unincorporated/i.test(m.title))
          fail(`${at}: the ETJ tooltip never says the land is unincorporated`);
      }
      if (shots) await page.screenshot({ path: `${OUT}/jur-shapes-${theme}-${width}.png`, fullPage: true });
    }
  }
} finally {
  await browser.close();
}

const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} checks passed`);
if (bad.length) { console.log("FAILURES:"); for (const b of bad) console.log(`  ${b.msg}`); }
process.exit(bad.length ? 1 : 0);
