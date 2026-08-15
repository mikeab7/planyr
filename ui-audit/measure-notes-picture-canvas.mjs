/* measure-notes-picture-canvas — A PICTURE IS A CANVAS OBJECT (NEW-PICTURE-CANVAS).
 *
 * ⛔ HIS REPORT: *"I feel like I should just be able to drop a picture in there and move it
 * around, like, however I want to, like a proper canvas."*
 *
 * ⛔ AND HIS ACCEPTANCE TEST, WHICH IS WHAT THIS FILE RUNS: *"Verify by measurement, not by eye:
 * drop a file at a known point and assert the STORED x/y matches the drop point; resize from each
 * handle and assert the stored size changed and survived a reload; drop one near the right edge
 * and assert it is not crushed."* All three, plus the two his list implies and does not say — that
 * several files dropped at once do not land in one stack, and that a box holding a picture is not
 * eaten by the empty-box prune on the way to storage.
 *
 * ⛔ EVERY VERDICT IS THE STORED DOCUMENT, NEVER THE SCREEN. This module has been burned by that
 * exact distinction twice: a resize that RENDERED at the dragged size and stored the old one
 * (B434417 — *"rendered 300, stored 180, 180 after a reload"*), and a delete that reported success
 * with the object still on his plan. So the box is read out of `localStorage` after the save
 * debounce, and the resize leg RELOADS before it believes anything.
 *
 * ⛔ AND IT REFUSES TO PRINT A SCORE IT DID NOT EARN. A synthetic drop is exactly the class of
 * thing this repo has proven does not reach the app (B364017: a synthetic click produces no
 * `mousedown`, so the whole placement path went unexercised while a harness reported it working).
 * So the FIRST leg is a KNOWN-GOOD ARM in the sense of DRIVER-SCROLL-IS-NOT-APP-SCROLL clause 6:
 * if a drop does not produce a box AT ALL, the instrument — not the app — is what failed, and the
 * run says VACUOUS and exits non-zero rather than reporting eight green rows about geometry it
 * never measured.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";
const PAGE_KEY = `${PAGE_PREFIX}p1`;

/** Kept in step with `notesBoxResize.js` by `test/notesBoxResize.test.js`, which imports them. */
const MIN_W = 160;
const MIN_H = 48;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await assertMeasurable(page, "measure-notes-picture-canvas");
await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

let pass = 0; let fail = 0;
const failures = [];
const ok = (label, cond, detail = "") => {
  if (cond) { pass += 1; console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ""}`); }
  else { fail += 1; failures.push(label); console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`); }
};

async function seed(boxes = []) {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, key, bs]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Canvas", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(key, JSON.stringify({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "a line of ordinary text" }] },
        ...bs.map((b) => ({
          type: "noteAnchor",
          attrs: b,
          content: [{ type: "noteImage", attrs: { imageId: b.imageId || "img_seed", alt: "seed.png", w: 800, h: 400 } }],
        })),
      ],
    }));
  }, [TREE_KEY, PAGE_KEY, boxes]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
}

/** Every positioned box in the STORED document, with the kind of thing it holds. */
const storedBoxes = () => page.evaluate((k) => {
  const out = [];
  const walk = (n) => {
    if (!n || typeof n !== "object") return;
    if (n.type === "noteAnchor") {
      const kid = (n.content || [])[0];
      out.push({
        ...n.attrs,
        kind: (n.content || []).length === 1 && kid?.type === "noteImage" ? "image" : "text",
        imageId: kid?.type === "noteImage" ? kid.attrs?.imageId : null,
      });
      return;
    }
    (n.content || []).forEach(walk);
  };
  try { walk(JSON.parse(localStorage.getItem(k))); } catch (_) { /* unreadable */ }
  return out;
}, PAGE_KEY);

/** The editor's own frame, so a client point can be turned into the document point the app
 *  stores — the SAME conversion the app does, measured rather than assumed. */
const frame = () => page.evaluate(() => {
  const dom = document.querySelector(".ProseMirror");
  const b = dom.getBoundingClientRect();
  return { left: b.left, top: b.top, width: b.width, offsetWidth: dom.offsetWidth, scale: b.width / (dom.offsetWidth || 1) || 1 };
});

