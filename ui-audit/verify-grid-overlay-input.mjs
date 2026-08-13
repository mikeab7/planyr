/* NEW-1 + NEW-2 — AN OVERLAY MUST OWN ITS OWN INPUT.
 *
 * Two separate defects that share a theme (and are NOT one root cause — each reproduces without
 * the other, which is why they are two items):
 *
 *   NEW-1  the Enter that DISMISSES the successor prompt also reached the grid's key handler,
 *          which by design opens the picker on a picker column — so the status menu the user had
 *          just closed came straight back. Not an orphaned menu: a SECOND one.
 *          Signature, and it is the proof: Enter leaves a menu up, Escape and ✕ do not.
 *
 *   NEW-2  a press inside a portalled menu bubbles up the REACT tree into the grid cell that owns
 *          it, arming drag-select — so pressing a swatch and moving a few pixels before release
 *          paints a selection band the user never asked for. A plain click does not show it.
 *
 * WHAT THIS FILE REFUSES TO LET A FIX GET AWAY WITH — both are asserted as loudly as the bugs:
 *   · Enter on a picker column with NO overlay in play must STILL open the picker (designed).
 *   · ordinary drag-select in the grid must STILL work when the press did not start in a menu.
 * A fix that killed either would be worse than the bug it cured.
 *
 * Run:  node ui-audit/verify-grid-overlay-input.mjs      [PW_CHROME=<chrome>]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { ensureVendored, rewriteCdn, serveVendored } from "./lib/vendorCdn.mjs";

const ROOT = new URL("../public/", import.meta.url).pathname;
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json" };

await ensureVendored();
const server = createServer(async (req, res) => {
  try {
    if (await serveVendored(req, res)) return;
    let p = decodeURIComponent(req.url.split("?")[0]); if (p.endsWith("/")) p += "index.html";
    const fp = normalize(join(ROOT, p)); if (!fp.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
    let body = await readFile(fp);
    if (p.endsWith("sequence/index.html")) body = Buffer.from(rewriteCdn(body.toString("utf8")));
    res.writeHead(200, { "Content-Type": MIME[extname(fp)] || "application/octet-stream" }); res.end(body);
  } catch { res.writeHead(404); res.end("not found"); }
});
await new Promise(r => server.listen(0, r));
const url = `http://localhost:${server.address().port}/sequence/`;

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS ✅" : "FAIL ❌"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
/* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. See lib/tabTiming.mjs. */
await assertMeasurable(page, "verify-grid-overlay-input");
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));

await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
const booted = await page.waitForSelector("[data-task-row]", { timeout: 40000 }).then(() => true).catch(() => false);
ok("scheduler boots", booted);

const INSTALL = () => {
  // Overlays read from computed style across the WHOLE document — the successor prompt renders
  // inside the React tree, not as a body child, and a body-only scan is blind to it (that blind
  // spot produced a false "no bug" during diagnosis, so the detector is deliberately broad).
  window.__ov = () => [...document.querySelectorAll("div")]
    .filter(d => { const s = getComputedStyle(d); return s.position === "fixed" && s.display !== "none" && d.getBoundingClientRect().width > 40; })
    .map(d => ({ z: d.style.zIndex || "", t: (d.innerText || "").slice(0, 220).replace(/\n/g, " | ") }));
  window.__menus = () => [...document.querySelectorAll("body > div")]
    .filter(d => /fixed/.test(d.style.position || "") && d.style.zIndex === "9999").length;
  // A range-selected cell paints #dbeafe.
  window.__sel = () => { const o = {};
    for (const r of document.querySelectorAll("[data-task-row]")) {
      const hit = [...r.children].filter(c => c.getAttribute && c.getAttribute("data-col-key"))
        .filter(c => getComputedStyle(c).backgroundColor === "rgb(219, 234, 254)")
        .map(c => c.getAttribute("data-col-key"));
      if (hit.length) o[r.getAttribute("data-task-row")] = hit;
    } return o; };
};
await page.evaluate(INSTALL);
const menus = () => page.evaluate(() => window.__menus());
const sel = () => page.evaluate(() => window.__sel());
const promptUp = async () => (await page.evaluate(() => window.__ov())).some(o => /READY TO START|successor to review/i.test(o.t));

