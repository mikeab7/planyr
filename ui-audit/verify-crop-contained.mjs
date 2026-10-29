/* verify-crop-contained — B2448816 (owner 2026-10-29): zoomed in, the crop's drawing spilled out of its box and covered the
 * Rectangle | Polygon switch, Cancel / Done and the zoom toolbar, so none of them could be clicked.
 *
 *   THE INVARIANT: at ANY zoom or pan, in EITHER shape mode, nothing the crop draws EXISTS outside `crop-canvas` (its box
 *   never reaches past the canvas' — a clipped-but-oversized box still reads as a ghost to anything that reads boxes), and
 *   the header row / shape switch / Cancel / Done / floating toolbar always answer their own clicks.
 *
 *   THREE places the crop opens, all run here, wide AND narrow:
 *     site-tab        the Site tab Overlays panel → Crop (OverlayCropDialog)           — logged out, a throwaway local fixture
 *     map-edit        Map/Comps → Adjust site plan → Edit crop (post-placement)         — fake signed-in session, mocked Supabase
 *     map-preplace    Map/Comps → add a site plan → page step → Crop… (pre-placement)   — the same fake session
 *   (NEW-2: pre-placement used to be a small inline box — the same invariant is asserted there on the old build too, which is
 *    the red proof; after NEW-2 it opens in the same full-size window as the other two.)
 *
 *   KNOWN-GOOD ARMS (a run that cannot see the thing it guards is VOID, not green):
 *     · the toolbar answers its own click BEFORE zooming (so the elementFromPoint reading is trustworthy at all);
 *     · after zooming, the crop's own move surface must be reported by the page as bigger than the canvas on a build that
 *       draws it unclamped — i.e. the zoom really went deep (zoom ≥ 400%) — otherwise the run is VOID;
 *     · grip sweep: at least one sampled zoom step must have a grip within a few px of the canvas edge (else VOID).
 *
 *   FOREGROUND-OR-VOID: assertMeasurable first. No synthetic key dispatch; every press is a real mouse / keyboard event.
 *
 * Needs a build WITH dummy Supabase config (the map surfaces use a fake session — nothing leaves the process, no real
 * account or data is touched):
 *     VITE_SUPABASE_URL=https://bootauth.supabase.co VITE_SUPABASE_ANON_KEY=x npx vite build --outDir /tmp/dist-auth
 *     (cd /tmp/dist-auth && python3 -m http.server 4175 &)
 *     DIST=/tmp/dist-auth BASE_URL=http://localhost:4175/ node ui-audit/verify-crop-contained.mjs
 * SHOTS=<dir> writes the zoomed-in screenshots (SHOT_PREFIX names them);  ONLY=site-tab|map-edit|map-preplace narrows the run. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { AUTH_FIXTURE, authSessionSeed, cloudCacheSeed, detectSupabase, supabaseRouteHandler } from "./lib/authRemount.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openCropEditor } from "./lib/overlayCropPanel.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4175/";
const DIST = process.env.DIST || "/tmp/dist-auth";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1248/chrome-linux64/chrome";
const SHOTS = process.env.SHOTS || "";
const SHOT_PREFIX = process.env.SHOT_PREFIX || "crop";
const ONLY = process.env.ONLY || "";
if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let fail = 0, voided = 0;
const check = (name, ok, extra = "") => { console.log(`  ${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`); if (!ok) fail++; };
const voidRun = (why) => { console.log(`  ⛔ VOID — ${why}`); voided++; };
const section = async (name, fn) => { console.log(`\n— ${name}`); try { await fn(); } catch (e) { check(`${name}: ran to completion`, false, String(e.message || e).split("\n")[0].slice(0, 200)); } };

const sb = detectSupabase(DIST);
if (!sb) { console.log("✗ the build at " + DIST + " carries no Supabase config — build with VITE_SUPABASE_URL/KEY dummies"); process.exit(2); }

/* ---- a big, labelled sheet (a near-full-sheet crop is the default: an uncropped overlay opens on the full rectangle) -------- */
const W = 1275, H = 1650;
const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'><rect width='${W}' height='${H}' fill='#e8a83c'/><circle cx='${W / 2}' cy='${H / 2}' r='${W / 4}' fill='#2f6fb0'/><text x='40' y='120' font-size='90' fill='#222'>TOP-LEFT</text></svg>`;
const SKETCH = "data:image/svg+xml;utf8," + encodeURIComponent(svg);

