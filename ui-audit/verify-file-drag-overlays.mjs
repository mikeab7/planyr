/* NEW-1 / NEW-2 (2026-10-12) — a dragged FILE: the browser never gets the drop, and no overlay outlives its drag.
 *
 * Owner reports: (1) an .xlsx dropped on the Library made Chrome DOWNLOAD it (a drop with no handler is the
 * browser's own); (2) afterwards the Library stayed in its dragging state and the Map's blue "Drop to add a
 * site plan" pill stayed up with nothing being dragged. Measured stuck on f20ee5a: dragenter + dragover with no
 * dragleave survived Escape, dragend, mouse/pointer events, blur, an empty drop and a view switch.
 *
 * Drives REAL DragEvents (a File in the DataTransfer) through the real app and reads the real overlays:
 *   Map      [data-testid=map-file-drop-active]       "Drop to add a site plan"
 *   Library  [data-testid=library-drop-overlay]        "Drop to file into …"          (a project's FileBrowser)
 *   Review   [data-testid=review-drop-outline]
 *   Site     "Drop site plan to place it on the map"   (--live: the fixture plan's canvas)
 *
 * ARMS (each: raise the overlay, prove it is up, end the drag, prove it is gone):
 *   dragleave-off-window · drop-on-a-header · dragend · Escape · blur · mousemove · pointerdown ·
 *   NOTHING (watchdog) · switch-view-and-back · hidden-view-never-shows
 * KNOWN-GOOD ARMS (expected values independent of the code under test, per DRIVER-SCROLL §6): the plain
 *   enter→leave path clears; a TEXT drag never raises any overlay; an overlay IS up mid-drag (otherwise
 *   "it cleared" would be vacuous — a run where nothing ever raised is declared VOID, not green).
 * LIBRARY: a drop on the header / empty space / the overlay itself is preventDefault()ed (the download bug) and
 *   goes through the same path as Upload (an upload-tray row naming the file, or a named notice) — never silent.
 *
 * Usage:  BASE_URL=http://localhost:4183/ node ui-audit/verify-file-drag-overlays.mjs
 *         node ui-audit/verify-file-drag-overlays.mjs --live https://planyr.io   (signed in as the test account)
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const liveIdx = args.indexOf("--live");
const LIVE = liveIdx >= 0 ? (args[liveIdx + 1] || "https://planyr.io") : null;
const BASE = (LIVE || process.env.BASE_URL || "http://localhost:4183/").replace(/\/?$/, "/");

const OVERLAY = {
  map: '[data-testid="map-file-drop-active"]',
  library: '[data-testid="library-drop-overlay"]',
  review: '[data-testid="review-drop-outline"]',
};
let fails = 0, vacuous = true;
const NAV = LIVE ? 7000 : 1200; // a lazy workspace chunk over the real network needs far longer than a local preview
const ok = (c, m) => { console.log(`${c ? "✅" : "❌"} ${m}`); if (!c) fails++; };

/** Fire one DragEvent at the element under (x, y), or at `window`; returns defaultPrevented. */
const fire = (page, type, { files = true, at = "center", sel = null, relatedNull = false } = {}) => page.evaluate(([type, files, at, sel, relatedNull]) => {
  const dt = new DataTransfer();
  if (files) dt.items.add(new File([new Uint8Array([80, 75, 3, 4])], "Houston lease comps.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  else dt.setData("text/plain", "a map feature");
  const x = at === "center" ? innerWidth / 2 : 40, y = at === "center" ? innerHeight / 2 : 18;
  const el = sel ? document.querySelector(sel) : (document.elementFromPoint(x, y) || document.body);
  const ev = new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y, relatedTarget: relatedNull ? null : document.body });
  el.dispatchEvent(ev);
  return ev.defaultPrevented;
}, [type, files, at, sel, relatedNull]);
const raise = async (page, opts) => { await fire(page, "dragenter", opts); await fire(page, "dragover", opts); await page.waitForTimeout(40); };
const up = (page, sel) => page.locator(sel).first().isVisible().catch(() => false);
const settle = (page, ms) => page.evaluate((ms) => new Promise((r) => { const c = new MessageChannel(); const t0 = performance.now(); c.port1.onmessage = () => (performance.now() - t0 >= ms ? r() : c.port2.postMessage(0)); c.port2.postMessage(0); }), ms);

const ENDS = {
  "dragleave off the window (relatedTarget null)": async (p) => { await fire(p, "dragleave", { relatedNull: true }); await settle(p, 400); },
  "drop on a header (no zone)": async (p) => { await fire(p, "drop", { at: "top" }); },
  "dragend": async (p) => { await fire(p, "dragend"); },
  "Escape": async (p) => { await p.keyboard.press("Escape"); },
  "window blur": async (p) => { await p.evaluate(() => window.dispatchEvent(new Event("blur"))); },
  "mousemove": async (p) => { await p.mouse.move(300, 300); await p.mouse.move(320, 320); },
  "pointerdown": async (p) => { await p.mouse.down(); await p.mouse.up(); },
  "NOTHING (dragenter + dragover, then silence)": async (p) => { await settle(p, 2600); },
};

