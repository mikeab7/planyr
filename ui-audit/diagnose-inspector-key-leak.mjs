/* NEW-1 — DIAGNOSTIC: what happens to a keystroke typed into an inspector number field.
 *
 * The owner, verbatim: "go check out this site and figure out what's wrong with these text boxes
 * where I'm trying to input the depth, and it's not letting me... I think I had pressed backspace
 * or something in the text box and ended up deleting my building."
 *
 * Site FM 359 RD, Fulshear — plan "Concept A", Building 1 (1675 x 613, cross-dock, two bump-outs),
 * seeded VERBATIM from production into localStorage so this runs logged out.
 *
 * This is an INSTRUMENT, not a gate: it reports what the app does, key by key, so the two reported
 * symptoms can be separated. FOREGROUND-OR-VOID: it asserts the tab is measurable before reading
 * anything, and it drives REAL keys (SYNTHETIC-KEYS-DONT-EDIT).
 *
 * Run:  npm run build && npx vite preview --port 4184   (separate shell)
 *       BASE_URL=http://localhost:4184/ node ui-audit/diagnose-inspector-key-leak.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4184/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SITE = "fm359";
const BUILDING_1 = "e1454615maruai";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/fm359-concept-a.json", import.meta.url), "utf8"));

const line = (s) => console.log(s);

/** Every element id currently in the saved plan — the on-disk truth, so "did the building survive"
 *  is answered by the model rather than by whether a node happens to be painted. */
const readEls = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return (site.els || []).map((e) => e.id);
});

/* el-tier: the subject IS the element tier and nothing else — this probe asks whether ONE named
 * building survived a keystroke, against the same plan's own `els` array read back out of
 * storage. A whole-feature census would answer a different question (COUNT-EVERY-KIND's case is a
 * count that MISSES kinds; here the element count is the claim being made). */
const liveEls = (page) => page.evaluate(() => [...document.querySelectorAll("[data-el-id]")].map((n) => n.getAttribute("data-el-id")));

const activeInfo = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return { tag: a ? a.tagName : null, type: a ? a.getAttribute("type") : null, label: a ? (a.getAttribute("aria-label") || "") : null, value: a && "value" in a ? a.value : null };
});

async function openPlan(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE, name: "Concept A", site: "FM 359 RD, Fulshear, TX 77441" }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => line(`  ⚠ page error: ${e}`));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30_000 });
  await page.waitForTimeout(1200);
  await assertMeasurable(page, "diagnose-inspector-key-leak");
  return { ctx, page };
}

