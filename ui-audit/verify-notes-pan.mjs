/* verify-notes-pan — GRAB THE GREY AND MOVE IT LIKE A MAP, AND SHIFT-DRAG TO SELECT (NEW-1/NEW-2).
 *
 * ⛔ THE OWNER'S WORDS ARE THE SPEC: *"Click and drag should move like you're on a map"* and
 * *"shift click and drag should select multiple items."* One surface, one pointer, and now FOUR
 * meanings competing for the same press — place a note · pan the canvas · rubber-band a selection ·
 * resize the page by an edge grip. Every one of those is already shipped and tested except the pan,
 * so the risk here is not "does the pan work" but "what did the pan QUIETLY TAKE AWAY". That is what
 * this file measures.
 *
 * ⛔ IT IS RUN AT 1191×465 BECAUSE THAT IS HIS WINDOW. Measured here, and it is not incidental: at
 * that height the mat's own box runs to y=606 against a 465px window, so 141px of it is clipped
 * away and the sheet's BOTTOM edge grip sits entirely off-screen until the mat is scrolled. A
 * harness that computed a grip coordinate and clicked it without checking would be clicking
 * nothing at all, silently — `elementsFromPoint` returns an EMPTY ARRAY past the viewport rather
 * than erroring (NOTES-CARRY-FORWARD trap 18). So every gesture point in this file is hit-tested
 * before it is used, and a point that does not resolve to what it claims FAILS THE RUN.
 *
 * ⛔ THE KNOWN-GOOD ARM IS MANDATORY, NOT DECORATION (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6). Section 1
 * asserts a behaviour whose answer is known INDEPENDENTLY of anything this work touches — a press on
 * grey that does not travel still arms the placement caret, which is NEW-8's shipped, soak-tested
 * rule. If that arm goes red, the instrument is broken and every other number in the run is void.
 *
 * ⛔ AND THE VACUITY GUARD, because a pan is invisible on a surface that cannot scroll
 * (NOTES-CARRY-FORWARD trap 17 — two sections once stayed green on a build that moved the view
 * 362px, purely because their fixture fit). Section 0 refuses to report a score at all unless the
 * mat has real slack on BOTH axes.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

/* His window. Short on purpose — see the header. */
const VIEWPORT = { width: 1191, height: 465 };

const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

const checks = [];
const pageErrors = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});

/* ── the fixture ───────────────────────────────────────────────────────────────────────────────
 * Three boxes stacked where the short window can actually SEE them, one more far below the fold
 * as the control (a band that catches it has caught something it never touched), and one line of
 * flow text so the document is not degenerate. */
async function seed(page) {
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Grand Port", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    const P = (t) => ({ type: "paragraph", content: [{ type: "text", text: t }] });
    const box = (x, y, t) => ({ type: "noteAnchor", attrs: { x, y, w: 140 }, content: [P(t)] });
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc",
      content: [box(40, 0, "one"), box(40, 50, "two"), box(40, 100, "three"), box(40, 300, "far"), P("Flow.")],
    }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-anchor"]', { timeout: 20000 });
  await pacedWait(page, 900);
  await page.evaluate(() => { document.querySelector('[data-testid="note-mat"]').scrollTo(0, 0); });
  await pacedWait(page, 150);
}

/** The mat's own scroll offsets — the only place a pan can show up. */
const scrollNow = (page) => page.evaluate(() => {
  const m = document.querySelector('[data-testid="note-mat"]');
  return { sl: Math.round(m.scrollLeft), st: Math.round(m.scrollTop) };
});

/** What is actually painted at a client point, outermost-first. EMPTY means off-viewport. */
const hitAt = (page, x, y) => page.evaluate(([px, py]) => ({
  inViewport: px >= 0 && py >= 0 && px < innerWidth && py < innerHeight,
  stack: document.elementsFromPoint(px, py).slice(0, 4)
    .map((e) => e.getAttribute("data-testid") || (typeof e.className === "string" ? e.className.split(" ")[0] : "") || e.tagName),
}), [x, y]);

