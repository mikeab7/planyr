/* verify-notes-width-matrix — THE ADVERSARIAL PAGE-WIDTH MATRIX (NEW-2, fourth round,
 * 2026-09-21).
 *
 * ⛔ WHY A FOURTH HARNESS EXISTS AT ALL, AND WHAT MAKES IT DIFFERENT FROM THE THREE THAT WENT
 * GREEN OVER A LIVE DEFECT. Three rounds of this bug each shipped with a harness that honestly
 * passed, and the owner found the next symptom within minutes each time. The reason is recorded
 * in `notesPageWidth.js`'s own header and it is not "the harness was sloppy" — it is that
 * **every arm of every previous harness started from a page at or above the natural card width**
 * (unpinned 580, Wide 900, a custom 717). The defect lives in the mat's own SLACK — the gap
 * between the scroller's content and the pane — and a page at or above the natural card has no
 * slack by construction, so no arm could reach it. The instrument was blind to the whole
 * variable, not wrong about the ones it could see.
 *
 * So the differentiator here is NOT "more assertions". It is **coverage of the variables that
 * decide whether the compensation mechanism has anything left to spend**:
 *   · starting width BELOW the natural card (440, 505, 560) — the arm that has never existed
 *   · device pixel ratio ≠ 1 — his machine measures ~2.15, every prior run was 1
 *   · a view zoom other than 100%
 *   · the scroll position (both axes) at drag start
 *   · boxes placed to the LEFT and RIGHT of the text column, which move for reasons text does not
 *   · gesture SHAPE — many small moves vs a few big ones, reversal mid-drag, release off-window
 *
 * ⛔ AND IT CARRIES BOTH ARMS DRIVER-SCROLL-IS-NOT-APP-SCROLL §6 ASKS FOR, so a green table means
 * something:
 *   · a KNOWN-GOOD arm — a deliberate pan of the view MUST register as movement in the recorder.
 *     If it does not, the recorder cannot see movement at all and the whole run is VOID, not
 *     green. (`--selftest` runs it alone.)
 *   · a MUTATION arm — `--baseline=<url>` points the identical matrix at a build that predates a
 *     known fix and REQUIRES the rows that fix was for to come back RED. A guard nobody has seen
 *     fail is a guard that rots green, and the preferred form (NO-ONE-OWNS-A-COMPOSITE) is to
 *     point it at real untouched code rather than at a synthetic poke.
 *
 * ⛔ REAL TRUSTED INPUT ONLY (SYNTHETIC-KEYS-DONT-EDIT). Every gesture is Playwright's own mouse.
 * Nothing here dispatches a synthetic PointerEvent, and the release-outside-the-window row moves
 * the pointer to the viewport edge and releases there rather than faking a `pointercancel`.
 *
 * ⛔ SAMPLED EVERY FRAME, NOT AT THE ENDS. The owner's reports are "judder", "shake", "creep" —
 * all of which are invisible to a before/after pair. The in-page recorder runs on
 * `requestAnimationFrame` and records the client rect of every tracked feature, so a row reports
 * BOTH `maxDev` (the worst excursion at any frame — judder) AND `net` (first-to-last — creep).
 * A row is green only if both are within tolerance, and separately that there is no jump on
 * release.
 *
 * Usage:
 *   node ui-audit/verify-notes-width-matrix.mjs                 # against BASE_URL
 *   node ui-audit/verify-notes-width-matrix.mjs --selftest      # known-good arm only
 *   node ui-audit/verify-notes-width-matrix.mjs --baseline=URL  # ALSO run the mutation arm
 *   node ui-audit/verify-notes-width-matrix.mjs --json          # machine-readable table
 */
import { chromium } from "playwright";

import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const ARGS = process.argv.slice(2);
const SELFTEST_ONLY = ARGS.includes("--selftest");
const AS_JSON = ARGS.includes("--json");
const BASELINE = (ARGS.find((a) => a.startsWith("--baseline=")) || "").split("=")[1] || null;
const MUTATION = (ARGS.find((a) => a.startsWith("--mutation-arm=")) || "").split("=")[1] || null;

/* ⛔ THE TOLERANCE IS ONE CSS PIXEL, AND IT IS NOT A STYLE CHOICE. The owner's expectation,
 * restated across all three prior rounds, is that content does not move AT ALL. A sub-pixel
 * residue from a fractional device pixel ratio is real and unavoidable (his own panel runs at
 * ~2.15), so anything strictly under one whole CSS pixel is below what any eye can resolve and
 * below what a rect can honestly distinguish. Anything at or past 1px is a defect: the three
 * shipped rounds each produced 20px, 75px and 140px. */
const TOL = 1;

/* How far past a settled position a feature may move in the frames after the pointer is released
 * before that counts as a "jump on release" — his fourth named symptom. Same reasoning, same
 * number: a release must not move the picture at all. */
const RELEASE_TOL = 1;

const p = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });

/** A page with real body text, long enough to scroll, so a scrolled-state row has somewhere to
 *  scroll TO. Kept deliberately word-heavy rather than a single short line: a paragraph that
 *  wraps is what makes a horizontal shift visible at all. */
const bodyParas = (n = 24) => Array.from({ length: n }, (_, i) =>
  p(`Paragraph ${i + 1}. The quick brown fox jumps over the lazy dog while the surveyor checks `
    + `the plat and the detention pond is staked out to the south east corner of the site.`));

/** Boxes deliberately placed to the LEFT of the text column (negative x reaches into the blank
 *  margin the left grip opens) and to the RIGHT of it. Row 7's whole point: a box is positioned
 *  by its own stored coordinates, not by the text flow, so it can move for reasons the words
 *  cannot — and the previous rounds never tracked one. */
const boxNode = (aid, x, y, w = 180) => ({
  type: "noteAnchor", attrs: { aid, x, y, w, h: null },
  content: [p(`box ${aid}`)],
});

function docFor({ pageWidth = null, boxes = false, paras = 24 } = {}) {
  const content = bodyParas(paras);
  if (boxes) {
    content.unshift(boxNode("bx-left", -120, 60));
    content.unshift(boxNode("bx-right", 620, 60));
    content.unshift(boxNode("bx-mid", 200, 240));
  }
  const doc = { type: "doc", content };
  if (pageWidth !== null) doc.attrs = { pageWidth };
  return doc;
}

/* ---------------------------------------------------------------------------------------- */

