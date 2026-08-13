/* sweep-notes — THE SYSTEMATIC PASS OVER THE WHOLE NOTES MODULE.
 *
 * ⛔ WHY IT EXISTS, in the owner's words: *"you need to loop and debug everything about this
 * module."* Every round so far shipped a fix and he found another failure within minutes, which
 * means the testing has been FOLLOWING his reports instead of getting ahead of them. Every other
 * harness in `ui-audit/` was written to prove one named defect gone. This one is the opposite: it
 * knows no defects, and it asks the same small set of questions of EVERYTHING.
 *
 * ⛔ THE FIRST DESIGN RULE: IT ENUMERATES, IT DOES NOT LIST. The toolbar's controls are read out
 * of the DOM at run time (`[data-testid^="nt-"]`), the rail's rows and menu items likewise. A
 * hard-coded list of controls is a list that goes stale the day somebody adds one — and a sweep
 * that silently stops covering a new control is worse than no sweep, because it reports green.
 * Anything the sweep could not reach is COUNTED and NAMED at the end, never skipped quietly.
 *
 * ⛔ THE SECOND: THE QUESTIONS ARE GENERIC, so they apply to a control nobody has thought about.
 *   1. Does it throw?                     — no uncaught page error from any control, ever.
 *   2. Does UNDO put the document back?   — click it, then Ctrl+Z: the stored document must be
 *                                           BYTE-IDENTICAL to what it was. This is the strongest
 *                                           property available here and it needs no knowledge of
 *                                           what the control was supposed to do.
 *   3. Does REDO put it back again?
 *   4. Does a TOGGLE toggle?              — a control that reports itself active must return to
 *                                           its start state when pressed twice.
 *   5. Does anything paint OUTSIDE the sheet? — the Sketch-panel class of defect (B391075), asked
 *                                           of every panel rather than of the one that was reported.
 *   6. Does the STORED copy agree with the SCREEN? — B400176's invariant, generalised: after every
 *                                           action, what a second window would read must describe
 *                                           what this one is showing.
 *
 * ⛔ THE THIRD: A SWEEP THAT REPORTS NOTHING IS A FAILED SWEEP, and it says so in its own output
 * rather than leaving that judgement to the reader.
 *
 * Real input throughout — `page.mouse` and `page.keyboard`. A synthetic click reaches nothing here
 * (B364017) and a synthetic key mutates nothing (SYNTHETIC-KEYS-DONT-EDIT); a sweep driven by
 * dispatched events would return a page of green ticks having exercised nothing at all.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ONLY = process.env.SWEEP_ONLY || "";

const findings = [];
const notes = [];
let checks = 0;
const seenControls = new Set();

/** A FINDING is a defect with a repro attached. Nothing else may be called one. */
const finding = (area, what, repro) => {
  findings.push({ area, what, repro });
  console.log(`  ✗ ${area} — ${what}\n      repro: ${repro}`);
};
const pass = (label) => { checks += 1; if (process.env.SWEEP_VERBOSE) console.log(`  ✓ ${label}`); };
const note = (line) => { notes.push(line); console.log(`  · ${line}`); };

const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});

const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

/* ---- the reads everything below is built on ------------------------------------------- */

/** The STORED document — what a second window, the sync and the printer all read.
 *
 * ⛔ NORMALISED, AND THAT IS NOT A WEAKENING. A hand-authored fixture omits attributes the editor
 * writes back explicitly as `null` (`textAlign`, `lineHeight`, …), so a raw byte-compare against
 * the seed reports a difference the moment the editor round-trips the document once — which it
 * does on the first real edit. The first run called that "Ctrl+Z does not restore" four times over
 * a document whose every node was identical. A `null` attribute IS the default, so dropping it is
 * the comparison this check always meant; any attribute that actually holds a value still shows. */
const normalise = (json) => {
  if (!json) return json;
  const strip = (n) => {
    if (Array.isArray(n)) return n.map(strip);
    if (!n || typeof n !== "object") return n;
    const out = {};
    for (const [k, v] of Object.entries(n)) {
      if (k === "attrs" && v && typeof v === "object") {
        const a = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== null && x !== undefined));
        if (Object.keys(a).length) out.attrs = a;
        continue;
      }
      out[k] = strip(v);
    }
    return out;
  };
  try { return JSON.stringify(strip(JSON.parse(json))); } catch (_) { return json; }
};

