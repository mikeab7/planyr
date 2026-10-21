/* verify-overlay-dial-crop-live — NEW-1 (rotation dial) + NEW-2 (crop switch) on the Site tab OVERLAYS panel, driven as the
 * signed-in test account on a real deploy (owner decision 2026-10-04: a session's own live signed-in check counts).
 *
 * Seeds a THROWAWAY plan through the app's own local-cache path (never one of Michael's plans; constraint 7/15 — it is
 * ALWAYS deleted and confirmed gone), opens Overlays → the fixture sheet and checks on the REAL canvas, for an unlocked AND a
 * locked overlay:
 *   1. the dial: a real pointer drag turns the overlay live (canvas + number box agree), Shift snaps to 15°, the whole drag is
 *      ONE Ctrl+Z; ▲/▼ ±1°, typing sets an exact value (Esc reverts), both "Turn 90°" buttons, arrow keys on the dial
 *   2. the crop switch: off = heading only; ON with no shape opens the editor, cancelling leaves it off; draw a polygon →
 *      switch off (whole sheet — no clip on canvas OR in the export sheet; shape kept) → on (the SAME polygon back)
 * KNOWN-GOOD ARM: the run is VOID (exit 2) unless the untouched panel shows rotation 0, the switch off and no clip — an instrument
 * that cannot see the starting state cannot vouch for the changes.
 * The served build is read from /version.json IN THE SAME CALL as the assertions (CLAUDE.md: a live measurement is only valid if
 * the deployed chunk hash is read alongside it).
 *
 * Usage:  BASE_URL=https://planyr.io E2E_LOGIN_KEY=… node ui-audit/verify-overlay-dial-crop-live.mjs
 *         BASE_URL=http://localhost:4173 node ui-audit/verify-overlay-dial-crop-live.mjs --local     (signed out, a preview — to debug the harness) */
import { chromium } from "@playwright/test";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const LOCAL = process.argv.includes("--local");
const BASE = (process.env.BASE_URL || (LOCAL ? "http://localhost:4173" : "https://planyr.io")).replace(/\/$/, "");
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "zz-dc-" + Math.random().toString(36).slice(2, 7);
const W = 1000, H = 700;
const SKETCH = "data:image/svg+xml;utf8," + encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='${W}' height='${H}'><rect width='${W}' height='${H}' fill='#f4efe2'/><rect x='30' y='30' width='940' height='640' fill='none' stroke='#333' stroke-width='6'/><rect x='130' y='110' width='520' height='260' fill='#9fb8d4'/><circle cx='300' cy='520' r='90' fill='#d9b38c'/></svg>`);
const mkSite = (id, name, locked) => ({
  id, groupId: id, site: name, name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris", status: "active", schemaVersion: 12, updatedAt: Date.now(),
  parcels: [{ id: "p1", points: [{ x: 0, y: 0 }, { x: 900, y: 0 }, { x: 900, y: 700 }, { x: 0, y: 700 }], active: true, z: 0 }],
  sheetOverlays: [{ id: "ov1", name: "Fixture sheet.png", src: SKETCH, x: 100, y: 100, imgW: W, imgH: H, ftPerPx: 0.5, rotation: 0, opacity: 0.85, locked, visible: true }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [],
});

let browser, page, UID = null;
const ALL_IDS = [];
if (LOCAL) {
  browser = await chromium.launch({ executablePath: process.env.PW_CHROME || undefined, args: ["--no-sandbox"] });
  page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  console.log("LOCAL mode — signed out, against", BASE);
} else {
  const s = await openSignedIn({ base: BASE });
  browser = s.browser; page = s.page;
  console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
  UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
}
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
await page.addInitScript(() => { window.__PLANYR_E2E = true; });   // arms the read-only window.__plannerExportSvg on the next load

const T = (id) => page.getByTestId(id);
const rotBox = async () => Number(await T("overlay-rotation").inputValue());
const rotCanvas = () => page.evaluate(() => { const g = document.querySelector('[data-feature="reference:ov1"]'); const m = g && /rotate\(([-\d.]+)/.exec(g.getAttribute("transform") || ""); return m ? Number(m[1]) : 0; });
const clip = () => page.evaluate(() => !!document.querySelector('clipPath[id="ov-crop-ov1"]'));
const sw = () => T("overlay-crop-switch-ov1");
const near = (a, b, tol) => Math.abs(((a - b + 540) % 360) - 180) <= tol;
const dialPt = async (deg, r) => { const b = await T("overlay-rot-dial").boundingBox(); const cx = b.x + b.width / 2, cy = b.y + b.height / 2, a = (deg * Math.PI) / 180; return { x: cx + r * Math.sin(a), y: cy - r * Math.cos(a) }; };
const buildNow = () => page.evaluate(async () => { try { return (await (await fetch("/version.json", { cache: "no-store" })).json()); } catch (_) { return null; } });

async function open(id, name, locked) {
  const seeded = { [id]: mkSite(id, name, locked) };
  if (LOCAL) await page.goto(`${BASE}/`, { waitUntil: "load" });   // a blank page has no localStorage to seed
  await page.evaluate(([uid, all, local]) => {
    localStorage.setItem(local ? "planarfit:sites:v1" : "planarfit:sites:cloud:" + uid, JSON.stringify(all));
    localStorage.setItem("planarfit:currentSite:v1", Object.keys(all)[0]);
  }, [UID, seeded, LOCAL]);
  await page.goto(`${BASE}/#/project/${id}/site`, { waitUntil: "load" });
  await page.evaluate(() => { window.__PLANYR_E2E = true; });
  await T("planner-canvas").waitFor({ timeout: 45000 });
  await sleep(2000);
  await assertMeasurable(page, "verify-overlay-dial-crop-live");
  await page.locator('[data-rail-tab="references"]').first().evaluate((el) => el.click());
  await sleep(900);
  const row = T("reference-open-ov1");
  await row.waitFor({ timeout: 20000 });
  if ((await row.getAttribute("aria-expanded")) !== "true") await row.evaluate((el) => el.click());
  await T("overlay-rot-dial").waitFor({ timeout: 15000 });
}

