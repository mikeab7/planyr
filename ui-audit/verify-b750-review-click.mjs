/* Headless drive for the Review (Doc Review) single-click-SELECTS / double-click-OPENS-Properties
 * behavior (B750 / V263 step 1) — LOGGED OUT, on the BUILT app. Opens an ad-hoc LOCAL PDF (the
 * logged-out "Open PDF…" path — no sign-in, no Library/Drive), then drives the markup canvas:
 *
 *  1. Draw a rectangle → its Properties AUTO-SHOW in the sheet rail (fresh draw).
 *  2. Click empty space → the Properties section goes BLANK (deselect).
 *  3. Single-click the rect → STILL blank (select only — no auto-open).
 *  4. Double-click the rect → Properties SHOW.
 *
 * The sheet-rail Properties panel is data-testid="property-panel"; it renders only when a markup's
 * Properties were explicitly opened (double-click / fresh draw), never on a plain single-click.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { readFileSync, mkdirSync } from "node:fs";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const PDF = readFileSync(new URL("../e2e/fixtures/sample.pdf", import.meta.url));

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
const fails = [];
const check = (name, ok, extra = "") => { console.log(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); if (!ok) fails.push(name); };
const propsOpen = () => page.locator('[data-testid="property-panel"]').count().then((n) => n > 0);

// Enter the Review workspace (route #/markup), logged out.
await page.goto(BASE + "#/markup", { waitUntil: "load" });
await page.waitForSelector('[data-testid="doc-review-root"]', { timeout: 15000 });
await page.waitForTimeout(800);

// Open the sample PDF through the real, logged-out local-file input (accept="application/pdf,.pdf",
// NOT the multiple "Compare" input).
const input = page.locator('input[type="file"][accept="application/pdf,.pdf"]:not([multiple])').first();
await input.setInputFiles({ name: "sample.pdf", mimeType: "application/pdf", buffer: PDF });

// The tool rail mounts once the PDF is open; wait for it + a render settle.
await page.waitForSelector('[data-testid="tool-rect"]', { timeout: 20000 });
await page.waitForSelector('[data-testid="tool-select"]', { timeout: 5000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: OUT + "review-opened.png" });

// Rect corners + midpoint (a clear region of the canvas surface, away from both rails).
const A = { x: 760, y: 380 }, B = { x: 910, y: 490 };
const MID = { x: Math.round((A.x + B.x) / 2), y: Math.round((A.y + B.y) / 2) };
const EMPTY = { x: 560, y: 700 };

// ---- 1) Arm Rect + draw (two clicks = two opposite corners) → Properties auto-show. ----
await page.locator('[data-testid="tool-rect"]').click();
await page.waitForTimeout(150);
await page.mouse.click(A.x, A.y);
await page.waitForTimeout(120);
await page.mouse.click(B.x, B.y);
await page.waitForTimeout(500);
await page.screenshot({ path: OUT + "review-after-draw.png" });
const afterDraw = await propsOpen();
check("B750 (Review) — drawing a rectangle AUTO-SHOWS its Properties in the sheet rail", afterDraw);

// ---- 2) Click empty space → Properties go blank (deselect). ----
await page.mouse.click(EMPTY.x, EMPTY.y);
await page.waitForTimeout(350);
const afterEmpty = await propsOpen();
check("B750 (Review) — clicking empty space DESELECTS and blanks the Properties section", !afterEmpty);

// ---- 3) Single-click the rect → still blank (select only, no auto-open). ----
await page.mouse.click(MID.x, MID.y);
await page.waitForTimeout(350);
const afterSingle = await propsOpen();
await page.screenshot({ path: OUT + "review-after-single.png" });
check("B750 (Review) — a single-click SELECTS only; Properties stay CLOSED", !afterSingle);

// ---- 4) Double-click the rect → Properties show. ----
await page.mouse.dblclick(MID.x, MID.y);
await page.waitForTimeout(400);
const afterDouble = await propsOpen();
await page.screenshot({ path: OUT + "review-after-double.png" });
check("B750 (Review) — a DOUBLE-click OPENS Properties", afterDouble);

// ---- 5) Text note: double-click an ALREADY-selected text note → INLINE EDITOR opens (NOT the panel). ----
await page.mouse.click(EMPTY.x, EMPTY.y); // clear the rect selection
await page.waitForTimeout(300);
const T = { x: 780, y: 640 };
await page.locator('[data-testid="tool-text"]').click();
await page.waitForTimeout(150);
await page.mouse.click(T.x, T.y);                 // places a text note → inline editor opens on release
await page.waitForTimeout(350);
const newEditor = page.locator('input[placeholder="Text note…"]');
await newEditor.waitFor({ timeout: 4000 }).catch(() => {});
await newEditor.fill("Notexyz");
await page.keyboard.press("Enter");               // commit the note
await page.waitForTimeout(400);
await page.mouse.click(EMPTY.x, EMPTY.y);          // deselect the freshly-created note
await page.waitForTimeout(300);
// Target the RENDERED note glyphs (its exact screen box) so the select-click reliably HITS the small
// text hit-box — a raw coordinate can land just outside it.
const noteEl = page.locator('svg text', { hasText: "Notexyz" }).first();
await noteEl.waitFor({ timeout: 4000 }).catch(() => {});
const nb = await noteEl.boundingBox();
const NC = nb ? { x: nb.x + nb.width / 2, y: nb.y + nb.height / 2 } : T;
await page.mouse.click(NC.x, NC.y);                // single-click SELECTS the note (props stay closed)
await page.waitForTimeout(600);                    // >350ms so the next dbl reads it as ALREADY-selected
const noteSingleProps = await propsOpen();
const editorAfterSingle = await page.locator('input[placeholder="Text note…"]').count();
check("B750 (Review) — single-click a text note SELECTS only (no editor, no panel)", !noteSingleProps && editorAfterSingle === 0,
  `props=${noteSingleProps} editor=${editorAfterSingle}`);
await page.mouse.dblclick(NC.x, NC.y);             // double-click already-selected text → edit text in place
await page.waitForTimeout(400);
const editorOpen = (await page.locator('input[placeholder="Text note…"]').count()) > 0;
const panelInsteadOfEditor = await propsOpen();
await page.screenshot({ path: OUT + "review-text-editor.png" });
check("B750 (Review) — double-click an already-selected TEXT note opens the INLINE EDITOR, not the panel",
  editorOpen && !panelInsteadOfEditor, `editor=${editorOpen} panel=${panelInsteadOfEditor}`);
await page.keyboard.press("Escape");

check("B750 (Review) — no page errors during the click-through", errors.length === 0, errors.slice(0, 2).join(" | "));

await browser.close();
console.log(fails.length ? `\nFAILED: ${fails.length}\n` : "\nALL PASSED\n");
process.exit(fails.length ? 1 : 0);