/* ---- the in-page probe ------------------------------------------------------------------------------------------------ */
// Every control the user must always be able to press: its centre must answer to ITSELF.
const CONTROLS = ["crop-mode-rect", "crop-mode-poly", "crop-cancel", "crop-done", "crop-undo", "crop-redo", "crop-reset", "crop-pan-tool", "crop-zoom-out", "crop-zoom-100", "crop-zoom-in", "crop-zoom-fit"];

const readPage = (page) => page.evaluate((CONTROLS) => {
  const canvas = document.querySelector('[data-testid="crop-canvas"]');
  if (!canvas) return { error: "no crop-canvas" };
  const cr = canvas.getBoundingClientRect();
  const TOL = 1;
  // everything the crop DRAWS (the picture layer is the canvas' first child and is clipped by design; svg internals are not boxes)
  const imgLayer = canvas.firstElementChild;
  const drawn = [...canvas.querySelectorAll("div, svg, [data-testid]")].filter((e) => !imgLayer.contains(e) && e !== imgLayer);
  const outside = [];
  for (const e of drawn) {
    if (e.closest("mask, clipPath")) continue;
    if (e instanceof SVGElement && !(e.dataset && e.dataset.testid) && e.tagName !== "svg") continue;
    const r = e.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const slack = e instanceof SVGElement && e.tagName === "line" ? 9 : TOL; // a polygon edge's invisible hit strip is a 14 px stroke
    if (r.left < cr.left - slack || r.top < cr.top - slack || r.right > cr.right + slack || r.bottom > cr.bottom + slack) {
      outside.push({ id: e.dataset && e.dataset.testid || e.tagName.toLowerCase(), l: Math.round(r.left - cr.left), t: Math.round(r.top - cr.top), r: Math.round(r.right - cr.right), b: Math.round(r.bottom - cr.bottom) });
    }
  }
  const ctl = {};
  for (const id of CONTROLS) {
    const el = document.querySelector(`[data-testid="${id}"]`);
    if (!el) { ctl[id] = "absent"; continue; }
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    ctl[id] = hit && el.contains(hit) ? "ok" : "BLOCKED:" + (hit ? (hit.dataset.testid || hit.tagName.toLowerCase()) : "none");
  }
  // grips: each must lie wholly inside the canvas and answer its own centre
  const grips = [...canvas.querySelectorAll('[data-testid^="crop-handle-"]')].map((e) => {
    const r = e.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    const inset = Math.min(r.left - cr.left, r.top - cr.top, cr.right - r.right, cr.bottom - r.bottom);
    // The floating toolbar is meant to win a press over a grip it happens to sit on (the pill always answers its own clicks; only
    // the FRAMED view is promised clear of it) — so a grip under the pill is correct, a grip under anything else is a defect.
    const underPill = !!hit && !!hit.closest('[data-testid="crop-toolbar"]');
    return { id: e.dataset.testid, inside: inset >= -0.5, inset: Math.round(inset * 10) / 10, hitsSelf: (!!hit && e.contains(hit)) || underPill };
  });
  const move = canvas.querySelector('[data-testid="crop-move"]');
  const zoomTxt = (document.querySelector('[data-testid="crop-zoom-100"]') || {}).textContent || "";
  return { cr: { w: Math.round(cr.width), h: Math.round(cr.height) }, outside, ctl, grips, hasMove: !!move, zoom: parseInt(zoomTxt, 10) || 0,
    polyHint: !!document.querySelector('[data-testid="crop-poly-hint"]') };
}, CONTROLS);

const zoomIn = async (page, minPct) => {
  for (let i = 0; i < 40; i++) {
    const z = (await readPage(page)).zoom;
    if (z >= minPct) return z;
    await page.locator('[data-testid="crop-zoom-in"]').click();
    await page.waitForTimeout(40);
  }
  return (await readPage(page)).zoom;
};

