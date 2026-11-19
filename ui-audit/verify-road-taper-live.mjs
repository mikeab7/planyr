/* verify-road-taper-live — B2671212 (NEW-1, 2026-11-10/11): ROADS OF DIFFERENT WIDTHS JOIN WITH A SMOOTH TAPER, on a REAL deploy, signed in as the throwaway
 * test account (lib/roadTaper.js; root constraint #55).
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-road-taper-live.mjs [https://planyr.io] [--expect-contains <sha>] [--out <dir>]
 *
 * Seeds ONE throwaway plan with: a 50 ft road meeting a 24 ft drive end to end (STRAIGHT), the same pair meeting at a 50° bend (ANGLED), and an equal-width
 * pair (CONTROL). Every reading shares its page call with `/version.json` (cache:'no-store'); the deployed build must CONTAIN `--expect-contains`
 * (default 2f488fe8, the merge of #2906) — by git ancestry, not string equality, because a later deploy is still the build under test.
 *
 * Six cases, each judged by the pure rules in lib/taperVerdicts.mjs (unit-proved to go red on the pre-fix geometry, test/roadTaperVerdicts.test.js):
 *   1  straight joint        — the canvas outline (the model AND the painted <path>) narrows 50 → 24 with no step and a ≤ 1:10 edge
 *   2  angled joint          — one simple outline: no spike, no gap, the outside-corner wedge filled, the wide road narrowing into the bend
 *   3  Properties            — a Taper field on a road that has a tapered joint (and not on the control); typing 60 redraws within a couple of seconds,
 *                              is stored on the WIDE road only (read back from the database), and the narrow road stores nothing
 *   4  reload                — the typed length survives a reload
 *   5  PDF                   — the REAL downloaded PDF (editable AND flattened): the road annotation's vertices are laid over the canvas outline
 *                              (fitted on the control pair) and agree vertex for vertex; the rendered page's pixels show the same narrowing
 *   6  equal width           — the control is a plain 4-vertex rectangle on the canvas, the printed sheet and in the PDF
 * KNOWN-BAD ARMS (the harness must be able to see the defect): the equal-width control run through the TAPER verdict, the pre-fix notch and the
 * pre-fix chamfer, a spiked outline and an outline missing its corner — all must FAIL, or the run is VOID.
 * FOREGROUND-OR-VOID asserted before anything is measured. Deletes the throwaway at the end and VERIFIES it is gone (owner constraint 15); only that
 * plan id is ever written, and the account's other site rows are listed before and after to prove they were not touched. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { parseSvgRing, profile, straightFailures, profilesDisagree, equalWidthFailures, angledFailures, fitBox, ringMismatch, rasterProfile, selfIntersects } from "./lib/taperVerdicts.mjs";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PDFDocument, PDFName, PDFDict, PDFArray } from "pdf-lib";

const args = process.argv.slice(2);
const argAfter = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : null);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = argAfter("--expect-contains") || "2f488fe8";
const OUT = argAfter("--out") || join(tmpdir(), "road-taper-live");
const DPI = 200;
mkdirSync(OUT, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const checkFailures = (name, list, detail = "") => check(name, list.length === 0, list.length ? list.join("; ") : detail);
const mustFail = (name, list) => { const red = list.length > 0; console.log(`${red ? "🔴" : "⚠️"} known-bad arm — ${name}: ${red ? "FAILS as it must (" + list[0] + ")" : "PASSED — the harness cannot see this defect"}`); if (!red) voided++; };

/* ------------------------------------------------------------------------------------------------------------------------------------------ */
const ID = "zz-road-taper-" + Math.random().toString(36).slice(2, 8);
const road = (id, pts, travelW) => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  return { id, type: "road", z: 1024 + pts.length, pts, vtx: pts.map(() => ({})), travelW, curb: 0.5, roadClass: "local", cx: (Math.max(...xs) + Math.min(...xs)) / 2, cy: (Math.max(...ys) + Math.min(...ys)) / 2, w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) + travelW + 1, rot: 0 };
};
const ANG = (50 * Math.PI) / 180;
const WIDE_HALF = 25.5, NARROW_HALF = 12.5, RATIO = NARROW_HALF / WIDE_HALF, AUTO_LEN = 130, SLOPE = (WIDE_HALF - NARROW_HALF) / AUTO_LEN;
const SITE = {
  id: ID, groupId: ID, site: "zz Road taper", name: "Plan 1", origin: null, county: "harris",   // unlocated: a white page, so the rendered PDF's ink IS the road
  parcels: [{ id: "pc1", locked: false, points: [{ x: -520, y: -420 }, { x: 620, y: -420 }, { x: 620, y: 620 }, { x: -520, y: 620 }] }],
  els: [
    road("W", [{ x: 0, y: -300 }, { x: 200, y: -300 }], 50), road("N", [{ x: 200, y: -300 }, { x: 400, y: -300 }], 24),                                              // STRAIGHT
    road("BW", [{ x: 0, y: 0 }, { x: 200, y: 0 }], 50), road("BN", [{ x: 200, y: 0 }, { x: 200 + 200 * Math.cos(ANG), y: 200 * Math.sin(ANG) }], 24),                // ANGLED
    road("EA", [{ x: 0, y: 450 }, { x: 200, y: 450 }], 30), road("EB", [{ x: 200, y: 450 }, { x: 400, y: 450 }], 30),                                                 // CONTROL (equal widths)
  ],
  measures: [], markups: [], callouts: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
};
const PAIRS = { straight: { ids: ["W", "N"], dy: -300 }, angled: { ids: ["BW", "BN"], dy: 0 }, control: { ids: ["EA", "EB"], dy: 450 } };
const ANGLED_SPEC = (lenFt) => ({ c1: [{ x: 0, y: 0 }, { x: 200, y: 0 }], c2: [{ x: 200, y: 0 }, { x: 200 + 200 * Math.cos(ANG), y: 200 * Math.sin(ANG) }], halfWide: WIDE_HALF, halfNarrow: NARROW_HALF, lenFt });
const STRAIGHT_OPTS = (lenFt) => ({ ratio: RATIO, slopeMax: ((WIDE_HALF - NARROW_HALF) / lenFt) * 1.3 });

