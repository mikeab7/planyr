#!/usr/bin/env node
/* verify-pdf-annotation-pins — NEW-1 / NEW-2 (2026-10-19): which objects the editable-markup PDF lifts out of the page.
 *
 *   npx vite build && npx vite preview --port 4173 &
 *   node ui-audit/verify-pdf-annotation-pins.mjs [--assert] [--out <dir>]                       (local, seeded plan)
 *   E2E_LOGIN_KEY=… node ui-audit/verify-pdf-annotation-pins.mjs https://planyr.io [--assert]   (signed in, throwaway plan)
 *
 * One plan: a building, a SECOND building with a corner bump-out at each end of its dock wall (NEW-1 of 2026-10-19:
 * a building and its bump-outs are ONE annotation), a reference drawing promoted ABOVE the plan, a default rectangle,
 * a rectangle sent BEHIND the plan (under the first building) and a length measurement, on a geolocated plan (so the
 * lifted-GIS front band exists, empty). Exported with "Flatten markups" OFF then ON through the real compose screen:
 *   · OFF → exactly four annotations: the default Square, the measurement's Line, one Polygon per building (/Subj Building);
 *           the behind-the-plan rectangle is NOT one of them (it is printed into the page);
 *   · ON  → zero annotations;
 *   · render parity (poppler) between the two within the markups' own ink weight;
 *   · KNOWN-GOOD ARM: the flattened page differs from a plan-with-nothing-on-it export (the comparison isn't vacuous);
 *   · pdf.js (a second library) reads the four back, unlocked, with appearances; the plain building's Polygon carries 4
 *     vertices, the bumped-out building's 8, its /Rect spans the bump-outs, and — with the annotations hidden — the
 *     page holds none of the building's fill where the bump-outs are (they left the page with their building).
 * Signed in, the throwaway plan is deleted afterwards and its absence verified (CLAUDE.md entry 15).
 */
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";
import { decodePng } from "./lib/pngDiff.mjs";
import { blurLinear } from "./lib/perceptualDiff.mjs";

const urlArg = process.argv.slice(2).find((a) => /^https?:/.test(a));
const LIVE = !!urlArg && !/127\.0\.0\.1|localhost/.test(urlArg);
const BASE = urlArg || process.env.PLANYR_BASE || "http://127.0.0.1:4173";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";
const ASSERT = process.argv.includes("--assert");
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/pdf-annotation-pins";
const DPI = Number(process.env.PDF_DPI || 110);
mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const check = (c, m) => { console.log(`${c ? "  ✓" : "  ✗"} ${m}`); c ? pass++ : fail++; };

const ID = "zz-pdfpins-" + Math.random().toString(36).slice(2, 8);
const PNG1 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const idOf = (kind) => (kind === "full" ? ID : ID + "b");
const ST = { stroke: "#16a34a", weight: 2, dash: "solid", fill: "#16a34a", fillOpacity: 0.25 };
function plan(kind) {
  const full = kind === "full";
  const id = idOf(kind);
  return {
    schemaVersion: 12, id, groupId: id, site: "zz PDF pins check", name: "Plan 1", updatedAt: Date.now(), status: "active", data: { status: "active" },
    origin: { lat: 29.86, lon: -95.17 }, county: "harris",
    parcels: [{ id: "pc1", active: true, locked: false, points: [{ x: 0, y: 0 }, { x: 2000, y: 0 }, { x: 2000, y: 900 }, { x: 0, y: 900 }] }],
    els: full ? [
      { id: "bld1", type: "building", cx: 600, cy: 450, w: 900, h: 500, rot: 0, z: 1, dock: "cross", dockAxis: "x", dockSide: "bottom" },
      // the bumped-out building: 500×300, dock wall at the bottom, the default 55′×60′ bump-out at each end (dogEarGeom boxes)
      { id: "bld2", type: "building", cx: 1600, cy: 400, w: 500, h: 300, rot: 0, z: 2, dock: "front", dockAxis: "x", dockSide: "bottom" },
      { id: "bumpL", type: "building", cx: 1377.5, cy: 580, w: 55, h: 60, rot: 0, z: 3, attachedTo: "bld2", noFit: true, noLabel: true, dock: "none", dogEar: { side: "bottom", sign: -1, along: 55, proj: 60 } },
      { id: "bumpR", type: "building", cx: 1822.5, cy: 580, w: 55, h: 60, rot: 0, z: 4, attachedTo: "bld2", noFit: true, noLabel: true, dock: "none", dogEar: { side: "bottom", sign: 1, along: 55, proj: 60 } },
    ] : [],
    sheetOverlays: full ? [{ id: "ref1", name: "Promoted reference", src: PNG1, x: 1070, y: 720, imgW: 100, imgH: 100, ftPerPx: 1.7, rotation: 0, opacity: 0.8, visible: true, locked: false, aboveParcel: true, page: 1 }] : [],
    markups: full ? [
      { id: "mkDefault", kind: "rect", cx: 350, cy: 450, w: 240, h: 140, rot: 0, ...ST, z: 900001, comment: "DEFAULT" },
      { id: "mkBehind", kind: "rect", cx: 850, cy: 450, w: 200, h: 140, rot: 0, ...ST, stroke: "#dc2626", fill: "#dc2626", behindEls: true, z: 900002, comment: "BEHIND" },
    ] : [],
    measures: full ? [{ id: "meLine", mode: "line", pts: [{ x: 500, y: 330 }, { x: 800, y: 330 }], z: 900003 }] : [],
    callouts: [], settings: { printBuildingsTable: false }, underlay: null,
  };
}

