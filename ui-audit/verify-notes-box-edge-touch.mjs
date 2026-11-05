/* verify-notes-box-edge-touch.mjs — B2426788, the TOUCH half: on a coarse pointer a SELECTED box's border band reaches further
 * OUT onto the paper (so a finger can catch it) and a real touch drag of it moves the box. Companion of verify-notes-box-edge.mjs
 * (mouse); local base only (the signed-in run uses the mouse harness).
 *
 *   node ui-audit/verify-notes-box-edge-touch.mjs [http://localhost:4181]
 *
 * Chromium touch emulation (hasTouch → `(pointer: coarse)`), real CDP touch events — NOT WebKit: this host cannot install it, so the
 * one thing this cannot show is Mobile Safari's own touch quirks (docs/PHONE-TESTING.md). KNOWN-GOOD ARM: the page must really match
 * `(pointer: coarse)` and an UNSELECTED box must not reach 12 px out (the mouse geometry) — otherwise the run is VOID. */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = (process.argv[2] || process.env.BASE_URL || "http://localhost:4181").replace(/\/$/, "");
const EXEC = process.env.PW_CHROME || ["/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/opt/pw-browsers/chromium/chrome-linux/chrome"].find(existsSync);
const results = [];
const check = (name, got, want) => { const ok = got === want; results.push({ name, ok, got }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}  → ${got}`); };
const void_ = (why) => { console.error(`VOID: ${why}`); process.exit(2); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1000, height: 800 }, hasTouch: true });
const page = await ctx.newPage();
await page.goto(`${BASE}/#/notes`, { waitUntil: "domcontentloaded" });
await pacedWait(page, 250);
await page.evaluate(() => {
  localStorage.clear();
  localStorage.setItem("planyr:notes:tree:v1:local", JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "Touch page", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
  const P = (t) => (t ? { type: "paragraph", content: [{ type: "text", text: t }] } : { type: "paragraph" });
  localStorage.setItem("planyr:notes:page:v1:local:p1", JSON.stringify({ type: "doc", content: [{ type: "noteAnchor", attrs: { x: 60, y: 60, w: 180 }, content: [P("hello")] }, P("")] }));
});
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="note-anchor"]', { timeout: 30000 });
await pacedWait(page, 1200);
await assertMeasurable(page, "verify-notes-box-edge-touch");

const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
if (!coarse) void_("the emulated page does not match (pointer: coarse) — the touch geometry would not be measured");
const rect = () => page.evaluate(() => { const r = document.querySelector('[data-testid="note-anchor"]').getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; });
const edgeAt = (x, y) => page.evaluate(([px, py]) => !!document.elementFromPoint(px, py)?.closest(".planyr-anchor-edge"), [x, y]);
const stored = () => page.evaluate(() => { const d = JSON.parse(localStorage.getItem("planyr:notes:page:v1:local:p1")); const n = (d.doc || d).content.find((c) => c.type === "noteAnchor"); return { x: n.attrs.x, y: n.attrs.y }; });
const scale = await page.evaluate(() => { const d = document.querySelector('[data-testid="note-body"]'); return d.getBoundingClientRect().width / (d.offsetWidth || 1) || 1; });

let r = await rect();
const x30 = r.x + r.w * 0.3;
check("known-good: an UNSELECTED box's band does not reach 12 px out (the mouse geometry)", await edgeAt(x30, r.y - 12), false);
check("an unselected box's band is on the line", await edgeAt(x30, r.y + 0.5), true);

await page.touchscreen.tap(r.x + r.w / 2, r.y + r.h / 2);
await pacedWait(page, 500);
const sel = await page.evaluate(() => document.querySelector('[data-testid="note-anchor"]').getAttribute("data-selected"));
check("a tap on the box selects it", sel, "1");
r = await rect();
check("a SELECTED box's band reaches a finger's width out (12 px above the line)", await edgeAt(x30, r.y - 12), true);
check("…but not 30 px out", await edgeAt(x30, r.y - 30), false);
check("…and never over the text (8 px inside the line is the box)", await edgeAt(x30, r.y + 8), false);

const before = await stored();
const cdp = await ctx.newCDPSession(page);
const start = { x: x30, y: r.y - 8 };
await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
for (let i = 1; i <= 8; i += 1) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x + 8 * i, y: start.y + 5 * i }] });
await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
let after = before;
for (let i = 0; i < 40 && after.x === before.x && after.y === before.y; i += 1) { await pacedWait(page, 150); after = await stored(); }
check("a real touch drag of the band moves the box (stored X)", Math.abs(after.x - before.x - 64 / scale) <= 3, true);
check("…and stored Y", Math.abs(after.y - before.y - 40 / scale) <= 3, true);

const fails = results.filter((x) => !x.ok);
console.log(`\n${results.length - fails.length}/${results.length} passed  ·  ${BASE}`);
await browser.close();
if (fails.length) process.exitCode = 1;
