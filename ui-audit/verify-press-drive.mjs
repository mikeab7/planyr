/* verify-press-drive — WHICH WAYS OF PRESSING ACTUALLY PLACE A BLOCK, MEASURED.
 *
 * ⛔ THE REPORT THIS ANSWERS. A harness said the placement gesture had regressed to nothing:
 * *"On the PREVIOUS build, my synthetic harness created a positioned block 8 times out of 8,
 * pixel-exact… On THIS build, the identical harness produces NOTHING."* Same coordinates, same
 * page shape, `elementFromPoint` returning the right element, the editor focused. Stated
 * fairly, as a comparative result rather than an instrument complaint.
 *
 * ⛔ AND IT WAS STILL THE INSTRUMENT — the same species as SYNTHETIC-KEYS-DONT-EDIT, on the
 * mouse. The placement moved from `dblclick` to `mousedown` in that build, so a driver
 * dispatching a synthetic `click` or `dblclick` stopped reaching it. **A synthetic click does
 * not produce a mousedown**, so nothing ran: no error, nothing in the console, the right
 * element under the cursor. Every symptom of a broken feature and none of the cause.
 *
 * ⛔ SO THE TABLE IS RE-MEASURED HERE EVERY RUN, and the run FAILS if it stops matching. That
 * is the anti-rot half and it is the whole point: the day the wiring changes, this says so —
 * instead of a harness quietly reporting a working feature as broken, or a broken one as
 * working. `verify-delete-drive.mjs` does exactly this for the keyboard.
 *
 * Run:
 *   npx vite preview --port 4173 &
 *   node ui-audit/verify-press-drive.mjs
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { blocksOn, clientOf } from "./lib/pressFeature.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push({ name, pass: !!cond });
  console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

/** ⛔ THE DOCUMENTED CONTRACT. `places: false` is not a bug — it is the fact a harness author
 *  needs, and the reason it is written down is that guessing it wrong cost a false regression
 *  report. Changing a row here is a change to what drivers may rely on. */
const SHAPES = [
  { id: "real-click", places: true, why: "the driver's own mouse — the only supported way" },
  { id: "real-dblclick", places: true, why: "two real presses; the second lands inside what the first made" },
  { id: "synthetic-click-on-target", places: false, why: "a synthetic click produces no mousedown, so nothing runs" },
  { id: "synthetic-dblclick-on-target", places: false, why: "same — and this is the exact shape that reported a false regression" },
  { id: "synthetic-mousedown-no-bubble", places: false, why: "the handler is on the mat, an ancestor; a non-bubbling event never reaches it" },
  /* ⛔ THIS ROW FLIPPED, AND THE HARNESS FLIPPING IT IS THE HARNESS DOING ITS JOB (B421494).
   * Marquee select gave the blank-page press a second meaning, and the two can only be told
   * apart by how far the pointer travels — which is not knowable until the button comes UP. So
   * placement now completes on mouse-UP rather than on mouse-DOWN, and a lone synthetic
   * mousedown, having no release to follow it, completes nothing. That is a real change to what
   * a driver may rely on, which is exactly why it is written down here rather than discovered by
   * somebody's harness reporting a working feature as broken for the second time. */
  { id: "synthetic-mousedown-bubbles", places: false, why: "placement completes on mouse-UP now (the marquee's distance test); a lone mousedown never finishes the gesture" },
];

const REMOTE = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const PROXY = process.env.HTTPS_PROXY || process.env.https_proxy || "";
const browser = await chromium.launch({
  executablePath: EXEC,
  args: ["--no-sandbox", "--ignore-certificate-errors", ...(REMOTE && PROXY ? [`--proxy-server=${PROXY}`] : [])],
});
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
await assertMeasurable(page, "verify-press-drive");

const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(e.message));

const TREE_KEY = "planyr:notes:tree:v1:local";
const PAGE_PREFIX = "planyr:notes:page:v1:local:";

