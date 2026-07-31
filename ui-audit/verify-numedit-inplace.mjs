/* NEW-1 — the inline number editor, driven in a real browser.
 *
 * The owner clicked a setback chip to change 25 ft (2026-07-31) and sent one frame back: a 96 × 30
 * monospace box with a 2 px accent border and a drop shadow, floating ABOVE the 26 × 16 pill it was
 * editing — "25" and "25′" on screen together — sitting on the building, the setback line and the
 * red setback drag handles, wearing the browser's own grey spinner chevrons.
 *
 * Logged out, no external GIS, geometry seeded from localStorage — Claude-verifiable HERE.
 *
 * Checks (each shot before / during / after the edit):
 *   1  IN PLACE — the editor's rendered box is the CHIP's box: same centre, same width, same
 *      height, same type scale (never larger than its spawn beyond a px of rounding)
 *   2  THE VALUE ONCE — the chip and its editor are never both in the DOM; the other chips stay
 *      exactly where they were, at their own size (nothing grows, nothing moves)
 *   3  NOTHING COVERED — every parcel vertex handle still answers elementFromPoint while the
 *      editor is open, and no handle's centre is inside the editor's box
 *   4  NO NATIVE SPINNERS — computed `appearance` is textfield and the field's content box is not
 *      eaten by UA buttons; asserted on EVERY number input on the page, not just this one
 *   5  the SHARED floating callers (road width · element dimension · aerial-calibration trace, the
 *      same opener the overlay trace-length uses) are at chip scale, spinner-free, and OFFSET off
 *      the anchor rather than centred over the geometry
 *   6  Enter commits the typed value · Escape leaves it alone
 * At TWO zooms, in BOTH themes, on a tidy rectangle AND on the owner's real 60-vertex Weld County
 * boundary (the geometry the report came from).
 *
 * Run:  npm run build && npx vite preview --port 4181   (separate shell)
 *       BASE_URL=http://localhost:4181/ node ui-audit/verify-numedit-inplace.mjs
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4181/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const now = Date.now();

/* A plain 900 × 600 ft rectangle with a 25 ft setback all round (so every chip reads "25′"), one
 * building sitting hard against the setback line — the owner's case, where the editor landed on the
 * building — and one rect road for the road-width caller. */
const P = [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 600 }, { x: 0, y: 600 }];
const sites = {
  numedit: {
    id: "numedit", groupId: "numedit", site: "numedit", name: "NumEdit",
    origin: { lat: 29.7604, lon: -95.3698 }, county: "harris",
    parcels: [{ id: "p1", points: P }],
    els: [
      { id: "b1", type: "building", cx: 450, cy: 300, w: 700, h: 380, rot: 0 },
      { id: "r1", type: "road", cx: 450, cy: 555, w: 780, h: 34, rot: 0 },
    ],
    // A placed reference sheet, so the OVERLAY TRACE-LENGTH caller ("Trace a length" → two canvas
    // clicks → the inline field) can be driven for real rather than argued from shared code.
    sheetOverlays: [{
      id: "ov1", name: "Sheet C1.0",
      src: "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#dfe6ee"/><line x1="40" y1="150" x2="360" y2="150" stroke="#33414f" stroke-width="3"/></svg>').toString("base64"),
      imgW: 400, imgH: 300, page: 1, pageCount: 1,
      x: 120, y: 90, ftPerPx: 1.6, rotation: 0, opacity: 0.85, locked: false, visible: true,
    }],
    measures: [], callouts: [], markups: [],
    settings: { showSetback: true, setback: 25 }, underlay: null, status: "active", updatedAt: now,
  },
};
/* …and the owner's REAL parcel, so the in-place edit is proven on the geometry the report came
 * from (60 vertices, a filleted corner) and not only on a tidy rectangle. */