/** The STORED boxes. A box that looks moved and stored the old numbers is the bug. */
const stored = (page) => page.evaluate((k) => {
  const doc = JSON.parse(localStorage.getItem(k) || "null");
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "noteAnchor") {
      const t = [];
      const dig = (x) => { if (x?.type === "text") t.push(x.text); (x?.content || []).forEach(dig); };
      dig(n);
      out.push({ x: n.attrs.x, y: n.attrs.y, text: t.join("") });
    }
    (n.content || []).forEach(walk);
  };
  walk(doc);
  return out;
}, `${PAGE_PREFIX}p1`);

const selectedTexts = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-testid="note-anchor"][data-selected="1"]')]
    .map((el) => (el.querySelector(".planyr-anchor-content") || el).innerText.trim()));

const geometry = (page) => page.evaluate(() => {
  const r = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom), w: Math.round(b.width), h: Math.round(b.height) };
  };
  const m = document.querySelector('[data-testid="note-mat"]');
  return {
    mat: r('[data-testid="note-mat"]'),
    sheet: r('[data-testid="note-sheet"]'),
    body: r('[data-testid="note-body"]'),
    slackX: m.scrollWidth - m.clientWidth,
    slackY: m.scrollHeight - m.clientHeight,
    matCursor: getComputedStyle(m).cursor,
  };
});

/**
 * A REAL mouse gesture, with a reading taken at the halfway point.
 *
 * ⛔ THE MID-DRAG READING IS TAKEN ONLY WHEN ASKED FOR, and never between the two presses of a
 * pair — FOREGROUND-OR-VOID clause 6: a probe that observes the middle of a gesture has changed
 * the gesture. Here the gesture is a single continuous drag, so a read halfway through costs it
 * nothing; there is no press-to-press budget to blow.
 */
async function drag(page, from, delta, { shift = false, steps = 10, midRead = null } = {}) {
  await page.mouse.move(from.x, from.y);
  await pacedWait(page, 60);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.down();
  let mid = null;
  for (let i = 1; i <= steps; i += 1) {
    await page.mouse.move(Math.round(from.x + (delta.dx * i) / steps), Math.round(from.y + (delta.dy * i) / steps));
    await pacedWait(page, 20);
    if (midRead && i === Math.ceil(steps / 2)) mid = await midRead();
  }
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
  /* ⛔ LONGER THAN THE EDITOR'S 600ms SAVE DEBOUNCE, because half of this file judges by STORAGE.
   * A read that races the writer measures the harness, not the app. */
  await pacedWait(page, 1100);
  return mid;
}

const ctx = await browser.newContext({ viewport: VIEWPORT, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
page.on("pageerror", (e) => pageErrors.push(e.message));
await assertMeasurable(page, "verify-notes-pan");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });
await pacedWait(page, 1200);
await seed(page);

const g0 = await geometry(page);
console.log(`\nverify-notes-pan · ${VIEWPORT.width}×${VIEWPORT.height} · mat ${JSON.stringify(g0.mat)} sheet ${JSON.stringify(g0.sheet)}`);

/* ── 0 · VACUITY: a pan is unmeasurable on a surface with nowhere to go ───────────────────────── */
console.log("\n0 · the surface can actually move");
ok("the mat has real horizontal slack to pan into", g0.slackX >= 100, `${g0.slackX}px`);
ok("the mat has real vertical slack to pan into", g0.slackY >= 100, `${g0.slackY}px`);
const VACUOUS = g0.slackX < 100 || g0.slackY < 100;
if (VACUOUS) console.log("  ⛔ VACUOUS RUN — the pan assertions below would pass on a build that pans nothing.");

/* The grey point every pan gesture starts from, hit-tested rather than assumed. */
const GREY = { x: g0.mat.l + 142, y: 320 };
const greyHit = await hitAt(page, GREY.x, GREY.y);
ok("the chosen start point is inside the window AND resolves to bare grey mat",
  greyHit.inViewport && greyHit.stack[0] === "note-mat",
  `${GREY.x},${GREY.y} → ${JSON.stringify(greyHit.stack)}`);

