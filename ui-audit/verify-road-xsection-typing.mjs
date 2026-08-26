/* NEW-1 follow-up (owner report, 2026-08-26) — "when I type two it seems to bug out a little bit,
 * I'm just typing 2 to get to 25." Verifies, in a real headless browser, driving the REAL dialog
 * with REAL keystrokes (never by reasoning about the handler — the whole bug is about what happens
 * BETWEEN keystrokes):
 *   1. typing "2" then "5" into a band-width field never paints it invalid and never disturbs the
 *      dialog's totals or preview until the field commits (blur / Enter);
 *   2. every named adjacent mid-typing case (empty, lone ".", "0", "12.", leading-zero "08", a
 *      pasted-odd string) never shows an error while typing, and resolves sanely at commit;
 *   3. a below-minimum width is silently clamped at commit, never blocked mid-type;
 *   4. the preview degrades gracefully at a narrow width (no implicit browser rescale blowing a
 *      label into an "enormous numeral in an empty box");
 *   5. the dimension ladder's running-total label is never rotated/clipped/colliding, at a narrow
 *      section, the owner's 68′ boulevard, and the single-band default;
 *   6. "Pavement area … per 100 ft of road" reads unambiguously as a rate, not a total.
 *
 * Logged-out, no external GIS, blank site — the ATTEMPT-BEFORE-YOU-PARK class, so it runs here.
 *
 * Run:  npm run build && npx vite preview --port 4173  (then)  node ui-audit/verify-road-xsection-typing.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/road-xsection-typing/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, ignoreHTTPSErrors: true });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-road-xsection-typing");
const errs = [];
page.on("pageerror", (e) => errs.push(String(e)));

const fails = [], notes = [];
const check = (ok, label, detail = "") => { (ok ? notes : fails).push(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`); };

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
try { await page.getByRole("button", { name: /Start blank/i }).click({ timeout: 8000 }); } catch (_) {}
await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 20000 });
await page.waitForTimeout(600);

// ---- Open the dialog fresh — mode "new", single travel-lane band (the sticky default width) ----
await page.locator('[aria-label="Road presets"]').click();
await page.waitForTimeout(200);
await page.getByRole("button", { name: /Design cross-section…/ }).click();
await page.waitForTimeout(400);
check((await page.locator('[data-testid="road-xsection-dialog"]').count()) === 1, "the dialog opens");

const widthInput = page.locator('[aria-label="Band width, feet"]').first();
const bodyText = () => page.evaluate(() => document.querySelector('[data-testid="road-xsection-dialog"]').innerText);
const totalsLine = (txt) => (txt.match(/Section width[^\n]*/) || [""])[0] + " | " + (txt.match(/Total ROW width[^\n]*/) || [""])[0] + " | " + (txt.match(/Pavement area[^\n]*/) || [""])[0];
const inputState = () => widthInput.evaluate((el) => ({
  value: el.value,
  ariaInvalid: el.getAttribute("aria-invalid"),
  borderColor: getComputedStyle(el).borderColor,
}));

// ---- 0. Single-band default — the rotated-label fix, checked at the case that used to render at all sizes ----
const totalTextEl = () => page.locator('[data-testid="road-xsection-dialog"] svg text', { hasText: "total" }).first();
const checkTotalLabel = async (label) => {
  const info = await totalTextEl().evaluate((t) => {
    const svg = t.closest("svg");
    const tb = t.getBoundingClientRect(), sb = svg.getBoundingClientRect();
    return {
      transform: t.getAttribute("transform") || "",
      text: t.textContent,
      rotated: /rotate/.test(t.getAttribute("transform") || ""),
      clipped: tb.right > sb.right + 0.5 || tb.left < sb.left - 0.5 || tb.bottom > sb.bottom + 0.5 || tb.top < sb.top - 0.5,
      tb, sb,
    };
  });
  check(!info.rotated, `${label}: the running-total label is horizontal, never rotated`, info.transform || "(none)");
  check(!info.clipped, `${label}: the running-total label's box sits fully inside the preview SVG (no clipping)`, JSON.stringify({ tb: info.tb, sb: info.sb }));
  check(/^\d.*total$/.test(info.text || ""), `${label}: the running-total label reads a whole word, never a fragment ("tot")`, info.text);
};
await checkTotalLabel("single-band default");