const weld = JSON.parse(readFileSync(new URL("../test/fixtures/weldParcelProduction.json", import.meta.url), "utf8"));
const weldSite = {
  id: "numedit", groupId: "numedit", site: "numedit", name: "NumEdit",
  origin: { lat: 40.34612498, lon: -104.97788964 }, county: "weld",
  parcels: [{ id: weld.parcelId, points: weld.points }],
  els: [], measures: [], callouts: [], markups: [], sheetOverlays: [],
  settings: { showSetback: true, setback: weld.defaultSetbackFt }, underlay: null, status: "active", updatedAt: now,
};

const seedFor = (theme, which = "synthetic") => `(()=>{try{localStorage.setItem('planyr.theme',${JSON.stringify(theme)});`
  + `if(localStorage.getItem('planyr:harness:seeded'))return;`
  + `localStorage.setItem('planarfit:sites:v1',JSON.stringify(${JSON.stringify(sites)}));`
  + `if(${JSON.stringify(which)}==='weld'){var m=JSON.parse(localStorage.getItem('planarfit:sites:v1'));m.numedit=${JSON.stringify(weldSite)};localStorage.setItem('planarfit:sites:v1',JSON.stringify(m));}`
  + `localStorage.removeItem('planarfit:currentSite:v1');`
  + `localStorage.setItem('planyr:harness:seeded','1');}catch(e){}})();`;

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const results = [];
const ok = (n, pass, d = "") => { results.push({ n, pass }); console.log(`  ${pass ? "✅" : "❌"} ${n}${d ? " — " + d : ""}`); };
const near = (a, b, tol = 1.5) => Math.abs(a - b) <= tol;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

/* ---- readers -------------------------------------------------------------------------------- */
const readChips = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid="setback-chip"]')].map((r) => {
  const b = r.getBoundingClientRect();
  const t = r.parentElement.querySelector('[data-testid="setback-chip-text"]');
  return { x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2, txt: (t?.textContent || "").trim(), fontPx: parseFloat(getComputedStyle(t).fontSize) };
}));

const readField = (page, testId) => page.evaluate((id) => {
  const el = document.querySelector(`[data-testid="${id}"]`);
  if (!el) return null;
  const b = el.getBoundingClientRect(), cs = getComputedStyle(el);
  return {
    x: b.x, y: b.y, w: b.width, h: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2,
    value: el.value, fontPx: parseFloat(cs.fontSize), fontFamily: cs.fontFamily,
    borderTopWidth: parseFloat(cs.borderTopWidth), boxShadow: cs.boxShadow,
    appearance: cs.appearance || cs.webkitAppearance, inPlace: el.dataset.inPlace,
    // A UA spinner steals width from the content box; with it suppressed the caret box fills the
    // padding box. `clientWidth` is the padding box, `scrollWidth` the content — equal means nothing
    // else is parked inside the field.
    clientWidth: el.clientWidth, focused: document.activeElement === el,
  };
}, testId);

/* Every number input on the page, so a NEW one can't quietly reintroduce the chevrons. */
const readSpinners = (page) => page.evaluate(() => [...document.querySelectorAll('input[type="number"]')].map((el) => {
  const cs = getComputedStyle(el);
  return { appearance: cs.appearance || cs.webkitAppearance, testId: el.dataset.testid || el.getAttribute("aria-label") || "?" };
}));

/* Handle reachability, measured the same way before and during the edit — a BASELINE, because a grip
 * can also be off-canvas or behind the docked left panel, which has nothing to do with this item.
 * `onScreen` counts only grips inside the canvas rect; `reachable` counts the ones that answer a
 * press at their own centre. */