const assertInvariant = (tag, st) => {
  if (st.error) { check(`${tag}: crop canvas present`, false, st.error); return; }
  const blocked = Object.entries(st.ctl).filter(([, v]) => String(v).startsWith("BLOCKED"));
  check(`${tag}: every control answers its own press (switch, Cancel, Done, toolbar)`, blocked.length === 0, blocked.map(([k, v]) => `${k}→${v}`).join(", "));
  check(`${tag}: nothing the crop draws reaches past the canvas`, st.outside.length === 0, JSON.stringify(st.outside.slice(0, 3)));
  const badGrips = st.grips.filter((g) => !g.inside || !g.hitsSelf);
  check(`${tag}: every grip shown is fully inside and grabbable`, badGrips.length === 0, JSON.stringify(badGrips.slice(0, 3)));
};

const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${SHOT_PREFIX}-${name}.png` }); };

/* One full pass over an OPEN crop editor: rect → zoom deep → invariant → real click on Polygon → draw a near-full polygon →
 * zoom deep → invariant → Fit → grip sweep → Cancel. `surface` names the screenshots. */
async function exercise(page, surface, size) {
  const tag = `${surface}@${size}`;
  await page.locator('[data-testid="crop-canvas"]').waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(500);
  const before = await readPage(page);
  // known-good arm 1: before any zoom, the toolbar answers its own click (so the elementFromPoint reading can be trusted)
  if (before.ctl["crop-zoom-in"] !== "ok") { voidRun(`${tag}: the toolbar does not answer BEFORE zooming (${before.ctl["crop-zoom-in"]}) — the instrument cannot be trusted here`); return false; }

  // ---- rectangle mode, near-full-sheet crop, zoomed deep
  const z = await zoomIn(page, 800);
  if (z < 400) { voidRun(`${tag}: could not reach a deep zoom (reached ${z}%)`); return false; }
  await page.waitForTimeout(250);
  const rect = await readPage(page);
  console.log(`  [${tag}] rect @ ${rect.zoom}% canvas ${rect.cr.w}×${rect.cr.h}`);
  assertInvariant(`${tag} rectangle`, rect);
  await shot(page, `${surface}-${size}-rect-zoomed`);

  // ---- the same deep zoom, but about the sheet's top-left corner: the crop's corner grip and two edges are on screen, the rest runs off
  await page.locator('[data-testid="crop-zoom-fit"]').click();
  await page.waitForTimeout(250);
  const ib = await page.locator('[data-testid="crop-canvas"] img').first().boundingBox();
  await page.mouse.move(ib.x + 6, ib.y + 6);
  for (let i = 0; i < 60 && (await readPage(page)).zoom < 600; i++) { await page.mouse.wheel(0, -60); await page.waitForTimeout(30); }
  await page.waitForTimeout(200);
  const corner = await readPage(page);
  console.log(`  [${tag}] rect corner @ ${corner.zoom}% — grips shown: ${corner.grips.map((g) => g.id.replace("crop-handle-", "")).join(",") || "none"}`);
  assertInvariant(`${tag} rectangle (zoomed on a corner)`, corner);
  await shot(page, `${surface}-${size}-rect-corner`);
  // a REAL drag on the grip that is on screen still resizes the crop (the grip rides the visible part of its edge now)
  const gl = page.locator('[data-testid="crop-handle-l"]');
  if (await gl.count()) {
    const b0 = await gl.boundingBox();
    const left0 = (await page.locator('[data-testid="crop-move"]').boundingBox()).x;
    await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
    await page.mouse.down(); await page.mouse.move(b0.x + b0.width / 2 + 70, b0.y + b0.height / 2, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
    const left1 = (await page.locator('[data-testid="crop-move"]').boundingBox()).x;
    check(`${tag}: dragging the visible left grip 70 px moves the crop's left edge with it`, Math.abs(left1 - left0 - 70) <= 3, `left ${Math.round(left0)} → ${Math.round(left1)}`);
    await page.locator('[data-testid="crop-undo"]').click();
  } else voidRun(`${tag}: no left grip on screen at the corner view to drag`);

  // ---- a REAL click on the Polygon switch must switch the mode
  await page.locator('[data-testid="crop-mode-poly"]').click({ timeout: 4000 }).catch(() => {});
  await page.waitForTimeout(300);
  const afterClick = await readPage(page);
  check(`${tag}: a real click on Polygon switches the mode`, afterClick.polyHint === true, "polygon hint " + (afterClick.polyHint ? "shown" : "NOT shown"));
  if (!afterClick.polyHint) {
    // the click was eaten: switch by keyboard-free means is not available, so the polygon half cannot run — report and go on
    await page.locator('[data-testid="crop-cancel"]').click({ timeout: 2000, force: true }).catch(() => {});
    return true;
  }

  // ---- polygon mode: Fit, draw a near-full-sheet polygon, close it, zoom deep
  await page.locator('[data-testid="crop-zoom-fit"]').click();
  await page.waitForTimeout(250);
  const box = await page.locator('[data-testid="crop-canvas"] img').first().boundingBox();
  for (const [fx, fy] of [[0.03, 0.03], [0.97, 0.03], [0.97, 0.97], [0.03, 0.97]]) {
    await page.mouse.click(box.x + fx * box.width, box.y + fy * box.height);
    await page.waitForTimeout(120);
  }
  await page.mouse.click(box.x + 0.03 * box.width, box.y + 0.03 * box.height); // close on the first point
  await page.waitForTimeout(250);
  const closed = await page.locator('[data-testid="crop-poly-vertex-0"]').count();
  if (closed !== 1) { voidRun(`${tag}: could not close the polygon (vertex-0 count ${closed})`); }
  await zoomIn(page, 800);
  await page.waitForTimeout(250);
  const poly = await readPage(page);
  console.log(`  [${tag}] poly @ ${poly.zoom}%`);
  assertInvariant(`${tag} polygon`, poly);
  await shot(page, `${surface}-${size}-poly-zoomed`);

  // ---- grip sweep in rectangle mode: zoom in smoothly from Fit about the middle; every grip shown stays whole + grabbable
  await page.locator('[data-testid="crop-mode-rect"]').click();
  await page.locator('[data-testid="crop-zoom-fit"]').click();
  await page.waitForTimeout(250);
  const cb = await page.locator('[data-testid="crop-canvas"]').boundingBox();
  await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
  let sweepBad = [], nearEdge = 0, samples = 0;
  for (let i = 0; i < 70; i++) {
    await page.mouse.wheel(0, -18);
    await page.waitForTimeout(25);
    const st = await readPage(page);
    samples++;
    for (const g of st.grips) { if (g.inset < 0.5) nearEdge++; if (!g.inside || !g.hitsSelf) sweepBad.push(`${g.id}@${st.zoom}%:inset ${g.inset}${g.hitsSelf ? "" : " blocked"}`); }
    const blocked = Object.entries(st.ctl).filter(([, v]) => String(v).startsWith("BLOCKED"));
    if (blocked.length) sweepBad.push(`controls@${st.zoom}%:${blocked.map(([k]) => k).join(",")}`);
    if (st.outside.length) sweepBad.push(`outside@${st.zoom}%:${st.outside[0].id}`);
  }
  check(`${tag}: through a ${samples}-step zoom sweep no grip is clipped or blocked, no control is covered, nothing leaves the canvas`, sweepBad.length === 0, sweepBad.slice(0, 3).join(" | "));
  if (nearEdge === 0) voidRun(`${tag}: the sweep never put a grip next to the canvas edge — the clamp was not exercised`);

  await page.locator('[data-testid="crop-cancel"]').click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(500);
  return true;
}

