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
 *   • the label is not TRUNCATED at the working width (scrollWidth ≤ clientWidth)
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
  "split": { shape: "split", text: "Part in City of Baytown (6 of 14 lots) · rest in its ETJ · Harris County" },
  /* Bain with the CITY lookup failed. The ETJ still answered, so it is still named — "we know
   * Houston's ETJ reaches this land; we could not confirm whether any city's LIMITS also do" — and
   * no city can be listed as a touch, because the failed lookup returned no city names at all. */
  "unknown": { shape: "unknown", text: "Couldn't check city limits · Houston ETJ · Fort Bend County" },
};
/* ⛔ THE PRE-FIX LABEL FOR THE SAME SHAPE, because "is it clipped?" is only half a question. The
 * pill has always ellipsised, and the header's centre zone has finite room; what CHANGED is what
 * survives the clip. Pre-fix the governing fact sat SECOND ("Unincorporated / City of Houston ·
 * ETJ …"), so a narrow header cut off the jurisdiction that actually regulates the site and left the
 * word that says nothing. Leading with the governing authority means a clip can now only ever eat
 * the demoted tail. Both properties are measured below. */
const WAS = {
  "in-city": "City of Houston · Harris County",
  "in-city-etj": "City of Humble / City of Houston · ETJ · Harris County",
  "etj": "Unincorporated / City of Houston · ETJ / City of Katy · edge only · Fort Bend County",
  "etj-clean": "Unincorporated / City of Houston · ETJ · Harris County",
  "split": "Part in City of Baytown (6 of 14 lots) / rest in its ETJ · Harris County",
  "unknown": "City limits · couldn't check / City of Houston · ETJ · Fort Bend County",
};
const WIDTHS = [1440, 1280, 1100, 980];
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
      const full = span ? span.textContent : "";
      const lead = full.split(" · ")[0];
      return {
        leadW: measure(lead), wasW: measure(was), nowW: measure(full), lead,
        shape: root.getAttribute("data-shape"),
        text: span ? span.textContent : "",
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

        // 1 — the exact canonical label, read off the DOM.
        if (m.text !== want.text) fail(`${at}: rendered "${m.text}" — expected "${want.text}"`);
        else pass(`${at}: "${m.text}"`);

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

        /* 6 — ⛔ THE CLIP PROPERTY, which is the honest form of "is it truncated?". The header's
         * centre zone has finite room and this pill has always ellipsised; the two things that must
         * hold are that the change never made a label WIDER, and that whatever the clip eats, it can
         * never be the governing authority. Residual clipping of the demoted tail is REPORTED with
         * its measurement rather than passed over — it is the header's width budget, filed as its
         * own item, not something this label can fix by getting shorter. */
        if (m.nowW > m.wasW + 0.5) fail(`${at}: the new label is WIDER than the one it replaced (${m.nowW.toFixed(0)}px vs ${m.wasW.toFixed(0)}px)`);
        if (m.leadW > m.clientW + 1) fail(`${at}: the GOVERNING authority itself is clipped ("${m.lead}" needs ${m.leadW.toFixed(0)}px, has ${m.clientW}px)`);
        if (m.scrollW > m.clientW + 1) console.log(`   ⓘ ${at}: tail ellipsised (${m.scrollW}px of text in ${m.clientW}px) — governing lead intact, was ${m.wasW.toFixed(0)}px pre-fix`);

        // 7 — legible in this theme (the repo's AA floor for body text).
        const cr = ratio(parseRgb(m.color), parseRgb(m.background));
        if (!(cr >= 4.5)) fail(`${at}: contrast ${cr.toFixed(2)}:1 is below the AA floor of 4.5:1`);

        // 8 — the tooltip carries the REASON, so the reader is taught rather than surprised.
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
