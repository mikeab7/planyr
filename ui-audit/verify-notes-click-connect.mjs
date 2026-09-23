/* Self-verification for click-to-connect in Sketch mode (owner request 2026-09-22: dragging
 * from a box's dot to draw an arrow "is finicky" — he wants to click two boxes instead).
 *
 * Drives REAL, trusted input (`page.mouse`) on a throwaway page and asserts, for every leg,
 * against what is SAVED (the page's own stored document) as well as what is drawn:
 *   • ↗ Arrow is enabled with NOTHING selected once two boxes exist (known-good arm: with
 *     one box it is disabled — an answer known independently of the new code).
 *   • ↗ Arrow → click box A → click box B draws exactly A→B, then the mode exits.
 *   • between the clicks: crosshair mode on the canvas, box A highlighted as the source, and a
 *     dashed line that FOLLOWS the pointer.
 *   • a press on bare canvas cancels (no arrow, and no box minted by the double-tap detector).
 *   • Escape cancels; clicking the source twice keeps the mode and opens no editor.
 *   • the keyboard route (focus a box + Enter, twice) works.
 *   • the pre-existing drag-from-the-dot gesture still works.
 *
 * Run: npm run build && npx vite preview --port 4173 &
 *      node ui-audit/verify-notes-click-connect.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-notes-click-connect");

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const tb = (id) => page.locator(`[data-testid="${id}"]`);
const settle = async () => page.waitForTimeout(1100);

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
await tb("module-tab-notes").first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 15000 });

await tb("notes-new-page").click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 15000 });
await settle();
const pageId = await page.evaluate(() => {
  const t = JSON.parse(localStorage.getItem("planyr:notes:tree:v1:local") || "null");
  return t.pages[t.pages.length - 1].id;
});

/** The saved sketch node — storage is what settles what was actually written. */
const saved = () => page.evaluate((k) => {
  const p = JSON.parse(localStorage.getItem(k) || "null");
  let found = null;
  const walk = (n) => { if (!n || typeof n !== "object") return; if (n.type === "noteSketch") found = n; (n.content || []).forEach(walk); };
  walk(p?.doc || p);
  return found ? { boxes: found.attrs.boxes || [], links: found.attrs.links || [] } : null;
}, `planyr:notes:page:v1:local:${pageId}`);
const idFor = (s, label) => s.boxes.find((b) => b.label === label)?.id;
const hasLink = (s, a, b) => s.links.some((l) => l.from === a && l.to === b);

await tb("nt-box").click();
await page.waitForSelector('[data-testid="note-sketch"]', { timeout: 15000 });
await page.waitForTimeout(400);
await page.keyboard.type("Alpha", { delay: 6 });
await page.keyboard.press("Escape");
await settle();

ok("KNOWN-GOOD ARM: with ONE box, ↗ Arrow is disabled — there is nothing to connect",
  await tb("sketch-arrow").isDisabled());

const canvas = async () => page.locator("[data-sketch-canvas]").boundingBox();
async function addBoxAt(fx, fy, label) {
  const c = await canvas();
  await page.mouse.dblclick(c.x + c.width * fx, c.y + c.height * fy);
  await page.waitForTimeout(300);
  await page.keyboard.type(label, { delay: 6 });
  await page.keyboard.press("Escape");
  await settle();
}
await addBoxAt(0.8, 0.25, "Beta");
await addBoxAt(0.5, 0.8, "Gamma");
let s = await saved();
ok("fixture: three boxes saved", s?.boxes.length === 3, s?.boxes.map((b) => b.label).join("|"));
const A = idFor(s, "Alpha"), B = idFor(s, "Beta"), G = idFor(s, "Gamma");