/** ⛔ A REAL FILE, DROPPED. Built in the page as a canvas → blob → File so the harness needs no
 *  fixture on disk, and handed to a real `DataTransfer` — the drop the app sees is the same shape
 *  the OS produces. `clientX`/`clientY` ride the event because THEY ARE THE THING UNDER TEST:
 *  the whole item is that the picture lands where the pointer was, not at the caret. */
async function dropImages(clientX, clientY, count = 1) {
  const dt = await page.evaluateHandle(async (n) => {
    const transfer = new DataTransfer();
    for (let i = 0; i < n; i += 1) {
      const c = document.createElement("canvas");
      c.width = 800; c.height = 400;
      const g = c.getContext("2d");
      g.fillStyle = ["#B8418C", "#0E7490", "#EF9F27"][i % 3];
      g.fillRect(0, 0, 800, 400);
      // eslint-disable-next-line no-await-in-loop
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      transfer.items.add(new File([blob], `dropped-${i + 1}.png`, { type: "image/png" }));
    }
    return transfer;
  }, count);
  await page.dispatchEvent(".ProseMirror", "drop", { dataTransfer: dt, clientX, clientY, bubbles: true });
  await pacedWait(page, 1400);          // intake + store + the editor's 600ms save debounce
}

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * 1 · HIS TEST: A FILE LANDS WHERE IT WAS DROPPED — and this leg is also the INSTRUMENT CHECK
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("1 · A DROPPED FILE LANDS AT THE DROP POINT — stored x/y against the point pressed");
console.log("=".repeat(100));
await seed();
const f = await frame();
const DROP_X = Math.round(f.left + 700);
const DROP_Y = Math.round(f.top + 260);
await dropImages(DROP_X, DROP_Y);
let boxes = await storedBoxes();

/* ⛔ THE VACUITY GUARD. If the drop reached nothing, everything below measures a page with no
 * picture on it and would report green rows about geometry it never saw. */
if (!boxes.length) {
  console.log("\n⛔ VACUOUS RUN — the drop produced NO box in the stored document.");
  console.log("   That is an INSTRUMENT failure, not a verdict about the app: a synthetic drop");
  console.log("   that never reaches the editor exercises none of the path under test.");
  console.log(`   page errors: ${errs.length ? errs.slice(0, 3).join(" | ") : "clean"}`);
  await browser.close();
  process.exit(2);
}

const want = { x: Math.round((DROP_X - f.left) / f.scale), y: Math.round((DROP_Y - f.top) / f.scale) };
const dropped = boxes[0];
console.log(`  dropped at document point (${want.x}, ${want.y}) · stored (${dropped.x}, ${dropped.y})`);
ok("⛔ the picture is a POSITIONED BOX, not an inline attachment", dropped.kind === "image", `holds ${dropped.kind}`);
ok("⛔ the stored x IS the drop point", Math.abs(dropped.x - want.x) <= 1, `${dropped.x} vs ${want.x}`);
ok("⛔ the stored y IS the drop point — not the top, not the caret", Math.abs(dropped.y - want.y) <= 1, `${dropped.y} vs ${want.y}`);
ok("it carries a real stored height, so it is resizable in both axes", Number.isFinite(dropped.h) && dropped.h > 0, `h=${dropped.h}`);
ok("…and it kept the picture's proportions rather than arriving distorted",
  Math.abs(dropped.w / dropped.h - 2) < 0.06, `${dropped.w}×${dropped.h}, source 800×400`);
ok("⛔ the bytes were stored under an image id the purge can find", Boolean(dropped.imageId), dropped.imageId || "none");

