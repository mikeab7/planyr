/* B464049 / B464051 — AN ERROR MUST NOT LOOK LIKE ORDINARY FOCUS, and a number the app CHANGED
 * must say so. Proven on the rendered element, in both themes.
 *
 * The owner reported the Depth box "wasn't letting" him type and sent a frame of it outlined in
 * orange-red. ⛔ NOTHING WAS REJECTING HIS INPUT — every drive path took the value.
 *
 * ⛔ AND THE FIRST FIX FOR THAT WAS THE WRONG END OF THE PROBLEM, which is why this harness is
 * shaped the way it is. It concluded the FOCUS ring was impersonating an error (`--accent` sits
 * ~14 ΔE00 from `--danger`) and moved focus to blue across ~194 controls. Orange-red IS Planyr's
 * accent — the Select tool, the "Select parcels: on" pill, every active control — so a field
 * glowing in it while you type is normal, and restyling every text box in the app is a large
 * visible change aimed at something that was never the cause. **The defect is the ERROR STATE:**
 * this app had no invalid state at all, so an unusable value was reported by nothing — no colour,
 * no icon, no message. That is a WCAG 1.4.1 (Use of Color) failure in its own right, independent
 * of the bug that surfaced it, and identifying an error by a coloured border alone would not fix
 * it either.
 *
 * ⛔ THIS READS THE COMPUTED STYLE OFF THE LIVE ELEMENT, never the stylesheet — a token can be
 * right and still lose to a `!important` or a specificity it cannot see. That is not theoretical
 * here: the invalid rule's first cut set every token correctly, put `aria-invalid` on the element
 * and rendered its icon, and the border stayed the focus colour, because the focus rule's three
 * `:not()` arguments out-specify a bare `[aria-invalid]:focus` wherever it sits in the file.
 *
 * Asserted in BOTH themes:
 *   1  the FOCUS ring is still the brand accent — the revert is real, not claimed
 *   2  a rejected value differs from focus in HUE **and in WEIGHT** (a heavier border), so the two
 *      never read alike even before the words are read
 *   3  it carries a SHORT TEXT MESSAGE naming what is wrong, tied to the input by aria-describedby
 *   4  …and an icon, and `aria-invalid` — four cues, colour last (WCAG 1.4.1)
 *   5  a value the app ROUNDED or CLAMPED says so in the moment (LOUD-FAILURE), with its own
 *      non-error wording, and is never dressed as a rejection
 *   6  a valid, unfocused field is untouched, and typing a good value clears the state in place
 *
 * Run:  npm run build && npx vite preview --port 4184   (separate shell)
 *       BASE_URL=http://localhost:4184/ node ui-audit/verify-field-focus-vs-invalid.mjs
 */
import { chromium } from "playwright";
import { readFileSync, mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { srgbToLab, deltaE2000 } from "./lib/perceptualDiff.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4184/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const SITE = "fm359";
const B1 = "e1454615maruai";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/fm359-concept-a.json", import.meta.url), "utf8"));

const results = [];
const ok = (n, pass, d = "") => { results.push({ n, pass }); console.log(`  ${pass ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); };

/* A colour → [r,g,b]. Computed styles always resolve to `rgb(...)`, but a CUSTOM PROPERTY read off
 * the root comes back exactly as authored — `#C2410C` — and a digit-scrape of that yields nonsense
 * (it silently produced NaN comparisons on the first run of this harness, which is a reminder that
 * "the number came out weird" and "the check passed" are different failures). Both forms, explicitly. */
const rgb = (v) => {
  const s = String(v).trim();
  const hex = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split("").map((c) => c + c).join("") : hex[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  const m = s.match(/(\d+(?:\.\d+)?)/g);
  return m && m.length >= 3 ? m.slice(0, 3).map(Number) : null;
};
const de = (a, b) => (a && b ? +deltaE2000(srgbToLab(...a), srgbToLab(...b)).toFixed(2) : NaN);
/* Is this colour in the red family rather than the blue one? Hue, not a token name — the point is
 * what a viewer sees. Blue: the blue channel dominates. Red: the red channel dominates. */
const isBlueish = (c) => c && c[2] > c[0] + 20;
const isRedish = (c) => c && c[0] > c[2] + 40;

async function open(browser, theme) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE, name: "Concept A", site: "FM 359" }));
  await ctx.addInitScript(`(()=>{try{localStorage.setItem('planyr.theme',${JSON.stringify(theme)});}catch(e){}})();`);
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30_000 });
  await page.waitForTimeout(1200);
  await assertMeasurable(page, "verify-field-focus-vs-invalid");
  const at = await page.evaluate((id) => {
    const n = document.querySelector(`[data-el-id="${id}"]`); if (!n) return null;
    const b = n.getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, B1);
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(250);
  await page.locator('button[title="Properties"]').first().click();
  await page.waitForTimeout(400);
  return { ctx, page };
}