/* ── 1 · KNOWN-GOOD ARM: the shipped behaviour this work must not have taken away ─────────────── */
console.log("\n1 · known-good arm — a press that does not travel still arms the placement caret");
await seed(page);
const beforePress = await stored(page);
const scrollBeforePress = await scrollNow(page);
await page.mouse.move(GREY.x, GREY.y);
await page.mouse.down();
await pacedWait(page, 120);
await page.mouse.up();
await pacedWait(page, 400);
const armed = await page.evaluate(() => ({
  pending: document.querySelector('[data-testid="note-body"]')?.getAttribute("data-pending-place") || null,
  caret: !!document.querySelector('[data-testid="note-pending-caret"]'),
}));
const scrollAfterPress = await scrollNow(page);
ok("⛔ KNOWN-GOOD · a click on grey still arms placement (data-pendingPlace + the caret)",
  armed.pending === "1" && armed.caret, JSON.stringify(armed));
ok("…and that click panned NOTHING", scrollAfterPress.sl === scrollBeforePress.sl && scrollAfterPress.st === scrollBeforePress.st,
  `${JSON.stringify(scrollBeforePress)} → ${JSON.stringify(scrollAfterPress)}`);
await page.keyboard.press("Escape");
await pacedWait(page, 500);
ok("…and it created no box, so a click is still free", (await stored(page)).length === beforePress.length,
  `${beforePress.length} → ${(await stored(page)).length}`);

/* ── 2 · THE PAN ITSELF ───────────────────────────────────────────────────────────────────────── */
console.log("\n2 · press and drag the grey — it moves like a map");
await seed(page);
const beforePan = await stored(page);
const s0 = await scrollNow(page);
const PAN = { dx: -130, dy: -100 };
const endHit = await hitAt(page, GREY.x + PAN.dx, GREY.y + PAN.dy);
ok("the pan gesture stays on grey for its whole travel", endHit.inViewport && endHit.stack[0] === "note-mat",
  `end ${GREY.x + PAN.dx},${GREY.y + PAN.dy} → ${JSON.stringify(endHit.stack)}`);
const midCursor = await drag(page, GREY, PAN, {
  midRead: () => page.evaluate(() => {
    const m = document.querySelector('[data-testid="note-mat"]');
    return { attr: m.getAttribute("data-panning"), cursor: getComputedStyle(m).cursor };
  }),
});
const s1 = await scrollNow(page);
ok("dragging LEFT moves the canvas left — one-to-one with the pointer",
  Math.abs((s1.sl - s0.sl) - Math.abs(PAN.dx)) <= 6, `scrollLeft ${s0.sl} → ${s1.sl} (asked ${Math.abs(PAN.dx)})`);
ok("dragging UP moves the canvas up — one-to-one with the pointer",
  Math.abs((s1.st - s0.st) - Math.abs(PAN.dy)) <= 6, `scrollTop ${s0.st} → ${s1.st} (asked ${Math.abs(PAN.dy)})`);
ok("⛔ A PAN PLACES NOTHING — the document is untouched",
  JSON.stringify(await stored(page)) === JSON.stringify(beforePan), `${beforePan.length} boxes before`);
ok("…and it selected nothing either", (await selectedTexts(page)).length === 0);
ok("the cursor reads GRABBING while the pan is in flight",
  midCursor && midCursor.attr === "1" && midCursor.cursor === "grabbing", JSON.stringify(midCursor));
ok("…and back to GRAB once the pointer is released", (await geometry(page)).matCursor === "grab",
  (await geometry(page)).matCursor);

/* The other direction, from the scrolled position — a pan that only ever goes one way is half a
 * feature, and scroll offsets clamp at zero so this is where a sign error shows up. */