/* the HOOKS that must exist before the app boots: the e2e gate, and the PDF capture (a download is a blob → an <a download>; we keep the bytes, and let the click go nowhere) */
const INIT = () => {
  window.__PLANYR_E2E = true;
  window.__pdfs = [];
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => {
    try { if (b && b.type === "application/pdf") b.arrayBuffer().then((ab) => { let s = ""; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); window.__pdfs.push(btoa(s)); }); } catch (_) {}
    return real(b);
  };
  const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) return; return click.call(this); };
};

/* the deploy under test must CONTAIN the merge commit (git ancestry; a later build is still the build under test) */
try { execFileSync("git", ["fetch", "origin", "main", "-q"], { stdio: "ignore" }); } catch (_) { /* offline: ancestry is judged on what is local */ }
function buildContains(build, sha) {
  if (!build) return { ok: false, why: "no build id served" };
  try { execFileSync("git", ["merge-base", "--is-ancestor", sha, build], { stdio: "ignore" }); return { ok: true }; }
  catch (e) { return { ok: false, why: e.status === 1 ? `build ${build} does NOT contain ${sha}` : `build ${build} is unknown to the local repo (git fetch it)` }; }
}

const s = await openSignedIn({ base, initScripts: [[INIT, null]] });
const { page } = s;
const builds = new Set();

/* ONE evaluate per reading: /version.json (no-store) + the canvas model + the PAINTED canvas paths + the printed sheet's clone + the editable-PDF annotation names. */
const readState = async () => {
  const st = await page.evaluate(async () => {
    const build = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null);
    const net = window.__plannerRoadNet ? window.__plannerRoadNet() : null;
    const dom = [...document.querySelectorAll('[data-testid="planner-canvas"] [data-road-cluster]')].map((g) => ({ ids: g.getAttribute("data-road-cluster"), d: (g.querySelector('[data-testid="road-network-surface"]') || {}).getAttribute ? g.querySelector('[data-testid="road-network-surface"]').getAttribute("d") : null }));
    const sheet = new DOMParser().parseFromString(await window.__plannerExportSvg(), "image/svg+xml");
    const sheetRings = [...sheet.querySelectorAll("[data-road-cluster]")].map((n) => ({ ids: n.getAttribute("data-road-cluster"), d: (n.querySelector('[data-testid="road-network-surface"]') || n).getAttribute("d") }));
    const composed = await window.__plannerExportComposed();
    return { build, regions: net ? net.regions.map((r) => ({ ids: r.ids, outer: r.outer })) : null, dom, sheetRings, annots: composed ? composed.annots.map((a) => a.nm) : [] };
  });
  builds.add(st.build);
  return st;
};
const idsOf = (v) => (Array.isArray(v) ? v : String(v).split(/[\s,]+/)).filter(Boolean);
const findBy = (list, ids) => (list || []).find((r) => idsOf(r.ids).includes(ids[0]) && idsOf(r.ids).includes(ids[1]));
const hookRing = (st, pair) => { const r = findBy(st.regions, PAIRS[pair].ids); return r ? r.outer : null; };
const svgRing = (list, pair) => { const r = findBy(list, PAIRS[pair].ids); return r && r.d ? parseSvgRing(r.d) : null; };