const rowsWithDot = await page.evaluate(() => [...document.querySelectorAll("[data-task-row]")]
  .filter(r => r.querySelector("[data-health-dot]")).map(r => +r.getAttribute("data-task-row")));

// Open the picker on `id` and click GREEN (index 3 of the five dots). Returns true if the
// successor prompt came up as a result.
async function completeAndPrompt(id) {
  await page.locator(`[data-task-row="${id}"]`).scrollIntoViewIfNeeded().catch(() => {});
  await pacedWait(page, 120);
  const dot = page.locator(`[data-picker-cell="health-${id}"] [data-health-dot]`);
  if (!(await dot.count())) return null;
  try { await dot.click({ timeout: 4000 }); } catch { return null; }
  await pacedWait(page, 200);
  const sw = page.locator('body > div[style*="z-index: 9999"] > span');
  if (await sw.count() < 4) { await page.keyboard.press("Escape"); return null; }
  await sw.nth(3).click();
  await pacedWait(page, 450);
  return await promptUp();
}

if (booted) {
  // ── NEW-1 · the three dismissal routes ────────────────────────────────────────────
  const counts = { enter: [0, 0], escape: [0, 0], close: [0, 0] };
  for (const [how, key] of [["enter", "Enter"], ["escape", "Escape"], ["close", null]]) {
    /* Reload between routes. Each run marks a task Complete, so a later route inherits a board where
       the earlier one already consumed the candidates — the first version of this harness reported
       close:[0,0], a PASS earned by never raising a single prompt. A vacuous green is exactly the
       failure this repo keeps meeting, so the counts are asserted to be non-empty below too. */
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector("[data-task-row]", { timeout: 40000 });
    await page.evaluate(INSTALL);
    await pacedWait(page, 300);
    for (const id of rowsWithDot.slice(0, 14)) {
      const raised = await completeAndPrompt(id);
      if (raised !== true) { if (raised === false) await page.keyboard.press("Escape"); continue; }
      counts[how][1]++;
      if (key) await page.keyboard.press(key);
      else { const x = page.locator("text=✕").first(); if (await x.count()) await x.click().catch(() => {}); }
      await pacedWait(page, 450);
      if (await menus() > 0) counts[how][0]++;
      await page.keyboard.press("Escape"); await pacedWait(page, 120);
      if (counts[how][1] >= 4) break;
    }
  }
  console.log("   dismissal routes [menus left open / prompts raised]:", JSON.stringify(counts));
  ok("NEW-1 · Enter that dismisses the prompt does NOT re-open the status menu",
    counts.enter[1] > 0 && counts.enter[0] === 0, `${counts.enter[0]}/${counts.enter[1]} left a menu open`);
  ok("NEW-1 · every route actually raised prompts (an empty run would pass trivially)",
    counts.enter[1] >= 2 && counts.escape[1] >= 2 && counts.close[1] >= 2,
    `raised: enter=${counts.enter[1]} escape=${counts.escape[1]} close=${counts.close[1]}`);
  ok("NEW-1 · Escape stays clean", counts.escape[0] === 0, `${counts.escape[0]}/${counts.escape[1]}`);
  ok("NEW-1 · the ✕ button stays clean", counts.close[0] === 0, `${counts.close[0]}/${counts.close[1]}`);

  // ── NEW-1 · THE FEATURE MUST SURVIVE — Enter on a picker column, no overlay in play ─
  await page.keyboard.press("Escape"); await pacedWait(page, 200);
  const plain = rowsWithDot[0];
  await page.locator(`[data-task-row="${plain}"]`).scrollIntoViewIfNeeded().catch(() => {});
  await page.locator(`[data-picker-cell="health-${plain}"] [data-health-dot]`).click();
  await pacedWait(page, 200);
  await page.keyboard.press("Escape");          // close the menu, leave the cell selected
  await pacedWait(page, 250);
  ok("NEW-1 · (setup) the menu is closed before the feature check", (await menus()) === 0);
  await page.keyboard.press("Enter");
  await pacedWait(page, 350);
  ok("NEW-1 · Enter on a picker column STILL opens the picker when no overlay is in play",
    (await menus()) > 0, "this is a designed feature, not collateral");
  await page.keyboard.press("Escape"); await pacedWait(page, 150);

  // ── NEW-2 · press-and-drag inside a menu must not paint a selection ────────────────
  const r2 = rowsWithDot[0];
  await page.locator(`[data-picker-cell="health-${r2}"] [data-health-dot]`).click();
  await pacedWait(page, 220);
  const sw2 = page.locator('body > div[style*="z-index: 9999"] > span');
  const b = await sw2.nth(2).boundingBox();
  if (b) {
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.mouse.down(); await pacedWait(page, 90);
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 60, { steps: 8 });
    await pacedWait(page, 90);
    await page.mouse.up(); await pacedWait(page, 450);
  }
  const leaked = await sel();
  ok("NEW-2 · press-and-drag inside a menu leaks NO selection into the grid",
    Object.keys(leaked).length === 0, JSON.stringify(leaked).slice(0, 200));

  // ── NEW-2 · the menu must still WORK — clicking a swatch still sets the value ──────
  await page.keyboard.press("Escape"); await pacedWait(page, 200);
  const r3 = rowsWithDot[1];
  await page.locator(`[data-task-row="${r3}"]`).scrollIntoViewIfNeeded().catch(() => {});
  const before = (await page.locator(`[data-task-row="${r3}"] > div`).nth(8).innerText()).trim();
  await page.locator(`[data-picker-cell="health-${r3}"] [data-health-dot]`).click();
  await pacedWait(page, 220);
  await page.locator('body > div[style*="z-index: 9999"] > span').nth(2).click();   // RED
  await pacedWait(page, 450);
  const after = (await page.locator(`[data-task-row="${r3}"] > div`).nth(8).innerText()).trim();
  ok("NEW-2 · clicking a swatch still COMMITS the value", after !== before && after.length > 0,
    `status ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
  ok("NEW-2 · and the menu closes on that click", (await menus()) === 0);

  // ── NEW-2 · ORDINARY DRAG-SELECT MUST STILL WORK (no menu open) ────────────────────
  await page.keyboard.press("Escape"); await pacedWait(page, 200);
  const r4 = rowsWithDot[2], r5 = rowsWithDot[4];
  const c4 = await page.locator(`[data-task-row="${r4}"] > div`).nth(1).boundingBox();
  const c5 = await page.locator(`[data-task-row="${r5}"] > div`).nth(1).boundingBox();
  if (c4 && c5) {
    await page.mouse.move(c4.x + c4.width / 2, c4.y + c4.height / 2);
    await page.mouse.down(); await pacedWait(page, 80);
    await page.mouse.move(c5.x + c5.width / 2, c5.y + c5.height / 2, { steps: 10 });
    await pacedWait(page, 120);
    await page.mouse.up(); await pacedWait(page, 350);
  }
  const dragSel = await sel();
  ok("NEW-2 · ordinary drag-select in the grid STILL works",
    Object.keys(dragSel).length >= 2, JSON.stringify(dragSel).slice(0, 160));
}

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
await browser.close(); server.close();
const passed = results.filter(r => r.pass).length;
console.log(`\n=== ${passed}/${results.length} checks passed ===`);
process.exit(passed === results.length ? 0 : 1);