const SIZES = [["wide", 1600, 900], ["narrow", 1000, 700]];
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });

/* ===================================================== SURFACE 1 — the Site tab ===================================================== */
if (!ONLY || ONLY === "site-tab") await section("site-tab — Site tab Overlays panel → Crop", async () => {
  const id = "cropcontained-site";
  const site = {
    schemaVersion: 12, id, groupId: id, site: "Crop Contained Fixture", name: "Crop Contained Fixture", updatedAt: 1783000000000,
    teamId: null, ownerId: null, origin: { lat: 40.348437, lon: -104.981121 }, county: "Weld", status: "active",
    parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 700 }, { x: 0, y: 700 }], active: true, z: 0 }],
    sheetOverlays: [{ id: "ov1", name: "Fixture sheet.png", src: SKETCH, x: 100, y: 100, imgW: W, imgH: H, ftPerPx: 0.5, rotation: 0, opacity: 0.85, locked: false, visible: true }],
    underlay: null, parcelDrawings: [], settings: {}, els: [],
  };
  for (const [size, vw, vh] of SIZES) {
    const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
    await ctx.addInitScript(({ s, id }) => { try { window.__PLANYR_E2E = true; localStorage.setItem("planarfit:sites:v1", s); localStorage.setItem("planarfit:currentSite:v1", id); } catch (_) {} }, { s: JSON.stringify({ [id]: site }), id });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { console.log("  [pageerror]", String(e).slice(0, 160)); fail++; });
    await assertMeasurable(page, "verify-crop-contained");
    await page.goto(`${BASE}#/project/${id}/site`, { waitUntil: "load" });
    await page.locator('[data-testid="planner-canvas"]').first().waitFor({ state: "visible", timeout: 25000 });
    await page.waitForTimeout(900);
    await page.locator('[data-rail-tab="references"]').first().click();
    await page.waitForTimeout(600);
    const row = page.locator('[data-testid="reference-open-ov1"]');
    if ((await row.getAttribute("aria-expanded")) !== "true") await row.click();
    await page.waitForTimeout(400);
    await openCropEditor(page, "ov1");
    await exercise(page, "site-tab", size);
    await ctx.close();
  }
});

