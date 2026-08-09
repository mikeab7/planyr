/* audit-element-parity.mjs — the LIVE half of THE ELEMENT CAPABILITY CONTRACT (NEW-1 / NEW-2).
 *
 * The declaration + source guard are `e2e/elementCapabilities.table.js` + `test/elementCapabilities
 * .test.js`. This is the half that drives the REAL app: it right-clicks one of every drawable kind,
 * records the menu VERBATIM, and checks it against what that kind DECLARED — so the parity matrix
 * is read off the running product rather than off a source reading, and a menu that declares an
 * action it does not actually render fails here.
 *
 * NEW-2 rides the same fixture, because it is the same surface: does Arrange actually change WHAT
 * RENDERS ON TOP? Paint order in SVG IS DOM order, so every reading below comes from
 * `[data-feature]` in document order — never from React state, which is the reading that would have
 * called a dead feature green.
 *
 * ⛔ THREE THINGS THIS HARNESS LEARNED THE HARD WAY, each of which produced a clean, plausible,
 * completely wrong matrix before it was fixed:
 *
 *  1. THE FIXTURE MUST OVERLAP. A z-order feature cannot be observed on a plan whose shapes do not
 *     touch — every permutation draws the same picture, so a tidy grid fixture reports PASS on a
 *     completely dead implementation. Every pair below overlaps its sibling.
 *  2. A PROBE AT THE CENTRE OF AN OVERLAPPED SHAPE LANDS ON ITS SIBLING, and then the menu you read
 *     is the sibling's. `pointOn` takes a FRACTIONAL position and REPORTS what `elementFromPoint`
 *     actually finds there, so a mis-aimed probe says so instead of writing a wrong row.
 *  3. `offsetParent !== null` IS NOT A VISIBILITY TEST FOR A PORTALLED MENU. A position:fixed node
 *     always reports `offsetParent === null`, so that filter reported "no menu opened" for EVERY
 *     type — a full matrix of confident nulls. Measure the box instead.
 *
 * And a fourth, which is why the fixture carries two throwaway sidewalk chips: ZOOM-TO-FIT BOUNDS
 * PARCELS + ELEMENTS + THE UNDERLAY, AND NOTHING ELSE. A markup, callout or measurement outside the
 * ELEMENT extent is simply off screen after a fit, its probe reads a point past the viewport edge,
 * and the matrix records "this type has no right-click menu" about a feature that never rendered.
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { ELEMENT_CAPABILITIES, capabilityFor, verdict } from "../e2e/elementCapabilities.table.js";

const BASE = process.env.PLANYR_URL || "http://localhost:5173/";
const EXEC = process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium";
const SITE_ID = "zz-parity-audit";

let n = 0;
const eid = () => `pe${++n}`;
/* ⛔ AN ELEMENT IS CENTRED ON `cx`/`cy`, NOT `x`/`y`. Seeding x/y leaves cx/cy undefined, every
 * derived corner comes out NaN, and zoom-to-fit then puts the whole plan off the canvas. */
const rect = (cx, cy, w, h) => ({ cx, cy, w, h, rot: 0 });
const ring = (cx, cy, w, h) => [
  { x: cx - w / 2, y: cy - h / 2 }, { x: cx + w / 2, y: cy - h / 2 },
  { x: cx + w / 2, y: cy + h / 2 }, { x: cx - w / 2, y: cy + h / 2 },
];

const B1 = eid(), B2 = eid(), PAV = eid(), POND = eid();
const ELS = [
  { id: B1, type: "building", ...rect(0, 0, 400, 260), z: 0, label: "Bldg A" },
  { id: B2, type: "building", ...rect(120, 80, 400, 260), z: 1024, label: "Bldg B" },
  { id: PAV, type: "paving", ...rect(60, 40, 600, 400), z: 0, label: "Paving" },
  { id: POND, type: "pond", ...rect(900, 0, 320, 220), z: 0, label: "Pond" },   // ALONE in its band — see NEW-2 below
  { id: eid(), type: "sidewalk", ...rect(-300, -150, 20, 20), z: 0, label: "fit-corner" },
  { id: eid(), type: "sidewalk", ...rect(2150, 950, 20, 20), z: 1024, label: "fit-corner" },
];