async function seed() {
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.locator('[data-testid="notes-tree"]').first().waitFor({ timeout: 20000 }).catch(() => {});
  await pacedWait(page, 200);
  await page.evaluate(([treeKey, prefix]) => {
    localStorage.clear();
    localStorage.setItem(treeKey, JSON.stringify({
      v: 3, tombs: [], trash: [],
      pages: [{ id: "p1", title: "Press", createdAt: 1, updatedAt: 1, projectId: null, pages: [] }],
    }));
    localStorage.setItem(prefix + "p1", JSON.stringify({
      type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Existing first line." }] }],
    }));
  }, [TREE_KEY, PAGE_PREFIX]);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="note-body"]', { timeout: 20000 });
  await pacedWait(page, 400);
}

await page.goto(`${BASE}#/notes`, { waitUntil: "domcontentloaded" });

console.log("\nWhich ways of pressing actually place a block");
const POINT = { x: 260, y: 200 };
const results = [];

for (const shape of SHAPES) {
  await seed();
  const c = await clientOf(page, POINT.x, POINT.y);

  /* The target under the point, so the synthetic shapes are dispatched at the SAME element a
   * real press would hit — otherwise a "no" would be about aim rather than about the event. */
  const target = await page.evaluate(([x, y]) => {
    const el = document.elementFromPoint(x, y);
    return el ? (el.getAttribute("data-testid") || el.className || el.tagName) : "none";
  }, [c.x, c.y]);

  if (shape.id === "real-click") await page.mouse.click(c.x, c.y);
  else if (shape.id === "real-dblclick") await page.mouse.dblclick(c.x, c.y);
  else {
    await page.evaluate(([x, y, kind]) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return;
      const opts = { clientX: x, clientY: y, view: window, cancelable: true, button: 0, detail: 1 };
      if (kind === "synthetic-click-on-target") el.dispatchEvent(new MouseEvent("click", { ...opts, bubbles: true }));
      if (kind === "synthetic-dblclick-on-target") el.dispatchEvent(new MouseEvent("dblclick", { ...opts, bubbles: true, detail: 2 }));
      if (kind === "synthetic-mousedown-no-bubble") el.dispatchEvent(new MouseEvent("mousedown", { ...opts, bubbles: false }));
      if (kind === "synthetic-mousedown-bubbles") el.dispatchEvent(new MouseEvent("mousedown", { ...opts, bubbles: true }));
    }, [c.x, c.y, shape.id]);
  }
  await pacedWait(page, 350);

  const blocks = await blocksOn(page);
  const placed = blocks.some((b) => b.left === POINT.x && b.top === POINT.y);
  results.push({ ...shape, placed, target });
  console.log(`    ${String(shape.id).padEnd(32)} ${placed ? "places a block" : "does nothing   "}   (aimed at ${target})`);
}

ok("⛔ THE POINT UNDER TEST IS THE SAME ELEMENT FOR EVERY SHAPE — a 'no' is about the event, not the aim",
  new Set(results.map((r) => r.target)).size === 1, [...new Set(results.map((r) => r.target))].join(" / "));

const wrong = results.filter((r) => r.placed !== r.places);
ok("⛔ THE MEASURED TABLE STILL MATCHES THE DOCUMENTED ONE",
  wrong.length === 0,
  wrong.length ? wrong.map((r) => `${r.id}: documented ${r.places}, measured ${r.placed}`).join(" · ") : `${results.length} shapes, all as documented`);

ok("⛔ AND THE REAL MOUSE PLACES A BLOCK — if this is ever red, the feature really is broken",
  results.find((r) => r.id === "real-click")?.placed === true);
ok("…as does a real double-click, whose second press lands inside what the first made",
  results.find((r) => r.id === "real-dblclick")?.placed === true);

/* ⛔ AND THE ANSWER TO THE REPORT ITSELF, stated as a measurement: the shape that reported a
 * regression reaches nothing, on a build where the real mouse works 32 times out of 32. */
const syntheticDbl = results.find((r) => r.id === "synthetic-dblclick-on-target");
ok("⛔ THE SHAPE THAT REPORTED A REGRESSION REACHES NOTHING, on a build where the real mouse works",
  syntheticDbl?.placed === false && results.find((r) => r.id === "real-click")?.placed === true,
  "a synthetic dblclick produces no mousedown, and the placement is on mousedown");

ok("no uncaught page errors", pageErrors.length === 0, pageErrors.join(" | ") || "clean");

const passed = checks.filter((c) => c.pass).length;
console.log(`\n${passed}/${checks.length} checks passed`);
await browser.close();
if (passed !== checks.length) process.exit(1);