async function dialArm(tag) {
  const start = await rotBox();
  const p0 = await dialPt(0, 9);
  await page.mouse.move(p0.x, p0.y); await page.mouse.down();
  for (const d of [30, 90, 150, 180]) { const p = await dialPt(d, 24); await page.mouse.move(p.x, p.y, { steps: 3 }); await sleep(80); }
  await page.mouse.up(); await sleep(400);
  const r = await rotBox(), c = await rotCanvas();
  ok(`[${tag}] dragging the needle to 180° turns the overlay (box ${r}, canvas ${c})`, near(r, 180, 1.5) && near(c, r, 0.05));
  await page.keyboard.press("Control+z"); await sleep(500);
  ok(`[${tag}] the whole drag is ONE Ctrl+Z (back to ${start})`, (await rotBox()) === start && (await rotCanvas()) === start);

  const sp = await dialPt(0, 9);
  await page.mouse.move(sp.x, sp.y); await page.keyboard.down("Shift"); await page.mouse.down();
  const q = await dialPt(100, 24); await page.mouse.move(q.x, q.y, { steps: 4 }); await sleep(80);
  const snapped = await rotBox();
  await page.mouse.up(); await page.keyboard.up("Shift"); await sleep(300);
  ok(`[${tag}] Shift snaps 100° to 105°`, snapped === 105, String(snapped));

  const box = T("overlay-rotation");
  await box.fill("45"); await box.press("Enter"); await sleep(300);
  ok(`[${tag}] typing 45 sets 45`, (await rotBox()) === 45 && (await rotCanvas()) === 45);
  await box.fill("200"); await box.press("Escape"); await sleep(300);
  ok(`[${tag}] Esc reverts a half-typed value`, (await rotBox()) === 45);
  await page.getByRole("button", { name: "Increase rotation 1 degree" }).click(); await sleep(250);
  ok(`[${tag}] ▲ is +1°`, (await rotBox()) === 46);
  await page.getByRole("button", { name: "Decrease rotation 1 degree" }).click(); await page.getByRole("button", { name: "Decrease rotation 1 degree" }).click(); await sleep(250);
  ok(`[${tag}] ▼ is −1° (twice → 44)`, (await rotBox()) === 44);
  await page.getByRole("button", { name: "Turn 90° clockwise" }).click(); await sleep(250);
  ok(`[${tag}] Turn 90° clockwise → 134`, (await rotBox()) === 134 && near(await rotCanvas(), 134, 0.01));
  await page.getByRole("button", { name: "Turn 90° counterclockwise" }).click(); await page.getByRole("button", { name: "Turn 90° counterclockwise" }).click(); await sleep(250);
  ok(`[${tag}] Turn 90° counterclockwise ×2 → 314`, (await rotBox()) === 314);
  await T("overlay-rot-dial").focus(); await page.keyboard.press("ArrowRight"); await page.keyboard.press("Shift+ArrowLeft"); await sleep(300);
  ok(`[${tag}] the dial's own keys: → +1°, Shift+← −15° (314 → 300)`, (await rotBox()) === 300);
}