const centre = async (id) => {
  const b = await page.locator(`[data-sketch-node="${id}"] .planyr-sketch-box`).boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const blank = async () => {
  const c = await canvas();
  const taken = [];
  for (const n of await page.locator("[data-sketch-node]").all()) taken.push(await n.boundingBox());
  for (let y = c.y + 20; y < c.y + c.height - 20; y += 16) {
    for (let x = c.x + 20; x < c.x + c.width - 20; x += 20) {
      if (!taken.some((t) => x > t.x - 30 && x < t.x + t.width + 30 && y > t.y - 30 && y < t.y + t.height + 30)) return { x, y };
    }
  }
  return null;
};
const isConnecting = () => page.evaluate(() => !!document.querySelector(".planyr-sketch-draw.is-connecting"));
const status = () => tb("sketch-status").innerText();

/* Deselect everything first, so the leg below proves NOTHING has to be selected. */
const bl = await blank();
await page.mouse.click(bl.x, bl.y);
await page.waitForTimeout(700);   // well past the double-tap window
ok("nothing is selected before ↗ Arrow is pressed",
  await page.locator("[data-sketch-node].is-selected").count() === 0);
ok("⛔ ↗ Arrow is ENABLED with nothing selected once two boxes exist", !(await tb("sketch-arrow").isDisabled()));

/* ---- the main path: ↗ Arrow, click A, click B ---------------------------------------- */
await tb("sketch-arrow").click();
ok("pressing ↗ Arrow enters connect mode — crosshair canvas, button shown pressed, a prompt",
  await isConnecting() && (await tb("sketch-arrow").getAttribute("aria-pressed")) === "true"
  && /starts from/.test(await status()), await status());

const pa = await centre(A);
await page.mouse.click(pa.x, pa.y);
await page.waitForTimeout(250);
ok("clicking the first box HIGHLIGHTS it as the source",
  await page.locator(`[data-sketch-node="${A}"].is-link-source`).count() === 1
  && /points to/.test(await status()), await status());
ok("...and a dashed line runs from it", await tb("sketch-connect-line").count() === 1);
const x2a = await tb("sketch-connect-line").getAttribute("x2");
await page.mouse.move(pa.x + 140, pa.y + 90, { steps: 6 });
await page.waitForTimeout(100);
const x2b = await tb("sketch-connect-line").getAttribute("x2");
ok("...that FOLLOWS THE POINTER between the two clicks", x2a !== x2b, `x2 ${x2a} → ${x2b}`);
ok("...and nothing was moved or written by the first click (no drag, no edit)",
  JSON.stringify((await saved()).boxes) === JSON.stringify(s.boxes)
  && await page.locator('[data-testid="sketch-box-edit"]:visible').count() === 0);

const pb = await centre(B);
await page.mouse.click(pb.x, pb.y);
await settle();
s = await saved();
ok("⛔ CLICKING THE SECOND BOX DRAWS THE ARROW A → B — saved, and drawn",
  s.links.length === 1 && hasLink(s, A, B) && await page.locator("[data-sketch-edge]").count() === 1,
  JSON.stringify(s.links));
ok("...and the mode EXITS on its own — no crosshair, no line, no highlight, button released",
  !(await isConnecting()) && await tb("sketch-connect-line").count() === 0
  && await page.locator(".is-link-source").count() === 0
  && (await tb("sketch-arrow").getAttribute("aria-pressed")) === "false");
ok("...and no box was created or opened along the way",
  s.boxes.length === 3 && await page.locator('[data-testid="sketch-box-edit"]:visible').count() === 0);

/* ---- a press on bare canvas cancels ---------------------------------------------------- */
await page.waitForTimeout(700);
await tb("sketch-arrow").click();
await page.mouse.click(pb.x, pb.y);
await page.waitForTimeout(150);
const bl2 = await blank();
await page.mouse.click(bl2.x, bl2.y);
await page.waitForTimeout(150);
await page.mouse.click(bl2.x, bl2.y);   // a second quick press there: must NOT mint a box either
await settle();
s = await saved();
ok("a press on bare canvas CANCELS — no arrow added, the mode is off, it says so",
  s.links.length === 1 && !(await isConnecting()), await status());
ok("...and the two quick presses on bare canvas did not make a box (count unchanged)",
  await page.locator("[data-sketch-node]").count() === 3);
if (await page.locator('[data-testid="sketch-box-edit"]:visible').count()) { await page.keyboard.press("Escape"); await settle(); }

/* ---- Escape cancels -------------------------------------------------------------------- */
await page.waitForTimeout(700);
await tb("sketch-arrow").click();
await page.mouse.click(pa.x, pa.y);
await page.waitForTimeout(150);
await page.keyboard.press("Escape");
await page.waitForTimeout(200);
ok("Escape CANCELS connect mode", !(await isConnecting()) && await tb("sketch-connect-line").count() === 0);

/* ---- clicking the source twice stays in the mode and opens no editor -------------------- */
await page.waitForTimeout(700);
await tb("sketch-arrow").click();
await page.mouse.dblclick(pb.x, pb.y);   // a real native double-click on the same box
await page.waitForTimeout(300);
ok("clicking the SOURCE box again keeps the mode on and opens NO editor",
  await isConnecting() && await page.locator('[data-testid="sketch-box-edit"]:visible').count() === 0,
  await status());
const pg = await centre(G);
await page.mouse.click(pg.x, pg.y);
await settle();
s = await saved();
ok("...then clicking a different box connects B → G", hasLink(s, B, G) && s.links.length === 2, JSON.stringify(s.links));

/* ---- ↗ Arrow again toggles it off ------------------------------------------------------ */
await page.waitForTimeout(700);
await tb("sketch-arrow").click();
await tb("sketch-arrow").click();
ok("pressing ↗ Arrow a second time turns the mode OFF", !(await isConnecting()));

/* ---- the keyboard route ---------------------------------------------------------------- */
await tb("sketch-arrow").click();
await page.locator(`[data-sketch-node="${G}"]`).focus();
await page.keyboard.press("Enter");
await page.locator(`[data-sketch-node="${A}"]`).focus();
await page.keyboard.press("Enter");
await settle();
s = await saved();
ok("KEYBOARD: ↗ Arrow, focus a box + Enter, focus another + Enter → G → A",
  hasLink(s, G, A) && s.links.length === 3 && await page.locator('[data-testid="sketch-box-edit"]:visible').count() === 0,
  JSON.stringify(s.links));

/* ---- the old drag-from-the-dot gesture still works ------------------------------------- */
await page.waitForTimeout(700);
const gb = await page.locator(`[data-sketch-grip="${A}"]`).boundingBox();
const pg2 = await centre(G);
await page.mouse.move(gb.x + gb.width / 2, gb.y + gb.height / 2);
await page.mouse.down();
await page.mouse.move(pg2.x, pg2.y, { steps: 12 });
await page.mouse.up();
await settle();
s = await saved();
ok("the existing DRAG-FROM-THE-DOT gesture still draws an arrow (A → G)", hasLink(s, A, G) && s.links.length === 4, JSON.stringify(s.links));

ok("no page error across the run", pageErrors.length === 0, pageErrors.join(" | ") || "clean");

await browser.close();
const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
process.exit(passed === checks.length ? 0 : 1);
