/* NEW-1 — DOES CTRL+Z BRING THE BUILDING BACK *WHOLE*? The critical question behind the report.
 *
 * A stray Backspace deleted the owner's Building 1 and took the eight elements bonded to it with
 * it — 18 elements to 9 on his real FM 359 / "Concept A" plan. Whether that is an annoyance or
 * PERMANENT DATA LOSS turns entirely on one thing: whether undo restores the SAME object, not
 * merely an object. Dock configuration, dock axis and side, both 55×60 bump-outs with their
 * `dogEar` sides, both 135 ft truck courts, both sidewalks, both side-parking rows, the rotation,
 * the layer (`z`) assignment and every bond.
 *
 * ⛔ "18 ELEMENTS CAME BACK" IS NOT AN ANSWER, and accepting it would be exactly the mistake this
 * repo keeps writing rules about. This compares every element's every property, by id, before and
 * after — a DEEP diff, not a count — and it does it on his real rows rather than on a tidy
 * synthetic building, because a bonded assembly is where a restore can plausibly come back subtly
 * wrong (B1340's whole family is about assemblies reassembling incorrectly and reading fine).
 *
 * It asserts the two things separately, because they can disagree:
 *   COMMITTED — what the saved plan holds, read out of localStorage
 *   ON SCREEN — what the canvas actually paints, counted by FEATURE (COUNT-EVERY-KIND) so a
 *               restore that puts rows in the model but nothing on the drawing cannot pass
 *
 * Both delete routes are driven, because they take different code paths: the keyboard Delete and
 * the Properties panel's "Delete element" button.
 *
 * Run:  npm run build && npx vite preview --port 4184   (separate shell)
 *       BASE_URL=http://localhost:4184/ node ui-audit/verify-delete-undo-restores.mjs
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4184/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SITE = "fm359";
const B1 = "e1454615maruai";
const fixture = JSON.parse(readFileSync(new URL("./fixtures/fm359-concept-a.json", import.meta.url), "utf8"));

/* ⛔ THE SELF-TEST, and it is not optional. A harness that has never been seen to fail is a
 * harness that will report green when the thing it guards is gone (VIEW-INDEPENDENT-ONCE §6 names
 * this failure mode; DANGEROUS-MEANS-UNOBSERVABLE says build the instrument and prove it red).
 * `--no-undo` skips the Ctrl+Z and nothing else, which is exactly the world where the reported
 * deletion IS permanent data loss — every restoration check must go red.
 *   PROVEN, run 2026-08-13:  --no-undo  →  26 of 32 checks went red across both routes. */
const NO_UNDO = process.argv.includes("--no-undo");