/* ===================================================== SURFACES 2 + 3 — Map / Comps ===================================================== */
const uid = AUTH_FIXTURE.uid;
let ov = { id: "ov1", user_id: uid, team_id: null, project_id: "P1", site_link_declined: false, review_id: "rev1", page: 1, doc_title: "Test Flyer", doc_date: null, source_file_name: "flyer.pdf",
  img_w: W, img_h: H, raster_key: `${uid}/site-plan-overlays/ov1.jpg`, thumb_data_url: null, center_lat: 29.78, center_lon: -95.82, ft_per_px: 0.5, rotation_deg: 0, crop: null,
  opacity: 0.85, visible: true, locked: false, version: 3, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
const compRow = { id: "c1", user_id: uid, team_id: null, project_id: "P1", comp_type: "lease", comp_date: "2026-01-05", title: "Test comp", notes: "", anchor_kind: "pin", lat: 29.78, lon: -95.82,
  county: "harris", lease_rate: 7.5, lease_rate_period: "annual", lease_rate_expense: "nnn", lease_size_sf: 20000, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), deleted_at: null, version: 1 };
const mapSite = { id: "P1", groupId: "P1", site: "Test Project", name: "Plan 1", origin: { lat: 29.78, lon: -95.82 }, county: "harris", role: "tracked", parcels: [], els: [], measures: [], callouts: [], markups: [],
  settings: {}, underlay: null, sheetOverlays: [], parcelDrawings: [], status: "active", updatedAt: Date.now() };