const storedDoc = async (page, id = "p1") =>
  normalise(await page.evaluate((k) => localStorage.getItem(k), PAGE_PREFIX + id));

const storedTree = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), TREE_KEY);

/** Every feature on the page, by kind — COUNT-EVERY-KIND: a count that reads only `[data-el-id]`
 *  sees one kind and calls the other four nothing. */
const onScreen = (page) => page.evaluate(() => ({
  anchors: document.querySelectorAll('[data-testid="note-anchor"]').length,
  rows: document.querySelectorAll('[data-testid^="notes-row-"]').length,
  images: document.querySelectorAll(".planyr-note-image").length,
  sketches: document.querySelectorAll(".planyr-sketch-host").length,
  text: (document.querySelector('[data-testid="note-body"]')?.innerText || "").trim().length,
}));

/** ⛔ ANYTHING PAINTING OUTSIDE THE SHEET. B391075 was one panel overflowing its container; this
 *  asks it of every element under the editor, so the next one is caught by the same question. */
const overflowing = (page) => page.evaluate(() => {
  const sheet = document.querySelector('[data-testid="note-sheet"]') || document.querySelector('[data-testid="note-mat"]');
  if (!sheet) return [];
  const s = sheet.getBoundingClientRect();
  const out = [];
  for (const el of sheet.querySelectorAll("*")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (getComputedStyle(el).position === "fixed") continue;      // a popover is allowed to float
    const over = Math.max(s.left - r.left, r.right - s.right);
    if (over > 4) {
      out.push({
        cls: el.className?.toString?.().slice(0, 60) || el.tagName,
        inAnchor: !!el.closest(".planyr-anchor"),      // the box's own subtree, chrome and words alike
        over: Math.round(over),
      });
      if (out.length > 6) break;
    }
  }
  return out;
});

const press = async (page, key) => { await page.keyboard.press(key); await pacedWait(page, 220); };

/* ---- the fixture --------------------------------------------------------------------- */

/** A notebook with something of every kind in it, so a control has something to act ON. A sweep
 *  over an empty page proves that nothing crashes when there is nothing to break. */
async function seed(page) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [],
      pages: [
        { id: "p1", title: "Grand Port", createdAt: 1, updatedAt: 1, projectId: null,
          pages: [{ id: "p1a", title: "Entitlements", createdAt: 1, updatedAt: 1, pages: [] }] },
        { id: "p2", title: "Colorado", createdAt: 2, updatedAt: 2, projectId: null, pages: [] },
      ],
      trash: [{
        /* ⛔ THE FIELD IS `deletedAt`, NOT `at`. The first run seeded `at`, which `migrate` read as
         * zero — an entry binned in 1970, so the load-time expiry sweep purged it and the harness
         * reported an empty bin as a defect in the bin. The model was right; the fixture was not. */
        id: "t1", title: "A binned note", deletedAt: Date.now() - 86400000, projectId: null,
        pageIds: ["pgone"], node: { id: "pgone", title: "A binned note", pages: [] },
      }],
    }));
    const P = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [
        { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Coordination" }] },
        P("Civil is working to include the irrigation line."),
        { type: "bulletList", content: [
          { type: "listItem", content: [P("Sanitary line extension")] },
          { type: "listItem", content: [P("Water reservation")] },
        ] },
        { type: "noteAnchor", attrs: { x: 60, y: 240, w: 200 }, content: [P("a placed box")] },
        { type: "noteAnchor", attrs: { x: 340, y: 300, w: 180 }, content: [P("a second box")] },
        P("Trailing paragraph."),
      ],
    }));
    localStorage.setItem(prefix + "pgone", JSON.stringify({ type: "doc", content: [P("Words in the bin.")] }));
    localStorage.setItem(prefix + "p2", JSON.stringify({ type: "doc", content: [P("Weld County.")] }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 700);
}

/** Put the caret in the body's flow text — the state most controls are meant to act from. */
async function caretInText(page) {
  const box = await page.evaluate(() => {
    const p = [...document.querySelectorAll('[data-testid="note-body"] > p')]
      .find((el) => el.innerText.trim().length > 8);
    if (!p) return null;
    const r = p.getBoundingClientRect();
    return { x: Math.round(r.left + 20), y: Math.round(r.top + r.height / 2) };
  });
  if (!box) return false;
  await page.mouse.click(box.x, box.y);
  await pacedWait(page, 180);
  return true;
}