const s2before = await scrollNow(page);
await drag(page, { x: GREY.x + PAN.dx, y: GREY.y + PAN.dy }, { dx: -PAN.dx, dy: -PAN.dy });
const s2 = await scrollNow(page);
ok("dragging back RIGHT and DOWN returns the canvas where it came from",
  Math.abs(s2.sl - s0.sl) <= 6 && Math.abs(s2.st - s0.st) <= 6,
  `${JSON.stringify(s2before)} → ${JSON.stringify(s2)} (origin ${JSON.stringify(s0)})`);

/* ⛔ THE EXTENTS. A pan must not invent room the scroller does not have. */
await drag(page, GREY, { dx: 600, dy: 600 }, { steps: 12 });
const sClamped = await scrollNow(page);
ok("⛔ A PAN PAST THE EDGE STOPS AT THE EDGE, it does not run away",
  sClamped.sl === 0 && sClamped.st === 0, JSON.stringify(sClamped));

/* ── 3 · SHIFT-DRAG IS THE MARQUEE ────────────────────────────────────────────────────────────── */
console.log("\n3 · shift and drag — the rubber band, and everything it touches");
await seed(page);
const g3 = await geometry(page);
const BAND_FROM = { x: g3.mat.l + 142, y: g3.body.t - 18 };
const BAND_TO = { x: 700, y: 400 };
const bandStartHit = await hitAt(page, BAND_FROM.x, BAND_FROM.y);
ok("the band starts on bare grey", bandStartHit.inViewport && bandStartHit.stack[0] === "note-mat",
  `${BAND_FROM.x},${BAND_FROM.y} → ${JSON.stringify(bandStartHit.stack)}`);
const beforeBand = await stored(page);
const sBand0 = await scrollNow(page);
const midBand = await drag(page, BAND_FROM, { dx: BAND_TO.x - BAND_FROM.x, dy: BAND_TO.y - BAND_FROM.y }, {
  shift: true,
  midRead: () => page.evaluate(() => {
    const el = document.querySelector('[data-testid="note-marquee"]');
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { w: Math.round(b.width), h: Math.round(b.height) };
  }),
});
const caught = await selectedTexts(page);
const sBand1 = await scrollNow(page);
ok("⛔ THE BAND IS VISIBLE WHILE IT IS BEING DRAWN", midBand && midBand.w > 10 && midBand.h > 10, JSON.stringify(midBand));
ok("every box the band touched is selected when the drag ends",
  caught.length === 3 && ["one", "two", "three"].every((t) => caught.includes(t)), JSON.stringify(caught));
ok("⛔ …and the box it never reached is NOT selected", !caught.includes("far"), JSON.stringify(caught));
ok("⛔ A SHIFT-DRAG DOES NOT PAN — the two gestures do not fight",
  sBand1.sl === sBand0.sl && sBand1.st === sBand0.st, `${JSON.stringify(sBand0)} → ${JSON.stringify(sBand1)}`);
ok("…and it placed nothing", JSON.stringify(await stored(page)) === JSON.stringify(beforeBand));

/* ── 4 · A MULTI-SELECTION IS THE SAME SELECTION, WITH MORE MEMBERS ───────────────────────────── */
console.log("\n4 · selected together, moved together, deleted together");
const baseMove = await stored(page);
const boxTwo = await page.evaluate(() => {
  const el = [...document.querySelectorAll('[data-testid="note-anchor"]')]
    .find((n) => n.innerText.trim().startsWith("two"));
  const b = el.getBoundingClientRect();
  return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
});
const twoHit = await hitAt(page, boxTwo.x, boxTwo.y);
ok("the group-drag starts on a box that is really there", twoHit.inViewport && JSON.stringify(twoHit.stack).includes("planyr-anchor"), JSON.stringify(twoHit.stack));
await drag(page, boxTwo, { dx: 70, dy: 40 });
const afterMove = await stored(page);
const deltas = afterMove.map((b, i) => ({ t: b.text, dx: b.x - baseMove[i].x, dy: b.y - baseMove[i].y }));
const inSet = deltas.filter((d) => ["one", "two", "three"].includes(d.t));
const outSet = deltas.find((d) => d.t === "far");
ok("⛔ ALL THREE SELECTED BOXES MOVED BY THE SAME DELTA",
  inSet.length === 3 && inSet.every((d) => d.dx === inSet[0].dx && d.dy === inSet[0].dy) && (inSet[0].dx || inSet[0].dy),
  JSON.stringify(inSet));