async function openPage(browser, { width, height, dpr, url }) {
  const ctx = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: dpr,
  });
  const pg = await ctx.newPage();
  const errs = [];
  pg.on("pageerror", (e) => errs.push(e.message));
  pg.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await assertMeasurable(pg, "verify-notes-width-matrix");
  await pg.addInitScript(() => { window.__PLANYR_E2E = true; });
  pg._errs = errs;
  pg._base = url;
  return pg;
}

async function seed(pg, doc, title = "Matrix") {
  await pg.goto(`${pg._base}#/notes`, { waitUntil: "domcontentloaded" });
  await pg.evaluate(([treeKey, prefix, d, t]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: t, createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify(d));
  }, [TREE_KEY, PAGE_PREFIX, doc, title]);
  await pg.reload({ waitUntil: "domcontentloaded" });
  await pg.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(pg, 900);
}

/* ⛔ THE RECORDER. Installed in the page, sampling on rAF. It records the client rect LEFT and TOP
 * of every tracked feature, because a horizontal width gesture that moves content vertically is
 * just as much a defect and the previous harnesses only ever looked at x.
 *
 * ⛔ IT TRACKS FEATURES BY A STABLE SELECTOR RE-QUERIED EVERY FRAME, never by a held element
 * handle. A held `ElementHandle` across a React re-render is exactly the trap B1439 named: the
 * node the app re-created is not the node you are measuring, and the stale one reports a frozen
 * rect forever — which reads as a perfect zero-movement pass. */
/* ⛔ AND IT RECORDS THE REAL POINTER POSITION FROM THE PAGE'S OWN EVENTS, not from what the
 * driver believes it commanded. That is what makes the no-jump assertion possible at all: the
 * question "did the page move further than the finger did" needs both quantities on the same
 * clock. A capture-phase `pointermove` listener costs nothing and never round-trips, so it
 * cannot itself perturb the gesture the way a per-step `evaluate` would (FOREGROUND-OR-VOID §6:
 * a probe that observes the middle of a gesture has changed the gesture). */
const RECORDER = `
window.__wm = {
  samples: [],
  running: false,
  targets: [],
  px: null,
  paired: [],
  _onMove: null,
  _onDown: null,
  start(targets) {
    this.targets = targets; this.samples = []; this.running = true; this.px = null; this.paired = [];
    /* THE POINTER AND THE PAGE WIDTH ARE READ IN THE SAME HANDLER, SYNCHRONOUSLY, AND THAT IS
     * WHAT MAKES "did the page outrun the finger" ANSWERABLE AT ALL. (Full reasoning is in
     * widthRow's own comment below — this block is inside a template literal, so it may not
     * contain a backtick; see the module pointer's standing note about exactly that.) */
    const pairNow = (clientX) => {
      const el = document.querySelector('[data-testid="note-sheet"]');
      window.__wm.paired.push({ px: clientX, w: el ? el.getBoundingClientRect().width : null });
    };
    /* The FIRST pair is taken at the press, before the pointer has travelled at all. Without it
     * the baseline is one move stale in the pointer axis only, which under-counts every later
     * pointer delta by that one move and reports a lead the app never produced (measured 4.67px
     * on the reversal row, against 8.67px steps). */
    this._onDown = (e) => { pairNow(e.clientX); };
    this._onMove = (e) => { pairNow(e.clientX); window.__wm.px = e.clientX; };
    window.addEventListener("pointerdown", this._onDown, true);
    window.addEventListener("pointermove", this._onMove, true);
    const rect = (sel) => {
      const el = document.querySelector(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { l: r.left, t: r.top, w: r.width, r: r.right };
    };
    const tick = () => {
      if (!this.running) return;
      const frame = { t: performance.now(), px: this.px, v: {} };
      for (const tg of this.targets) frame.v[tg.name] = rect(tg.sel);
      frame.sheet = rect('[data-testid="note-sheet"]');
      this.samples.push(frame);
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  },
  stop() {
    this.running = false;
    if (this._onMove) window.removeEventListener("pointermove", this._onMove, true);
    if (this._onDown) window.removeEventListener("pointerdown", this._onDown, true);
    return { samples: this.samples, paired: this.paired };
  },
};
`;

async function startRecording(pg, targets) {
  await pg.evaluate(RECORDER);
  await pg.evaluate((tg) => window.__wm.start(tg), targets);
  // Let at least a couple of frames land before the gesture begins, so "first" is a settled frame.
  await pacedWait(pg, 90);
}

async function stopRecording(pg) {
  return pg.evaluate(() => window.__wm.stop());
}

/** Reduce the raw frames to per-feature movement. `maxDev` is the worst excursion from the FIRST
 *  sampled position (judder/shake); `net` is first-to-last (creep). A feature that goes missing
 *  mid-run is reported as such rather than silently skipped — a null frame used to read as "no
 *  movement". */