async function mapPage(vw, vh) {
  ov = { ...ov, crop: null, version: 3 };
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh } });
  await ctx.addInitScript(`(()=>{try{window.__PLANYR_E2E=true;if(!sessionStorage.getItem('seeded')){localStorage.setItem('planarfit:sites:v1',${JSON.stringify(JSON.stringify({ P1: mapSite }))});sessionStorage.setItem('seeded','1');}}catch(e){}})();`);
  await ctx.addInitScript(cloudCacheSeed());
  await ctx.addInitScript(authSessionSeed({ ref: sb.ref, url: sb.url }));
  const baseHandler = supabaseRouteHandler({ base: BASE, supabaseUrl: sb.url, liveSites: [mapSite] });
  const hdr = { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" };
  const ok = (route, body) => route.fulfill({ status: 200, contentType: "application/json", headers: hdr, body: JSON.stringify(body) });
  await ctx.route("**", (route) => {
    const req = route.request(), url = req.url(), m = req.method();
    if (url.startsWith(sb.url) && m !== "OPTIONS") {
      if (url.includes("/rest/v1/site_plan_overlays")) {
        if (m === "GET") return ok(route, [ov]);
        if (m === "PATCH" || m === "POST") {
          let body = {}; try { body = JSON.parse(req.postData() || "{}"); } catch (_) {}
          ov = { ...ov, ...body, version: Number.isFinite(body.version) ? body.version : (ov.version + 1) };
          return ok(route, /pgrst\.object/.test(req.headers().accept || "") ? ov : [ov]);
        }
      }
      if (url.includes("/rpc/commit_site_plan_overlay_placement") && m === "POST") return ok(route, { moved: 0, version: ov.version + 1 });
      if (url.includes("/rpc/site_plan_overlay_comp_points")) return ok(route, []);
      if (url.includes("/rest/v1/comps") && m === "GET") return ok(route, [compRow]);
      if (url.includes("/storage/v1/object/")) return route.fulfill({ status: 200, contentType: "image/svg+xml", headers: hdr, body: svg });
    }
    return baseHandler(route);
  });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => { console.log("  [pageerror]", String(e).slice(0, 160)); fail++; });
  await assertMeasurable(page, "verify-crop-contained");
  await page.goto(BASE + "#/site", { waitUntil: "load" });
  await page.waitForTimeout(4500);
  await page.locator("text=Records >> visible=true").first().click().catch(() => {});
  await page.waitForTimeout(700);
  await page.locator("text=Test comp >> visible=true").first().click();
  await page.waitForTimeout(800);
  return { ctx, page };
}

if (!ONLY || ONLY === "map-edit") await section("map-edit — Map/Comps → Adjust site plan → Edit crop (post-placement)", async () => {
  for (const [size, vw, vh] of SIZES) {
    const { ctx, page } = await mapPage(vw, vh);
    await page.locator("button:has-text('Zoom to') >> visible=true").first().click();
    await page.waitForTimeout(2500);
    if (process.env.DEBUG_SHOT) await page.screenshot({ path: process.env.DEBUG_SHOT });
    await page.locator("button[aria-label='More actions'] >> visible=true").last().click();
    await page.waitForTimeout(400);
    await page.locator("text=Adjust >> visible=true").first().click();
    await page.waitForTimeout(900);
    const panel = page.locator('[data-testid="site-plan-adjust-panel"]');
    if ((await panel.count()) !== 1) { voidRun(`map-edit@${size}: could not reach the Adjust panel`); await ctx.close(); continue; }
    await panel.locator("text=/Crop…|Edit crop/").first().click();
    await exercise(page, "map-edit", size);
    await ctx.close();
  }
});

// A real PNG, made in the page (a canvas) so the upload flow rasterises a real image file.
const makePng = async (page) => {
  const b64 = await page.evaluate(({ w, h }) => {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const g = c.getContext("2d"); g.fillStyle = "#e8a83c"; g.fillRect(0, 0, w, h); g.fillStyle = "#2f6fb0"; g.beginPath(); g.arc(w / 2, h / 2, w / 4, 0, 7); g.fill();
    g.fillStyle = "#222"; g.font = "80px sans-serif"; g.fillText("TOP-LEFT", 40, 110);
    return c.toDataURL("image/png").split(",")[1];
  }, { w: 1275, h: 1650 });
  return Buffer.from(b64, "base64");
};