const HOOK = () => {
  window.__pdfs = [];
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => {
    try { if (b && b.type === "application/pdf") b.arrayBuffer().then((ab) => { let s = ""; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); window.__pdfs.push(btoa(s)); }); } catch (_) {}
    return real(b);
  };
  const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) return; return click.call(this); };
};
async function openCompose(page) {
  await page.getByRole("button", { name: "File ▾" }).click();
  await page.getByRole("button", { name: "Download PDF / pick frame…" }).click();
  await pacedWait(page, 600);
  await page.getByRole("button", { name: "Continue ➜" }).click();
  await pacedWait(page, 1500);
}
async function exportOnce(page, flatten) {
  await openCompose(page);
  const box = page.getByLabel("Flatten markups");
  if ((await box.isChecked()) !== flatten) await box.click();
  const before = await page.evaluate(() => window.__pdfs.length);
  await page.getByRole("button", { name: /Download PDF/ }).first().click();
  let pdfs = [];
  for (let i = 0; i < 200; i++) { pdfs = await page.evaluate(() => window.__pdfs); if (pdfs.length > before) break; await page.waitForTimeout(250); }
  if (pdfs.length <= before) throw new Error("no PDF was produced");
  await pacedWait(page, 800);
  return Buffer.from(pdfs[pdfs.length - 1], "base64");
}
const raster = (file, stem, extra = []) => { execFileSync("pdftoppm", ["-r", String(DPI), "-png", "-singlefile", ...extra, file, join(OUT, stem)]); return decodePng(readFileSync(join(OUT, `${stem}.png`))); };