function analyse(samples, names) {
  const out = {};
  for (const name of names) {
    const pts = samples.map((s) => s.v[name]);
    const present = pts.filter(Boolean);
    if (present.length < 2) { out[name] = { missing: true, frames: present.length }; continue; }
    const first = present[0];
    const last = present[present.length - 1];
    let maxDevX = 0; let maxDevY = 0;
    for (const q of present) {
      maxDevX = Math.max(maxDevX, Math.abs(q.l - first.l));
      maxDevY = Math.max(maxDevY, Math.abs(q.t - first.t));
    }
    out[name] = {
      missing: false,
      frames: present.length,
      maxDevX: round2(maxDevX),
      maxDevY: round2(maxDevY),
      netX: round2(last.l - first.l),
      netY: round2(last.t - first.t),
      gone: pts.length - present.length,
    };
  }
  return out;
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Where the grip is, in client coordinates, right now. Re-read every time — the left grip MOVES
 *  during a left-edge drag by construction, so a cached position is wrong after the first move. */
/** ⛔ PRESS ONLY WHERE A HUMAN COULD ACTUALLY PRESS (DRIVER-SCROLL-IS-NOT-APP-SCROLL §4, and
 *  NOTES-CARRY-FORWARD §7's own note that the mat's box runs past the bottom of the viewport).
 *  The width grip spans the WHOLE height of the sheet, so on any page with real content in it the
 *  grip is TALLER THAN THE WINDOW and its geometric centre is somewhere below the glass. The
 *  first version of this harness took that centre, and every drag in every row silently did
 *  nothing — 40 of 46 rows red, all of them the instrument. Take the middle of the grip's
 *  VISIBLE portion instead, and refuse outright if it has none. */
async function matBox(pg) {
  const b = await pg.locator('[data-testid="note-mat"]').boundingBox();
  if (!b) throw new Error("no note-mat");
  return b;
}

async function gripBox(pg, edge) {
  const el = pg.locator(`[data-testid="note-page-width-grip-${edge}"]`);
  const b = await el.boundingBox();
  if (!b) throw new Error(`grip ${edge} has no box — the page may be in narrow mode`);
  /* ⛔ THE VISIBLE BOX IS THE MAT'S, NOT THE WINDOW'S, ON BOTH AXES — and getting this wrong cost
   * a real diagnosis. The first version checked the viewport, so a grip panned to x=217 read as
   * comfortably on screen; `elementsFromPoint` there answered `#notes-tree`, because the Pages
   * rail occupies the left ~268px of the window and the grip had been panned clean underneath it.
   * The press landed on the rail, the drag did nothing, and the row reported "committed nothing"
   * about a build where the gesture is fine. Vertically the same trap already applies for a
   * different reason (the mat's own box runs past the bottom of the glass — NOTES-CARRY-FORWARD
   * §7). Press only what a human could actually see INSIDE the container
   * (DRIVER-SCROLL-IS-NOT-APP-SCROLL §4). */
  const vp = pg.viewportSize();
  const mat = await matBox(pg);
  const visLeft = Math.max(mat.x, 0);
  const visRight = Math.min(mat.x + mat.width, vp.width);
  const top = Math.max(b.y, mat.y, 0);
  const bottom = Math.min(b.y + b.height, mat.y + mat.height, vp.height);
  if (bottom - top < 12) {
    throw new Error(`grip ${edge} is outside the mat vertically (grip ${Math.round(b.y)}..${Math.round(b.y + b.height)}, visible ${Math.round(Math.max(mat.y, 0))}..${Math.round(Math.min(mat.y + mat.height, vp.height))})`);
  }
  const cx = b.x + b.width / 2;
  if (cx < visLeft + 2 || cx > visRight - 2) {
    throw new Error(`grip ${edge} is outside the mat horizontally (centre x ${Math.round(cx)}, mat ${Math.round(visLeft)}..${Math.round(visRight)}) — a press here lands on the rail, not the grip`);
  }
  return { x: cx, y: (top + bottom) / 2 };
}

/** ⛔ THE SAVE IS DEBOUNCED, so a read taken immediately after the pointer comes up reports the
 *  PREVIOUS width and reads as "the drag committed nothing" — which is exactly what the first
 *  version of this harness reported, for every row, on a build where the drag worked fine. Poll
 *  until it changes or the debounce window is comfortably past. */
async function storedWidth(pg, { was, tries = 24 } = {}) {
  const read = () => pg.evaluate(() => {
    const raw = localStorage.getItem("planyr:notes:page:v1:local:p1");
    if (!raw) return undefined;
    try {
      const a = JSON.parse(raw)?.attrs || {};
      return { pageWidth: a.pageWidth ?? null, pageMarginLeft: a.pageMarginLeft || 0 };
    } catch { return undefined; }
  });
  for (let i = 0; i < tries; i += 1) {
    const v = await read();
    if (was === undefined || JSON.stringify(v) !== JSON.stringify(was)) return v;
    await pacedWait(pg, 100);
  }
  return read();
}

/** The live view scale, read off the workspace layer's own transform — never re-derived from the
 *  app's own formula. A width gesture is measured in SCREEN pixels (that is what the pointer
 *  moves in) while the page is stored in WORKSPACE pixels, and at any zoom but 100% those are
 *  different quantities. Comparing them without this is the harness asserting its own confusion:
 *  the first run of this matrix against the new canvas reported "committed 547 vs asked 820" at
 *  150%, which is 547 × 1.5 = 820 — the app was exactly right and the comparison was not. */
async function viewScale(pg) {
  return pg.evaluate(() => {
    const el = document.querySelector('[data-testid="note-workspace"]');
    const m = /scale\(([-0-9.]+)\)/.exec(el?.style.transform || "");
    return m ? parseFloat(m[1]) : 1;
  });
}

async function sheetRect(pg) {
  return pg.evaluate(() => {
    const s = document.querySelector('[data-testid="note-sheet"]');
    if (!s) return null;
    const r = s.getBoundingClientRect();
    return { left: round(r.left), right: round(r.right), width: round(r.width) };
    function round(n) { return Math.round(n * 100) / 100; }
  });
}

/** Drive a real mouse drag on a grip.
 *  `steps` — how many pointermoves the travel is split into. Many small moves is the Case-21
 *  method (it is what found the last defect); a few large ones is the flick case, which stresses
 *  a completely different code path (one big delta per frame, so any per-frame accumulation shows
 *  up immediately instead of averaging out). */
/** ⛔ MAKE ROOM BEFORE MEASURING, AND PAN THE VIEW TO DO IT — never shrink the gesture to fit.
 *  A left-edge drag needs `|dx|` pixels of window to the LEFT of the grip; a wide or already-
 *  panned page can leave less than that, and the driver silently clamps the pointer at the glass,
 *  so the row reports "the drag committed nothing" about a build where the drag is fine. Panning
 *  first is legitimate setup (it is the same wheel a person would use) and it happens BEFORE the
 *  recorder starts, so it cannot contaminate the measurement. */
async function ensureGripRoom(pg, edge, dx) {
  const vp = pg.viewportSize();
  const mat = await matBox(pg);
  /* The band the whole gesture has to live inside — the MAT's visible width, with a margin, for
   * the reason `gripBox` now refuses outside it. */
  const lo = Math.max(mat.x, 0) + 24;
  const hi = Math.min(mat.x + mat.width, vp.width) - 24;
  for (let i = 0; i < 12; i += 1) {
    let g = null;
    try { g = await gripBox(pg, edge); } catch { g = null; }   // outside IS the case this fixes
    const need = g ? g.x + dx : null;                          // where the pointer must reach
    if (g && g.x > lo && g.x < hi && need > lo && need < hi) return;
    const push = edge === "left" ? -200 : 200;                 // pan the page away from that edge
    await pg.mouse.move((lo + hi) / 2, mat.y + Math.min(mat.height, vp.height - mat.y) / 2);
    await pg.mouse.wheel(push, 0);
    await pacedWait(pg, 120);
  }
}

async function dragGrip(pg, { edge, dx, steps, reverseAt = null, releaseOutside = false }) {
  const start = await gripBox(pg, edge);
  await pg.mouse.move(start.x, start.y);
  await pg.mouse.down();
  const legs = reverseAt == null ? [dx] : [reverseAt, dx - reverseAt];
  let travelled = 0;
  for (const leg of legs) {
    const per = leg / steps;
    for (let i = 0; i < steps; i += 1) {
      travelled += per;
      await pg.mouse.move(start.x + travelled, start.y);
    }
  }
  if (releaseOutside) {
    /* Past the window's own edge. Playwright clamps to the viewport, which IS the real condition:
     * the browser stops reporting positions past the glass. The app must commit what it last saw
     * rather than snapping back — and the row must score it against where the pointer actually
     * ended, not against the nominal `dx`, or it asserts a number no gesture ever asked for. */
    const vp = pg.viewportSize();
    const edgeX = edge === "left" ? 0 : vp.width;
    await pg.mouse.move(edgeX, start.y);
    travelled = edgeX - start.x;
  }
  await pg.mouse.up();
  await pacedWait(pg, 260);          // let the commit + any settling frames land
  return { start, travelled };
}

/* ---------------------------------------------------------------------------------------- */

/** ⛔ THE KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6). Move the VIEW deliberately and
 *  require the recorder to report it. Its expected value is known independently of any width
 *  code: scrolling/panning a view by N pixels moves everything painted in it by N pixels. If
 *  this arm does not report movement, the recorder is blind and every green row below is
 *  vacuous — so the run is declared VOID rather than scored. */
async function knownGoodArm(pg) {
  await seed(pg, docFor({ pageWidth: 440, paras: 40 }));
  await startRecording(pg, [
    { name: "body", sel: '[data-testid="note-body"] p' },
  ]);
  // A real wheel over the mat — the app's own scroll/pan path, not a driver actionability scroll.
  const mat = await pg.locator('[data-testid="note-mat"]').boundingBox();
  await pg.mouse.move(mat.x + mat.width / 2, mat.y + mat.height / 2);
  for (let i = 0; i < 8; i += 1) await pg.mouse.wheel(0, 40);
  await pacedWait(pg, 300);
  const got = analyse((await stopRecording(pg)).samples, ["body"]);
  const moved = !got.body.missing && Math.abs(got.body.netY) > 20;
  return { moved, detail: got.body };
}

/* ---------------------------------------------------------------------------------------- */

const ROWS = [];
const row = (id, title, run) => ROWS.push({ id, title, run });

/** Shared body of a width-drag row. Everything except the gesture and the fixture is identical,
 *  which is the point — a row differs from its neighbours in exactly one named variable. */
async function widthRow(pg, { doc, edge, dx, steps, reverseAt, releaseOutside, prep, boxes }) {
  await seed(pg, doc);
  if (prep) await prep(pg);
  const targets = [
    { name: "body", sel: '[data-testid="note-body"] > p' },
  ];
  if (boxes) {
    targets.push({ name: "boxLeft", sel: '.planyr-anchor[data-anchor-id="bx-left"]' });
    targets.push({ name: "boxRight", sel: '.planyr-anchor[data-anchor-id="bx-right"]' });
    targets.push({ name: "boxMid", sel: '.planyr-anchor[data-anchor-id="bx-mid"]' });
  }
  /* ⛔ MAKING ROOM IS SETUP, SO IT HAPPENS BEFORE THE RECORDER STARTS. It pans the view, and a pan
   * moves everything painted on the canvas — which is exactly what the recorder is built to
   * notice. The first version called it from inside `dragGrip`, i.e. after recording had begun,
   * and three rows reported the harness's own setup pan as content movement (240px at one window,
   * 111.63px at another). A probe whose own action produced the reading is
   * DRIVER-SCROLL-IS-NOT-APP-SCROLL in its purest form, and it is worth noting that it took the
   * same shape here as the bug this matrix exists to find. */
  await ensureGripRoom(pg, edge, dx);
  const before = await sheetRect(pg);
  const scale = await viewScale(pg);
  const wasStored = await storedWidth(pg);
  await startRecording(pg, targets);
  const { travelled } = await dragGrip(pg, { edge, dx, steps, reverseAt, releaseOutside });
  const { samples, paired } = await stopRecording(pg);
  const after = await sheetRect(pg);
  const committed = await storedWidth(pg, { was: wasStored });

  const names = targets.map((t) => t.name);
  const moves = analyse(samples, names);

  /* ⛔ JUMP ON RELEASE, MEASURED SEPARATELY. The last ~4 sampled frames all land AFTER
   * `pointerup`; if the picture moves between the final drag frame and where it settles, that is
   * his "jump when I let go" and it is invisible to a first-vs-last comparison (both ends can be
   * identical while the middle snaps). */
  const release = {};
  for (const n of names) {
    const pts = samples.map((s) => s.v[n]).filter(Boolean);
    if (pts.length < 6) { release[n] = null; continue; }
    const tail = pts.slice(-5);
    release[n] = round2(Math.max(...tail.map((q) => Math.abs(q.l - tail[tail.length - 1].l))));
  }

  /* The width the drag ASKED for. The left grip grows the page by moving left, so a negative dx
   * widens it; the right grip grows by moving right. */
  const asked = before.width + (edge === "left" ? -travelled : travelled);

  /* ⛔ WHY THE POINTER AND THE WIDTH ARE READ TOGETHER IN THE `pointermove` HANDLER, AND NOT ONE
   * PER rAF FRAME. The first version of this harness recorded the pointer in the handler and the
   * sheet's width on the next animation frame, then allowed a fudge of one frame's pointer travel
   * because the two could straddle a move. **That allowance never moved the 2px threshold — but it
   * cost real sensitivity, and it cost it exactly where the gesture is fastest.** On a three-step
   * flick one frame carries ~100px of pointer, which is enough to hide a 140px jump completely.
   * Measured on `origin/main`, whose grab-jump is 140px of page against the first few pixels of
   * finger: CAUGHT in the slow rows (frames ~5px) and MISSED in the flick rows 2 and 4b (frames
   * ~100px) — one defect, one instrument, invisible purely because of how fast the hand moved.
   * Pairing the two readings removes the straddle instead of budgeting for it, and the width read
   * in the handler is necessarily the one from BEFORE this move's own state update lands, so the
   * app can only ever appear to LAG the pointer, never lead it. Lag never trips a bound that only
   * fires on leading, and the jump is still caught one move later.
   *
   * ⛔ THE NO-JUMP INVARIANT, AND IT IS THE ONE THAT CAUGHT THE FIRST REAL DEFECT OF THIS ROUND.
   * A width gesture is direct manipulation: the boundary follows the finger. So at EVERY frame,
   * the page may not have changed width by MORE than the pointer has travelled. It may legally
   * change by LESS (a floor or a ceiling is holding it), which is why this is a one-sided bound
   * rather than an equality — an equality would report every legitimate clamp as a defect.
   *
   * Measured on `origin/main` before any change this round: grabbing the left grip of a page
   * pinned to 440 moved the sheet from 440 to 580 — 140px of page — while the pointer had moved
   * 8. That is a jump of 132px AT GRAB, before the drag has really begun, and no previous
   * harness asked the question that finds it. */
  /* ⛔ THE WIDTH AT MOVE N IS PAIRED WITH THE POINTER AT MOVE N−1, AND THAT OFFSET IS EXACT
   * RATHER THAN A FUDGE. `apply()` sets React state inside the move handler, so the DOM the NEXT
   * handler measures is the one move N−1 produced. Comparing same-index pairs therefore reports a
   * one-move LAG, which is harmless while the pointer travels one way — and flips into an
   * apparent LEAD the instant the gesture reverses, because the width is still showing the
   * extreme while the pointer has already started back. Measured on a correct build: a clean
   * 4.67px "lead" on the reversal row, exactly one 140/30 step, about a page that tracked the
   * pointer perfectly. Shifting the pointer series by one is the correction, and it costs no
   * sensitivity at all: the grab-jump this bound exists to catch is 140px of page against the
   * first few pixels of finger, and it is still caught on the very next move. */
  let worstLead = 0; let worstAt = null;
  const pairs = paired.filter((q) => q.px != null && q.w != null);
  if (pairs.length > 2) {
    const p0 = pairs[0];
    for (let i = 1; i < pairs.length; i += 1) {
      const pointerMoved = Math.abs(pairs[i - 1].px - p0.px);
      const widthMoved = Math.abs(pairs[i].w - p0.w);
      const lead = widthMoved - pointerMoved;
      if (lead > worstLead) { worstLead = round2(lead); worstAt = { pointerMoved: round2(pointerMoved), widthMoved: round2(widthMoved) }; }
    }
  }

  /* ⛔ THE OPPOSITE EDGE HOLDS. Dragging the LEFT boundary must not move the RIGHT one and vice
   * versa — "only the boundary you grabbed moves" is half of the owner's own sentence, and it is
   * a different question from "the content stayed still". */
  const edgeHold = (() => {
    const withSheet = samples.filter((s) => s.sheet);
    if (withSheet.length < 2) return null;
    const f = withSheet[0];
    const key = edge === "left" ? "r" : "l";
    let worst = 0;
    for (const s of withSheet) worst = Math.max(worst, Math.abs(s.sheet[key] - f.sheet[key]));
    return round2(worst);
  })();

  /* ⛔ WHAT THE CONTENT IS *ALLOWED* TO DO, STATED PER GESTURE RATHER THAN AS A FLAT ZERO.
   *
   * Widening from either edge, and narrowing from the right, must move the content NOT AT ALL —
   * that is the owner's sentence and it admits no exception. Narrowing from the LEFT is the one
   * case that is different, and pretending otherwise would make this harness assert something
   * false: once the blank paper on the left is used up, the boundary has nowhere to go but into
   * the writing column, so the column narrows and the words move right WITH the boundary. That is
   * what dragging a margin marker into your own text does in every word processor.
   *
   * So the expectation is computed, not assumed: it is exactly the overshoot past the margin that
   * was there when the drag began. A row that seeds no margin and narrows 160px expects the
   * content to move exactly +160 — no more (which would mean the page moved too), no less (which
   * would mean the boundary did not really go where the pointer did). */
  const startMargin = (doc?.attrs?.pageMarginLeft || 0) * (scale || 1);   // on screen, like travel
  const expectShift = edge === "left" && travelled > 0
    ? Math.max(0, travelled - startMargin)
    : 0;

  const problems = [];
  for (const n of names) {
    const m = moves[n];
    if (m.missing) { problems.push(`${n}: not tracked (${m.frames} frames)`); continue; }
    if (m.gone) problems.push(`${n}: disappeared for ${m.gone} frames`);
    if (Math.abs(m.netX - expectShift) >= TOL) problems.push(`${n} netX ${m.netX}, expected ${round2(expectShift)}`);
    if (m.maxDevX > Math.abs(expectShift) + TOL) problems.push(`${n} maxDevX ${m.maxDevX} exceeds the ${round2(expectShift)} the boundary moved into it`);
    if (Math.abs(m.maxDevY) >= TOL) problems.push(`${n} maxDevY ${m.maxDevY}`);
    if (release[n] != null && release[n] >= RELEASE_TOL) problems.push(`${n} release jump ${release[n]}`);
  }
  if (worstLead > 2) problems.push(`page outran the pointer by ${worstLead} (pointer ${worstAt.pointerMoved}, width ${worstAt.widthMoved})`);
  if (edgeHold != null && edgeHold >= TOL) problems.push(`${edge === "left" ? "RIGHT" : "LEFT"} edge moved ${edgeHold} during a ${edge}-edge drag`);

  /* The committed width is reported, and compared against what the pointer asked for only when
   * no clamp can be involved — a drag into the module's own floor/ceiling legitimately commits a
   * different number, and calling that a failure would be the harness asserting its own model of
   * the app rather than the property. A clamp that fires is REPORTED instead, in `width.note`. */
  /* The stored geometry is TWO numbers now — the writing column (`pageWidth`, what that attribute
   * has always meant) and the blank left margin (`pageMarginLeft`, new). Their sum is the page,
   * which is what the pointer was dragging, so that is what gets compared. */
  const committedTotal = committed && typeof committed === "object" && typeof committed.pageWidth === "number"
    ? committed.pageWidth + (committed.pageMarginLeft || 0)
    : after.width;
  /* Both sides of the comparison in WORKSPACE pixels — see `viewScale`. */
  const askedWorkspace = asked / (scale || 1);
  const clamped = askedWorkspace <= 330 || askedWorkspace >= 2390 || (worstLead > 2);
  if (!clamped && Math.abs(committedTotal - askedWorkspace) > 3) {
    problems.push(`committed ${committedTotal} (col ${committed?.pageWidth}, margin ${committed?.pageMarginLeft}) vs asked ${round2(askedWorkspace)} workspace px`);
  }

  return {
    ok: problems.length === 0,
    problems,
    moves,
    release,
    lead: { worstLead, worstAt },
    edgeHold,
    width: { before: before.width, after: after.width, asked: round2(asked), scale, committed, committedTotal, clamped },
  };
}

/* ---- THE TEN (plus) ---------------------------------------------------------------------- */

row("1", "LEFT grip · slow widen · many small moves (Case 21 method)", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: 440 }), edge: "left", dx: -150, steps: 60 }));