/* ⛔ AND IT SURVIVED THE STORAGE SEAM'S PRUNE, which is the leg that would have destroyed real
 * work: a box holding no TEXT must not read as an abandoned empty box. Proven here end to end
 * rather than only in the unit suite, because the prune runs inside `writePage`. */
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
await pacedWait(page, 900);
const afterReload = (await storedBoxes())[0];
ok("⛔ it is still there after a reload — the empty-box prune did not eat it", Boolean(afterReload));
ok("…at the same point", afterReload && afterReload.x === dropped.x && afterReload.y === dropped.y,
  afterReload ? `(${afterReload.x}, ${afterReload.y})` : "gone");

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * 2 · SEVERAL AT ONCE DO NOT LAND IN ONE STACK
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("2 · THREE FILES DROPPED AT ONCE — three boxes, none hidden under another");
console.log("=".repeat(100));
await seed();
const f2 = await frame();
await dropImages(Math.round(f2.left + 400), Math.round(f2.top + 200), 3);
const many = await storedBoxes();
console.log(`  boxes: ${many.map((b) => `(${b.x},${b.y} ${b.w}×${b.h})`).join(" · ") || "none"}`);
ok("⛔ three files make three boxes", many.length === 3, `${many.length}`);
ok("⛔ …and no two share a point, so none is invisible under another",
  new Set(many.map((b) => `${b.x},${b.y}`)).size === many.length);
ok("each has its own stored picture", new Set(many.map((b) => b.imageId)).size === many.length);

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * 3 · HIS TEST: RESIZE FROM EACH HANDLE, AND IT SURVIVES A RELOAD
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("3 · EVERY HANDLE RESIZES, AND THE STORED SIZE SURVIVES A RELOAD");
console.log("=".repeat(100));
const pad = (s, n) => String(s).padEnd(n);
console.log(pad("handle", 9) + pad("before", 22) + pad("after drag", 22) + pad("after RELOAD", 22) + "verdict");
console.log("-".repeat(100));

/** Drag one handle by a delta, then read the STORED box back. */
async function dragHandle(handle, dx, dy, { shift = false } = {}) {
  await seed([{ x: 300, y: 200, w: 400, h: 200, imageId: "img_seed" }]);
  await page.locator(".planyr-anchor").first().click();      // stage 1: select, revealing the handles
  await pacedWait(page, 350);
  const sel = handle === "e" ? '[data-testid="note-anchor-size"]' : `[data-testid="note-anchor-h-${handle}"]`;
  const el = page.locator(sel).first();
  if (!(await el.count())) return { missing: true };
  const b = await el.boundingBox();
  if (!b) return { missing: true };
  const before = (await storedBoxes())[0];
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  if (shift) await page.keyboard.down("Shift");
  // In steps, so the handler sees real movement rather than one teleport.
  for (let i = 1; i <= 6; i += 1) await page.mouse.move(cx + (dx * i) / 6, cy + (dy * i) / 6);
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
  await pacedWait(page, 900);
  const after = (await storedBoxes())[0];
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 900);
  return { before, after, reloaded: (await storedBoxes())[0] };
}

const box = (b) => (b ? `${b.x},${b.y} ${b.w}×${b.h}` : "—");
/* Each row names the edges the drag is allowed to move; everything else must be untouched. */
const CASES = [
  ["e", 120, 0, { w: +1 }],
  ["w", -120, 0, { x: -1, w: +1 }],
  ["s", 0, 100, { h: +1 }],
  ["n", 0, -100, { y: -1, h: +1 }],
  ["se", 120, 60, { w: +1, h: +1 }],
  ["sw", -120, 60, { x: -1, w: +1, h: +1 }],
  ["ne", 120, -60, { y: -1, w: +1, h: +1 }],
  ["nw", -120, -60, { x: -1, y: -1, w: +1, h: +1 }],
];

for (const [handle, dx, dy, expect] of CASES) {
  const r = await dragHandle(handle, dx, dy);
  if (r.missing) {
    ok(`${handle} handle exists on a picture box`, false, "the control is not in the DOM");
    console.log(pad(handle, 9) + "— handle missing");
    continue;
  }
  const { before, after, reloaded } = r;
  const problems = [];
  for (const [k, dir] of Object.entries(expect)) {
    const moved = (after?.[k] ?? 0) - (before?.[k] ?? 0);
    if (Math.sign(moved) !== dir || Math.abs(moved) < 10) problems.push(`${k} ${before?.[k]}→${after?.[k]}`);
  }
  /* ⛔ AND THE EDGES THIS HANDLE DOES NOT NAME MUST NOT HAVE MOVED — the invariant that makes a
   * resize a resize. Checked on the STORED numbers, not on the rendered box. */
  for (const k of ["x", "y", "w", "h"]) {
    if (k in expect) continue;
    if (before?.[k] !== after?.[k]) problems.push(`⛔ ${k} moved and should not have (${before?.[k]}→${after?.[k]})`);
  }
  const persisted = reloaded && ["x", "y", "w", "h"].every((k) => reloaded[k] === after[k]);
  if (!persisted) problems.push("⛔ did not survive the reload");
  console.log(pad(handle, 9) + pad(box(before), 22) + pad(box(after), 22) + pad(box(reloaded), 22)
    + (problems.length ? `⛔ ${problems.join("; ")}` : "ok"));
  ok(`${handle} resizes, moves only the edges it names, and persists`, problems.length === 0, problems.join("; "));
}

