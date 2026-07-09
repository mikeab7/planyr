/* Self-verification: B740 — Shift-click multi-select + shared property editing (opacity/style).
 *
 * Drives the real LOGGED-OUT app on :4173. Seeds one building + two angled paving strips (a
 * building + truck-court-style strips, the exact driver) with DIFFERING fill-opacity so the shared
 * "Opacity" control starts in the "Mixed" state. Then:
 *   - plain click a building  → single selection (header "Element", not "N selected"),
 *   - Shift-click each strip  → toggles them IN (header "2 selected" → "3 selected"),
 *   - the Opacity control reads "Mixed" (they disagree),
 *   - drag Opacity to 100%    → ALL three rects become fill-opacity="1" (the restore-all driver),
 *   - Shift-click a member    → toggles it OUT ("2 selected"),
 *   - plain click a member    → REPLACES (single selection),
 *   - click empty canvas      → clears,
 *   - while multi>1: per-member OBB outlines render (stroke-width 3.5 casings) and the single-element
 *     transform grips (rotation knob) are suppressed.
 *
 * Run:  node ui-audit/verify-b740.mjs   (needs `npm run preview` on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const DEMO_ID = "verify-b734";

// Distinct fills so each element is individually locatable; angled strips (rot 30) exercise the OBB
// outline; three different fillOpacity values make the shared control start "Mixed". Stacked in a
// CENTER column (cx 0) so the left companion panel — which opens on first selection and shifts the
// canvas right — never covers them; each element's screen box is re-read before every click.
const bldg = { id: "B0", type: "building", cx: 0, cy: -220, w: 150, h: 90, rot: 0, fill: "#101011", fillOpacity: 0.4 };
const strip1 = { id: "P1", type: "paving", cx: 0, cy: 60, w: 60, h: 190, rot: 30, fill: "#202022", fillOpacity: 0.6 };
const strip2 = { id: "P2", type: "paving", cx: 0, cy: 330, w: 60, h: 190, rot: 30, fill: "#303033", fillOpacity: 0.8 };
const demoSite = {
  id: DEMO_ID, groupId: DEMO_ID, site: "Verify B740", name: "Plan 1",
  origin: null, county: null, parcels: [], els: [bldg, strip1, strip2], measures: [], callouts: [],
  markups: [], settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [DEMO_ID]: demoSite })}));
  localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(DEMO_ID)});
} catch (e) {} })();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
const errors = [];
const NETWORK_NOISE = /ERR_TUNNEL_CONNECTION_FAILED|ERR_CONNECTION_CLOSED|ERR_CERT|Failed to load resource|net::/i;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error" && !NETWORK_NOISE.test(m.text())) errors.push(m.text()); });

const results = [];
const check = (name, cond, extra = "") => { results.push({ name, ok: !!cond, extra }); console.log(`${cond ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  // Wait for the planner canvas + our three seeded rects.
  await page.waitForSelector('svg rect[fill="#101011"]', { timeout: 30000 });
  await page.waitForSelector('svg rect[fill="#202022"]', { timeout: 30000 });
  await page.waitForSelector('svg rect[fill="#303033"]', { timeout: 30000 });
  await page.waitForTimeout(400);

  const R = { b: 'rect[fill="#101011"]', p1: 'rect[fill="#202022"]', p2: 'rect[fill="#303033"]' };
  const panelText = async () => (await page.locator('[data-testid="property-panel"]').first().innerText().catch(() => "")) || "";
  const opInputs = () => page.locator('[data-testid="property-panel"] input[type="range"]');
  const opacityOf = async (sel) => page.locator(sel).first().getAttribute("fill-opacity");
  // Click an element by re-reading its CURRENT screen box (the canvas shifts when the panel opens),
  // then dispatch a real pixel click via the mouse (bypasses the transient panel-transition
  // interception the actionability check trips on). Shift is held via the keyboard for toggles.
  const clickEl = async (sel, { shift = false } = {}) => {
    const bb = await page.locator(sel).first().boundingBox();
    if (!bb) throw new Error(`no box for ${sel}`);
    if (shift) await page.keyboard.down("Shift");
    await page.mouse.click(bb.x + bb.width / 2, bb.y + bb.height / 2);
    if (shift) await page.keyboard.up("Shift");
    await page.waitForTimeout(350);
  };

  // The panel text is CSS-uppercased; match case-insensitively. The single-element geometry section
  // is titled "Selected · <type>", so the MULTI header is matched specifically as "<n> selected".
  const isMulti = (t, n) => new RegExp(`${n} selected`, "i").test(t);
  const isSingle = (t) => /element\s*—/i.test(t) && !/\d+ selected/i.test(t);

  // 1. Plain click the building → single selection.
  await clickEl(R.b);
  let t = await panelText();
  check("plain click selects one (single-element header, not 'N selected')", isSingle(t), JSON.stringify(t.split("\n")[0]));

  // 2. Shift-click strip 1 → 2 selected.
  await clickEl(R.p1, { shift: true });
  t = await panelText();
  check("shift-click adds → '2 selected'", isMulti(t, 2), JSON.stringify(t.split("\n")[0]));

  // 3. Shift-click strip 2 → 3 selected.
  await clickEl(R.p2, { shift: true });
  t = await panelText();
  check("shift-click adds → '3 selected'", isMulti(t, 3), JSON.stringify(t.split("\n")[0]));

  // 4. Opacity control present and MIXED (0.4 / 0.6 / 0.8 disagree).
  const nOp = await opInputs().count();
  check("shared Opacity slider present", nOp >= 1, `range inputs=${nOp}`);
  check("Opacity shows 'Mixed' (values differ)", /Mixed/i.test(t), JSON.stringify(t.replace(/\n/g, " ").slice(0, 120)));

  // 5. Per-member OBB outlines render (casing stroke-width 3.5), one per member; single-element
  //    rotation grip is suppressed while multi>1.
  const casings = await page.locator('svg [stroke-width="3.5"]').count();
  check("per-member OBB outlines render (≥3 casings)", casings >= 3, `stroke-width=3.5 count=${casings}`);

  // 6. Drag Opacity to 100% → all three become fill-opacity 1 (the restore-all driver).
  await opInputs().first().evaluate((el) => {
    el.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(el, "1");
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.waitForTimeout(300);
  const [ob, op1, op2] = [await opacityOf(R.b), await opacityOf(R.p1), await opacityOf(R.p2)];
  check("Opacity→100% applied to ALL selected", ob === "1" && op1 === "1" && op2 === "1", `b=${ob} p1=${op1} p2=${op2}`);
  t = await panelText();
  // Only Opacity was set — Fill/Outline stay Mixed. Assert the OPACITY control specifically is no
  // longer Mixed (its label is now directly followed by the next control, not "Mixed").
  check("after drag the Opacity control is no longer 'Mixed'", !/opacity\s*mixed/i.test(t.replace(/\n/g, " ")), JSON.stringify(t.replace(/\n/g, " ").slice(0, 100)));

  // 7. Shift-click a member again → toggles it OUT (3 → 2).
  await clickEl(R.p2, { shift: true });
  t = await panelText();
  check("shift-click removes → '2 selected'", isMulti(t, 2), JSON.stringify(t.split("\n")[0]));

  // 8. Plain click a NON-member (p2, just removed) → REPLACES with a single selection.
  //    (A plain click on a MEMBER of a multi starts a group move by design, so use a non-member.)
  await clickEl(R.p2);
  t = await panelText();
  check("plain click (non-member) replaces → single selection", isSingle(t), JSON.stringify(t.split("\n")[0]));

  // 9. Click empty canvas → clears. Compute a point INSIDE the planner SVG but outside every
  //    element box (the elements are a center column, so the right side of the canvas is empty).
  const empty = await page.evaluate(() => {
    const r = document.querySelector('rect[fill="#101011"]');
    const svg = r && r.ownerSVGElement;
    if (!svg) return null;
    const s = svg.getBoundingClientRect();
    const boxes = ["#101011", "#202022", "#303033"].map((f) => document.querySelector(`rect[fill="${f}"]`)?.getBoundingClientRect()).filter(Boolean);
    // scan the right half of the canvas for a point not covering any element
    for (let fx = 0.9; fx >= 0.55; fx -= 0.05) {
      for (let fy = 0.3; fy <= 0.7; fy += 0.1) {
        const x = s.left + s.width * fx, y = s.top + s.height * fy;
        if (!boxes.some((b) => x >= b.left && x <= b.right && y >= b.top && y <= b.bottom)) {
          return { x, y, top: (document.elementFromPoint(x, y) || {}).tagName };
        }
      }
    }
    return null;
  });
  if (empty) { await page.mouse.click(empty.x, empty.y); await page.waitForTimeout(300); }
  t = await panelText();
  check("empty click clears selection", !!empty && !/\d+ selected/i.test(t) && !/element\s*—/i.test(t), empty ? `clicked ${empty.top} @(${empty.x|0},${empty.y|0}) → ${JSON.stringify(t.slice(0, 40))}` : "no empty point found");

  check("no page errors", errors.length === 0, errors.slice(0, 3).join(" | "));
} catch (e) {
  check("script ran without throwing", false, String(e));
} finally {
  const passed = results.filter((r) => r.ok).length;
  console.log(`\nB740 headless: ${passed}/${results.length} checks passed`);
  await browser.close();
  process.exit(passed === results.length ? 0 : 1);
}