row("2", "LEFT grip · fast flick widen · few large moves", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: 440 }), edge: "left", dx: -150, steps: 3 }));

row("3a", "LEFT grip · narrow · slow", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: 900 }), edge: "left", dx: 160, steps: 60 }));

row("3b", "LEFT grip · narrow · fast", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: 900 }), edge: "left", dx: 160, steps: 3 }));

row("4a", "RIGHT grip · widen · slow", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: 440 }), edge: "right", dx: 180, steps: 60 }));

row("4b", "RIGHT grip · widen · fast", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: 440 }), edge: "right", dx: 180, steps: 3 }));

row("4c", "RIGHT grip · narrow · slow", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: 900 }), edge: "right", dx: -170, steps: 60 }));

row("6a", "START below natural card (440) · LEFT widen", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: 440 }), edge: "left", dx: -250, steps: 50 }));

row("6b", "START at natural card (580) · LEFT widen", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: 580 }), edge: "left", dx: -250, steps: 50 }));

row("6c", "START custom (505) · LEFT widen", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: 505 }), edge: "left", dx: -220, steps: 50 }));

row("6d", "START unpinned (Fit to content) · LEFT widen", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: null }), edge: "left", dx: -200, steps: 50 }));

row("6e", "START Full width · LEFT narrow", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: "full" }), edge: "left", dx: 200, steps: 50 }));