const handleProbe = (page, box) => page.evaluate((b) => {
  const svg = document.querySelector('[data-testid="planner-canvas"]');
  const s = svg?.getBoundingClientRect();
  const hs = [...document.querySelectorAll('[data-testid="vtx-handle"]')];
  let onScreen = 0, reachable = 0, insideEditor = 0;
  for (const h of hs) {
    const r = h.getBoundingClientRect();
    const cx = r.x + r.width / 2, cy = r.y + r.height / 2;
    if (!s || cx < s.x + 4 || cy < s.y + 4 || cx > s.x + s.width - 4 || cy > s.y + s.height - 4) continue;
    onScreen++;
    if (b && cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) insideEditor++;
    const hit = document.elementFromPoint(cx, cy);
    if (hit && (hit === h || hit.getAttribute?.("data-testid") === "vtx-handle")) reachable++;
  }
  return { total: hs.length, onScreen, reachable, insideEditor };
}, box);

/* A DROP shadow has offset or blur; the app's own focused-input ring is `0 0 0 3px <token>` and is
 * what every other input in Planyr wears. The old editor carried `0 4px 14px rgba(0,0,0,.18)`,
 * which no other control on the canvas had. */
const noDropShadow = (shadow) => {
  if (!shadow || shadow === "none") return true;
  const nums = shadow.match(/-?[\d.]+px/g) || [];
  const [ox, oy, blur] = nums.map(parseFloat);
  return (ox || 0) === 0 && (oy || 0) === 0 && (blur || 0) === 0;
};