const results = [];
const ok = (n, pass, d = "") => { results.push({ n, pass }); console.log(`  ${pass ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); };

/** COMMITTED: every element the saved plan holds, keyed by id, with every property. */
const committed = (page) => page.evaluate(() => {
  const map = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const site = map[Object.keys(map)[0]] || {};
  return Object.fromEntries((site.els || []).map((e) => [e.id, e]));
});

/** ON SCREEN: distinct feature keys the canvas paints, by kind (COUNT-EVERY-KIND). */
const onScreen = (page) => page.evaluate(() => {
  const keys = new Set();
  for (const n of document.querySelectorAll("[data-feature]")) keys.add(n.getAttribute("data-feature"));
  const by = {};
  for (const k of keys) { const kind = k.split(":")[0]; by[kind] = (by[kind] || 0) + 1; }
  return { total: keys.size, by, keys: [...keys].sort() };
});

/** How many elements share a `z` with an earlier one — the legacy-migration signal. */
const dupZ = (page) => page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const s = m[Object.keys(m)[0]] || {};
  const seen = new Set(); let d = 0;
  for (const e of s.els || []) { if (seen.has(e.z)) d++; seen.add(e.z); }
  return d;
});

/* ON SCREEN, GEOMETRICALLY: every painted feature's box relative to the canvas origin. Canvas-
 * relative on purpose — chrome around the drawing can move by a pixel between two readings, and
 * that must not read as "the plan changed". */
const paintedGeometry = (page) => page.evaluate(() => {
  const canvas = document.querySelector('[data-testid="planner-canvas"]');
  const c = canvas.getBoundingClientRect();
  const r1 = (v) => Math.round(v * 10) / 10;
  const boxes = {};
  for (const n of document.querySelectorAll("[data-feature]")) {
    const key = n.getAttribute("data-feature");
    if (boxes[key]) continue;                       // chrome carries its owner's key too
    const b = n.getBoundingClientRect();
    boxes[key] = [r1(b.x - c.x), r1(b.y - c.y), r1(b.width), r1(b.height)];
  }
  return { canvas: { w: r1(c.width), h: r1(c.height) }, boxes };
});

/* A property-by-property diff. Returns the human-readable differences, or [] for "the same
 * object". Key order and float dust are ignored; nothing else is.
 *
 * ⛔ `z` IS REPORTED SEPARATELY, AND THAT SPLIT IS A FINDING RATHER THAN A CONVENIENCE. The first
 * run of this harness failed on 17 `z` differences and NOTHING else, on both delete routes — every
 * geometric and configuration property came back byte-identical while the stacking keys were
 * re-spaced (`1024 → 2048`, `2048 → 4096`, …). Folding that into one pass/fail would have said
 * "undo does not restore the building", which is false and would have sent the next session
 * hunting a data-loss bug that is not there. Reported apart, it is what it actually is: the
 * B671 `normalizeZ` re-numbering, which must preserve ORDER — and order is what is asserted. */
const Z = "z";
function deepDiff(before, after, { ignore = [] } = {}) {
  const out = [];
  const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const id of [...ids].sort()) {
    const a = before[id], b = after[id];
    if (!a) { out.push(`${id}: appeared out of nowhere`); continue; }
    if (!b) { out.push(`${id} (${a.type}): NOT RESTORED`); continue; }
    const fields = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const f of [...fields].sort()) {
      if (ignore.includes(f)) continue;
      const av = a[f], bv = b[f];
      if (typeof av === "number" && typeof bv === "number") { if (Math.abs(av - bv) > 1e-6) out.push(`${id}.${f}: ${av} → ${bv}`); continue; }
      if (JSON.stringify(av) !== JSON.stringify(bv)) out.push(`${id}.${f}: ${JSON.stringify(av)} → ${JSON.stringify(bv)}`);
    }
  }
  return out;
}

/* The stacking ORDER, which is the thing `z` exists to express. Ties are broken the way the
 * renderer breaks them (B671 `byZAsc`: z, then id), so two plans with different z NUMBERS but the
 * same ORDER draw the same picture. */
const zOrder = (els) => Object.values(els)
  .slice()
  .sort((a, b) => (a[Z] || 0) - (b[Z] || 0) || String(a.id).localeCompare(String(b.id)))
  .map((e) => e.id);

const zDiff = (before, after) => Object.keys(before)
  .filter((id) => after[id] && (before[id][Z] || 0) !== (after[id][Z] || 0))
  .map((id) => `${id}: ${before[id][Z]} → ${after[id][Z]}`);

async function open(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 950 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(fixtureSeed(fixture, { id: SITE, name: "Concept A", site: "FM 359 RD, Fulshear, TX 77441" }));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log(`  ⚠ page error: ${e}`));
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30_000 });
  await page.waitForTimeout(1300);
  await assertMeasurable(page, "verify-delete-undo-restores");
  return { ctx, page };
}

async function selectBuilding1(page, { soft = false } = {}) {
  const at = await page.evaluate((id) => {
    const n = document.querySelector(`[data-el-id="${id}"]`);
    if (!n) return null;
    const b = n.getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, B1);
  // `soft` is for the RE-selects after a reading: under --no-undo the building is legitimately
  // gone, and the self-test must reach its assertions rather than dying on the way to them.
  if (!at) { if (soft) return; throw new Error("Building 1 is not painted — the fixture did not open"); }
  await page.mouse.click(at.x, at.y);
  await page.waitForTimeout(300);
}

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

for (const route of ["keyboard Delete", "Properties → Delete element"]) {
  console.log(`\n=== undo after ${route} — on the owner's real FM 359 "Concept A" ===`);
  const { ctx, page } = await open(browser);
  await selectBuilding1(page);

  /* ⛔ B464050's CORRECTION, measured here so it cannot drift back into folklore. The item was filed
   * as "undo re-spaces every element's layer key", off a real 17-element diff after Ctrl+Z. Undo is
   * NOT what does it: this plan carries 9 DUPLICATE `z` values (both buildings are z:0, each
   * assembly numbered from 0 — legacy rows from before B671 gave elements an explicit z), and
   * `createSiteModel` repairs them with `ensureZ` on LOAD. The next SAVE of any kind persists the
   * repair; undo was merely the first save. One arrow nudge proves it. */
  if (route === "keyboard Delete") {
    const dupBefore = await dupZ(page);
    await page.keyboard.press("ArrowRight");   // a mutation that is NOT a delete and NOT an undo
    await page.waitForTimeout(900);
    const dupAfter = await dupZ(page);
    await page.keyboard.press("Control+z");    // put it back before the real measurement starts
    await page.waitForTimeout(700);
    ok("B464050 — the z re-spacing is the LOAD-TIME migration, not undo (one nudge does it too)",
      dupBefore > 0 && dupAfter === 0,
      `${dupBefore} duplicate z values in the saved plan → ${dupAfter} after a single arrow nudge`);
    await selectBuilding1(page, { soft: true });
  }

  const before = await committed(page);
  const screenBefore = await onScreen(page);
  console.log(`  plan holds ${Object.keys(before).length} elements · canvas paints ${screenBefore.total} features (${JSON.stringify(screenBefore.by)})`);
  /* Deselect before the reference reading so selection chrome is not in it — what is under test
   * is the DRAWING, not the handles. */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const geomBefore = await paintedGeometry(page);
  await selectBuilding1(page, { soft: true });

  if (route === "keyboard Delete") {
    await page.keyboard.press("Delete");
  } else {
    const props = page.locator('button[title="Properties"]');
    if (await props.count()) await props.first().click();
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /Delete element/i }).first().click();
  }
  await page.waitForTimeout(700);

  const gone = await committed(page);
  const goneScreen = await onScreen(page);
  ok(`${route} removed the building AND its bonded assembly`,
    !gone[B1] && Object.keys(gone).length < Object.keys(before).length,
    `${Object.keys(before).length} → ${Object.keys(gone).length} elements, canvas ${screenBefore.total} → ${goneScreen.total} features`);

  /* ⛔ THE UNDO MUST BE DRIVEN FROM THE DRAWING. After the panel-button route the keyboard is
   * legitimately on the panel, and a real user presses Ctrl+Z from wherever they are — Ctrl+Z is
   * app-scope precisely so it always works. Driven with a real key event, never a synthetic one
   * (SYNTHETIC-KEYS-DONT-EDIT). */
  if (!NO_UNDO) await page.keyboard.press("Control+z");
  await page.waitForTimeout(900);

  const after = await committed(page);
  const screenAfter = await onScreen(page);

  ok("COMMITTED — every element is back", Object.keys(after).length === Object.keys(before).length,
    `${Object.keys(before).length} before, ${Object.keys(after).length} after`);

  const diff = deepDiff(before, after, { ignore: [Z] });
  ok("COMMITTED — the SAME object, property for property (not merely 18 objects)",
    diff.length === 0,
    diff.length ? `${diff.length} difference(s):\n       ${diff.slice(0, 25).join("\n       ")}` : "identical across all elements (every property but z; see below)");

  /* The z re-numbering, reported as its own fact. What must hold is the ORDER — the numbers are
   * B671's re-spaced keys and are not user data. */
  const zs = zDiff(before, after);
  ok("COMMITTED — the stacking ORDER is unchanged (z keys may be re-spaced, order may not move)",
    JSON.stringify(zOrder(before)) === JSON.stringify(zOrder(after)),
    zs.length ? `${zs.length} z key(s) re-spaced by normalizeZ, order preserved — e.g. ${zs.slice(0, 3).join(" · ")}` : "z keys identical too");

  /* Named spot checks, so a failure reads as a fact about the building rather than as a diff. */
  const b1 = after[B1] || {};
  ok("Building 1 — dock configuration intact", b1.dock === "cross" && b1.dockAxis === "x" && b1.dockSide === "bottom",
    `dock=${b1.dock} axis=${b1.dockAxis} side=${b1.dockSide}`);
  ok("Building 1 — size and rotation intact", b1.w === 1675 && b1.h === 613 && Math.abs((b1.rot || 0) - 336.2132030868854) < 1e-9,
    `${b1.w} × ${b1.h}, rot ${b1.rot}`);
  ok("Building 1 — layer (z) assignment intact", b1.z === 0, `z=${b1.z}`);

  const kids = Object.values(after).filter((e) => e.attachedTo === B1);
  const kind = (f) => kids.filter(f).length;
  ok("both bump-outs restored, with their dogEar sides",
    kind((e) => e.type === "building" && e.dogEar) === 2
      && new Set(kids.filter((e) => e.dogEar).map((e) => e.dogEar.side)).size === 2,
    `${kind((e) => e.dogEar)} bump-outs: ${kids.filter((e) => e.dogEar).map((e) => `${e.w}×${e.h} ${e.dogEar.side}`).join(", ")}`);
  ok("both truck courts restored, with their sides and depth",
    kind((e) => e.truckCourt) === 2 && kids.filter((e) => e.truckCourt).every((e) => e.zd === 135),
    kids.filter((e) => e.truckCourt).map((e) => `${e.truckCourt.side} ${e.zd}ft`).join(", "));
  ok("both car-parking rows restored", kind((e) => e.type === "parking") === 2,
    kids.filter((e) => e.type === "parking").map((e) => `${e.sideParkSide} ${e.w}×${e.h}`).join(", "));
  ok("both sidewalks restored", kind((e) => e.type === "sidewalk") === 2,
    kids.filter((e) => e.type === "sidewalk").map((e) => e.sidewalkSide).join(", "));
  ok("every bond points back at Building 1", kids.length === 8, `${kids.length} bonded children`);

  /* ON SCREEN, asserted apart from the model — a restore that lands rows nobody can see is not a
   * restore, and the two really can disagree (a stale render, a culled layer, a failed heal). */
  ok("ON SCREEN — the canvas paints the same features again",
    screenAfter.total === screenBefore.total,
    `${screenBefore.total} → ${screenAfter.total} features ${JSON.stringify(screenAfter.by)}`);
  const lostOnScreen = screenBefore.keys.filter((k) => !screenAfter.keys.includes(k));
  ok("ON SCREEN — no feature is missing by name", lostOnScreen.length === 0,
    lostOnScreen.length ? lostOnScreen.join(", ") : "every feature key is back");

  /* ⛔ AND THE ONLY QUESTION THAT SETTLES THE z RE-NUMBERING: DOES THE DRAWING CHANGE? A stacking
   * key is not user data — the picture is.
   *
   * ⚠ THIS IS DELIBERATELY NOT A PIXEL DIFF, and the reason is a measurement. A screenshot pair was
   * tried first and failed at detail ΔE00 80.8 / perceived 50.0 — while the two images, put side by
   * side, are the same drawing. The whole FRAME is offset by one pixel (the canvas box moves
   * 1379.0 → 1378.0 wide between the two readings, a chrome-layout artifact of the panel state, not
   * of the plan), and a one-pixel shift detonates a perceptual diff at every edge in the picture.
   * PERCEPTUAL-PARITY's bar is the right bar for a change to how something is DRAWN; it cannot
   * answer "did this object move" across a frame that itself moved.
   *
   * So the drawing is compared by its own GEOMETRY: every painted feature's box, expressed
   * RELATIVE TO THE CANVAS ORIGIN, so a chrome shift cancels out and a feature that actually moved
   * cannot. This is a stricter claim than a pixel diff, not a weaker one — it is per feature, by
   * name, to a tenth of a pixel. */
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);
  const geomAfter = await paintedGeometry(page);
  const moved = Object.keys(geomBefore.boxes)
    .filter((k) => geomAfter.boxes[k] && JSON.stringify(geomBefore.boxes[k]) !== JSON.stringify(geomAfter.boxes[k]))
    .map((k) => `${k}: ${JSON.stringify(geomBefore.boxes[k])} → ${JSON.stringify(geomAfter.boxes[k])}`);
  ok("ON SCREEN — every restored feature is drawn in exactly the same place (canvas-relative box)",
    moved.length === 0,
    moved.length ? `${moved.length} feature(s) moved:\n       ${moved.slice(0, 10).join("\n       ")}`
      : `all ${Object.keys(geomAfter.boxes).length} features identical to 0.1 px${geomBefore.canvas.w !== geomAfter.canvas.w ? ` (canvas box itself moved ${geomBefore.canvas.w} → ${geomAfter.canvas.w} px wide — chrome, not the plan)` : ""}`);
  await selectBuilding1(page, { soft: true });

  /* And it has to SURVIVE — an undo that only lives in memory is still data loss on reload. */
  await page.reload();
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30_000 });
  await page.waitForTimeout(1200);
  const reloaded = await committed(page);
  const rdiff = deepDiff(before, reloaded, { ignore: [Z] });
  ok("the restore PERSISTS across a reload", rdiff.length === 0,
    rdiff.length ? `${rdiff.length} difference(s):\n       ${rdiff.slice(0, 15).join("\n       ")}` : "identical after reload");

  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n  ${results.length - failed.length}/${results.length} checks passed${NO_UNDO ? "  (--no-undo self-test: these failures are the POINT)" : ""}`);
if (NO_UNDO) {
  /* Inverted: with the undo removed, the restoration checks MUST fail. A green run here would mean
   * the harness cannot see the difference between recovery and permanent loss. */
  console.log(failed.length ? `\n  ✅ SELF-TEST PASSED — ${failed.length} check(s) went red without the undo` : "\n  ❌ SELF-TEST FAILED — the harness cannot tell recovery from permanent loss");
  process.exit(failed.length ? 0 : 1);
}
if (failed.length) { console.log(`  FAILED: ${failed.map((f) => f.n).join(" · ")}`); process.exit(1); }