row("7", "Boxes LEFT and RIGHT of the column · LEFT widen", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: 440, boxes: true }), edge: "left", dx: -220, steps: 50, boxes: true }));

row("8a", "Page SCROLLED DOWN · LEFT widen", (pg) =>
  widthRow(pg, {
    doc: docFor({ pageWidth: 440, paras: 60 }), edge: "left", dx: -180, steps: 50,
    prep: async (page) => {
      const mat = await page.locator('[data-testid="note-mat"]').boundingBox();
      await page.mouse.move(mat.x + mat.width / 2, mat.y + mat.height / 2);
      for (let i = 0; i < 10; i += 1) await page.mouse.wheel(0, 60);
      await pacedWait(page, 300);
    },
  }));

row("8b", "Page PANNED HORIZONTALLY · LEFT widen", (pg) =>
  widthRow(pg, {
    /* ⛔ AN ORDINARY-WIDTH PAGE, DELIBERATELY. The first version of this row used a 2000px page to
     * manufacture horizontal overflow in the old scroller; on a transform canvas the view pans
     * regardless of the page's width, so all that width did was sit the page against
     * `PAGE_WIDTH_MAX` and confound the row's real variable — a non-zero `view.x` at drag start —
     * with a clamp. */
    doc: docFor({ pageWidth: 580, paras: 30 }), edge: "left", dx: -160, steps: 50,
    prep: async (page) => {
      const mat = await page.locator('[data-testid="note-mat"]').boundingBox();
      await page.mouse.move(mat.x + mat.width / 2, mat.y + mat.height / 2);
      for (let i = 0; i < 8; i += 1) await page.mouse.wheel(60, 0);
      await pacedWait(page, 300);
    },
  }));