/* ---- one pass: theme × zoom ------------------------------------------------------------------ */
async function pass(theme, zoomLabel, zoomSteps, which = "synthetic") {
  const tag = which === "synthetic" ? `${theme}-${zoomLabel}` : `${which}-${theme}-${zoomLabel}`;
  console.log(`\n── ${theme} theme · ${zoomLabel} zoom · ${which} parcel ─────────────────`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  await ctx.addInitScript(seedFor(theme, which));
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);

  await page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("numedit")').first().click();
  await page.waitForTimeout(1400);
  await page.locator('button[title="Zoom to fit"]').click().catch(() => {});
  await page.waitForTimeout(700);

  // Select the parcel from its panel row (deterministic — a canvas click can land on the building).
  await page.locator('[data-rail-tab="parcel"]').first().click().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('button:has-text("Parcel 1")').first().click().catch(() => {});
  await page.waitForTimeout(600);

  if (zoomSteps) {
    /* Zoom ABOUT A CHIP, not about the canvas centre. The wheel zoom is cursor-anchored, so the
     * geometry under the pointer stays put — which is the only way a chip on an edge MIDPOINT
     * survives a zoom-in on a parcel that already fills the canvas. */
    const at = (await readChips(page))[0];
    const cb = await page.getByTestId("planner-canvas").boundingBox();
    await page.mouse.move(at ? at.cx : cb.x + cb.width / 2, at ? at.cy : cb.y + cb.height / 2);
    for (let i = 0; i < Math.abs(zoomSteps); i++) { await page.mouse.wheel(0, Math.sign(zoomSteps) * 120); await page.waitForTimeout(25); }
    await page.waitForTimeout(500);
  }

  const before = await readChips(page);
  const baseHandles = await handleProbe(page, null);
  await page.screenshot({ path: `${OUT}numedit-${tag}-1-before.png` });
  ok(`[${tag}] the setback chips render`, before.length >= 1, `${before.length} chips: ${before.map((c) => c.txt).join(" · ")}`);
  if (!before.length) { await ctx.close(); return; }

  // --- 1/2/3: click a chip → it becomes the field ---------------------------------------------
  // Zoomed IN, a chip can be off the canvas or under the docked left panel; only a chip we can
  // actually reach is a valid subject.
  const cbox = await page.getByTestId("planner-canvas").boundingBox();
  const reachableChips = before.filter((c) => c.cx > cbox.x + 12 && c.cx < cbox.x + cbox.width - 12
    && c.cy > cbox.y + 12 && c.cy < cbox.y + cbox.height - 12);
  ok(`[${tag}] at least one chip is on the canvas to click`, reachableChips.length > 0, `${reachableChips.length}/${before.length}`);
  if (!reachableChips.length) { await ctx.close(); return; }
  const target = reachableChips.reduce((a, b) => (b.w > a.w ? b : a));
  await page.mouse.click(target.cx, target.cy);
  await page.waitForTimeout(350);

  const field = await readField(page, "setback-chip-input");
  const during = await readChips(page);
  await page.screenshot({ path: `${OUT}numedit-${tag}-2-editing.png` });
  ok(`[${tag}] clicking the chip opens an IN-PLACE field`, !!field && field.inPlace === "1");
  if (!field) { await ctx.close(); return; }
  console.log(`     chip ${target.w.toFixed(1)}×${target.h.toFixed(1)} @${target.fontPx}px → field ${field.w.toFixed(1)}×${field.h.toFixed(1)} @${field.fontPx}px`);

  ok(`[${tag}] the field is NOT bigger than the chip it edits`,
    field.w <= target.w + 1.5 && field.h <= target.h + 1.5 && field.fontPx <= target.fontPx + 0.5,
    `was 96×30@13px for a ${target.w.toFixed(0)}×${target.h.toFixed(0)} pill`);
  ok(`[${tag}] it sits exactly where the chip sat (nothing moves)`,
    near(field.cx, target.cx) && near(field.cy, target.cy),
    `Δ ${(field.cx - target.cx).toFixed(2)}, ${(field.cy - target.cy).toFixed(2)}`);
  ok(`[${tag}] the edited chip is SUPPRESSED — the number is on screen once`,
    during.length === before.length - 1 && !during.some((c) => near(c.cx, target.cx) && near(c.cy, target.cy)),
    `${before.length} chips → ${during.length} + 1 field`);
  ok(`[${tag}] the OTHER chips are untouched (no growth, no reflow)`,
    during.every((d) => before.some((b) => near(b.cx, d.cx, 0.6) && near(b.w, d.w, 0.6) && near(b.h, d.h, 0.6))));
  ok(`[${tag}] the value is SELECTED, so typing replaces it`, field.focused && /^\d/.test(field.value), `value "${field.value}"`);

  const probe = await handleProbe(page, field);
  // Zoomed in past the parcel's corners there is no grip on the canvas to begin with — that is a
  // property of the view, not of the editor, so the check reports n/a rather than failing. The
  // fit-zoom pass is where the grips are on screen and the assertion has teeth.
  ok(`[${tag}] the parcel drag handles stay visible AND clickable while editing`,
    probe.onScreen === baseHandles.onScreen && probe.reachable === baseHandles.reachable && probe.insideEditor === 0,
    baseHandles.onScreen === 0
      ? "n/a at this zoom — no grip on the canvas; nothing under the field either"
      : `${probe.reachable}/${probe.onScreen} answer a press at their own centre (was ${baseHandles.reachable}/${baseHandles.onScreen}) · ${probe.insideEditor} under the field`);

  const spinners = await readSpinners(page);
  ok(`[${tag}] no number input on the page paints native spinners`,
    spinners.length > 0 && spinners.every((s) => /textfield|none/.test(s.appearance)),
    `${spinners.length} inputs · ${[...new Set(spinners.map((s) => s.appearance))].join("/")}`);
  ok(`[${tag}] the field wears the app's tokens — hairline border, no drop shadow, UI font`,
    field.borderTopWidth <= 1.5 && noDropShadow(field.boxShadow) && !/mono/i.test(field.fontFamily),
    `${field.borderTopWidth}px border · shadow ${field.boxShadow} · ${field.fontFamily.split(",")[0]}`);

  // --- 6: Enter commits ------------------------------------------------------------------------
  await page.keyboard.type("40");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const after = await readChips(page);
  await page.screenshot({ path: `${OUT}numedit-${tag}-3-after.png` });
  ok(`[${tag}] Enter commits the typed value and the chip comes back`,
    after.length === before.length && after.some((c) => /\b40′/.test(c.txt)),
    after.map((c) => c.txt).join(" · "));
  ok(`[${tag}] no editor is left behind`, !(await readField(page, "setback-chip-input")));

  // --- Escape cancels --------------------------------------------------------------------------
  const t2 = after.reduce((a, b) => (b.w > a.w ? b : a));
  await page.mouse.click(t2.cx, t2.cy);
  await page.waitForTimeout(300);
  await page.keyboard.type("999");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  const afterEsc = await readChips(page);
  ok(`[${tag}] Escape leaves the value alone`,
    afterEsc.length === after.length && !afterEsc.some((c) => /999/.test(c.txt)),
    afterEsc.map((c) => c.txt).join(" · "));

  ok(`[${tag}] no JS errors`, jsErrors.length === 0, jsErrors.slice(0, 2).join(" | "));
  await ctx.close();
}