/* ⛔ THE FIELD IS RE-RESOLVED ON EVERY READ, NEVER HELD. When a message appears the control
 * re-renders into a different wrapper, so an `ElementHandle` grabbed earlier is DETACHED — and a
 * detached node answers `getComputedStyle` with empty strings and `inputValue` with junk, which
 * reads as "the style did not apply" rather than as "you are asking a dead node". This harness
 * reported exactly that on its first run against the corrected build (borderColor "", value "-").
 * Same family as the undisposed-handle contamination B1439 records. */
const findInput = (page, label) => page.evaluateHandle((lbl) => {
  for (const row of document.querySelectorAll("div")) {
    const s = row.firstElementChild;
    if (s && s.tagName === "SPAN" && (s.textContent || "").trim() === lbl) { const i = row.querySelector("input"); if (i) return i; }
  }
  return null;
}, label);

async function clickField(page, label) {
  const h = await findInput(page, label);
  const el = h.asElement();
  if (!el) throw new Error(`no "${label}" input in the inspector`);
  await el.click();
  await el.dispose();
}

/** What the element ACTUALLY renders as, plus the accessibility state riding with it. */
const readField = (page, label) => page.evaluate((lbl) => {
  let n = null;
  for (const row of document.querySelectorAll("div")) {
    const s = row.firstElementChild;
    if (s && s.tagName === "SPAN" && (s.textContent || "").trim() === lbl) { const i = row.querySelector("input"); if (i) { n = i; break; } }
  }
  if (!n) return null;
  const cs = getComputedStyle(n);
  const id = n.getAttribute("aria-describedby");
  const m = id && document.getElementById(id);
  return {
    value: n.value,
    borderColor: cs.borderTopColor,
    borderWidth: cs.borderTopWidth,
    ariaInvalid: n.getAttribute("aria-invalid"),
    describedBy: id,
    describedText: m ? m.textContent.trim() : null,
  };
}, label);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