// A genuinely narrow section — the "giant numeral in an empty box" repro. Type it via the field
// (below, after the keystroke-bug section reuses this same input) — for now, measure the label
// glyph's rendered size at whatever the default (24′) draws, as a sanity baseline.
const baselineGlyphH = await page.locator('[data-testid="road-xsection-dialog"] svg text').first().evaluate((t) => t.getBoundingClientRect().height);
check(baselineGlyphH < 30, "baseline: a band's own label glyph renders at a sane pixel height (not implicitly stretched)", `${baselineGlyphH.toFixed(1)}px`);

// ---- 1. THE REPORTED BUG — type "2" then "5" into the width field, character by character -------
const baseline = totalsLine(await bodyText());
notes.push(`— baseline totals before editing: ${baseline}`);

await widthInput.click();
await page.keyboard.press("Control+A");
await page.keyboard.press("Backspace");
await page.keyboard.type("2", { delay: 60 });
await page.waitForTimeout(120);
let s = await inputState();
let mid = totalsLine(await bodyText());
check(s.value === "2", "after typing '2': the field's own draft shows '2'", s.value);
check(s.ariaInvalid !== "true", "after typing '2': no aria-invalid — a prefix of a valid number is not an error", String(s.ariaInvalid));
check(mid === baseline, "after typing '2': the dialog's totals are UNCHANGED — still the last COMMITTED geometry, not the transient '2'", `now: ${mid}`);
await page.screenshot({ path: OUT + "01-typed-2.png" });

await page.keyboard.type("5", { delay: 60 });
await page.waitForTimeout(120);
s = await inputState();
mid = totalsLine(await bodyText());
check(s.value === "25", "after typing '5' (now '25'): the field's own draft shows '25'", s.value);
check(s.ariaInvalid !== "true", "after typing '5': still no aria-invalid mid-type", String(s.ariaInvalid));
check(mid === baseline, "after typing '5' (now '25' mid-type): totals STILL unchanged — the whole dialog never recomputed off a transient value", `now: ${mid}`);
await page.screenshot({ path: OUT + "02-typed-25-still-mid-edit.png" });

await widthInput.blur();
await page.waitForTimeout(200);
const afterCommit = totalsLine(await bodyText());
check(afterCommit !== baseline && /25/.test(afterCommit), "on blur: the field COMMITS — totals now reflect the real, final 25′", afterCommit);
await page.screenshot({ path: OUT + "03-committed-25.png" });

// ---- 2. Named adjacent cases — none may paint red or disturb the preview mid-type ----------------
const typeCase = async (text, label, expectCommit) => {
  const totalsBeforeCase = totalsLine(await bodyText());
  await widthInput.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.press("Backspace");
  if (text) await page.keyboard.type(text, { delay: 40 });
  else await page.waitForTimeout(30); // the empty-field case: nothing to type
  await page.waitForTimeout(80);
  const midState = await inputState();
  const midTotals = totalsLine(await bodyText());
  check(midState.ariaInvalid !== "true", `mid-typing "${label}": no aria-invalid`, String(midState.ariaInvalid));
  check(midTotals === totalsBeforeCase, `mid-typing "${label}": totals hold the LAST COMMITTED geometry, undisturbed by this in-progress draft`, `now: ${midTotals}`);
  await widthInput.blur();
  await page.waitForTimeout(150);
  const committed = await inputState();
  check(committed.value === String(expectCommit), `commit "${label}" → ${expectCommit}`, `got ${committed.value}`);
  check(committed.ariaInvalid !== "true", `after committing "${label}": still no aria-invalid`, String(committed.ariaInvalid));
  return committed.value;
};