/* ======================================================================================= */
/* PHASE 1 — EVERY TOOLBAR CONTROL, ENUMERATED                                             */
/* ======================================================================================= */

async function sweepToolbar(page, label) {
  console.log(`\n[${label}] PHASE 1 — every toolbar control, enumerated from the DOM`);

  /* ⛔ THE ENUMERATION, AND THE "More" PANEL IS OPENED FIRST so the controls behind it are in
   * the DOM to be found. A sweep that only sees the row is a sweep that misses half the module. */
  await page.locator('[data-testid="nt-more"]').first().click().catch(() => {});
  await pacedWait(page, 250);

  const controls = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="nt-"]')]
    .map((el) => ({
      id: el.getAttribute("data-testid"),
      tag: el.tagName.toLowerCase(),
      title: el.getAttribute("title") || "",
      disabled: el.disabled === true,
      hidden: !el.getBoundingClientRect().width,
    }))
    .filter((c) => !/-popover$|-panel$|-grid$|-group$|-size$|^nt-table-cell-/.test(c.id)));

  note(`${controls.length} toolbar controls found`);
  await press(page, "Escape");

  for (const c of controls) {
    if (ONLY && !c.id.includes(ONLY)) continue;
    seenControls.add(c.id);

    if (c.id === "nt-image-input") { note(`${c.id} — a file input; covered by the picture path, not clickable here`); continue; }
    if (c.tag === "input") { note(`${c.id} — a text input, exercised in its own phase`); continue; }
    /* ⛔ A DISABLED CONTROL IS CORRECT BEHAVIOUR, NOT A DEFECT. Undo and Redo are disabled on a
     * freshly seeded page because there is nothing to undo — the first run reported six findings
     * that were the app being right. `disabled` was captured at enumeration and not used, which is
     * the instrument being wrong about the app rather than the other way round. */
    if (c.disabled) { note(`${c.id} — disabled in this context, which is correct here`); continue; }

    await seed(page);
    if (!(await caretInText(page))) { finding("toolbar", `could not put the caret in the body before ${c.id}`, "seed, click a paragraph"); continue; }

    const before = await storedDoc(page);
    const baseSpill = await overflowing(page);      // what already overflows before this control ran
    const errs = [];
    const onErr = (e) => errs.push(e.message);
    page.on("pageerror", onErr);

    try {
      /* Behind "More"? Open it first — every run re-seeds, so the panel is shut again. */
      const needsMore = await page.evaluate((id) => {
        const el = document.querySelector(`[data-testid="${id}"]`);
        return !el || !el.getBoundingClientRect().width;
      }, c.id);
      if (needsMore) {
        await page.locator('[data-testid="nt-more"]').first().click().catch(() => {});
        await pacedWait(page, 250);
      }

      const el = page.locator(`[data-testid="${c.id}"]`).first();
      if (!(await el.count())) { finding("toolbar", `${c.id} vanished between enumeration and use`, `open More, look for ${c.id}`); continue; }

      if (c.tag === "select") {
        const opts = await el.evaluate((n) => [...n.options].map((o) => o.value));
        const pick = opts.find((o) => o !== "" && o !== opts[0]) ?? opts[0];
        await el.selectOption(pick);
      } else {
        await el.click({ timeout: 4000 });
      }
      await pacedWait(page, 450);
    } catch (e) {
      finding("toolbar", `${c.id} could not be operated: ${String(e.message).split("\n")[0]}`, `seed, caret in text, click ${c.id}`);
      page.off("pageerror", onErr);
      continue;
    }

    if (errs.length) finding("toolbar", `${c.id} threw: ${errs[0]}`, `seed, caret in text, click ${c.id}`);
    else pass(`${c.id} did not throw`);

    /* ⛔ NOTHING MAY PAINT OUTSIDE THE SHEET — asked of every control, not just the reported one.
     * ⛔ AGAINST A BASELINE, which the first run did not have: the fixture's own anchored boxes sit
     * outside the sheet's box by construction (they are absolutely positioned against the editor,
     * which is wider), so an absolute reading reported the SAME 34 elements for every control and
     * said nothing about any of them. Only NEW overflow is a finding. */
    const spill = await overflowing(page);
    /* ⛔ AN ANCHORED BOX OVERHANGING A NARROWED SHEET IS A STATED TRADE-OFF, NOT A FINDING. A box
     * is positioned in DOCUMENT coordinates against the editor, and the left edge somebody chose
     * is never moved (B350000's acceptance test guards that in as many words) — so opening a side
     * panel narrows the sheet and a box placed toward the right will hang past it. The cost is
     * accepted and paid for by stacking, so the box and its controls stay reachable. Everything
     * else is still a finding, which is what caught the real History-panel defect: the header's
     * own status line painting 96px outside the page. */
    const fresh = spill
      .filter((x) => !x.inAnchor)
      .filter((x) => !baseSpill.some((b) => b.cls === x.cls && Math.abs(b.over - x.over) < 3));
    if (fresh.length) finding("layout", `${c.id} makes ${fresh.length} element(s) newly paint outside the sheet (worst ${fresh[0].over}px, ${fresh[0].cls})`, `seed, caret in text, click ${c.id}`);
    else pass(`${c.id} spills nothing new`);

    const after = await storedDoc(page);

    if (after === before) {
      /* Not a defect: a popover opener, or a control that legitimately declines here. Recorded so
       * the report can say what was and was not actually exercised. */
      note(`${c.id} — no document change (opens a panel, or declines in this context)`);
      await press(page, "Escape");
      continue;
    }

    /* ---- 2. UNDO PUTS IT BACK, EXACTLY ------------------------------------------------- */
    await press(page, "Control+z");
    await pacedWait(page, 400);
    const undone = await storedDoc(page);
    if (undone !== before) {
      finding("undo", `Ctrl+Z after ${c.id} does not restore the document`,
        `seed, caret in text, click ${c.id}, Ctrl+Z — stored document differs from before the click`);
    } else pass(`${c.id} undo restores`);

    /* ---- 3. REDO PUTS IT BACK AGAIN ---------------------------------------------------- */
    await press(page, "Control+Shift+z");
    await pacedWait(page, 400);
    const redone = await storedDoc(page);
    if (undone === before && redone !== after) {
      finding("redo", `Ctrl+Shift+Z after ${c.id} does not re-apply the change`,
        `seed, caret in text, click ${c.id}, Ctrl+Z, Ctrl+Shift+Z — stored document differs from after the click`);
    } else pass(`${c.id} redo re-applies`);

    page.off("pageerror", onErr);
  }
}