ok("⛔ …AND THE UNSELECTED BOX DID NOT MOVE", outSet && !outSet.dx && !outSet.dy, JSON.stringify(outSet));

await page.keyboard.press("Delete");
await pacedWait(page, 1200);
const afterDelete = await stored(page);
ok("⛔ ONE Delete REMOVES THE WHOLE SELECTION",
  afterDelete.length === 1 && afterDelete[0].text === "far",
  JSON.stringify(afterDelete.map((b) => b.text)));

/* Escape, and a click on empty grey, both release the whole set. */
await seed(page);
await drag(page, BAND_FROM, { dx: BAND_TO.x - BAND_FROM.x, dy: BAND_TO.y - BAND_FROM.y }, { shift: true });
ok("three are selected again", (await selectedTexts(page)).length === 3);
await page.keyboard.press("Escape");
await pacedWait(page, 300);
ok("Escape releases the whole selection", (await selectedTexts(page)).length === 0);
await drag(page, BAND_FROM, { dx: BAND_TO.x - BAND_FROM.x, dy: BAND_TO.y - BAND_FROM.y }, { shift: true });
ok("three are selected again (second time)", (await selectedTexts(page)).length === 3);
await page.mouse.move(GREY.x, GREY.y);
await page.mouse.down();
await pacedWait(page, 100);
await page.mouse.up();
await pacedWait(page, 400);
ok("a click on empty grey releases the whole selection", (await selectedTexts(page)).length === 0);
await page.keyboard.press("Escape");
await pacedWait(page, 400);

/* ── 5 · THE FOUR EDGE GRIPS STILL RESIZE THE PAGE, THEY DO NOT PAN IT ────────────────────────── */
console.log("\n5 · a drag that starts on a page edge grip resizes — it never pans");
/* ⛔ THE PROBE SECTION 5 RELIES ON, POINTED AT A CASE WHOSE ANSWER IS ALREADY KNOWN
 * (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6). Every grip check below passes by reading `data-panning` as
 * NULL mid-drag — which is exactly what a probe that can never see the attribute at all would also
 * report, for every grip, forever. So the identical read is first aimed at a gesture that MUST arm
 * it. If this one comes back null the section is measuring nothing and says so. */
await seed(page);
const probeSeesAPan = await drag(page, GREY, { dx: -120, dy: -90 }, {
  midRead: () => page.evaluate(() => document.querySelector('[data-testid="note-mat"]').getAttribute("data-panning")),
});
ok("⛔ KNOWN-GOOD · the same mid-drag probe DOES report an armed pan when there is one",
  probeSeesAPan === "1", `data-panning=${JSON.stringify(probeSeesAPan)}`);
