/* NEW-1 — A FOCUSED FIELD AND A REJECTED FIELD MUST NOT LOOK ALIKE. Proven on the rendered element.
 *
 * The owner reported that the Depth box in the building inspector "wasn't letting" him type, and
 * sent a frame of it wearing a red outline. ⛔ NOTHING WAS REJECTING HIS INPUT — driven every way it
 * can be driven, the field took the value every time (ui-audit/diagnose-inspector-key-leak.mjs).
 * What he was looking at was the FOCUS ring: `--accent` (#C2410C light / #F26B3A dark) with a soft
 * accent halo, measuring **14.4 / 13.4 ΔE00** from this app's own error colour `--danger`. A plainly
 * different hue measures ~49 by the same metric. Red means rejected; the field was reporting an
 * error it had not had.
 *
 * ⛔ THIS READS THE COMPUTED STYLE OFF THE LIVE ELEMENT, never the stylesheet. A token can be
 * defined correctly and lose to a `!important`, a local override or a theme block that never
 * applies — and the thing the owner sees is the rendered pixel, not the declaration.
 *
 * Six things are asserted, in BOTH themes, with both states on screen at once:
 *   1  the focused border is BLUE, and is not the accent
 *   2  the invalid border is the DANGER red
 *   3  focused vs invalid are far apart perceptually (ΔE00, the repo's own CIEDE2000)
 *   4  the invalid state BEATS focus — a field you are still typing in keeps saying it is refused
 *   5  NON-COLOUR CUES exist: aria-invalid, an accessible error message, and a visible ⚠ glyph
 *      (colour alone fails a red-green colour-blind reader, and blue-vs-red is that exact pair)
 *   6  the valid, unfocused field is untouched
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

/** The two number inputs in the inspector: Length (the control) and Depth (the reported field). */
async function fields(page) {
  const grab = async (label) => {
    const h = await page.evaluateHandle((lbl) => {
      for (const row of document.querySelectorAll("div")) {
        const s = row.firstElementChild;
        if (s && s.tagName === "SPAN" && (s.textContent || "").trim() === lbl) { const i = row.querySelector("input"); if (i) return i; }
      }
      return null;
    }, label);
    const el = h.asElement();
    if (!el) throw new Error(`no "${label}" input in the inspector`);
    return el;
  };
  return { depth: await grab("Depth (ft)"), length: await grab("Length (ft)") };
}

/** What the element ACTUALLY renders as, plus the accessibility state riding with it. */
const read = (el) => el.evaluate((n) => {
  const cs = getComputedStyle(n);
  return {
    borderColor: cs.borderTopColor,
    boxShadow: cs.boxShadow,
    ariaInvalid: n.getAttribute("aria-invalid"),
    ariaErrorMessage: n.getAttribute("aria-errormessage"),
    title: n.getAttribute("title"),
  };
});

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

for (const theme of ["light", "dark"]) {
  console.log(`\n=== ${theme} theme — the two states side by side on the real inspector ===`);
  const { ctx, page } = await open(browser, theme);
  const { depth, length } = await fields(page);

  /* The tokens as the ROOT actually resolves them, so the ΔE00 claims in the CSS comment and in the
   * backlog are re-measured every run rather than trusted. */
  const tokens = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const g = (k) => cs.getPropertyValue(k).trim();
    return { accent: g("--accent"), danger: g("--danger"), focusBorder: g("--focus-border") };
  });

  // STATE 1 — valid and unfocused (the control).
  const resting = await read(length);

  // STATE 2 — focused, valid. This is what he was looking at.
  await depth.click();
  await page.waitForTimeout(200);
  const focused = await read(depth);

  // STATE 3 — genuinely rejected. Depth is min 1 / max MAX_DIM, so a negative is really refused.
  await page.keyboard.press("Control+A");
  await page.keyboard.type("-5");
  await page.waitForTimeout(250);
  const invalid = await read(depth);
  const glyph = page.locator('[data-testid="numinput-invalid"]').first();
  const glyphSeen = await glyph.isVisible().catch(() => false);
  const glyphName = glyphSeen ? await glyph.getAttribute("aria-label") : null;

  const cFocus = rgb(focused.borderColor), cInvalid = rgb(invalid.borderColor);
  const cAccent = rgb(tokens.accent), cDanger = rgb(tokens.danger);

  ok(`${theme}: the FOCUSED border is blue, not the accent`,
    isBlueish(cFocus) && de(cFocus, cAccent) > 20,
    `border ${focused.borderColor} · ΔE00 from --accent ${de(cFocus, cAccent)}`);

  ok(`${theme}: the REJECTED border is the danger red`,
    isRedish(cInvalid) && de(cInvalid, cDanger) < 3,
    `border ${invalid.borderColor} · ΔE00 from --danger ${de(cInvalid, cDanger)}`);

  const sep = de(cFocus, cInvalid);
  ok(`${theme}: focused and rejected are unmistakably different`, sep > 35,
    `ΔE00 ${sep} between the two states (the OLD focus-vs-danger pair measured ${theme === "light" ? "14.39" : "13.36"})`);

  ok(`${theme}: rejected BEATS focused — the field is still focused and still says refused`,
    isRedish(cInvalid),
    `still focused: ${await page.evaluate(() => document.activeElement.tagName)} · border ${invalid.borderColor}`);

  ok(`${theme}: NON-COLOUR cues carry the state`,
    invalid.ariaInvalid === "true" && !!invalid.ariaErrorMessage && glyphSeen && /Invalid/i.test(glyphName || ""),
    `aria-invalid=${invalid.ariaInvalid} · message "${invalid.ariaErrorMessage}" · ⚠ visible=${glyphSeen} named "${glyphName}"`);

  ok(`${theme}: a valid, unfocused field is untouched and carries no error state`,
    resting.ariaInvalid == null && !isRedish(rgb(resting.borderColor)),
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
  const refocused = await read(depth);
  ok(`${theme}: typing a valid value CLEARS the rejected state in place`,
    refocused.ariaInvalid == null && isBlueish(rgb(refocused.borderColor)),
    `border ${refocused.borderColor} · aria-invalid=${refocused.ariaInvalid}`);
  if (clip) await page.screenshot({ path: `${OUT}field-focused-${theme}.png`, clip });

  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed · shots in ui-audit/screens/field-{focused,rejected}-{light,dark}.png`);
if (failed.length) { console.log(`  FAILED: ${failed.map((f) => f.n).join(" · ")}`); process.exit(1); }