for (const theme of ["light", "dark"]) {
  console.log(`\n=== ${theme} theme — the two states side by side on the real inspector ===`);
  const { ctx, page } = await open(browser, theme);

  /* The tokens as the ROOT actually resolves them, so the ΔE00 claims in the CSS comment and in the
   * backlog are re-measured every run rather than trusted. */
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const g = (k) => cs.getPropertyValue(k).trim();
    return { accent: g("--accent"), danger: g("--danger"), focusBorder: g("--focus-border") };
  });

  // STATE 1 — valid and unfocused (the control).
  const resting = await readField(page, "Length (ft)");

  // STATE 2 — focused, valid. This is what he was looking at.
  await clickField(page, "Depth (ft)");
  await page.waitForTimeout(200);
  const focused = await readField(page, "Depth (ft)");

  // STATE 3 — genuinely rejected. Depth is min 1 / max MAX_DIM, so a negative is really refused.
  await page.keyboard.press("Control+A");
  await page.keyboard.type("-5");
  await page.waitForTimeout(250);
  const invalid = await readField(page, "Depth (ft)");

  const cFocus = rgb(focused.borderColor), cInvalid = rgb(invalid.borderColor);
  const cAccent = rgb(tokens.accent), cDanger = rgb(tokens.danger);

  ok(`${theme}: the FOCUS ring is still the BRAND ACCENT (the revert is real)`,
    de(cFocus, cAccent) < 3,
    `border ${focused.borderColor} · ΔE00 from --accent ${de(cFocus, cAccent)} · width ${focused.borderWidth}`);

  ok(`${theme}: a REJECTED value is the danger red`,
    de(cInvalid, cDanger) < 3,
    `border ${invalid.borderColor} · ΔE00 from --danger ${de(cInvalid, cDanger)}`);

  /* ⛔ WEIGHT, not only hue — the two states are both warm here by design, so the error must be
   * legible as different before any colour is judged. */
  const wFocus = parseFloat(focused.borderWidth), wInvalid = parseFloat(invalid.borderWidth);
  ok(`${theme}: …and differs from focus in WEIGHT as well as hue`,
    wInvalid > wFocus,
    `focus ${focused.borderWidth} → rejected ${invalid.borderWidth} (ΔE00 between them ${de(cFocus, cInvalid)})`);

  ok(`${theme}: the rejection carries a SHORT TEXT MESSAGE, tied to the input`,
    invalid.ariaInvalid === "true" && !!invalid.describedBy && /Smallest allowed is 1/.test(invalid.describedText || ""),
    `aria-invalid=${invalid.ariaInvalid} · aria-describedby→ "${invalid.describedText}"`);

  ok(`${theme}: the message is ONE short line (PANEL-BREVITY)`,
    (invalid.describedText || "").length <= 60 && !(invalid.describedText || "").includes("\n"),
    `${(invalid.describedText || "").length} chars`);

  ok(`${theme}: an icon rides with it — colour is the LAST cue, never the only one`,
    await page.locator('[data-testid="numinput-invalid"]').first().isVisible().catch(() => false),
    "⚠ rendered inside the message line");

  ok(`${theme}: a valid, unfocused field is untouched and carries no error state`,
    resting.ariaInvalid == null && resting.describedBy == null && de(rgb(resting.borderColor), cDanger) > 20,
    `border ${resting.borderColor}`);

  /* THE RECORD: the same two rows shot in each state, so the owner can see what he approved.
   * `rejected` is the frame above (Depth = -5, refused); `focused` restores a valid value and
   * leaves the caret in the box, which is the state he originally mistook for an error. */
  const clip = await page.evaluate(() => {
    for (const row of document.querySelectorAll("div")) {
      const s = row.firstElementChild;
      if (s && s.tagName === "SPAN" && (s.textContent || "").trim() === "Length (ft)") {
        const box = row.parentElement.getBoundingClientRect();
        return { x: box.x, y: box.y - 4, width: box.width, height: 120 };
      }
    }
    return null;
  });
  if (clip) await page.screenshot({ path: `${OUT}field-rejected-${theme}.png`, clip });

  await page.keyboard.press("Control+A");
  await page.keyboard.type("613");
  await page.waitForTimeout(250);
  const refocused = await readField(page, "Depth (ft)");
  ok(`${theme}: typing a valid value CLEARS the state in place`,
    refocused.ariaInvalid == null && refocused.describedBy == null && de(rgb(refocused.borderColor), cAccent) < 3,
    `border ${refocused.borderColor} · aria-invalid=${refocused.ariaInvalid}`);
  if (clip) await page.screenshot({ path: `${OUT}field-focused-${theme}.png`, clip });

  /* ⛔ B464051 — THE SILENT ALTERATION, measured rather than argued. Every dimension call site
   * passes `value={Math.round(...)}`, so a decimal round-trips to a different number; and
   * `clampNum` silently returns MAX_DIM for anything larger. Both are correct behaviour and
   * neither used to be reported. */
  for (const [typed, stored, note, why] of [
    ["200000", "100000", "Using 100000", "CLAMPED — the committed value really is changed"],
    ["613.7", "613.7", "Showing 614", "stored EXACTLY; it is the DISPLAY that rounds"],
  ]) {
    await clickField(page, "Depth (ft)");
    await page.keyboard.press("Control+A");
    await page.keyboard.type(typed);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(400);
    const after = await readField(page, "Depth (ft)");
    const model = await page.evaluate((id) => {
      const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const site = m[Object.keys(m)[0]] || {};
      const e = (site.els || []).find((x) => x.id === id);
      return e ? e.h : null;
    }, B1);
    ok(`${theme}: ${typed} — ${why}, and the app SAYS SO`,
      String(model) === stored && new RegExp(note).test(after.describedText || "") && after.ariaInvalid == null,
      `model holds ${model} · note "${after.describedText}" · aria-invalid=${after.ariaInvalid} (a change is not a rejection)`);
    if (clip && typed === "613.7") await page.screenshot({ path: `${OUT}field-altered-${theme}.png`, clip });
  }

  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed · shots in ui-audit/screens/field-{focused,rejected,altered}-{light,dark}.png`);
if (failed.length) { console.log(`  FAILED: ${failed.map((f) => f.n).join(" · ")}`); process.exit(1); }