/** Select Building 1 by clicking its painted body, then open the docked Properties inspector. */
async function selectBuilding(page) {
  const box = await page.evaluate((id) => {
    const n = document.querySelector(`[data-el-id="${id}"]`);
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, BUILDING_1);
  if (!box) throw new Error("Building 1 is not painted — the fixture did not open");
  await page.mouse.click(box.x, box.y);
  await page.waitForTimeout(300);
  const props = page.locator('button[title="Properties"]');
  if (await props.count()) await props.first().click();
  await page.waitForTimeout(400);
}

/** The ELEMENT · BUILDING inspector's Depth (ft) input. */
function depthField(page) {
  return page.locator('input').filter({ hasNot: page.locator("nothing") }).nth(0); // replaced below
}

async function findDepthInput(page) {
  const handle = await page.evaluateHandle(() => {
    const rows = [...document.querySelectorAll("div")];
    for (const r of rows) {
      const span = r.firstElementChild;
      if (!span || span.tagName !== "SPAN") continue;
      if ((span.textContent || "").trim() !== "Depth (ft)") continue;
      const input = r.querySelector("input");
      if (input) return input;
    }
    return null;
  });
  const el = handle.asElement();
  if (!el) throw new Error("no Depth (ft) input found in the inspector");
  return el;
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

/* ------------------------------------------------------------------ SYMPTOM A: the keystroke leak */
line("\n=== SYMPTOM A — does a key typed in the Depth field reach the canvas? ===");
{
  const { ctx, page } = await openPlan(browser);
  await selectBuilding(page);
  const before = await readEls(page);
  line(`  plan holds ${before.length} elements; Building 1 present: ${before.includes(BUILDING_1)}`);

  const depth = await findDepthInput(page);
  await depth.click();
  line(`  after clicking Depth: activeElement = ${JSON.stringify(await activeInfo(page))}`);

  // A1 — Backspace while the caret is genuinely inside the field.
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(250);
  let now = await readEls(page);
  line(`  A1 Backspace with the field focused        → ${now.length} elements (B1 ${now.includes(BUILDING_1) ? "alive" : "DELETED"}), active=${(await activeInfo(page)).tag}`);

  // A2 — Delete while the caret is inside the field.
  await page.keyboard.press("Delete");
  await page.waitForTimeout(250);
  now = await readEls(page);
  line(`  A2 Delete with the field focused           → ${now.length} elements (B1 ${now.includes(BUILDING_1) ? "alive" : "DELETED"})`);

  // A3 — THE REPORTED SEQUENCE. Type a value, press Enter (which commits AND blurs), then press
  // Backspace again as a user who believes they are still in the box would.
  await depth.click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type("600");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  line(`  A3 after Enter commits: activeElement = ${JSON.stringify(await activeInfo(page))}`);
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(400);
  now = await readEls(page);
  const live = await liveEls(page);
  line(`  A3 Backspace AFTER Enter                   → ${now.length} elements (B1 ${now.includes(BUILDING_1) ? "alive" : "DELETED"}), painted=${live.length}`);

  if (!now.includes(BUILDING_1)) {
    // CRITICAL — does undo bring it back, with its whole assembly?
    await page.keyboard.press("Control+z");
    await page.waitForTimeout(600);
    const after = await readEls(page);
    const missing = before.filter((id) => !after.includes(id));
    line(`  A3 Ctrl+Z                                  → ${after.length} elements; still missing: ${missing.length ? missing.join(",") : "none"}`);
  }
  await ctx.close();
}

/* ------------------------------------------------------- SYMPTOM B: "it is not letting me type" */
line("\n=== SYMPTOM B — can the Depth value actually be changed? ===");
for (const path of ["select-all-type", "backspace-clear-type", "partial-then-tab", "type-then-click-away"]) {
  const { ctx, page } = await openPlan(browser);
  await selectBuilding(page);
  const depth = await findDepthInput(page);
  const start = await depth.inputValue();
  const els0 = await readEls(page);

  try {
    if (path === "select-all-type") {
      await depth.click(); await page.keyboard.press("Control+A"); await page.keyboard.type("500"); await page.keyboard.press("Enter");
    } else if (path === "backspace-clear-type") {
      await depth.click(); await page.keyboard.press("End");
      for (let i = 0; i < 6; i++) await page.keyboard.press("Backspace");
      await page.keyboard.type("500"); await page.keyboard.press("Enter");
    } else if (path === "partial-then-tab") {
      await depth.click(); await page.keyboard.press("Control+A"); await page.keyboard.type("5"); await page.keyboard.press("Tab");
    } else {
      await depth.click(); await page.keyboard.press("Control+A"); await page.keyboard.type("450");
      await page.mouse.click(300, 500); // click away on the canvas
    }
  } catch (e) { line(`  ${path}: drive failed — ${e.message}`); }

  await page.waitForTimeout(700);
  const els1 = await readEls(page);
  const depthNow = await page.evaluate((id) => {
    const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    const site = map[Object.keys(map)[0]] || {};
    const e = (site.els || []).find((x) => x.id === id);
    return e ? { w: e.w, h: e.h } : null;
  }, BUILDING_1);
  let shown = "(field gone)";
  try { shown = await depth.inputValue(); } catch (_) {}
  line(`  ${path.padEnd(22)} start=${start} → field shows ${shown}, model w/h = ${JSON.stringify(depthNow)}, els ${els0.length}→${els1.length}`);
  await ctx.close();
}

await browser.close();