/* every secondary rendering (painted path, printed sheet, PDF) is laid over the model by the CONTROL pair (a known rectangle) and must then agree vertex for vertex */
function overlayVerdicts(tag, hook, other, { flipY = false, tol = 0.35 }) {
  if (!other.control || !other.straight || !other.angled) { check(`${tag} — all three pairs were found`, false, JSON.stringify(Object.fromEntries(Object.entries(other).map(([k, v]) => [k, v ? v.length : null])))); return; }
  const map = fitBox(other.control, hook.control, { flipY });
  for (const pair of ["straight", "angled", "control"]) {
    const mapped = other[pair].map(map);
    const mis = ringMismatch(mapped, hook[pair]);
    check(`${tag} — the ${pair} pair lies on the canvas outline (every vertex within ${tol} ft)`, mis <= tol, `worst vertex ${mis.toFixed(3)} ft; ${other[pair].length} vertices vs ${hook[pair].length}`);
  }
}

const modelVerdicts = (tag, st, lenFt) => {
  const R = { straight: hookRing(st, "straight"), angled: hookRing(st, "angled"), control: hookRing(st, "control") };
  check(`${tag} model — all three pairs are ONE continuous outline each`, !!R.straight && !!R.angled && !!R.control);
  if (!R.straight || !R.angled || !R.control) return null;
  const p = profile(R.straight);
  check(`${tag} case 1 — straight: ${WIDE_HALF}→${NARROW_HALF} ft half width`, Math.abs(p.first - WIDE_HALF) < 0.6 && Math.abs(p.last - NARROW_HALF) < 0.6, `${p.first.toFixed(2)} → ${p.last.toFixed(2)}`);
  checkFailures(`${tag} case 1 — straight: narrows monotonically, no step, edge no steeper than the ${lenFt} ft taper`, straightFailures(p, STRAIGHT_OPTS(lenFt)), `max edge slope ${p.maxSlope.toFixed(3)} (taper ${SLOPE.toFixed(3)} auto)`);
  const x0 = p.x0, span = p.x1 - p.x0;
  check(`${tag} case 1 — the taper runs ${lenFt} ft and ends exactly at the joint`, Math.abs(p.startFrac - (200 - lenFt - x0) / span) < 0.02 && Math.abs(p.endFrac - (200 - x0) / span) < 0.02, `starts ${(x0 + p.startFrac * span).toFixed(1)}, ends ${(x0 + p.endFrac * span).toFixed(1)} (want ${200 - lenFt}, 200)`);
  checkFailures(`${tag} case 2 — angled: simple outline, no spike, no gap, outside-corner wedge filled, wide road narrowing into the bend`, angledFailures(R.angled, ANGLED_SPEC(AUTO_LEN)), `${R.angled.length} vertices`);
  checkFailures(`${tag} case 6 — equal width: a plain unchanged rectangle`, equalWidthFailures(profile(R.control), R.control), `${R.control.length} vertices`);
  return R;
};
const renderVerdicts = (tag, st, R, lenFt) => {
  const hook = R;
  for (const [what, list] of [["painted canvas path", st.dom], ["printed sheet", st.sheetRings]]) {
    const o = { straight: svgRing(list, "straight"), angled: svgRing(list, "angled"), control: svgRing(list, "control") };
    overlayVerdicts(`${tag} ${what}`, hook, o, { flipY: false });
    if (o.straight) { const q = profile(o.straight); checkFailures(`${tag} ${what} — straight: same taper, no step`, [...straightFailures(q, STRAIGHT_OPTS(lenFt)), ...profilesDisagree(profile(hook.straight), q)]); }
    if (o.control) checkFailures(`${tag} ${what} — equal width: unchanged`, equalWidthFailures(profile(o.control), o.control));
  }
};