async function armMatrix(page, name, overlay) {
  // known-good: the plain path
  await raise(page);
  const mid = await up(page, overlay);
  ok(mid, `${name}: overlay is UP mid-drag (known-good — a run where it never rises is void)`);
  if (mid) vacuous = false;
  await fire(page, "dragleave", { relatedNull: true }); await settle(page, 400);
  ok(!(await up(page, overlay)), `${name}: plain enter→leave clears (known-good arm)`);
  for (const [label, end] of Object.entries(ENDS)) {
    await raise(page);
    const raised = await up(page, overlay);
    await end(page); await settle(page, 150);
    ok(raised && !(await up(page, overlay)), `${name}: cleared by ${label}`);
  }
  // a text / map-feature drag never raises it
  await fire(page, "dragenter", { files: false }); await fire(page, "dragover", { files: false }); await settle(page, 80);
  ok(!(await up(page, overlay)), `${name}: a TEXT drag never raises it`);
  await fire(page, "drop", { files: false, at: "top" });
}

(async () => {
  let page, close;
  if (LIVE) {
    const { openSignedIn } = await import("./lib/signedInSession.mjs");
    const s = await openSignedIn({ base: LIVE });
    page = s.page; close = s.close;
    console.log(`signed in — build ${s.build} proof ${JSON.stringify(s.proof)}`);
  } else {
    const browser = await chromium.launch({ executablePath: existsSync(chromium.executablePath()) ? undefined : "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
    page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
    close = () => browser.close();
    await page.goto(BASE + "#/site");
  }
  const consoleErrors = [];
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
  await page.waitForTimeout(LIVE ? 4000 : 1500);
  await assertMeasurable(page, "verify-file-drag-overlays");

  // ---- MAP (portfolio, "Select a project") ----
  await page.evaluate(() => { location.hash = "#/site"; }); await page.waitForTimeout(NAV);
  await armMatrix(page, "Map", OVERLAY.map);

  // ---- REVIEW ----
  await page.evaluate(() => { location.hash = "#/markup"; }); await page.waitForTimeout(NAV);
  await armMatrix(page, "Review", OVERLAY.review);

  // ---- LIBRARY ----
  const libHash = LIVE ? "#/library" : "#/library";
  await page.evaluate((h) => { location.hash = h; }, libHash); await page.waitForTimeout(NAV);
  const hasOverlayView = await (async () => { await raise(page); const v = await up(page, OVERLAY.library); await fire(page, "dragleave", { relatedNull: true }); await settle(page, 400); return v; })();
  if (hasOverlayView) await armMatrix(page, "Library", OVERLAY.library);
  else console.log("ℹ Library: no project open here (home / signed-out) — overlay arms skipped; drop arms below still run");
  for (const [where, opts] of [["the header", { at: "top" }], ["empty space / centre", { at: "center" }]]) {
    await raise(page, opts);
    const prevented = await fire(page, "drop", opts);
    await settle(page, 300);
    ok(prevented, `Library: a drop on ${where} is preventDefault()ed (the browser can never download it)`);
    const tray = await page.evaluate(() => /Houston lease comps\.xlsx/.test(document.body.innerText));
    const note = await page.locator('[data-testid="library-drop-notice"], [data-testid="library-home-drop-notice"]').first().isVisible().catch(() => false);
    if (!(tray || note)) console.log('   debug tail:', JSON.stringify((await page.evaluate(() => location.hash + ' | ' + document.body.innerText)).slice(-260)));
    ok(tray || note, `Library: the drop on ${where} is NOT silent (a tray row names the file, or a notice does)`);
  }

  // ---- view switch: raise on the Map, move to Library, back — nothing stuck anywhere ----
  await page.evaluate(() => { location.hash = "#/site"; }); await page.waitForTimeout(NAV);
  await raise(page);
  await page.evaluate(() => { location.hash = "#/library"; }); await page.waitForTimeout(NAV);
  ok(!(await up(page, OVERLAY.map)) && !(await up(page, OVERLAY.library)), "view switch mid-drag: no overlay left up in the new view");
  await page.evaluate(() => { location.hash = "#/site"; }); await page.waitForTimeout(NAV);
  ok(!(await up(page, OVERLAY.map)), "…and the Map's overlay is not waiting for me when I come back");

  // ---- genuine drop onto the Map still reaches the site-plan intake (no regression) ----
  await page.evaluate(() => { location.hash = "#/site"; }); await page.waitForTimeout(NAV);
  await raise(page);
  const mapDrop = await fire(page, "drop");
  await settle(page, 400);
  ok(mapDrop, "Map: a genuine file drop is still taken (preventDefault) and the overlay clears");
  ok(!(await up(page, OVERLAY.map)), "Map: overlay cleared after the genuine drop");

  ok(consoleErrors.length === 0, `no uncaught page errors${consoleErrors.length ? ": " + consoleErrors[0] : ""}`);
  if (vacuous) { console.log("❌ VOID — no overlay ever rose; this run proved nothing"); fails++; }
  await close();
  console.log(fails ? `\n${fails} FAILED` : "\nALL PASSED");
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