/* ======================================================================================= */
/* PHASE 2 — THE BOX LIFECYCLE, WITH A REAL MOUSE                                          */
/* ======================================================================================= */

async function sweepBoxes(page, label) {
  console.log(`\n[${label}] PHASE 2 — place · select · move · resize · delete, and undo after each`);
  await seed(page);

  const anchorRects = () => page.evaluate(() =>
    [...document.querySelectorAll('[data-testid="note-anchor"]')].map((el) => {
      const r = el.getBoundingClientRect();
      return { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), r: r.toJSON() };
    }));

  const start = await anchorRects();
  if (start.length < 2) { finding("boxes", "the fixture's two boxes did not render", "seed and count [data-testid=note-anchor]"); return; }
  pass("two boxes rendered");

  /* ---- place: a press in blank space, then words ------------------------------------- */
  /* ⛔ THE POINT MUST BE PROVEN BLANK BEFORE IT IS USED. A "free point" that already had something
   * in it has produced a false pass in this module twice; here it produced a false FAILURE, which
   * is the same instrument error wearing the other sign. The point is searched for and asserted. */
  const blank = await page.evaluate(() => {
    const body = document.querySelector('[data-testid="note-body"]');
    const r = body.getBoundingClientRect();
    for (let dy = 40; dy < r.height - 40; dy += 30) {
      for (let dx = r.width - 60; dx > r.width / 2; dx -= 40) {
        const x = Math.round(r.left + dx);
        const y = Math.round(r.top + dy);
        if (x > window.innerWidth - 8 || y > window.innerHeight - 8) continue;
        const el = document.elementFromPoint(x, y);
        if (el && (el === body || el.getAttribute?.("data-testid") === "note-body")) return { x, y };
      }
    }
    return null;
  });
  if (!blank) { finding("boxes", "no genuinely blank point could be found on the page to press", "seed, hunt for a point whose elementFromPoint is the note body itself"); return; }
  const beforePlace = await storedDoc(page);
  await page.mouse.click(blank.x, blank.y);
  await pacedWait(page, 300);
  await page.keyboard.type("swept", { delay: 20 });
  await pacedWait(page, 500);
  const placed = await anchorRects();
  if (placed.length !== start.length + 1) {
    finding("boxes", `a press in blank space then typing did not make a box (${start.length} → ${placed.length})`,
      `seed, click blank space near the right edge, type "swept"`);
  } else pass("a press in blank space places a box");

  /* ⛔ AND UNDO REMOVES IT AGAIN — a placement that cannot be undone is a trap, because the box
   * is the thing you make by accident. */
  await press(page, "Control+z");
  await press(page, "Control+z");
  await pacedWait(page, 500);
  const afterUndo = await anchorRects();
  if (afterUndo.length > start.length) {
    finding("undo", "undo does not remove a box that was just placed and typed into",
      `seed, click blank space, type "swept", Ctrl+Z twice — the box is still there`);
  } else pass("undo removes a placed box");

  /* ---- ⛔ EVERY CONTROL ON A BOX ANSWERS TO ITSELF -------------------------------------
   *
   * This is the generic form of the first defect the sweep found (B421488): the delete button was
   * VISIBLE, ENABLED, correctly labelled — and a press at its own centre landed on the box's
   * paragraph, because the content wrapper is positioned and appended last, so it painted on top.
   * Paint order is hit-test order. Nothing in this repo could have seen it: every existing check
   * located the button in the DOM and clicked it through the driver's element handle, which
   * bypasses hit-testing entirely, and so does a dispatched `click`.
   *
   * The question is therefore asked of the PIXEL, not of the element: at each control's own
   * centre, what does the document say is there? It is asked of every control on every box, so
   * the next one to be buried is caught by the same question rather than by another report. */
  await seed(page);
  await page.locator('[data-testid="note-anchor"]').first().hover();
  await pacedWait(page, 300);
  const buried = await page.evaluate(() => {
    const out = [];
    for (const el of document.querySelectorAll('[data-testid="note-anchor"]')) {
      for (const id of ["note-anchor-grip", "note-anchor-delete", "note-anchor-size"]) {
        const n = el.querySelector(`[data-testid="${id}"]`);
        if (!n) { out.push({ id, why: "missing" }); continue; }
        const r = n.getBoundingClientRect();
        if (!r.width || !r.height) { out.push({ id, why: "zero-sized" }); continue; }
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        /* ⛔ A POINT OUTSIDE THE VIEWPORT ANSWERS `null` TO EVERY QUESTION. In the short window the
         * lower box is below the fold, and the first run read that as three unreachable controls —
         * the instrument reporting its own blind spot as a defect in the app. Scrolled-away is not
         * buried; only a point that is actually on screen can be asked what is on top of it. */
        if (cx < 0 || cy < 0 || cx > window.innerWidth || cy > window.innerHeight) continue;
        const hit = document.elementFromPoint(cx, cy);
        if (!hit || !(hit === n || n.contains(hit))) {
          out.push({ id, why: `a press at its own centre reaches ${hit ? (hit.getAttribute("data-testid") || hit.className?.toString?.().slice(0, 30) || hit.tagName) : "nothing"}` });
        }
      }
    }
    return out;
  });
  for (const b of buried) {
    finding("chrome", `a box's ${b.id} cannot be pressed — ${b.why}`,
      "seed, hover a box, then ask document.elementFromPoint at that control's own centre — it must answer with the control");
  }
  if (!buried.length) pass("every control on every box answers to a press at its own centre");

  /* ---- delete via the box's own button ----------------------------------------------- */
  await seed(page);
  const beforeDel = await storedDoc(page);
  const first = page.locator('[data-testid="note-anchor"]').first();
  await first.hover();
  await pacedWait(page, 200);
  const delBtn = first.locator('[data-testid="note-anchor-delete"]');
  if (!(await delBtn.count())) finding("boxes", "the box has no delete control on hover", "seed, hover a box");
  else {
    /* ⛔ A REAL PRESS AT ITS COORDINATES, not `locator.click()` on the handle — the handle route
     * is what let the buried button above pass every previous check. A timeout here is a FINDING
     * rather than a crash: a sweep that dies on the first defect stops being a sweep. */
    let clicked = true;
    try {
      const c = await delBtn.evaluate((n) => { const r = n.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
      await page.mouse.click(c.x, c.y);
    } catch (e) { clicked = false; finding("boxes", `the delete button could not be pressed: ${String(e.message).split("\n")[0]}`, "seed, hover a box, press its × at its own centre"); }
    if (!clicked) return;
    await pacedWait(page, 600);
    const left = await anchorRects();
    if (left.length !== start.length - 1) finding("boxes", `deleting a box left ${left.length} of ${start.length}`, "seed, hover a box, click its ×");
    else pass("the delete button removes exactly one box");

    await press(page, "Control+z");
    await pacedWait(page, 600);
    const back = await storedDoc(page);
    const backCount = (await anchorRects()).length;
    /* ⛔ TWO ASSERTIONS, because they fail for different reasons. The COUNT catches the real
     * defect this found — the delete left focus on `<body>`, so Ctrl+Z reached nothing at all and
     * the box was gone for good. The BYTES catch a restore that brings the box back subtly
     * changed. A count alone would have passed a restore that moved it. */
    if (backCount !== start.length) {
      finding("undo", `Ctrl+Z after deleting a box does not bring it back (${backCount} of ${start.length})`,
        "seed, hover a box, press its × at its own centre, Ctrl+Z — count the boxes");
    } else pass("undo brings a deleted box back");
    if (back !== beforeDel) {
      finding("undo", "Ctrl+Z after deleting a box restores it CHANGED",
        "seed, hover a box, press its ×, Ctrl+Z — the normalised stored document differs from before");
    } else pass("undo restores a deleted box exactly");
  }
}

/* ======================================================================================= */
/* PHASE 3 — THE RAIL: pages, subpages, rename, delete, restore, the bin                   */
/* ======================================================================================= */

async function sweepRail(page, label) {
  console.log(`\n[${label}] PHASE 3 — the rail, its menus, and the bin`);
  await seed(page);

  const rows = () => page.evaluate(() => [...document.querySelectorAll('[data-testid^="notes-row-"]')]
    .map((el) => el.getAttribute("data-testid").replace("notes-row-", "")));

  const before = await rows();
  if (!before.includes("p1") || !before.includes("p2")) {
    finding("rail", `the fixture's pages are not both on the rail (${JSON.stringify(before)})`, "seed and read [data-testid^=notes-row-]");
    return;
  }
  pass("the rail lists the seeded pages");

  /* ---- the row menu, enumerated -------------------------------------------------------- */
  await page.locator('[data-testid="notes-row-p1"]').first().click({ button: "right" });
  await pacedWait(page, 350);
  const menu = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="notes-menu-"]')]
    .map((el) => ({ id: el.getAttribute("data-testid"), text: el.innerText.trim() })));
  if (!menu.length) finding("rail", "right-clicking a row opens no menu", "seed, right-click the Grand Port row");
  else note(`${menu.length} row-menu items: ${menu.map((m) => m.text).join(" · ")}`);
  menu.forEach((m) => seenControls.add(m.id));
  await press(page, "Escape");

  /* ---- new page, and it must be on disk at once (B400176 generalised) ------------------ */
  await page.locator('[data-testid="notes-new-page"]').first().click();
  await pacedWait(page, 400);
  const afterNew = await rows();
  const tree = await storedTree(page);
  const stored = (tree?.pages || []).length;
  if (afterNew.length !== before.length + 1) finding("rail", `＋ Page added ${afterNew.length - before.length} rows`, "seed, click ＋ Page");
  else pass("＋ Page adds one row");
  if (stored < 3) finding("sync", `a new page is on the rail but not in the stored tree (rail ${afterNew.length}, stored roots ${stored})`, "seed, click ＋ Page, read the stored tree without reloading");
  else pass("a new page reaches storage at once");

  /* ---- delete → bin → restore ---------------------------------------------------------- */
  await seed(page);
  await page.locator('[data-testid="notes-row-p2"]').first().click({ button: "right" });
  await pacedWait(page, 300);
  const del = page.locator('[data-testid^="notes-menu-"]').filter({ hasText: /delete/i }).first();
  if (!(await del.count())) finding("rail", "the row menu offers no Delete", "seed, right-click a row");
  else {
    await del.click();
    await pacedWait(page, 300);
    /* The confirm is `<testid>-yes`, not `<testid>` — the first run pressed a selector that does
     * not exist, never confirmed, and then reported the page as undeleted. */
    const yes = page.locator('[data-testid="notes-del-p2-yes"]').first();
    if (!(await yes.count())) finding("rail", "Delete did not offer an inline confirm", "seed, right-click Colorado, Delete");
    else { await yes.click(); await pacedWait(page, 600); }
    const left = await rows();
    if (left.includes("p2")) finding("rail", "a deleted page is still on the rail", "seed, right-click Colorado, Delete, confirm");
    else pass("delete removes the row");
  }

  /* ---- the bin: every row must be judgeable, and Read it must show the WORDS ----------- */
  /* Re-seed first: the bin is asked about the FIXTURE's binned entry, and the delete case above
   * has just changed the tree. A phase that lets one case's leftovers set up the next is how a
   * sweep reports a cascade of failures with one cause. */
  await seed(page);
  await press(page, "Escape");
  const binTab = page.locator('[data-testid="notes-view-bin"]').first();
  if (!(await binTab.count())) { finding("rail", "there is no Bin tab", "seed, look for notes-view-bin"); return; }
  await binTab.click();
  await pacedWait(page, 800);

  const bin = await page.evaluate(() => [...document.querySelectorAll('[data-testid^="notes-bin-"]')]
    .map((el) => el.getAttribute("data-testid")));
  if (!bin.length) finding("bin", "the Bin view lists nothing although the fixture seeds a binned note", "seed, open the Bin tab");
  else pass(`the bin lists ${bin.length} element(s)`);

  const peek = page.locator('[data-testid="notes-bin-peek-t1"]').first();
  if (!(await peek.count())) note("bin — no Read it control for the seeded entry (it may need a body row)");
  else {
    await peek.click();
    await pacedWait(page, 700);
    const shown = await page.evaluate(() => (document.querySelector('[data-testid="note-body"]')?.innerText || ""));
    if (!shown.includes("Words in the bin")) {
      finding("bin", "Read it does not show the binned note's words", `seed, open the Bin, click Read it on "A binned note" — expected "Words in the bin."`);
    } else pass("Read it shows the binned note's words");
  }
}

