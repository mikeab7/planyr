/* DOUBLE-CLICK BLANK SPACE AND TYPE — the caret goes there, the words land, and nothing
 * flips to fullscreen (B291538).
 *
 * THE REPORT: *"open a note, double-click on a blank part of the page, then type. The view
 * flips to fullscreen and the typed text goes nowhere — the document is still empty
 * afterwards. A SINGLE click in the same place works perfectly."* The owner read that as
 * double-click being BOUND to fullscreen, and asked for it to stop owning the gesture.
 *
 * ⛔ AUDIT-FIRST, and the finding contradicts the report's mechanism while confirming its
 * symptom. NOTHING in this repo binds a double-click to fullscreen — there is no such
 * handler, and a sweep of sixteen double-click points across the note pane put the caret in
 * the document at every one of them. What DOES exist is a **bare `f`** bound at the window
 * to "toggle fullscreen", excluded only when the press target is itself a typing surface. So
 * the moment any gesture leaves focus on <body> — which a press on inert chrome does — the
 * next letter typed is read as a command and is gone. Measured, with a note open and focus
 * on <body>: one bare `f` entered real fullscreen and the keystroke vanished. That is the
 * bug behind the report, and it is a bug whatever gesture happens to expose it.
 *
 * So this harness asserts BOTH halves, and each one is mutation-provable on its own:
 *   · the gesture — a double-click on blank space, at many points, ends with the typed words
 *     in the DOCUMENT (never "a handler fired", never a character count);
 *   · the shortcut — with a writeable document on screen, a bare `f` types an "f" and does
 *     NOT enter fullscreen, while the header button and Ctrl/Cmd+Shift+F both still do.
 * And the thing that must not break to get there: double-clicking a WORD still selects it.
 *
 *   npm run build && npx vite preview --port 4173 &
 *   node ui-audit/verify-notes-doubleclick.mjs
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

const P = (t) => ({ type: "paragraph", ...(t ? { content: [{ type: "text", text: t }] } : {}) });
const allNodes = (n, out = []) => { if (n && typeof n === "object") { out.push(n); (n.content || []).forEach((c) => allNodes(c, out)); } return out; };
const textOf = (d) => allNodes(d).filter((n) => n.type === "text").map((n) => n.text).join("");
const paras = (d) => allNodes(d).filter((n) => n.type === "paragraph").length;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-notes-doubleclick");
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

console.log("Double-click blank space, then type — and what owns the fullscreen key\n");

await page.goto(BASE, { waitUntil: "load" });
await page.waitForTimeout(1200);
await page.locator('[data-testid="module-tab-notes"]:visible').first().click();
await page.waitForSelector('[data-testid="notes-tree"]', { timeout: 20000 });
await page.locator('[data-testid="notes-new-page"]').click();
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
await page.waitForTimeout(1200);
await page.waitForFunction(() => !!window.__noteEditor, null, { timeout: 20000 });

const seed = async (d) => {
  await page.evaluate((doc) => window.__noteEditor.setDoc(doc), d);
  await page.waitForTimeout(150);
};
const readDoc = () => page.evaluate(() => window.__noteEditor.json());
const inFullscreen = () => page.evaluate(() => !!document.fullscreenElement || !!document.querySelector('[data-testid="exit-fullscreen"]'));
const leaveFullscreen = async () => {
  if (!(await inFullscreen())) return;
  await page.evaluate(() => { document.querySelector('[data-testid="exit-fullscreen"]')?.click(); });
  await page.waitForTimeout(500);
};

/* ════ 1. THE GESTURE — a double-click on blank space, everywhere on the pane ═══════════ */
const mat = await page.locator('[data-testid="note-mat"]').boundingBox();
const POINTS = [];
for (const fx of [0.06, 0.32, 0.64, 0.92]) {
  for (const fy of [0.22, 0.5, 0.86]) {
    POINTS.push({ fx, fy, x: Math.round(mat.x + mat.width * fx), y: Math.round(mat.y + mat.height * fy) });
  }
}

let landed = 0;
let wentFullscreen = 0;
const misses = [];
for (const pt of POINTS) {
  await seed({ type: "doc", content: [P()] });
  await page.mouse.dblclick(pt.x, pt.y);
  await page.waitForTimeout(180);
  await page.keyboard.type("fluffy dog", { delay: 15 });
  await page.waitForTimeout(220);
  const doc = await readDoc();
  const fs = await inFullscreen();
  if (fs) { wentFullscreen += 1; await leaveFullscreen(); }
  if (textOf(doc).includes("fluffy dog") && !fs) landed += 1;
  else misses.push(`(${pt.fx},${pt.fy}) fs=${fs} text=${JSON.stringify(textOf(doc)).slice(0, 40)}`);
}
ok("⛔ double-clicking blank space puts the caret there and the typed words land IN THE DOCUMENT — at every point on the pane",
  landed === POINTS.length, `${landed}/${POINTS.length} points${misses.length ? ` · missed ${misses.join(" | ")}` : ""}`);