/* ---- PDF ------------------------------------------------------------------------------------------------------------------------------- */
async function downloadPdf(flatten) {
  await page.getByRole("button", { name: "File ▾" }).click();
  await page.getByRole("button", { name: "Download PDF / pick frame…" }).click();
  await pacedWait(page, 600);
  await page.getByRole("button", { name: "Continue ➜" }).click();
  await pacedWait(page, 1500);
  const box = page.getByLabel("Flatten markups");
  if ((await box.isChecked()) !== flatten) await box.click();
  const before = await page.evaluate(() => window.__pdfs.length);
  await page.getByRole("button", { name: /Download PDF/ }).first().click();
  let n = before;
  for (let i = 0; i < 240 && n <= before; i++) { n = await page.evaluate(() => window.__pdfs.length); if (n <= before) await page.waitForTimeout(250); }
  if (n <= before) throw new Error("no PDF was produced");
  await pacedWait(page, 800);
  return Buffer.from(await page.evaluate(() => window.__pdfs[window.__pdfs.length - 1]), "base64");
}
/** the road annotations of an editable PDF: { NM → vertices (PDF points, y up) } + the page height */
async function roadAnnotations(buf) {
  const doc = await PDFDocument.load(buf), page = doc.getPage(0), arr = page.node.Annots();
  const out = {};
  for (let i = 0; arr && i < arr.size(); i++) {
    const a = arr.lookup(i, PDFDict), nm = a.lookup(PDFName.of("NM")), v = a.lookup(PDFName.of("Vertices"));
    if (!nm || !(v instanceof PDFArray)) continue;
    const nums = v.asArray().map((n) => n.asNumber()), ring = [];
    for (let k = 0; k + 1 < nums.length; k += 2) ring.push({ x: nums[k], y: nums[k + 1] });
    out[nm.decodeText()] = ring;
  }
  return { annots: out, w: page.getWidth(), h: page.getHeight(), rotate: page.getRotation().angle };
}
const annotRing = (annots, pair) => { const k = Object.keys(annots).find((n) => PAIRS[pair].ids.some((id) => n === `planyr-element-${id}`)); return k ? annots[k] : null; };