if (!ONLY || ONLY === "map-preplace") await section("map-preplace — Map/Comps → add a site plan → Crop… (pre-placement)", async () => {
  for (const [size, vw, vh] of SIZES) {
    const { ctx, page } = await mapPage(vw, vh);
    await page.locator('[data-testid="comp-record-add-doc"] >> visible=true').first().click({ timeout: 6000 });
    await page.waitForTimeout(600);
    const png = await makePng(page);
    await page.locator('input[type="file"] >> visible=true').first().setInputFiles({ name: "flyer.png", mimeType: "image/png", buffer: png });
    const cropBtn = page.locator("button:has-text('Crop…') >> visible=true").first();
    await cropBtn.waitFor({ timeout: 15000 });
    await cropBtn.click();
    await exercise(page, "map-preplace", size);
    await ctx.close();
  }
});

/* NEW-2 flow: the pre-placement crop is the full-size window, and the placement step keeps its contract. */
if (!ONLY || ONLY === "map-preplace") await section("map-preplace flow — full-size window; Done applies, Cancel / Escape change nothing", async () => {
  const { ctx, page } = await mapPage(1600, 900);
  await page.locator('[data-testid="comp-record-add-doc"] >> visible=true').first().click({ timeout: 6000 });
  await page.waitForTimeout(600);
  await page.locator('input[type="file"] >> visible=true').first().setInputFiles({ name: "flyer.png", mimeType: "image/png", buffer: await makePng(page) });
  const cropBtn = page.locator('[data-testid="site-plan-flow-crop"]');
  await cropBtn.waitFor({ timeout: 15000 });
  check("before cropping the button reads 'Crop…'", /Crop…/.test(await cropBtn.textContent()));
  await cropBtn.click();
  const modal = page.locator('[data-testid="site-plan-precrop-modal"]');
  await modal.waitFor({ timeout: 5000 });
  const mb = await modal.locator('[role="dialog"]').boundingBox();
  check("it opens as the full-size window (same shell as Edit crop): ≥ 90% of the window both ways", mb.width >= 0.9 * 1600 && mb.height >= 0.9 * 900, `${Math.round(mb.width)}×${Math.round(mb.height)}`);
  check("the tool has the focus on open (Escape works with no first click)", await page.evaluate(() => !!document.activeElement && !!document.activeElement.closest("[data-crop-modal]")));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  check("Escape closes only the crop window — the placement step is still there, uncropped", (await modal.count()) === 0 && (await cropBtn.count()) === 1 && /Crop…/.test(await cropBtn.textContent()));
  // Cancel: no change
  await cropBtn.click(); await modal.waitFor();
  await page.locator('[data-testid="crop-cancel"]').click();
  await page.waitForTimeout(300);
  check("Cancel returns to the placement step with no crop applied", (await modal.count()) === 0 && /Crop…/.test(await cropBtn.textContent()));
  // Done: crop applied
  await cropBtn.click(); await modal.waitFor(); await page.waitForTimeout(400);
  const tl = await page.locator('[data-testid="crop-handle-tl"]').boundingBox();
  await page.mouse.move(tl.x + tl.width / 2, tl.y + tl.height / 2); await page.mouse.down();
  await page.mouse.move(tl.x + tl.width / 2 + 140, tl.y + tl.height / 2 + 120, { steps: 8 }); await page.mouse.up();
  await page.waitForTimeout(200);
  await page.locator('[data-testid="crop-done"]').click();
  await page.waitForTimeout(400);
  check("Done returns to the placement step with the crop applied ('Edit crop')", (await modal.count()) === 0 && /Edit crop/.test(await cropBtn.textContent()));
  await cropBtn.click(); await modal.waitFor(); await page.waitForTimeout(400);
  const move = await page.locator('[data-testid="crop-move"]').boundingBox();
  const canvas = await page.locator('[data-testid="crop-canvas"] img').first().boundingBox();
  check("re-opening shows the crop that was applied (the outline is smaller than the sheet)", move.width < canvas.width - 20, `${Math.round(move.width)} vs ${Math.round(canvas.width)}`);
  await page.locator('[data-testid="crop-cancel"]').click();
  await ctx.close();
});

await browser.close();
console.log(voided ? `\n⛔ ${voided} VOID condition(s) — the run proved nothing where it says VOID.` : "");
console.log(fail ? `\n✗ ${fail} check(s) failed` : "\n✓ all checks passed");
process.exit(fail || voided ? 1 : 0);