/* ⛔ THE WIDE-PAGE ARM, KEPT AS ITS OWN ROW SO CHANGING 8b's FIXTURE DID NOT QUIETLY DROP
 * COVERAGE. Row 8b originally used a 2000px page to manufacture horizontal overflow in the old
 * scroller; narrowing it to 580 made that row about the variable it claims (a non-zero view.x at
 * drag start) rather than about a clamp — but a page far wider than the window is a real case and
 * it is now tested here instead of being lost in the edit. */
row("8c", "A page far WIDER than the window · LEFT widen", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: 2000, paras: 30 }), edge: "left", dx: -160, steps: 50 }));

row("10a", "Drag REVERSES direction mid-gesture", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: 440 }), edge: "left", dx: -120, steps: 30, reverseAt: -260 }));

row("10b", "Release the pointer OUTSIDE the window", (pg) =>
  widthRow(pg, { doc: docFor({ pageWidth: 440 }), edge: "left", dx: -200, steps: 40, releaseOutside: true }));

/* ---- Rows that are not a grip drag ------------------------------------------------------- */

/** 5 — every preset, switching from each to each. A preset commit is a single state change
 *  rather than a gesture, so the question is only "did anything move that should not". The body
 *  text's own LEFT edge must not move when the page gets wider from a preset either: the same
 *  invariant, reached through the menu instead of the grip. */
row("5", "Width-menu presets · every from→to pair", async (pg) => {
  await seed(pg, docFor({ pageWidth: null }));
  const PRESETS = ["Fit to content", "Narrow", "Normal", "Wide", "Full width"];
  const problems = [];
  const seen = [];
  for (const from of PRESETS) {
    for (const to of PRESETS) {
      if (from === to) continue;
      const okFrom = await pickPreset(pg, from);
      if (!okFrom) { problems.push(`could not select ${from}`); continue; }
      await pacedWait(pg, 200);
      await startRecording(pg, [{ name: "body", sel: '[data-testid="note-body"] > p' }]);
      const okTo = await pickPreset(pg, to);
      await pacedWait(pg, 320);
      const got = analyse((await stopRecording(pg)).samples, ["body"]);
      if (!okTo) { problems.push(`could not select ${to}`); continue; }
      seen.push(`${from}→${to}`);
      if (got.body.missing) { problems.push(`${from}→${to}: body not tracked`); continue; }
      /* ⛔ "FULL WIDTH" IS THE ONE EXEMPTION, AND IT IS A STATED PRODUCT DECISION RATHER THAN A
       * TOLERANCE. Every other preset names a NUMBER, so it changes the page's width and nothing
       * else, and the content may not move by a pixel. "Full width" names the PANE — it is the one
       * preset whose whole meaning is "fill what I can see" — so honouring it means bringing the
       * page's full width into view, which moves the view and therefore moves the content on
       * screen. Leaving the view alone instead was measured: a 907px frame overhanging a 923px
       * pane by 156px, i.e. a preset called Full width that you cannot see all of. The exemption
       * is exactly the four transitions INTO full; every transition OUT of it, and all twelve
       * between the numeric presets, are still held to zero. */
      if (to === "Full width") {
        if (got.body.missing) problems.push(`${from}→${to}: body not tracked`);
        continue;
      }
      if (Math.abs(got.body.netX) >= TOL) problems.push(`${from}→${to}: body netX ${got.body.netX}`);
      if (Math.abs(got.body.maxDevX) >= TOL) problems.push(`${from}→${to}: body maxDevX ${got.body.maxDevX}`);
    }
  }
  return { ok: problems.length === 0, problems, pairs: seen.length };
});