/* ======================================================================================= */
/* PHASE 4 — TITLE, PRINT, MARKDOWN, AND THE ZOOM/SIZE MATRIX                              */
/* ======================================================================================= */

async function sweepTitleAndExports(page, label) {
  console.log(`\n[${label}] PHASE 4 — the title, print and Markdown`);
  await seed(page);

  /* ---- the title, one character at a time ------------------------------------------- */
  const field = page.locator('[data-testid="note-title"]').first();
  await field.click();
  await page.keyboard.press("Control+a");
  for (let i = 0; i < 12; i += 1) {
    await page.keyboard.press("Backspace");
    const v = await field.inputValue();
    if (v.length && i === 0) { /* the first backspace clears a selection — expected */ }
  }
  const emptied = await field.inputValue();
  if (emptied !== "") finding("title", `the title will not delete to empty (stuck at "${emptied}")`, "seed, click the title, Ctrl+A, press Backspace twelve times");
  else pass("the title deletes to empty with no snap-back");

  await page.keyboard.type("SWEPT", { delay: 25 });
  await pacedWait(page, 400);
  const t = await storedTree(page);
  const stored = (t?.pages || []).find((p) => p.id === "p1")?.title;
  if (stored !== "SWEPT") finding("title", `retyping a title did not reach storage (stored "${stored}")`, 'seed, clear the title, type "SWEPT", read the stored tree');
  else pass("a retyped title reaches storage at once");

  const railText = await page.evaluate(() => document.querySelector('[data-testid="notes-row-p1"]')?.innerText?.trim());
  if (!String(railText).includes("SWEPT")) finding("title", `the rail still shows "${railText}" after a rename`, 'seed, rename the page to "SWEPT", read the rail row without reloading');
  else pass("the rail follows a rename with no reload");

  /* ---- Markdown export ---------------------------------------------------------------- */
  await seed(page);
  const errs = [];
  const onErr = (e) => errs.push(e.message);
  page.on("pageerror", onErr);
  const exp = page.locator('[data-testid="nt-export"]').first();
  if (!(await exp.count())) finding("export", "no Markdown control on the toolbar", "seed, look for nt-export");
  else {
    await exp.click().catch(() => {});
    await pacedWait(page, 900);
    if (errs.length) finding("export", `Markdown export threw: ${errs[0]}`, "seed, click Markdown");
    else pass("Markdown export does not throw");
  }

  /* ---- print: the serializer is a dynamic import and has crashed before ---------------- */
  errs.length = 0;
  await page.evaluate(() => { window.print = () => {}; });      // no printer dialog in a harness
  const pr = page.locator('[data-testid="nt-print"]').first();
  if (!(await pr.count())) finding("print", "no Print control on the toolbar", "seed, look for nt-print");
  else {
    await pr.click().catch(() => {});
    await pacedWait(page, 1500);
    if (errs.length) finding("print", `Print threw: ${errs[0]}`, "seed, click Print");
    else pass("Print does not throw");
  }
  page.off("pageerror", onErr);
}