/* ⛔ THE RATIO RULE, MEASURED — corners hold it, Shift frees it. This is the half of his spec a
 * "did the number change?" check cannot see: a corner drag that stretches is still a resize. */
console.log("\n  the ratio rule (source box 400×200, ratio 2.00)");
const corner = await dragHandle("se", 200, 4);
if (!corner.missing) {
  const r = corner.after.w / corner.after.h;
  ok("⛔ a corner HOLDS the picture's proportions", Math.abs(r - 2) < 0.05, `${corner.after.w}×${corner.after.h} = ${r.toFixed(2)}`);
}
const freed = await dragHandle("se", 200, 4, { shift: true });
if (!freed.missing) {
  const r = freed.after.w / freed.after.h;
  ok("⛔ …and Shift FREES it — his 'Shift inverts that'", Math.abs(r - 2) > 0.1, `${freed.after.w}×${freed.after.h} = ${r.toFixed(2)}`);
}

/* ⛔ A TEXT BOX OFFERS ONLY WHAT IT CAN HONOUR. Its height is its words (B391073), so a north
 * handle would have to mean something other than "resize" — an open question with the owner. */
await page.evaluate(([treeKey, key]) => {
  localStorage.clear();
  localStorage.setItem(treeKey, JSON.stringify({ v: 3, tombs: [], trash: [], pages: [{ id: "p1", title: "T", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }] }));
  localStorage.setItem(key, JSON.stringify({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "text" }] },
      { type: "noteAnchor", attrs: { x: 300, y: 200, w: 240 }, content: [{ type: "paragraph", content: [{ type: "text", text: "a text box" }] }] },
    ],
  }));
}, [TREE_KEY, PAGE_KEY]);
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
await pacedWait(page, 900);
await page.locator(".planyr-anchor").first().click();
await pacedWait(page, 350);
const textHandles = await page.evaluate(() => [...document.querySelectorAll('.planyr-anchor [data-handle]')].map((e) => e.getAttribute("data-handle")).sort());
console.log(`\n  a TEXT box offers: ${textHandles.join(" · ") || "none"}`);
ok("⛔ a text box offers east and west only — its height is its words", textHandles.join(",") === "e,w", textHandles.join(","));

/* ════════════════════════════════════════════════════════════════════════════════════════════
 * 4 · HIS TEST: DROPPED NEAR THE RIGHT EDGE, AND NOT CRUSHED
 * ═══════════════════════════════════════════════════════════════════════════════════════════ */
console.log("\n" + "=".repeat(100));
console.log("4 · A PICTURE DROPPED HARD AGAINST THE RIGHT MARGIN IS NOT CRUSHED");
console.log("=".repeat(100));
await seed();
const f3 = await frame();
/* ⛔ THE DROP MUST LAND ON THE SHEET, AND THAT IS PROSEMIRROR'S RULE RATHER THAN A CHOICE HERE.
 * The first version of this leg aimed at the SCROLLER's right edge — trap 2 from
 * `measure-notes-right-edge`'s own header, arrived at from the other side — and got no box at all.
 * The reason is worth writing down so nobody re-derives it: ProseMirror's own drop handler runs
 * `posAtCoords` FIRST and returns early when it is null, so `handleDrop` is never called for a
 * point outside the editor's box. A drop past the sheet is not a case the app can have; the case
 * that matters is a drop hard against the sheet's right margin. */