/** 9 — at a view zoom other than 100%, and at a device pixel ratio other than 1. The DPR arm is
 *  handled by the caller (it needs its own browser context); this row does the zoom. */
row("9a", "At 150% view zoom · LEFT widen", (pg) =>
  widthRow(pg, {
    doc: docFor({ pageWidth: 440 }), edge: "left", dx: -160, steps: 50,
    prep: async (page) => {
      await page.keyboard.press("Control+Equal");
      await page.keyboard.press("Control+Equal");
      await page.keyboard.press("Control+Equal");
      await pacedWait(page, 350);
    },
  }));

row("9b", "At 67% view zoom · LEFT widen", (pg) =>
  widthRow(pg, {
    doc: docFor({ pageWidth: 440 }), edge: "left", dx: -160, steps: 50,
    prep: async (page) => {
      await page.keyboard.press("Control+Minus");
      await page.keyboard.press("Control+Minus");
      await pacedWait(page, 350);
    },
  }));

/** Reload persistence of the final width. */
row("R1", "Final width survives a reload", async (pg) => {
  await seed(pg, docFor({ pageWidth: 440 }));
  await dragGrip(pg, { edge: "left", dx: -150, steps: 30 });
  const committed = await storedWidth(pg);
  const before = await sheetRect(pg);
  await pg.reload({ waitUntil: "domcontentloaded" });
  await pg.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(pg, 900);
  const after = await sheetRect(pg);
  const problems = [];
  if (committed == null) problems.push("nothing committed");
  if (Math.abs(after.width - before.width) > 2) problems.push(`width ${before.width} → ${after.width} across reload`);
  return { ok: problems.length === 0, problems, width: { before: before.width, after: after.width, committed } };
});

/** Undo/redo of a width change is ONE step, and undoing restores the previous width. */
row("R2", "Undo/redo of a width change is one step", async (pg) => {
  await seed(pg, docFor({ pageWidth: 440 }));
  const before = await sheetRect(pg);
  await dragGrip(pg, { edge: "left", dx: -150, steps: 30 });
  const widened = await sheetRect(pg);
  await pg.locator('[data-testid="note-body"]').click({ position: { x: 40, y: 20 } });
  await pacedWait(pg, 150);
  await pg.keyboard.press("Control+z");
  await pacedWait(pg, 400);
  const undone = await sheetRect(pg);
  await pg.keyboard.press("Control+y");
  await pacedWait(pg, 400);
  const redone = await sheetRect(pg);
  const problems = [];
  if (widened.width - before.width < 100) problems.push(`drag did not widen (${before.width} → ${widened.width})`);
  if (Math.abs(undone.width - before.width) > 3) problems.push(`undo left ${undone.width}, expected ~${before.width}`);
  if (Math.abs(redone.width - widened.width) > 3) problems.push(`redo left ${redone.width}, expected ~${widened.width}`);
  return { ok: problems.length === 0, problems, width: { before: before.width, widened: widened.width, undone: undone.width, redone: redone.width } };
});

/** A window resize after a custom width must not move the content either. */
row("R3", "Window resize after a custom width", async (pg) => {
  await seed(pg, docFor({ pageWidth: 505 }));
  await startRecording(pg, [{ name: "body", sel: '[data-testid="note-body"] > p' }]);
  const vp = pg.viewportSize();
  await pg.setViewportSize({ width: vp.width - 260, height: vp.height });
  await pacedWait(pg, 500);
  const got = analyse((await stopRecording(pg)).samples, ["body"]);
  await pg.setViewportSize(vp);
  await pacedWait(pg, 300);
  const problems = [];
  if (got.body.missing) problems.push("body not tracked");
  /* ⛔ A WINDOW RESIZE LEGITIMATELY MOVES THE PAGE — the pane it sits in got narrower, so a
   * centred or gutter-placed sheet genuinely has a different left edge. What this row asserts is
   * only that the page does not move by MORE than the window did: the content must not amplify
   * the resize. Stated as a bound rather than as zero, because zero would be wrong here. */
  else if (Math.abs(got.body.netX) > 260 + TOL) problems.push(`body netX ${got.body.netX} exceeds the 260 the window moved`);
  return { ok: problems.length === 0, problems, body: got.body };
});

/** The width control is `FormatMenu testid="nt-page-width"` — a button that opens a
 *  `role="listbox"` whose rows are `nt-page-width-opt-<value>`. Driven by the real controls
 *  rather than by calling the command, so this row exercises the same path the owner does. */
const PRESET_VALUE = {
  "Fit to content": "fit",
  Narrow: "440",
  Normal: "580",
  Wide: "900",
  "Full width": "full",
};

async function pickPreset(pg, label) {
  const trigger = pg.locator('[data-testid="nt-page-width"]');
  if (!(await trigger.count())) return false;
  await trigger.first().click();
  await pacedWait(pg, 180);
  const item = pg.locator(`[data-testid="nt-page-width-opt-${PRESET_VALUE[label]}"]`);
  if (!(await item.count())) {
    await pg.keyboard.press("Escape");
    return false;
  }
  await item.first().click();
  await pacedWait(pg, 220);
  return true;
}

/* ⛔ THE MUTATION ARM, AND IT IS A SEPARATE ARM FROM THE KNOWN-GOOD ONE ON PURPOSE.
 *
 * They answer two different questions and a harness that runs only one of them is half-blind:
 *   · the KNOWN-GOOD arm asks *can this recorder see movement at all* — if a deliberate view pan
 *     does not register, every green row is vacuous and the run is VOID.
 *   · the MUTATION arm asks *can this matrix see the DEFECT it was built for* — pointed at a
 *     build that predates a known fix, on real untouched code rather than a synthetic poke, and
 *     required to reproduce that item's OWN MEASURED NUMBERS rather than merely to go red.
 * A guard nobody has watched fail is a guard that rots green (VIEW-INDEPENDENT-ONCE §6), and
 * "it went red somewhere" is a much weaker claim than "it reported +140 on a 440 page, which is
 * what B1801040 measured by hand."
 *
 * ⛔ THE EXPECTED VALUES ARE B1801040's OWN, copied from that item and from
 * `notesPageWidth.js`'s header, NOT read off a run of this harness: a 138px left-grip widen in
 * 60 small steps moved the body +140px at a stored width of 440, +75 at 505, +20 at 560, and
 * exactly 0 at 717, at 900 and unpinned. The drift is the mat's own slack, so it appears only
 * below the natural card — which is precisely the region no previous harness ever tested. */