const M1 = "pm1", M2 = "pm2";
const MARKUPS = [
  { id: M1, kind: "rect", stroke: "#ff0101", weight: 3, fill: "#ff0101", fillOpacity: 0.35, cx: 0, cy: 700, w: 400, h: 260, rot: 0, z: 0 },
  { id: M2, kind: "rect", stroke: "#ff0102", weight: 3, fill: "#ff0102", fillOpacity: 0.35, cx: 120, cy: 780, w: 400, h: 260, rot: 0, z: 1024 },
];

/* Callouts — two overlapping text boxes, seeded with NO `z` on purpose. That is the state every
 * plan ever saved is in, so this is also the migration case: they must still order correctly. */
const C1 = "pc1", C2 = "pc2";
const CALLOUTS = [
  { id: C1, box: { x: 900, y: 700 }, text: "Callout A", noLeader: true },
  { id: C2, box: { x: 960, y: 760 }, text: "Callout B", noLeader: true },
];

const MS1 = "pms1", MS2 = "pms2";
const MEASURES = [
  { id: MS1, mode: "area", z: 0, pts: ring(1800, 0, 400, 260) },
  { id: MS2, mode: "area", z: 1024, pts: ring(1900, 80, 400, 260) },
];

const site = {
  id: SITE_ID, groupId: SITE_ID, site: "ZZ Element parity audit", name: "Plan 1",
  origin: null, county: null, parcels: [], underlay: null,
  els: ELS, markups: MARKUPS, callouts: CALLOUTS, measures: MEASURES,
  settings: { showDims: false }, updatedAt: Date.now(),
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify({ [SITE_ID]: site }))});
  localStorage.removeItem('planarfit:currentSite:v1');
} catch (e) {} })();`;

const results = [];
const ok = (name, pass, extra = "") => {
  results.push({ name, pass: !!pass });
  console.log(`${pass ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`);
};

/* How a declared ACTION reads in the shipped menus. One place, so the matrix and the app share a
 * vocabulary instead of the harness re-deciding what "copy" looks like per family. */
const ACTION_PATTERNS = {
  properties: /^Properties/i,
  /* ⛔ The hint rides INSIDE the button, so `textContent` reads "CopyCtrl+C" — `/^Copy\b/` finds no
   * word boundary between "Copy" and "Ctrl" and reports the row missing on a menu that has it. */
  copy: /^Copy/i,
  duplicate: /^Duplicate/i,
  lock: /^(Lock|Unlock)/i,
  arrangeEnds: /^(Bring to Front|Send to Back)/i,
  arrangeSteps: /^(Bring Forward|Send Backward)/i,
  crossBand: /(behind|above) the plan|behind buildings|in front of buildings/i,
  delete: /^Delete\b/i,
};

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, ignoreHTTPSErrors: true });
await ctx.addInitScript(seed);
await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
const page = await ctx.newPage();
await assertMeasurable(page, "audit-element-parity");
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(String(e)));

const paintOrder = () => page.evaluate(() => {
  const out = [];
  const svg = document.querySelector('[data-testid="planner-canvas"]') || document;
  svg.querySelectorAll("[data-feature],[data-markup],[data-measure-chip]").forEach((n) => {
    const id = n.getAttribute("data-feature") || (n.getAttribute("data-markup") && `markup:${n.getAttribute("data-markup")}`) ||
      `measure:${n.getAttribute("data-measure-chip")}`;
    if (id && !out.includes(id)) out.push(id);
  });
  return out;
});

/* ⛔ AND A FIFTH TRAP, which cost a full matrix of Building failures: `elementFromPoint` AGREEING
 * IS NOT ENOUGH. A group's bounding box is inflated by its drop-shadow filter and its label, so a
 * fraction of that box can sit outside the painted body while `elementFromPoint` still answers with
 * the group — and the right-click there opens the MAP menu. That reads as "the building menu offers
 * nothing", which is a confident, completely wrong row.
 *
 * So the probe SCANS candidate fractions and accepts the first one the APP ITSELF resolves to the
 * target, via `window.__plannerHitTarget` (E2E-gated, read-only — the instrument B233153 built for
 * exactly this). Asking the app beats re-implementing its hit test in the harness, which would
 * only ever test the harness's copy of the rule. */
const pointOn = (sel, fx = 0.5, fy = 0.5, want = null) => page.evaluate(({ s, fx, fy, want }) => {
  const n = document.querySelector(s);
  if (!n) return null;
  const r = n.getBoundingClientRect();
  const at = (a, b) => ({ x: Math.round(r.x + r.width * a), y: Math.round(r.y + r.height * b) });
  const owns = (x, y) => {
    const hit = document.elementFromPoint(x, y);
    const o = hit && hit.closest("[data-feature],[data-markup],[data-measure-chip]");
    return o ? (o.getAttribute("data-feature") || o.getAttribute("data-markup") || o.getAttribute("data-measure-chip")) : (hit && hit.tagName);
  };
  const asks = typeof window.__plannerHitTarget === "function";
  const cands = [[fx, fy]];
  for (const a of [0.2, 0.3, 0.35, 0.15, 0.25]) for (const b of [0.2, 0.3, 0.35, 0.15, 0.25]) cands.push([a, b]);
  let firstDom = null;
  for (const [a, b] of cands) {
    const { x, y } = at(a, b);
    const under = owns(x, y);
    if (under !== want && want) continue;
    if (!firstDom) firstDom = { x, y, under, resolved: null };
    if (!asks) return { x, y, under, resolved: null };
    let t = null;
    try { t = window.__plannerHitTarget(x, y); } catch (e) { /* ignore */ }
    const id = t && (t.id || t.feature || "");
    if (!want || String(id).includes(String(want).split(":").pop())) return { x, y, under, resolved: id || null };
  }
  return firstDom || { x: at(fx, fy).x, y: at(fx, fy).y, under: owns(at(fx, fy).x, at(fx, fy).y), resolved: null };
}, { s: sel, fx, fy, want });

/* ⛔ DO NOT PRE-SELECT BEFORE READING A MENU. A left click mounts the feature's own resize grips,
 * and a corner grip sits exactly where a corner-ish probe point is — the right-click then lands on
 * chrome the probe itself created, falls through to the canvas, and the harness records the MAP
 * menu as "the building's menu offers nothing". (CHROME-NEVER-EATS-A-PRESS clause 4, in its
 * right-click form.) Every family's context menu opens without a prior selection, so deselect and
 * ask cold. */
async function menuAt(x, y) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await page.mouse.click(x, y, { button: "right" });
  await page.waitForTimeout(350);
  const rows = await page.evaluate(() => {
    const menu = [...document.querySelectorAll(".menu")].filter((m) => m.getBoundingClientRect().width > 0).pop();
    if (!menu) return null;
    return [...menu.querySelectorAll("button")]
      .map((b) => ({ text: (b.textContent || "").trim(), disabled: b.disabled === true }))
      .filter((r) => r.text && r.text.length < 60);
  });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  return rows;
}

/* Check one live menu against one declared row. A row it does NOT declare is not required; a row
 * it DOES declare must be there (present-but-greyed counts — a greyed row with a stated reason is
 * an answer, and NEW-2 is precisely about a menu that gave none). */
function checkMenu(type, rows) {
  const row = capabilityFor(type);
  const label = row ? row.label : type;
  if (!rows) { ok(`${label}: right-click opens a menu`, false, "no menu opened"); return; }
  console.log(`\n=== ${label} right-click menu ===`);
  console.log(rows.map((r) => `  ${r.disabled ? "[grey] " : ""}${r.text}`).join("\n"));
  for (const [cap, re] of Object.entries(ACTION_PATTERNS)) {
    if (verdict(row.actions[cap]) !== "yes") continue;
    ok(`${label}: the menu offers "${cap}", as declared`, rows.some((r) => re.test(r.text)));
  }
}

try {
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1800);
  await page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
  await page.waitForTimeout(400);
  await page.locator(`button:has-text(${JSON.stringify(site.site)})`).first().click();
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 25000 });
  await page.waitForTimeout(1500);

  if (pageErrors.length) {
    console.log("\n⛔ THE FIXTURE CRASHED THE RENDER — every result below would be meaningless:");
    pageErrors.slice(0, 3).forEach((e) => console.log("   " + e.slice(0, 250)));
    process.exit(1);
  }

  const contentFill = () => page.evaluate(() => {
    const c = document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect();
    /* ⛔ ALL FIVE DRAWN KINDS (NEW-2). "How much of the canvas does the plan fill" answered from
     * elements alone under-reports a plan whose extent is set by a parcel ring or a markup, and a
     * fit check that under-reports is a fit check that passes a fit that did not happen. */
    const boxes = [...document.querySelectorAll("[data-feature]")].map((g) => g.getBoundingClientRect()).filter((b) => b.width && b.height);
    if (!boxes.length) return 0;
    const x0 = Math.min(...boxes.map((b) => b.left)), x1 = Math.max(...boxes.map((b) => b.right));
    const y0 = Math.min(...boxes.map((b) => b.top)), y1 = Math.max(...boxes.map((b) => b.bottom));
    return Math.min((x1 - x0) / c.width, (y1 - y0) / c.height);
  });
  const fits = page.locator('button[title="Zoom to fit"]');   // also matches the HEADER's fullscreen glyph
  for (let i = (await fits.count()) - 1; i >= 0; i--) {
    await fits.nth(i).click({ timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(600);
    if (await contentFill() > 0.3) break;
  }
  if (await contentFill() <= 0.3) {
    console.log(`\n⛔ ZOOM-TO-FIT DID NOTHING — the plan is not on screen (fill ${(await contentFill()).toFixed(3)}).`);
    process.exit(1);
  }

  console.log("\n=== PAINT ORDER AS SEEDED (document order = bottom → top) ===");
  console.log((await paintOrder()).join("\n"));

  /* ---- NEW-1 · THE MATRIX, read off the running app ---------------------------------------- */
  const probes = [
    ["building", `[data-el-id="${B1}"]`, 0.12, 0.12, `el:${B1}`],   // a corner Bldg B does NOT cover
    ["pond", `[data-el-id="${POND}"]`, 0.5, 0.5, `el:${POND}`],
    ["mrect", `[data-markup="${M1}"]`, 0.12, 0.12, M1],
    ["callout", `[data-testid="callout-${C1}"]`, 0.2, 0.3, `callout:${C1}`],
    ["measure", `[data-measure-chip="${MS1}"]`, 0.5, 0.5, null],
  ];
  for (const [type, sel, fx, fy, want] of probes) {
    const p = await pointOn(sel, fx, fy, want);
    if (!p) { ok(`${type}: rendered on the canvas`, false, `no node for ${sel}`); continue; }
    checkMenu(type, await menuAt(p.x, p.y));
  }

  /* ---- NEW-2 · does ordering change WHAT RENDERS ON TOP? ----------------------------------- */
  console.log("\n=== NEW-2 · ordering, read back from the rendered DOM ===");

  // (a) Two same-type ELEMENTS — the case that already worked; kept so a regression is caught.
  const bA = await pointOn(`[data-el-id="${B1}"]`, 0.12, 0.12, `el:${B1}`);
  const before = await paintOrder();
  await page.mouse.click(bA.x, bA.y);
  await page.waitForTimeout(250);
  await page.keyboard.press("Control+Shift+BracketRight");
  await page.waitForTimeout(500);
  const after = await paintOrder();
  ok("two same-type elements: Bring to Front moves the RENDERED node above its peer",
    after.indexOf(`el:${B1}`) > after.indexOf(`el:${B2}`),
    `A ${before.indexOf(`el:${B1}`)}→${after.indexOf(`el:${B1}`)}, B ${before.indexOf(`el:${B2}`)}→${after.indexOf(`el:${B2}`)}`);

  // (b) CALLOUTS — the family that had no ordering at all. Seeded with NO z, so this is also the
  //     migration case. Both the chord AND the menu row are exercised: a model that orders but a
  //     menu that never offers it is the same dead end from the user's chair.
  const cA = await pointOn(`[data-testid="callout-${C1}"]`, 0.2, 0.3, `callout:${C1}`);
  ok("the callout probe lands on the callout", cA && cA.under === `callout:${C1}`, JSON.stringify(cA));
  const co0 = await paintOrder();
  await page.mouse.click(cA.x, cA.y);
  await page.waitForTimeout(250);
  await page.keyboard.press("Control+Shift+BracketRight");
  await page.waitForTimeout(500);
  const co1 = await paintOrder();
  ok("a text box can be brought to the front, and its RENDERED node moves",
    co1.indexOf(`callout:${C1}`) > co1.indexOf(`callout:${C2}`),
    `A ${co0.indexOf(`callout:${C1}`)}→${co1.indexOf(`callout:${C1}`)}, B ${co0.indexOf(`callout:${C2}`)}→${co1.indexOf(`callout:${C2}`)}`);

  // (c) The callout's CROSS-BAND move: send it behind the plan and prove it now paints before the
  //     elements. This is what "send behind the plan" means, and no state read can substitute.
  const cRows = await menuAt(cA.x, cA.y);
  const behindRow = (cRows || []).find((r) => /Send behind the plan/i.test(r.text));
  ok("the callout menu offers 'Send behind the plan'", !!behindRow);
  if (behindRow) {
    await page.mouse.click(cA.x, cA.y, { button: "right" });
    await page.waitForTimeout(350);
    await page.locator('.menu button', { hasText: "Send behind the plan" }).first().click();
    await page.waitForTimeout(600);
    const cb = await paintOrder();
    ok("sent behind the plan, the callout RENDERS before the site elements",
      cb.indexOf(`callout:${C1}`) >= 0 && cb.indexOf(`callout:${C1}`) < cb.indexOf(`el:${B1}`),
      `callout ${cb.indexOf(`callout:${C1}`)} vs building ${cb.indexOf(`el:${B1}`)}`);
  }

  // (d) THE SILENT NO-OP. The pond is alone in its type-layer band. Pre-fix the whole Arrange group
  //     was hidden, which on a real plan is what "doesn't work at all" looked like. It must now be
  //     PRESENT and greyed — an answer rather than an absence.
  const pd = await pointOn(`[data-el-id="${POND}"]`, 0.5, 0.5, `el:${POND}`);
  const pondRows = await menuAt(pd.x, pd.y);
  const arrangeRows = (pondRows || []).filter((r) => /Bring to Front|Bring Forward|Send Backward|Send to Back/i.test(r.text));
  ok("an element alone in its layer still SHOWS all four Arrange rows (greyed, not hidden)",
    arrangeRows.length === 4 && arrangeRows.every((r) => r.disabled),
    `${arrangeRows.length} rows, ${arrangeRows.filter((r) => r.disabled).length} greyed`);

  console.log("\n=== FINAL PAINT ORDER ===");
  console.log((await paintOrder()).join("\n"));
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass).length;
console.log(`\n${results.length - failed}/${results.length} pass`);
console.log(`declared types: ${ELEMENT_CAPABILITIES.length}`);
process.exit(failed ? 1 : 0);