async function cropArm(tag) {
  ok(`[${tag}] crop starts OFF: the heading and the switch only`, (await sw().getAttribute("aria-checked")) === "false" && (await T("overlay-crop-open").count()) === 0 && (await T("overlay-crop-reset").count()) === 0);
  ok(`[${tag}] the switch is enabled (a locked overlay can still be cropped)`, await sw().isEnabled());
  await sw().click();
  const editor = T("overlay-crop-dialog");
  await editor.waitFor({ timeout: 10000 });
  await T("crop-cancel").click(); await sleep(400);
  ok(`[${tag}] ON with no shape opens the editor; cancelling leaves the switch OFF`, (await editor.count()) === 0 && (await sw().getAttribute("aria-checked")) === "false" && !(await clip()));
  await sw().click(); await editor.waitFor({ timeout: 10000 });
  await editor.locator("button", { hasText: "Polygon" }).click(); await sleep(250);
  const b = await editor.locator("img").first().boundingBox();
  const at = (fx, fy) => ({ x: b.x + fx * b.width, y: b.y + fy * b.height });
  for (const [fx, fy] of [[0.12, 0.15], [0.88, 0.2], [0.55, 0.9]]) { const p = at(fx, fy); await page.mouse.click(p.x, p.y); await sleep(300); }
  const c0 = at(0.12, 0.15); await page.mouse.click(c0.x, c0.y); await sleep(250);
  await editor.locator("button", { hasText: "Done" }).click(); await sleep(700);
  ok(`[${tag}] a polygon drawn → switch ON, picture + Adjust shown, the sheet is clipped`, (await sw().getAttribute("aria-checked")) === "true" && (await T("overlay-crop-picture-ov1").count()) === 1 && (await T("overlay-crop-open").innerText()) === "Adjust" && (await clip()));
  const pts = await page.evaluate(() => document.querySelector('clipPath[id="ov-crop-ov1"] polygon').getAttribute("points"));
  await sw().click(); await sleep(500);
  const offExport = await page.evaluate(() => window.__plannerExportSvg());
  ok(`[${tag}] switch OFF: the whole sheet — no clip on the canvas and none in the print/PDF sheet`, !(await clip()) && !/ov-crop-ov1/.test(offExport) && (await sw().getAttribute("aria-checked")) === "false" && (await T("overlay-crop-body").count()) === 0);
  await sw().click(); await sleep(500);
  const pts2 = await page.evaluate(() => { const p = document.querySelector('clipPath[id="ov-crop-ov1"] polygon'); return p ? p.getAttribute("points") : null; });
  const onExport = await page.evaluate(() => window.__plannerExportSvg());
  ok(`[${tag}] switch back ON: the SAME polygon, on the canvas and in the export`, pts2 === pts && /ov-crop-ov1/.test(onExport), `${pts} vs ${pts2}`);
}

try {
  for (const locked of [false, true]) {
    const id = `${RUN}-${locked ? "L" : "U"}`; ALL_IDS.push(id);
    const tag = locked ? "locked" : "unlocked";
    console.log(`\n=== ${tag.toUpperCase()} overlay ===`);
    await open(id, `ZZ DC ${RUN.slice(-5)} ${tag}`, locked);
    const v = await buildNow();
    console.log("served build:", JSON.stringify(v), "| chunks:", (await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((s) => s.getAttribute("src").split("/").pop()).join(","))).slice(0, 200));
    const startOk = (await rotBox()) === 0 && (await sw().getAttribute("aria-checked")) === "false" && !(await clip());
    if (!startOk) { console.log("VOID — the instrument cannot see the starting state"); await browser.close(); process.exit(2); }
    ok(`[${tag}] known-good arm: rotation 0 · crop off · no clip`, startOk);
    await dialArm(tag);
    await cropArm(tag);
  }
  ok("no page errors", errors.length === 0, errors.join(" | ").slice(0, 300));
} catch (e) {
  console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message);
} finally {
  if (!LOCAL) {
    const gone = await page.evaluate(async ([ids, uid]) => {
      let all = true;
      for (const id of ids) {
        await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
        await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
        await window.pfSupabase.from("sites").delete().eq("id", id);
        const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
        if (q.error || (q.data || []).length) all = false;
      }
      try { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); ids.forEach((id) => delete m[id]); localStorage.setItem(k, JSON.stringify(m)); } catch (e) {}
      return all;
    }, [ALL_IDS, UID]).catch(() => false);
    ok("throwaway plans deleted and confirmed gone from the cloud", gone);
  }
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