const B1801040_DRIFT = [
  { pageWidth: 440, expect: 140 },
  { pageWidth: 505, expect: 75 },
  { pageWidth: 560, expect: 20 },
  { pageWidth: 717, expect: 0 },
  { pageWidth: 900, expect: 0 },
  { pageWidth: null, expect: 0 },
];

async function mutationArm(browser, url) {
  const rows = [];
  for (const { pageWidth, expect } of B1801040_DRIFT) {
    const pg = await openPage(browser, { width: 1500, height: 950, dpr: 1, url });
    await seed(pg, docFor({ pageWidth, paras: 24 }));
    const sel = '[data-testid="note-body"] > p';
    const first = await pg.evaluate((q) => document.querySelector(q).getBoundingClientRect().left, sel);
    await dragGrip(pg, { edge: "left", dx: -138, steps: 60 });
    const last = await pg.evaluate((q) => document.querySelector(q).getBoundingClientRect().left, sel);
    const drift = round2(last - first);
    const ok = Math.abs(drift - expect) <= 2;
    rows.push({ pageWidth, expect, drift, ok });
    console.log(`  ${ok ? "✓" : "✗"} pageWidth ${String(pageWidth).padEnd(6)} body drift ${String(drift).padStart(7)}  (B1801040 measured ${expect})`);
    await pg.context().close();
  }
  return rows;
}

/* ---------------------------------------------------------------------------------------- */

async function runMatrix(browser, url, { dpr = 1, width = 1500, height = 950, label }) {
  const results = [];
  for (const r of ROWS) {
    const pg = await openPage(browser, { width, height, dpr, url });
    let res;
    try {
      res = await r.run(pg);
    } catch (e) {
      res = { ok: false, problems: [`threw: ${e.message}`] };
    }
    if (pg._errs.length) {
      res.problems = [...(res.problems || []), `console: ${pg._errs.slice(0, 2).join(" | ")}`];
      res.ok = false;
    }
    results.push({ id: r.id, title: r.title, ...res });
    console.log(`  ${res.ok ? "✓" : "✗"} [${label}] ${r.id} ${r.title}`
      + (res.problems?.length ? `\n        ${res.problems.join("\n        ")}` : ""));
    await pg.context().close();
  }
  return results;
}

/* ---------------------------------------------------------------------------------------- */

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

console.log("── known-good arm (the recorder must be able to see movement) ──");
const kgPage = await openPage(browser, { width: 1500, height: 950, dpr: 1, url: BASE });
const kg = await knownGoodArm(kgPage);
await kgPage.context().close();
console.log(`  ${kg.moved ? "✓" : "✗"} a deliberate view pan registers as movement — `
  + `netY ${kg.detail?.netY}, frames ${kg.detail?.frames}`);
if (!kg.moved) {
  console.log("\n⛔ RUN VOID — the recorder cannot see movement at all. No row below means anything.");
  await browser.close();
  process.exit(2);
}
let mutation = null;
if (MUTATION) {
  console.log(`\n── MUTATION ARM · B1801040's own measured drift, against ${MUTATION} ──`);
  mutation = await mutationArm(browser, MUTATION);
}

if (SELFTEST_ONLY) {
  await browser.close();
  /* Both arms can be run together without the matrix: the point of `--selftest` is to check the
   * INSTRUMENT, and the mutation arm is half of that check. */
  if (mutation && mutation.some((r) => !r.ok)) process.exit(3);
  process.exit(0);
}

console.log("\n── matrix · 1500×950 · dpr 1 ──");
const main = await runMatrix(browser, BASE, { label: "head", dpr: 1 });

console.log("\n── matrix · 1191×465 (his real window) · dpr 2.15 ──");
const dpr215 = await runMatrix(browser, BASE, { label: "dpr2.15", dpr: 2.15, width: 1191, height: 465 });

let baseline = null;
if (BASELINE) {
  console.log(`\n── MUTATION ARM · the identical matrix against ${BASELINE} ──`);
  baseline = await runMatrix(browser, BASELINE, { label: "pre-fix", dpr: 1 });
}

await browser.close();

const all = [...main.map((r) => ({ ...r, arm: "1500×950 dpr1" })), ...dpr215.map((r) => ({ ...r, arm: "1191×465 dpr2.15" }))];
const failed = all.filter((r) => !r.ok);

if (AS_JSON) {
  console.log(JSON.stringify({ knownGood: kg, head: main, dpr215, baseline, mutation }, null, 2));
} else {
  console.log("\n══ MATRIX ══");
  console.log("| row | case | 1500×950 dpr1 | 1191×465 dpr2.15 |");
  console.log("|---|---|---|---|");
  for (const r of ROWS) {
    const a = main.find((x) => x.id === r.id);
    const b = dpr215.find((x) => x.id === r.id);
    const cell = (x) => (x?.ok ? "✅" : `❌ ${(x?.problems || []).join("; ").slice(0, 90)}`);
    console.log(`| ${r.id} | ${r.title} | ${cell(a)} | ${cell(b)} |`);
  }
}

if (baseline) {
  const redOnBaseline = baseline.filter((r) => !r.ok).map((r) => r.id);
  console.log(`\nMUTATION ARM: ${redOnBaseline.length} rows red on the pre-fix build — ${redOnBaseline.join(", ") || "NONE"}`);
  if (!redOnBaseline.length) {
    console.log("⛔ The mutation arm found NOTHING on a build known to carry the defect. "
      + "This matrix cannot see the bug it was built for — treat every green above as vacuous.");
    process.exit(3);
  }
}

if (mutation) {
  const bad = mutation.filter((r) => !r.ok);
  console.log(`\nMUTATION ARM: ${mutation.length - bad.length}/${mutation.length} of B1801040's measured values reproduced`);
  if (bad.length) {
    console.log("⛔ The mutation arm did NOT reproduce the defect it was pointed at. This matrix "
      + "cannot see the bug it was built for — treat every green above as vacuous.");
    process.exit(3);
  }
}

console.log(`\n${failed.length ? "✗" : "✓"} ${all.length - failed.length}/${all.length} rows green`);
process.exit(failed.length ? 1 : 0);