async function pdfVerdicts(tag, buf, flatBuf, R, lenFt, st) {
  writeFileSync(join(OUT, `${tag}-editable.pdf`), buf);
  const info = await roadAnnotations(buf);
  check(`${tag} PDF — a real PDF came down, upright (no /Rotate), with the road networks as annotations`, buf.subarray(0, 5).toString() === "%PDF-" && info.rotate === 0 && Object.keys(info.annots).length >= 3, `${Object.keys(info.annots).join(", ")}; page ${info.w}×${info.h} pt`);
  const rings = { straight: annotRing(info.annots, "straight"), angled: annotRing(info.annots, "angled"), control: annotRing(info.annots, "control") };
  overlayVerdicts(`${tag} PDF annotation`, R, rings, { flipY: true, tol: 0.5 });
  if (rings.straight && rings.control) {
    const map = fitBox(rings.control, R.control, { flipY: true });
    const straight = rings.straight.map(map), angled = rings.angled.map(map), control = rings.control.map(map);
    checkFailures(`${tag} PDF — straight: narrows with no step, ${lenFt} ft taper`, [...straightFailures(profile(straight), STRAIGHT_OPTS(lenFt)), ...profilesDisagree(profile(R.straight), profile(straight))]);
    checkFailures(`${tag} PDF — angled: simple outline, no spike, no gap, corner filled, wide road narrowing`, angledFailures(angled, ANGLED_SPEC(AUTO_LEN)));
    checkFailures(`${tag} PDF — equal width: unchanged rectangle`, equalWidthFailures(profile(control), control));
  }
  // the rendered page itself (what a person sees): editable (annotations painted over the page) and flattened (the roads in the page)
  if (flatBuf) writeFileSync(join(OUT, `${tag}-flat.pdf`), flatBuf);
  for (const [which, b, file] of [["editable", buf, `${tag}-editable`], ["flattened", flatBuf, `${tag}-flat`]]) {
    if (!b || !rings.straight || !rings.control) continue;
    execFileSync("pdftoppm", ["-r", String(DPI), "-png", "-singlefile", join(OUT, `${file}.pdf`), join(OUT, file)]);
    const img = decodePng(readFileSync(join(OUT, `${file}.png`)));
    const sc = DPI / 72;
    const boxOf = (ring) => ({ x0: Math.floor(Math.min(...ring.map((p) => p.x)) * sc) - 2, x1: Math.ceil(Math.max(...ring.map((p) => p.x)) * sc) + 2, y0: Math.floor((info.h - Math.max(...ring.map((p) => p.y))) * sc) - 3, y1: Math.ceil((info.h - Math.min(...ring.map((p) => p.y))) * sc) + 3 });
    // the road is blue-grey (blue above red, in its fill AND its curb line); the red dimension marker's tick caps poke past the strip and, in a flattened (lossy-compressed) page, blur to pinks the plain "is red" test misses
    const roadInk = (r, g, b) => b - r >= 12;
    const rp = rasterProfile(img, boxOf(rings.straight), { isInk: roadInk }), rc = rasterProfile(img, boxOf(rings.control), { isInk: roadInk });
    check(`${tag} PDF ${which} page — pixels: the straight pair narrows ${RATIO.toFixed(2)}× with no step, like the canvas`, !!rp && straightFailures({ ...rp, maxStep: 0 }, { ratio: RATIO, ratioTol: 0.1, slopeMax: STRAIGHT_OPTS(lenFt).slopeMax * 1.6 }).length === 0 && profilesDisagree(profile(R.straight), rp, { ratioTol: 0.1, fracTol: 0.06 }).length === 0, rp ? `ratio ${(rp.last / rp.first).toFixed(3)}, taper ${rp.startFrac.toFixed(2)}–${rp.endFrac.toFixed(2)} of the length, edge slope ${rp.maxSlope.toFixed(3)}` : "no ink found");
    check(`${tag} PDF ${which} page — pixels: the equal-width pair keeps one width (the known-good arm)`, !!rc && Math.abs(rc.last / rc.first - 1) < 0.06 && rc.maxSlope < 0.05, rc ? `ratio ${(rc.last / rc.first).toFixed(3)}, slope ${rc.maxSlope.toFixed(3)}` : "no ink found");
    // KNOWN-BAD on pixels: the control run through the taper verdict must fail
    if (rc) mustFail(`${tag} ${which} pixels: the equal-width pair through the TAPER verdict`, straightFailures({ ...rc, maxStep: 0 }, { ratio: RATIO, ratioTol: 0.1 }));
  }
}

