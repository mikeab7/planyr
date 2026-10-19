#!/usr/bin/env node
/* verify-pdf-annotation-pins — NEW-1 / NEW-2 (2026-10-19): which objects the editable-markup PDF lifts out of the page.
 *
 *   npx vite build && npx vite preview --port 4173 &
 *   node ui-audit/verify-pdf-annotation-pins.mjs [--assert] [--out <dir>]                       (local, seeded plan)
 *   E2E_LOGIN_KEY=… node ui-audit/verify-pdf-annotation-pins.mjs https://planyr.io [--assert]   (signed in, throwaway plan)
 *
 * One plan: a building, a reference drawing promoted ABOVE the plan, a default rectangle, a rectangle sent BEHIND the
 * plan (under the building) and a length measurement, on a geolocated plan (so the lifted-GIS front band exists, empty).
 * Exported with "Flatten markups" OFF then ON through the real compose screen:
 *   · OFF → exactly three annotations: the default Square, the measurement's Line, the building's Polygon (/Subj Building);
 *           the behind-the-plan rectangle is NOT one of them (it is printed into the page);
 *   · ON  → zero annotations;
 *   · render parity (poppler) between the two within the markups' own ink weight;
 *   · KNOWN-GOOD ARM: the flattened page differs from a plan-with-nothing-on-it export (the comparison isn't vacuous);
 *   · pdf.js (a second library) reads the three back, unlocked, with appearances, the Polygon carrying 4 vertices.
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
    parcels: [{ id: "pc1", active: true, locked: false, points: [{ x: 0, y: 0 }, { x: 1200, y: 0 }, { x: 1200, y: 900 }, { x: 0, y: 900 }] }],
    els: full ? [{ id: "bld1", type: "building", cx: 600, cy: 450, w: 900, h: 500, rot: 0, z: 1, dock: "cross", dockAxis: "x", dockSide: "bottom" }] : [],
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
  check(["el:bld1", "reference:ref1", "markup:mkDefault", "markup:mkBehind", "measure:0"].every((k) => feats.includes(k)), "the plan renders its building, promoted reference, both rectangles and the measurement");
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
check(dicts.length === 3 && sub.join() === "Line,Polygon,Square", "toggle OFF: exactly three annotations — Square (default rectangle), Line (measurement), Polygon (building)");
check(/\(DEFAULT\)/.test(edit) && !/\(BEHIND\)/.test(edit), "the default rectangle is an annotation; the rectangle sent behind the plan is NOT");
check(/\/Subj \(Building\)/.test(edit), "the Polygon is the building (/Subj Building)");
check(dicts.every((a) => /\/F 4 /.test(a) && /\/AP << \/N \d+ 0 R >>/.test(a)), "every annotation is unlocked (/F 4) and has an /AP /N stream");
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const an = await (await (await pdfjs.getDocument({ data: new Uint8Array(out.edit), verbosity: 0 }).promise).getPage(1)).getAnnotations();
const poly = an.find((a) => a.annotationType === 7);
check(an.length === 3 && an.every((a) => (a.annotationFlags & 192) === 0 && a.hasAppearance), `pdf.js reads ${an.length} annotations back, unlocked, each with an appearance`);
check(poly && poly.vertices && poly.vertices.length / (typeof poly.vertices[0] === "number" ? 2 : 1) === 4, `pdf.js: the building Polygon has 4 vertices (${poly && poly.vertices ? poly.vertices.length : "none"} values)`);
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
console.log(`\n${pass} passed, ${fail} failed   (files in ${OUT})`);
process.exit(ASSERT && fail ? 1 : 0);