/* ======================================================================================= */

async function run(label, { width, height, zoomSteps = 0, phases }) {
  console.log(`\n${"=".repeat(78)}\n${label}\n${"=".repeat(78)}`);
  const ctx = await browser.newContext({ viewport: { width, height }, ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  const fatal = [];
  page.on("pageerror", (e) => fatal.push(`${label}: ${e.message}`));
  await assertMeasurable(page, "sweep-notes");
  await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
  await seed(page);

  if (zoomSteps) {
    await page.keyboard.down("Control");
    for (let i = 0; i < zoomSteps; i += 1) await page.keyboard.press("Equal");
    await page.keyboard.up("Control");
    await pacedWait(page, 500);
    const z = await page.evaluate(() => document.querySelector('[data-testid="note-zoom-level"]')?.innerText?.trim());
    note(`zoom is ${z || "unreported"}`);
  }

  /* ⛔ A PHASE THAT THROWS IS A FINDING, NOT THE END OF THE RUN. The first version died on the
   * first defect it found and reported nothing about the other three phases — which is the
   * failure mode a sweep exists to avoid. */
  for (const ph of phases) {
    try { await ph(page, label); }
    catch (e) { finding("harness", `${ph.name} stopped early: ${String(e.message).split("\n")[0]}`, `run sweep-notes at ${label}`); }
  }
  await ctx.close();
}

const ALL = [sweepToolbar, sweepBoxes, sweepRail, sweepTitleAndExports];

await run("A · a full window, 100%", { width: 1500, height: 950, phases: ALL });
await run("B · a SHORT laptop window — HIS, about 500 tall", { width: 1280, height: 520, phases: ALL });
await run("C · zoomed in, full window", { width: 1500, height: 950, zoomSteps: 2, phases: [sweepBoxes, sweepRail, sweepTitleAndExports] });
await run("D · a NARROW window", { width: 900, height: 800, phases: [sweepToolbar, sweepBoxes] });

/* ======================================================================================= */
/* THE REPORT — including what was NOT covered, which is part of the result                */
/* ======================================================================================= */

console.log(`\n${"=".repeat(78)}\nSWEEP REPORT\n${"=".repeat(78)}`);
console.log(`${checks} generic checks passed across ${seenControls.size} distinct controls.`);

const NOT_COVERED = [
  "signed-in cloud sync — the proxy CORS-blocks Supabase auth here (every sync claim is against a fake server in test/)",
  "picture and file INTAKE from a real file picker — nt-image-input / nt-attach open an OS dialog",
  "the printed SHEET's appearance — the driver is exercised, the paper is not (PDF-PARITY lives in its own harness)",
  "drag-and-drop between rail rows — HTML5 dnd is not driveable by page.mouse",
  "the sketch canvas's own gestures — verify-notes-sketch owns those",
  "version history restore — its snapshots are IndexedDB and device-local",
];

if (!findings.length) {
  console.log("\n⛔ THE SWEEP FOUND NOTHING, AND THAT IS A RESULT TO DISTRUST, NOT TO CELEBRATE.");
  console.log("   Before reporting this as clean, check that the phases actually ran: the control");
  console.log("   count above should be in the dozens, and the per-phase lines should not be silent.");
} else {
  console.log(`\n⛔ ${findings.length} FINDING(S), each with a repro:\n`);
  const byArea = {};
  for (const f of findings) (byArea[f.area] ||= []).push(f);
  for (const [area, list] of Object.entries(byArea)) {
    console.log(`  ${area.toUpperCase()} (${list.length})`);
    for (const f of list) console.log(`    • ${f.what}\n        repro: ${f.repro}`);
  }
}

console.log("\nNOT COVERED BY THIS SWEEP — stated rather than left to be assumed:");
for (const n of NOT_COVERED) console.log(`  · ${n}`);

await browser.close();
process.exit(findings.length ? 1 : 0);