ok("⛔ …and not one of those gestures flipped the view to fullscreen",
  wentFullscreen === 0, `${wentFullscreen} of ${POINTS.length}`);

/* The press must stay CHEAP as well as correct — B1393 ×3's rule that it pads nothing. */
await seed({ type: "doc", content: [P("only line")] });
const before = paras(await readDoc());
await page.mouse.dblclick(Math.round(mat.x + mat.width * 0.7), Math.round(mat.y + mat.height * 0.8));
await page.waitForTimeout(200);
await page.keyboard.type("second line", { delay: 12 });
await page.waitForTimeout(250);
const after = await readDoc();
ok("…and it cost the document at most ONE new line — no stack of blank padding",
  paras(after) <= before + 1, `${before} → ${paras(after)} paragraph(s)`);
ok("…and left no alignment behind", !/"textAlign":"(center|right|justify)"/.test(JSON.stringify(after)));

/* ════ 2. WORD SELECTION MUST STILL WORK — the thing the fix must not buy at ═══════════ */
await seed({ type: "doc", content: [P("alpha bravo charlie")] });
const wordBox = await page.evaluate(() => {
  const body = document.querySelector('[data-testid="note-body"]');
  const n = document.createTreeWalker(body, NodeFilter.SHOW_TEXT).nextNode();
  const r = document.createRange();
  r.setStart(n, 6); r.setEnd(n, 11);             // "bravo"
  const rect = r.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
});
await page.mouse.dblclick(wordBox.x, wordBox.y);
await page.waitForTimeout(160);
await page.keyboard.type("DELTA", { delay: 12 });
await page.waitForTimeout(220);
ok("⛔ double-clicking a WORD still selects it — typing replaces that word and nothing else",
  textOf(await readDoc()) === "alpha DELTA charlie", JSON.stringify(textOf(await readDoc())));

/* ════ 3. THE SHORTCUT — a bare letter is not a command while a document is on screen ═══ */
await seed({ type: "doc", content: [P()] });
await page.locator('[data-testid="note-body"]').click();
await page.waitForTimeout(120);
await page.keyboard.type("ffff", { delay: 20 });
await page.waitForTimeout(250);
ok("typing the letter f inside the note types four f's and nothing else",
  textOf(await readDoc()) === "ffff" && !(await inFullscreen()), JSON.stringify(textOf(await readDoc())));

/* ⛔ THE ONE THAT REPRODUCES THE REPORT. Focus on <body> — exactly where any press on inert
 * chrome leaves it — with a note open. Before the fix this entered real fullscreen and ate
 * the keystroke. */
await seed({ type: "doc", content: [P()] });
await page.evaluate(() => document.activeElement?.blur?.());
await page.waitForTimeout(120);
await page.keyboard.press("f");
await page.waitForTimeout(500);
const bareFWentFullscreen = await inFullscreen();
ok("⛔ a bare f with focus outside the document does NOT flip a note to fullscreen — the report's real mechanism",
  !bareFWentFullscreen);
await leaveFullscreen();

/* ════ 4. …AND FULLSCREEN STILL HAS A HOME. Both of them. ══════════════════════════════ */
ok("fullscreen has a VISIBLE control in the header — it is no longer folklore + one letter",
  await page.locator('[data-testid="toggle-fullscreen"]:visible').count() === 1);

await page.locator('[data-testid="toggle-fullscreen"]:visible').first().click();
await page.waitForTimeout(600);
ok("…and clicking it enters fullscreen", await inFullscreen());
await leaveFullscreen();
await page.waitForTimeout(400);
ok("…and the exit control puts the chrome back", !(await inFullscreen()));

/* The modifier shortcut has to work from INSIDE the note, which is the whole reason it is
 * checked ahead of the typing-surface guard. */
await page.locator('[data-testid="note-body"]').click();
await page.waitForTimeout(120);
const textBeforeShortcut = textOf(await readDoc());
await page.keyboard.press("Control+Shift+F");
await page.waitForTimeout(600);
const shortcutWorked = await inFullscreen();
ok("Ctrl/⌘+Shift+F enters fullscreen even with the caret in the note", shortcutWorked);
ok("…and it did not type anything into the document", textOf(await readDoc()) === textBeforeShortcut);
await leaveFullscreen();

ok("no page errors during the run", pageErrors.length === 0, pageErrors.slice(0, 2).join(" | "));

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
process.exit(passed === checks.length ? 0 : 1);