async function openPlan(page, kind) {
  const rec = plan(kind);
  if (LIVE) {
    const err = await page.evaluate(async (site) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
      await window.pfSupabase.from("sites").delete().eq("id", site.id);
      let r = await window.pfSupabase.from("sites").insert(row);
      if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
      return r.error ? String(r.error.message) : null;
    }, rec);
    check(!err, `throwaway ${kind} plan written to the test account${err ? " — " + err : ""}`);
  } else {
    await page.evaluate((r) => { const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); all[r.id] = r; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all)); }, rec);
  }
  await page.goto(`${BASE}/#/project/${rec.id}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 60000 });
  await pacedWait(page, 2500);
  await page.evaluate(HOOK);
}

let session = null, browser = null;
async function newPage() {
  if (LIVE) {
    const { openSignedIn } = await import("./lib/signedInSession.mjs");
    session = await openSignedIn({ base: BASE });
    console.log("served build:", JSON.stringify(session.build));
    return session.page;
  }
  browser = await chromium.launch({ headless: true, executablePath: EXEC, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(() => { window.__PLANYR_E2E = true; });
  await ctx.route(/^https?:\/\//, (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  return page;
}

const page = await newPage();
await assertMeasurable(page, "verify-pdf-annotation-pins");
const errors = []; page.on("pageerror", (e) => errors.push(e.message));
page.on("dialog", (d) => { errors.push("alert: " + d.message()); d.dismiss().catch(() => {}); });
const out = {};
try {
  await openPlan(page, "full");
  const feats = await page.evaluate(() => [...document.querySelectorAll('[data-testid="planner-canvas"] [data-feature]')].map((n) => n.getAttribute("data-feature")));
  check(["el:bld1", "el:bld2", "el:bumpL", "el:bumpR", "reference:ref1", "markup:mkDefault", "markup:mkBehind", "measure:0"].every((k) => feats.includes(k)), "the plan renders both buildings, the two bump-outs (their own el: nodes), promoted reference, both rectangles and the measurement");
  const orderIdx = (k) => feats.indexOf(k);
  console.log("   paint order:", feats.filter((k) => /^(el|reference|markup|measure):/.test(k)).join(" < "));
  check(orderIdx("reference:ref1") > orderIdx("markup:mkDefault") && orderIdx("reference:ref1") < orderIdx("measure:0"), "KNOWN-GOOD ARM: the reference paints AFTER the default rectangle and BEFORE the measurement (the exact shape that pinned them under the old rule)");
  out.edit = await exportOnce(page, false); writeFileSync(join(OUT, "editable.pdf"), out.edit);
  out.flat = await exportOnce(page, true); writeFileSync(join(OUT, "flat.pdf"), out.flat);
  await openPlan(page, "blank");
  out.blank = await exportOnce(page, true); writeFileSync(join(OUT, "blank.pdf"), out.blank);
  check(errors.length === 0, `no JS crash or alert${errors.length ? " (" + errors.slice(0, 2).join("; ") + ")" : ""}`);
} finally {
  if (LIVE) {
    const gone = await page.evaluate(async (ids) => {
      try {
        const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); ids.forEach((id) => { delete all[id]; }); localStorage.setItem("planarfit:sites:v1", JSON.stringify(all));
        for (const id of ids) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); }
        const q = await window.pfSupabase.from("sites").select("id").in("id", ids);
        const left = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
        return { cloud: !(q.data && q.data.length), local: !ids.some((id) => left[id]) };
      } catch (e) { return { error: String(e) }; }
    }, [ID, ID + "b"]).catch((e) => ({ error: String(e) }));
    check(!!gone.cloud && !!gone.local, "throwaway plan deleted and verified gone " + JSON.stringify(gone));
    await session.close();
  } else await browser.close();
}

const L = (b) => b.toString("latin1");
const edit = L(out.edit), flat = L(out.flat);
const dicts = edit.match(/\/Type \/Annot [^\n]*/g) || [];
check(!/\/Annots/.test(flat), "toggle ON: zero annotations");
const sub = dicts.map((a) => /\/Subtype \/(\w+)/.exec(a)[1]).sort();
console.log("   toggle OFF subtypes:", JSON.stringify(sub));
check(dicts.length === 4 && sub.join() === "Line,Polygon,Polygon,Square", "toggle OFF: exactly four annotations — Square (default rectangle), Line (measurement), one Polygon per building (the bump-outs are NOT annotations of their own)");
check(/\(DEFAULT\)/.test(edit) && !/\(BEHIND\)/.test(edit), "the default rectangle is an annotation; the rectangle sent behind the plan is NOT");
check(/\/Subj \(Building\)/.test(edit), "the Polygon is the building (/Subj Building)");
check(dicts.every((a) => /\/F 4 /.test(a) && /\/AP << \/N \d+ 0 R >>/.test(a)), "every annotation is unlocked (/F 4) and has an /AP /N stream");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const an = await (await (await pdfjs.getDocument({ data: new Uint8Array(out.edit), verbosity: 0 }).promise).getPage(1)).getAnnotations();
const polys = an.filter((a) => a.annotationType === 7);
const vertsOf = (a) => { const v = a.vertices || []; return typeof v[0] === "number" ? Array.from({ length: v.length / 2 }, (_, i) => ({ x: v[2 * i], y: v[2 * i + 1] })) : v.map((p) => ({ x: p.x, y: p.y })); };
check(an.length === 4 && an.every((a) => (a.annotationFlags & 192) === 0 && a.hasAppearance), `pdf.js reads ${an.length} annotations back, unlocked, each with an appearance`);
const plain = polys.find((a) => vertsOf(a).length === 4), bumped = polys.find((a) => vertsOf(a).length === 8);
check(polys.length === 2 && !!plain && !!bumped, `pdf.js: two Building Polygons — one with 4 vertices, one with 8 (${polys.map((a) => vertsOf(a).length).join(", ")})`);
let bumpRegions = null;
if (bumped) {
  const v = vertsOf(bumped), xs = v.map((p) => p.x), ys = v.map((p) => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const ratio = (y1 - y0) / (x1 - x0); // (300 + 60) / 500 on the plan
  check(Math.abs(ratio - 360 / 500) < 0.01, `the 8-vertex Polygon's extent is the building PLUS its bump-outs (height/width ${ratio.toFixed(3)}, expected ${(360 / 500).toFixed(3)})`);
  const r = bumped.rect; // [x0, y0, x1, y1]
  check(r[0] <= x0 + 0.5 && r[1] <= y0 + 0.5 && r[2] >= x1 - 0.5 && r[3] >= y1 - 0.5, "its /Rect spans the bump-outs too");
  // the bump-out rectangles: the two tabs below the dock face (PDF y runs up: the face is the second-lowest y)
  const yFace = Math.min(...ys.filter((y) => y > y0 + 1));
  const innerXs = v.filter((p) => Math.abs(p.y - y0) < 0.5).map((p) => p.x).sort((a, b) => a - b); // x0, x0+55′, x1-55′, x1
  bumpRegions = innerXs.length === 4 ? [[x0, y0, innerXs[1], yFace], [innerXs[2], y0, x1, yFace]] : null;
  check(!!bumpRegions, `the Polygon's far edge carries the two bump-outs' four corners (${innerXs.length} found)`);
}
const A = raster(join(OUT, "flat.pdf"), "flat"), B = raster(join(OUT, "editable.pdf"), "editable"), C = raster(join(OUT, "blank.pdf"), "blank");
const meanAbs = (X, Y) => { let s = 0; for (let i = 0; i < X.length; i++) s += Math.abs(X[i] - Y[i]); return s / X.length; };
const bA = blurLinear(A, 2), bB = blurLinear(B, 2), bC = blurLinear(C, 2);
const vsBlank = meanAbs(bA, bC), vsEdit = meanAbs(bA, bB);
check(vsBlank > 0, `known-good arm: the flattened page differs from a plan with nothing on it (${vsBlank.toFixed(5)})`);
const ratio = vsEdit / vsBlank;
check(ratio <= 0.15, `render parity: editable vs flattened ink difference is ${(ratio * 100).toFixed(1)}% of the plan's own ink weight (bar 15%)`);
const pageOnly = raster(join(OUT, "editable.pdf"), "editable-page-only", ["-hide-annotations"]);
const bP = blurLinear(pageOnly, 2);
check(meanAbs(bP, bA) > 0, "the editable file's page content (annotations hidden) is NOT the full flattened picture — the lifted objects are really out of the page");
if (bumpRegions) {
  // NO bump-out ink left in the page. The fill colour is sampled from the FLATTENED page at each bump-out's centre
  // (so it is whatever the building really paints, over a live aerial or a white page); the check is then the share
  // of that colour inside the rectangle. Flattened and editable-with-annotations must read ~1, and the annotation-
  // hidden page must read ~0. (A baseline-diff against a blank plan is NOT used: with a live aerial the blank plan
  // frames the map differently, so the imagery differs and the diff reads imagery, not bump-out ink — measured live.)
  const pageHpt = (await (await pdfjs.getDocument({ data: new Uint8Array(out.edit), verbosity: 0 }).promise).getPage(1)).view[3];
  const k = DPI / 72, W = A.width, ch = A.channels;
  const at = (I, x, y) => { const i = (y * W + x) * ch; return [I.data[i], I.data[i + 1], I.data[i + 2]]; };
  const box = ([rx0, ry0, rx1, ry1]) => [Math.floor(rx0 * k) + 3, Math.floor((pageHpt - ry1) * k) + 3, Math.ceil(rx1 * k) - 3, Math.ceil((pageHpt - ry0) * k) - 3];
  const fillShare = (I, [x0, y0, x1, y1], ref) => { let hit = 0, n = 0; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { n++; const c = at(I, x, y); if (Math.abs(c[0] - ref[0]) < 14 && Math.abs(c[1] - ref[1]) < 14 && Math.abs(c[2] - ref[2]) < 14) hit++; } return n ? hit / n : 0; };
  const rects = bumpRegions.map(box);
  const refs = rects.map(([x0, y0, x1, y1]) => at(A, Math.round((x0 + x1) / 2), Math.round((y0 + y1) / 2)));
  const shareFlat = rects.map((r, i) => fillShare(A, r, refs[i])), shareEdit = rects.map((r, i) => fillShare(B, r, refs[i])), sharePage = rects.map((r, i) => fillShare(pageOnly, r, refs[i]));
  check(shareFlat.every((v) => v > 0.9), `known-good arm: the flattened page is the building's fill throughout both bump-outs (${shareFlat.map((v) => v.toFixed(2)).join(", ")})`);
  check(shareEdit.every((v) => v > 0.9), `with the annotations shown, both bump-outs read as the building's fill (${shareEdit.map((v) => v.toFixed(2)).join(", ")})`);
  check(sharePage.every((v) => v < 0.02), `no bump-out ink is left in the page with the annotations hidden (building-fill share ${sharePage.map((v) => v.toFixed(2)).join(", ")}; bar < 0.02)`);
}
console.log(`\n${pass} passed, ${fail} failed   (files in ${OUT})`);
process.exit(ASSERT && fail ? 1 : 0);