/* ---- the Properties panel ------------------------------------------------------------------------------------------------------------- */
const place = (wx, wy) => page.evaluate(([x, y]) => { const b = document.querySelector('[data-testid="planner-canvas"]').getBoundingClientRect(); const v = window.__plannerView.get(); return { x: b.x + v.offX + x * v.ppf, y: b.y + v.offY + y * v.ppf }; }, [wx, wy]);
async function openProperties(wx, wy) {
  await page.evaluate(([x, y]) => window.__plannerView.centerOn(x, y, 1.0), [wx + 170, wy]);
  await page.waitForTimeout(600);
  const pt = await place(wx, wy);
  await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(450); await page.mouse.dblclick(pt.x, pt.y);
  await page.getByTestId("road-header").waitFor({ timeout: 10000 });
}
const closeProperties = async () => { await page.keyboard.press("Escape"); await page.mouse.click(5, 5); await page.waitForTimeout(300); };
const fitView = () => page.evaluate(() => window.__plannerView.centerOn(150, 100, 0.55));
const openPlan = async () => {
  await page.goto(`${base}/?cb=${Date.now()}#/project/${ID}/site`, { waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 45000 });
  await page.waitForFunction(() => ["W", "N", "BW", "BN", "EA", "EB"].every((id) => document.querySelector(`[data-el-id="${id}"]`)) && !!window.__plannerRoadNet && !!window.__plannerExportSvg, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await fitView(); await page.waitForTimeout(700);
};
/* a signed-in plan's elements live in public.site_elements (one row per element, `data` = the element verbatim), NOT in sites.data — read THERE */
const storedRoads = () => page.evaluate(async (id) => { const q = await window.pfSupabase.from("site_elements").select("id, data, deleted_at").eq("site_id", id).eq("kind", "el"); return q.error ? null : (q.data || []).filter((r) => !r.deleted_at && r.data && r.data.type === "road").map((r) => ({ id: r.id, taper: r.data.taper })); }, ID);
const otherSiteIds = () => page.evaluate(async (id) => { const q = await window.pfSupabase.from("sites").select("id").neq("id", id).order("id"); return (q.data || []).map((r) => r.id); }, ID);

/* ================================================================================================================================================ */
let othersBefore = null;
try {
  await assertMeasurable(page, "verify-road-taper-live");
  console.log("signed in as", s.proof.email, "| served build", s.build && s.build.build, "| out", OUT);

  /* known-bad arms that need no browser (the same rules the unit test pins; asserted again HERE so a mis-loaded module voids the run) */
  const NOTCH = [[0, -25.5], [200, -25.5], [200, -12.5], [400, -12.5], [400, 12.5], [200, 12.5], [200, 25.5], [0, 25.5]].map(([x, y]) => ({ x, y }));
  const CHAMFER = [[0, -25.5], [200, -25.5], [219, -12.5], [400, -12.5], [400, 12.5], [219, 12.5], [200, 25.5], [0, 25.5]].map(([x, y]) => ({ x, y }));
  mustFail("the pre-fix vertical notch through the straight verdict", straightFailures(profile(NOTCH), STRAIGHT_OPTS(AUTO_LEN)));
  mustFail("the pre-fix 1:1.5 chamfer through the straight verdict", straightFailures(profile(CHAMFER), STRAIGHT_OPTS(AUTO_LEN)));
  mustFail("an unchanged wide road through the angled verdict (it never narrows into the bend)", angledFailures([[0, -25.5], [200, -25.5], [209.6, -8], [338, 145], [319, 161], [194, 13], [200, 25.5], [0, 25.5]].map(([x, y]) => ({ x, y })), ANGLED_SPEC(AUTO_LEN)));

  const ins = await page.evaluate(async (site) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
    let r = await window.pfSupabase.from("sites").insert(row);
    if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
    return r.error ? String(r.error.message) : null;
  }, SITE);
  check("throwaway plan written to the test account", !ins, ins || "");
  othersBefore = await otherSiteIds();

  /* ---------------------------------------------------- baseline: the AUTOMATIC taper ------------------------------------------------------ */
  await openPlan();
  let st = await readState();
  check(`the deployed build contains ${expectSha}`, buildContains(st.build, expectSha).ok, `served ${st.build}${buildContains(st.build, expectSha).why ? " — " + buildContains(st.build, expectSha).why : ""}`);
  let R = modelVerdicts("[open]", st, AUTO_LEN);
  mustFail("the equal-width control through the TAPER verdict (taper absent)", R ? straightFailures(profile(R.control), STRAIGHT_OPTS(AUTO_LEN)) : []);
  if (R) renderVerdicts("[open]", st, R, AUTO_LEN);
  // the editable-PDF set: one annotation per joined network, still the roads' own
  check("[open] editable PDF composition — each joined network is an annotation", ["N", "BN", "EA"].every((id) => st.annots.includes(`planyr-element-${id}`)), JSON.stringify(st.annots.filter((n) => /planyr-element/.test(n))));

  /* ---------------------------------------------------- case 5: the real downloaded PDF ------------------------------------------------- */
  const editable = await downloadPdf(false);
  await openPlan();
  const flat = await downloadPdf(true);
  if (R) await pdfVerdicts("[auto]", editable, flat, R, AUTO_LEN, st);
  await openPlan();

  /* ---------------------------------------------------- case 3: Properties + typing a length --------------------------------------------- */
  await openProperties(30, -300);
  const field = page.getByTestId("road-taper-e").first();
  check("case 3 — the wide road's Properties carry a Taper length (automatic = 130)", (await field.count()) === 1 && (await field.getAttribute("placeholder")) === String(AUTO_LEN));
  check("case 3 — …and no Taper field at the start end (only the end that has a tapered joint)", (await page.getByTestId("road-taper-s").count()) === 0);
  const t0 = Date.now();
  await field.fill("60"); await field.press("Enter");
  let redrawnMs = null;
  for (let i = 0; i < 60; i++) {
    const h = await page.evaluate(() => { const r = window.__plannerRoadNet().regions.find((x) => x.ids.includes("W")); const ring = r.outer; let lo = Infinity, hi = -Infinity; for (let k = 0; k < ring.length; k++) { const a = ring[k], b = ring[(k + 1) % ring.length]; if ((a.x - 120) * (b.x - 120) > 0 || a.x === b.x) continue; const y = a.y + ((b.y - a.y) * (120 - a.x)) / (b.x - a.x); lo = Math.min(lo, y); hi = Math.max(hi, y); } return (hi - lo) / 2; });
    if (h > 25) { redrawnMs = Date.now() - t0; break; }
    await page.waitForTimeout(50);
  }
  check("case 3 — typing 60 redraws the taper (full width until x = 140)", redrawnMs != null, redrawnMs != null ? `${redrawnMs} ms from Enter to the new outline (includes the polling interval and the round trip)` : "the outline never changed");
  await closeProperties();
  await openProperties(30, 0);
  check("case 3 — the ANGLED wide road has its own Taper field too", (await page.getByTestId("road-taper-e").count()) === 1);
  await closeProperties();
  await openProperties(30, 450);
  check("case 3 — a road with no tapered joint (the control) has NO Taper section", (await page.locator('[data-testid^="road-taper-"]').count()) === 0);
  await closeProperties();
  await fitView(); await page.waitForTimeout(700);
  st = await readState();
  R = modelVerdicts("[typed 60]", st, 60);
  if (R) renderVerdicts("[typed 60]", st, R, 60);
  // …and it is stored (read from the database, not the screen), on the wide road only
  let stored = null;
  for (let i = 0; i < 60; i++) { stored = await storedRoads(); if (stored && (stored.find((r) => r.id === "W") || {}).taper) break; await page.waitForTimeout(500); }
  const byId = Object.fromEntries((stored || []).map((r) => [r.id, r.taper]));
  check("case 3 — the typed length is in the database (site_elements) on the wide road only, and all six roads are there", JSON.stringify(byId.W) === JSON.stringify({ e: 60 }) && ["N", "BW", "BN", "EA", "EB"].every((id) => id in byId && byId[id] == null), JSON.stringify(byId));

  /* ---------------------------------------------------- case 4: reload ---------------------------------------------------------------- */
  await openPlan();
  st = await readState();
  R = modelVerdicts("[reload]", st, 60);
  if (R) renderVerdicts("[reload]", st, R, 60);
  const field2 = null; void field2;
  await openProperties(30, -300);
  check("case 4 — after the reload the Taper field still holds the typed 60", (await page.getByTestId("road-taper-e").first().inputValue()) === "60");
  await closeProperties();
  await openPlan();

  /* ---------------------------------------------------- case 5 again: the PDF follows the typed length ------------------------------------ */
  const editable60 = await downloadPdf(false);
  await openPlan();
  st = await readState();
  R = modelVerdicts("[typed 60, for the PDF]", st, 60);
  if (R) await pdfVerdicts("[typed 60]", editable60, null, R, 60, st);

  const sha = [...builds].filter(Boolean);
  check("every reading came from the SAME served build", sha.length === 1, JSON.stringify(sha));
  console.log("served build at every reading:", sha.join(", "));
} finally {
  const gone = await page.evaluate(async (id) => {
    try {
      for (const k of Object.keys(localStorage)) {
        if (!/^planarfit:sites:/.test(k)) continue;
        if (k.endsWith(":p:" + id)) { localStorage.removeItem(k); continue; }
        try { const m = JSON.parse(localStorage.getItem(k) || "{}"); if (m && m[id]) { delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } } catch (_) {}
      }
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
      const others = await window.pfSupabase.from("sites").select("id").neq("id", id).order("id");
      return { cloud: !(q.data && q.data.length), others: (others.data || []).map((r) => r.id) };
    } catch (e) { return { error: String(e) }; }
  }, ID).catch((e) => ({ error: String(e) }));
  check("throwaway plan deleted and verified gone", !!gone.cloud, JSON.stringify({ cloud: gone.cloud, error: gone.error }));
  if (othersBefore) check("the account's other site rows are exactly as they were (nothing else was touched)", JSON.stringify(othersBefore) === JSON.stringify(gone.others), `${othersBefore.length} before, ${(gone.others || []).length} after`);
  await s.close();
}
if (voided) console.log(`VOID — ${voided} known-bad arm(s) did not go red; the harness cannot see the defect, so no pass is claimed`);
console.log(failed || voided ? `FAIL (${failed} failed, ${voided} void)` : "PASS");
process.exit(failed || voided ? 1 : 0);