// Currently committed: "25". Each case below either reverts to the LAST committed value (an
// unparseable/incomplete draft) or commits to a real new number.
await typeCase("", "empty field (clearing to retype)", 25); // nothing typed → reverts to 25
await typeCase(".", "a lone '.'", 25); // never parses → reverts to 25
await typeCase("0", "'0' on the way to '0.5'", 25); // 0 is not > 0 → reverts to 25
await typeCase("12.", "trailing decimal '12.' on the way to '12.5'", 12); // Number("12.") === 12 → commits to 12
await typeCase("08", "leading zero '08'", 8); // leading zero is a legitimate way to type 8
await widthInput.click();
await page.keyboard.press("Control+A");
await page.keyboard.press("Backspace");
await page.keyboard.insertText("12'6\""); // simulates a paste landing something odd, in one shot
await page.waitForTimeout(80);
const pasteState = await inputState();
check(pasteState.ariaInvalid !== "true", "mid-'paste' of odd text: no aria-invalid", String(pasteState.ariaInvalid));
await widthInput.blur();
await page.waitForTimeout(150);
const afterPaste = await inputState();
check(afterPaste.value === "8", "a paste that lands something odd silently reverts to the last committed value on blur", `got ${afterPaste.value}`);
check(afterPaste.ariaInvalid !== "true", "after the odd-paste commit: no aria-invalid", String(afterPaste.ariaInvalid));

// ---- 3. Below-minimum width — clamp at commit, never block/flag the keystroke --------------------
await widthInput.click();
await page.keyboard.press("Control+A");
await page.keyboard.press("Backspace");
await page.keyboard.type("0.02", { delay: 40 });
await page.waitForTimeout(80);
const belowMinMid = await inputState();
check(belowMinMid.ariaInvalid !== "true", "typing a below-minimum width ('0.02'): no aria-invalid mid-type", String(belowMinMid.ariaInvalid));
await widthInput.blur();
await page.waitForTimeout(150);
const belowMinCommitted = await inputState();
check(belowMinCommitted.value === "0.1", "below-minimum width is silently clamped UP at commit (never blocked)", `got ${belowMinCommitted.value}`);
await page.screenshot({ path: OUT + "04-clamped-min.png" });

// ---- 4. The preview degrades gracefully at a narrow width — no giant numeral in an empty box -----
await widthInput.click();
await page.keyboard.press("Control+A");
await page.keyboard.press("Backspace");
await page.keyboard.type("2", { delay: 40 });
await widthInput.blur();
await page.waitForTimeout(200);
const narrowGlyph = await page.locator('[data-testid="road-xsection-dialog"] svg text').first().evaluate((t) => {
  const b = t.getBoundingClientRect();
  return { h: b.height, w: b.width, style: getComputedStyle(t).fontSize };
});
check(narrowGlyph.h < 30 && narrowGlyph.w < 60, "a 2′ single-band section's label renders at a sane pixel size, not an enormous numeral", JSON.stringify(narrowGlyph));
await checkTotalLabel("narrow (2′) section");
await page.screenshot({ path: OUT + "05-narrow-2ft-preview.png" });

// ---- 5. The owner's own 68′ boulevard preset — total label not clipped/colliding either -----------
await page.getByRole("button", { name: /^4-lane divided boulevard$/ }).click();
await page.waitForTimeout(300);
const boulevardTxt = await bodyText();
check(/68/.test(boulevardTxt), "the 4-lane divided boulevard preset totals 68′ curb to curb, as expected", boulevardTxt.match(/Section width[^\n]*/)?.[0]);
await checkTotalLabel("68′ boulevard");
await page.screenshot({ path: OUT + "06-boulevard-preview.png" });

// ---- 6. "Pavement area … per 100 ft of road" reads unambiguously as a rate, never a total --------
check(/Pavement area .*per 100 ft of road/.test(boulevardTxt.replace(/\n/g, " ")), "'Pavement area' states its per-100-ft rate right beside the number, not as a leading parenthetical easily skimmed past", boulevardTxt.match(/Pavement area[^\n]*/)?.[0]);

check(errs.length === 0, "no uncaught page errors the whole run", JSON.stringify(errs));

console.log(notes.join("\n"));
console.log("");
console.log(fails.length ? fails.join("\n") : "ALL CHECKS PASSED");
console.log(`\n${notes.length}/${notes.length + fails.length} checks passed`);
await browser.close();
process.exit(fails.length ? 1 : 0);