const GRIPS = [
  { id: "note-page-width-grip-left", axis: "w", delta: { dx: -70, dy: 0 }, scroll: 0 },
  { id: "note-page-width-grip-right", axis: "w", delta: { dx: 70, dy: 0 }, scroll: 0 },
  { id: "note-page-height-grip-top", axis: "h", delta: { dx: 0, dy: -60 }, scroll: 0 },
  /* ⛔ THE BOTTOM GRIP IS OFF-SCREEN AT THIS WINDOW SIZE and has to be scrolled to before it can
   * be pressed at all — see the header. Scrolled deliberately, BEFORE the gesture, then
   * re-measured; a rect computed before a scroll that was supposed to happen is worth nothing. */
  { id: "note-page-height-grip-bottom", axis: "h", delta: { dx: 0, dy: 60 }, scroll: 430 },
];
for (const grip of GRIPS) {
  await seed(page);
  if (grip.scroll) {
    await page.evaluate((s) => { document.querySelector('[data-testid="note-mat"]').scrollTop = s; }, grip.scroll);
    await pacedWait(page, 250);
  }
  const spot = await page.evaluate((id) => {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) return null;
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) };
  }, grip.id);
  if (!spot) { ok(`${grip.id} exists`, false, "not rendered"); continue; }
  const gripHit = await hitAt(page, spot.x, spot.y);
  ok(`${grip.id} · the press really lands on the grip`,
    gripHit.inViewport && gripHit.stack[0] === grip.id,
    `${spot.x},${spot.y} → ${JSON.stringify(gripHit.stack)}`);
  if (!gripHit.inViewport || gripHit.stack[0] !== grip.id) continue;
  const sizeBefore = await geometry(page);
  const scrollBefore = await scrollNow(page);
  const panArmed = await drag(page, spot, grip.delta, {
    steps: 8,
    midRead: () => page.evaluate(() => document.querySelector('[data-testid="note-mat"]').getAttribute("data-panning")),
  });
  const sizeAfter = await geometry(page);
  const scrollAfter = await scrollNow(page);
  const changed = grip.axis === "w"
    ? Math.abs(sizeAfter.sheet.w - sizeBefore.sheet.w)
    : Math.abs(sizeAfter.sheet.h - sizeBefore.sheet.h);
  ok(`${grip.id} · RESIZES the page`, changed >= 30,
    `${grip.axis} ${grip.axis === "w" ? sizeBefore.sheet.w : sizeBefore.sheet.h} → ${grip.axis === "w" ? sizeAfter.sheet.w : sizeAfter.sheet.h}`);
  /* ⛔ THE SCROLL DELTA CANNOT ANSWER THIS, AND THE FIRST VERSION OF THIS CHECK THOUGHT IT COULD —
   * a false failure on two of the four grips, on a build where nothing was wrong. `beginWidthDrag`
   * and `beginHeightDrag` MOVE THE SCROLLER ON PURPOSE for the LEFT and TOP edges, so the page's
   * edge stays under the pointer while it grows (VIEWPORT-STABLE). Measured: a 70px leftward drag
   * on the left grip widens the sheet 579→649 and sets scrollLeft to exactly 70 — which is, to the
   * pixel, what a pan of the same gesture would also have produced. The two are indistinguishable
   * by their arithmetic and always will be.
   *
   * So ask the gesture itself instead of its footprint: `data-panning` is written by the pan and by
   * nothing else, and it is read MID-DRAG, while the pan would still be holding it. A grip press
   * that never arms the pan cannot have panned, whatever the scroller did afterwards. */
  ok(`${grip.id} · ⛔ …AND THE PAN NEVER ARMED (read mid-drag, not inferred from the scroller)`,
    panArmed === null,
    `data-panning=${JSON.stringify(panArmed)} · scroll ${JSON.stringify(scrollBefore)} → ${JSON.stringify(scrollAfter)}`);
  /* For the two edges that do NOT compensate, the footprint is unambiguous and is worth asserting
   * as a second, independent witness that agrees with the one above. */
  if (grip.id.endsWith("-right") || grip.id.endsWith("-bottom")) {
    ok(`${grip.id} · …and the canvas did not move at all`,
      scrollAfter.sl === scrollBefore.sl && scrollAfter.st === scrollBefore.st,
      `${JSON.stringify(scrollBefore)} → ${JSON.stringify(scrollAfter)}`);
  }
}

/* ── the verdict ──────────────────────────────────────────────────────────────────────────────── */
await browser.close();
const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (pageErrors.length) console.log(`⛔ ${pageErrors.length} page error(s): ${pageErrors.slice(0, 4).join(" · ")}`);
if (failed.length) console.log(`⛔ FAILED:\n${failed.map((c) => `  · ${c.name}`).join("\n")}`);
if (VACUOUS) console.log("⛔ THE RUN IS VACUOUS — it proves nothing about panning.");
process.exit(failed.length || pageErrors.length || VACUOUS ? 1 : 0);