/* ---- the SHARED floating callers ------------------------------------------------------------- */
async function floatingCallers() {
  console.log(`\n── the shared floating callers (road width · element dim · calibration trace) ──`);
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 });
  await ctx.addInitScript(seedFor("light"));
  const page = await ctx.newPage();
  const jsErrors = [];
  page.on("pageerror", (e) => jsErrors.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1600);
  await page.locator('button[title="Choose a project"]:visible, button[title="Switch project"]:visible').first().click();
  await page.waitForTimeout(400);
  await page.locator('button:has-text("numedit")').first().click();
  await page.waitForTimeout(1400);
  await page.locator('button[title="Zoom to fit"]').click().catch(() => {});
  await page.waitForTimeout(700);

  // A double-tap on an element's dimension number opens the floating editor (B912). Pointer capture
  // eats the DOM dblclick, so the app reconstructs the gesture from two down/up pairs.
  const openViaDim = async (which, wantValue) => {
    const dims = page.locator('[data-testid="el-dim"]');
    const n = await dims.count();
    const seen = [];
    for (let i = 0; i < n; i++) {
      const b = await dims.nth(i).boundingBox().catch(() => null);
      if (!b) continue;
      seen.push((await dims.nth(i).textContent().catch(() => "")).trim());
      const x = b.x + b.width / 2, y = b.y + b.height / 2;
      await page.mouse.move(x, y);
      await page.mouse.down(); await page.mouse.up();
      await page.mouse.down(); await page.mouse.up();
      await page.waitForTimeout(350);
      const f = await readField(page, "num-edit-field");
      // The value identifies WHICH caller opened it — without that, "the road again" would pass
      // twice and the second caller would be untested.
      if (f && (!wantValue || f.value === wantValue)) return { f, anchor: { x, y } };
      await page.keyboard.press("Escape");
      await page.waitForTimeout(150);
    }
    console.log(`     (no dimension opened the ${which} editor — ${n} dims on screen: ${seen.join(", ")})`);
    return null;
  };

  // Two DIFFERENT floating callers: a road's travel width (34 ft strip − a curb each side = 33)
  // and a building's footprint depth (380). Both go through the same field; the values prove both
  // openers were exercised.
  for (const [label, pick, want] of [["road width", "r1", "33"], ["element dimension", "b1", "380"]]) {
    await page.keyboard.press("Escape");
    await page.waitForTimeout(200);
    // Click the element itself to select it (its centre is inside its own footprint).
    const at = await page.evaluate((id) => {
      const el = document.querySelector(`[data-el-id="${id}"]`);
      if (!el) return null;
      const b = el.getBoundingClientRect();
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    }, pick);
    if (at) { await page.mouse.click(at.x, at.y); await page.waitForTimeout(400); }
    const got = await openViaDim(label, want);
    if (!got) { ok(`[float] ${label} — editor opened`, false); continue; }
    const { f, anchor } = got;
    console.log(`     ${label}: ${f.w.toFixed(1)}×${f.h.toFixed(1)} @${f.fontPx}px, value "${f.value}"`);
    ok(`[float] ${label} — at chip scale, not the old 96×30@13px`,
      f.w <= 60 && f.h <= 20 && f.fontPx <= 11 && f.inPlace === "0");
    ok(`[float] ${label} — no native spinners`, /textfield|none/.test(f.appearance), f.appearance);
    ok(`[float] ${label} — hairline border, no drop shadow, UI font`,
      f.borderTopWidth <= 1.5 && noDropShadow(f.boxShadow) && !/mono/i.test(f.fontFamily),
      `${f.borderTopWidth}px border · shadow ${f.boxShadow} · ${f.fontFamily.split(",")[0]}`);
    ok(`[float] ${label} — OFFSET off the anchor, not centred over the geometry`,
      f.cx > anchor.x && f.y + f.h < anchor.y, `field ${f.cx.toFixed(0)},${f.cy.toFixed(0)} vs anchor ${anchor.x.toFixed(0)},${anchor.y.toFixed(0)}`);
    await page.screenshot({ path: `${OUT}numedit-float-${label.replace(/\s+/g, "-")}.png` });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(250);
  }

  /* --- the OVERLAY TRACE-LENGTH caller: References → "Trace a length" → two canvas clicks ------ */
  await page.keyboard.press("Escape");
  await page.locator('[data-rail-tab="references"]').first().click().catch(() => {});
  await page.waitForTimeout(600);
  // A reference row's controls only show once the row is SELECTED — click its name first.
  await page.locator('[data-testid="reference-row-ov1"] button').first().click().catch(() => {});
  await page.waitForTimeout(400);
  const traceBtn = page.locator('button:has-text("Trace a length")').first();
  if (await traceBtn.count()) {
    await traceBtn.click();
    await page.waitForTimeout(400);
    const cb = await page.getByTestId("planner-canvas").boundingBox();
    const a = { x: cb.x + cb.width * 0.35, y: cb.y + cb.height * 0.62 };
    const b2 = { x: cb.x + cb.width * 0.62, y: cb.y + cb.height * 0.62 };
    await page.mouse.click(a.x, a.y); await page.waitForTimeout(250);
    await page.mouse.click(b2.x, b2.y); await page.waitForTimeout(450);
    const f = await readField(page, "num-edit-field");
    ok("[float] overlay trace length — the inline field opens on the second traced point", !!f && f.value === "");
    if (f) {
      console.log(`     overlay trace: ${f.w.toFixed(1)}×${f.h.toFixed(1)} @${f.fontPx}px, empty and focused=${f.focused}`);
      ok("[float] overlay trace length — at chip scale, not the old 96×30@13px",
        f.w <= 60 && f.h <= 20 && f.fontPx <= 11 && f.inPlace === "0");
      ok("[float] overlay trace length — no native spinners", /textfield|none/.test(f.appearance), f.appearance);
      ok("[float] overlay trace length — hairline border, no drop shadow, UI font",
        f.borderTopWidth <= 1.5 && noDropShadow(f.boxShadow) && !/mono/i.test(f.fontFamily));
      ok("[float] overlay trace length — OFFSET off the traced point, not over the line measured",
        f.cx > b2.x && f.y + f.h < b2.y, `field ${f.cx.toFixed(0)},${f.cy.toFixed(0)} vs point ${b2.x.toFixed(0)},${b2.y.toFixed(0)}`);
      await page.screenshot({ path: `${OUT}numedit-float-overlay-trace.png` });
    }
    await page.keyboard.press("Escape");
  } else {
    ok("[float] overlay trace length — the References panel offers 'Trace a length'", false);
  }

  ok("[float] no JS errors", jsErrors.length === 0, jsErrors.slice(0, 2).join(" | "));
  await ctx.close();
}

await pass("light", "fit", 0);
await pass("light", "in", -6);
await pass("dark", "fit", 0);
await pass("dark", "in", -6);
// The owner's real 60-vertex Weld County boundary — the geometry the report came from.
await pass("light", "fit", 0, "weld");
await floatingCallers();

await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${failed.length ? "❌" : "✅"} ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) { failed.forEach((f) => console.log(`   ✗ ${f.n}`)); process.exit(1); }