const DROP_EDGE_X = Math.round(f3.left + f3.width - 30);
await dropImages(DROP_EDGE_X, Math.round(f3.top + 220));
const edge = (await storedBoxes())[0];
const wantEdgeX = Math.round((DROP_EDGE_X - f3.left) / f3.scale);
console.log(`  stored ${edge ? `${edge.w}×${edge.h} at x=${edge.x}` : "—"} · dropped at document x=${wantEdgeX}`);
ok("⛔ a drop at the right margin still produces a box", Boolean(edge));
ok("⛔ the stored width never drops below the floor", Boolean(edge) && edge.w >= MIN_W, `${edge?.w} (floor ${MIN_W})`);
ok("⛔ nor the height", Boolean(edge) && edge.h >= MIN_H, `${edge?.h} (floor ${MIN_H})`);
ok("⛔ …and it kept its proportions rather than being squeezed into a sliver",
  Boolean(edge) && Math.abs(edge.w / edge.h - 2) < 0.06, edge ? (edge.w / edge.h).toFixed(2) : "—");
/* ⛔ AND THE LEFT EDGE IS STILL THE POINT HE CHOSE. This is B539648's acceptance rule — *"assert
 * stored left equals click x minus editor left. No clamping band anywhere"* — asked of the drop
 * gesture, which is a placement path that rule had never been applied to. */
ok("⛔ the left edge is the drop point — no clamping band on the drop path either",
  Boolean(edge) && Math.abs(edge.x - wantEdgeX) <= 1, `${edge?.x} vs ${wantEdgeX}`);

/* ⛔ AND THE GROWTH BRANCH IS EXERCISED RATHER THAN ASSUMED. A dropped picture is capped at a
 * sensible width, so it lands comfortably inside the visible canvas and NO growth is owed —
 * demanding it there would report a working feature as broken (which the first version did). The
 * honest way to reach the branch is to make the box genuinely overhang: drag its east handle well
 * past the window and require the canvas to have grown rather than the picture to have shrunk. */
console.log("\n  dragging a picture box's east handle past the window");
await seed([{ x: 300, y: 200, w: 400, h: 200, imageId: "img_seed" }]);
await page.locator(".planyr-anchor").first().click();
await pacedWait(page, 350);
const eh = await page.locator('[data-testid="note-anchor-size"]').first().boundingBox();
let grown = null;
if (eh) {
  const cx = eh.x + eh.width / 2;
  const cy = eh.y + eh.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 8; i += 1) await page.mouse.move(cx + i * 70, cy);
  await page.mouse.up();
  await pacedWait(page, 900);
  grown = await page.evaluate(() => {
    const pm = document.querySelector(".ProseMirror");
    let sc = null;
    for (let n = pm?.parentElement; n; n = n.parentElement) {
      const ox = getComputedStyle(n).overflowX;
      if (ox === "auto" || ox === "scroll") { sc = n; break; }
    }
    return { scrollW: sc ? Math.round(sc.scrollWidth) : null, clientW: sc ? Math.round(sc.clientWidth) : null };
  });
  const wide = (await storedBoxes())[0];
  console.log(`  stored ${wide?.w}×${wide?.h} · canvas ${grown.scrollW} / ${grown.clientW} visible`);
  ok("⛔ the drag is not walled at the page edge — the box really got wider",
    Boolean(wide) && wide.w > 700, `${wide?.w}`);
  ok("⛔ …and the canvas grew to the right to hold it instead of crushing it",
    (grown.scrollW || 0) > (grown.clientW || 0), `${grown.scrollW} > ${grown.clientW}`);
  ok("…while the box kept the height it had — an east drag stretches one axis",
    Boolean(wide) && wide.h === 200, `h=${wide?.h}`);
} else {
  ok("the east handle is reachable on a picture box", false, "not in the DOM");
}

console.log(`\n${pass}/${pass + fail} checks passed`);
for (const f2x of failures) console.log(`  ✗ ${f2x}`);
console.log(`page errors: ${errs.length ? errs.slice(0, 3).join(" | ") : "clean"}`);
await browser.close();
process.exit(fail ? 1 : 0);
