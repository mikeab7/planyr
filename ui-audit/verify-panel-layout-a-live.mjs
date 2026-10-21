/* verify-panel-layout-a-live — B2403056–B2403058 / V1829360, driven LIVE as the test account (signedInSession).
 *
 * On a THROWAWAY plan (created here, deleted at the end — owner constraint #15): DRAW an area measurement, a building, a parking field,
 * a detention pond and a road with the real tools, open each one's Properties, and read the panel at the default width and again after a
 * REAL drag of the panel's resize handle out to its widest:
 *   · the Outline | Fill (paired) columns and every compact value cell are the SAME width at both panel widths (and no wider than the
 *     compact width) — extra panel width is empty space, never wider controls
 *   · a number box and its ▲▼ touch; no sideways scroll; no "pt" beside a weight; pattern selects right-aligned
 *   · the Area measurement panel: header "Area measurement", Label, Appearance, Size & position; NO Layer block / label-zoom block /
 *     drag hint
 *   · right-click the measurement: Bring to Front, Send to Back and "Send behind the plan" are offered, and the last one works
 *
 * KNOWN-GOOD ARM (CLAUDE.md DRIVER-SCROLL §6 clause 6 / WRONG-CASE): every panel read must find at least one paired cell or compact cell
 * (else the query saw nothing and the run is VOID), and the widen step must really have made the panel wider.
 *
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… node ui-audit/verify-panel-layout-a-live.mjs [--out <dir>] [--local]
 *   --local  skip sign-in and cloud clean-up (a dry run against `vite preview`).
 */
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const LOCAL = process.argv.includes("--local");
const BASE = (process.env.BASE_URL || (LOCAL ? "http://localhost:4173" : "https://planyr.io")).replace(/\/$/, "");
const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "/tmp/panel-layout-a-live";
mkdirSync(OUT, { recursive: true });
const VALUE_W = 92;
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let SITE_ID = null;
let UID = null;

let browser, page, close;
if (LOCAL) {
  browser = await chromium.launch({ args: ["--no-sandbox"], executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium" });
  page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  console.log("LOCAL dry run against", BASE);
} else {
  const s = await openSignedIn({ base: BASE });
  browser = s.browser; page = s.page;
  console.log("signed in as", s.proof.email, "| /version.json:", JSON.stringify(s.build));
  UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
}
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const T = (id) => page.getByTestId(id);
const canvas = T("planner-canvas");
const panel = T("property-panel");
await page.addInitScript(() => { window.__PLANYR_E2E = true; });

const site = () => page.evaluate(() => {
  const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
  const id = localStorage.getItem("planarfit:currentSite:v1");
  return m[id] || Object.values(m)[0] || {};
});
const bust = Date.now();

async function drawAll() {
  const b = await canvas.boundingBox();
  const at = (fx, fy) => ({ x: b.x + b.width * fx, y: b.y + b.height * fy });
  // 1 · area measurement (Measure ▾ → Area): four clicks, double-click the first point to close
  await page.getByRole("button", { name: /^Measure mode:/ }).click();
  await page.getByRole("button", { name: "Area", exact: true }).click();
  const area = [at(0.08, 0.10), at(0.30, 0.10), at(0.30, 0.30), at(0.08, 0.30)];
  for (const p of area) { await page.mouse.click(p.x, p.y); await sleep(80); }
  await page.mouse.dblclick(area[0].x, area[0].y);
  await sleep(500); await page.keyboard.press("Escape"); await sleep(200);
  // 2 · building
  const drag = async (tool, a, c) => {
    await page.getByRole("button", { name: tool, exact: true }).click();
    await page.mouse.move(a.x, a.y); await page.mouse.down();
    await page.mouse.move(a.x + 60, a.y + 40, { steps: 5 }); await page.mouse.move(c.x, c.y, { steps: 8 });
    await page.mouse.up(); await sleep(400); await page.keyboard.press("Escape"); await sleep(200);
  };
  await drag("Building", at(0.42, 0.10), at(0.62, 0.30));
  await drag("Parking", at(0.72, 0.10), at(0.92, 0.26));
  await drag("Detention Pond", at(0.08, 0.50), at(0.28, 0.72));
  // 3 · a centerline road (preset width, three clicks, Enter)
  await page.getByRole("button", { name: "Road presets" }).click();
  await page.getByRole("button", { name: /^24′$/ }).click();
  for (const p of [at(0.42, 0.62), at(0.62, 0.62), at(0.80, 0.78)]) { await page.mouse.click(p.x, p.y); await sleep(100); }
  await page.keyboard.press("Enter"); await sleep(600); await page.keyboard.press("Escape");
}

const readPanel = () => panel.evaluate((root, VALUE_W) => {
  const w = (e) => Math.round(e.getBoundingClientRect().width * 10) / 10;
  return {
    title: (document.querySelector('[data-testid="props-panel-title"]') || {}).textContent || "",
    pairedCells: [...root.querySelectorAll("[data-paired-cell]")].map(w),
    compactCells: [...root.querySelectorAll('[data-field-value="compact"]')].map(w),
    boxed: [...root.querySelectorAll("[data-numbox]")].map((box) => { const st = box.querySelector("[data-num-stepper]"); const r = box.getBoundingClientRect(); return { w: Math.round(r.width * 10) / 10, gap: st ? Math.round((r.right - st.getBoundingClientRect().right) * 10) / 10 : null }; }),
    sels: [...root.querySelectorAll('select[aria-label$="pattern"]')].map((s) => getComputedStyle(s).textAlignLast),
    weightRows: [...root.querySelectorAll('[data-field-group="1"][data-row-align="1"]')].filter((r) => /(^|\s)(Line weight|Weight)(\s|$)/.test(r.innerText.replace(/\n/g, " "))).map((r) => r.innerText.replace(/\s+/g, " ")),
    sections: [...root.querySelectorAll("[data-panel-section]")].map((e) => (e.firstElementChild || e).textContent.trim()),
    overflow: root.scrollWidth - root.clientWidth,
    width: root.getBoundingClientRect().width,
    text: root.innerText.replace(/\s+/g, " "),
  };
}, VALUE_W);

async function widen() {
  const h = page.locator('[title="Drag to resize"]').first();
  const hb = await h.boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down();
  await page.mouse.move(hb.x + 400, hb.y + hb.height / 2, { steps: 12 }); await page.mouse.up();
  await sleep(600);
}

async function openOne(sel) {
  await page.keyboard.press("Escape"); await sleep(200);
  const bb = await page.locator(sel).first().boundingBox();
  const at = { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 };
  await page.mouse.click(at.x, at.y); await sleep(400);
  await page.mouse.dblclick(at.x, at.y);
  await panel.waitFor({ timeout: 10000 }); await sleep(300);
  return at;
}

try {
  await page.goto(BASE + "/?cb=" + bust + "#/site-planner", { waitUntil: "load" });
  await sleep(2500);
  await T("map-toolbar-draw").click();
  await canvas.waitFor({ timeout: 25000 });
  await sleep(1500);
  await assertMeasurable(page, "verify-panel-layout-a-live");
  await drawAll();
  await sleep(1200);
  const s0 = await site();
  SITE_ID = await page.evaluate(() => localStorage.getItem("planarfit:currentSite:v1"));
  console.log("throwaway site id:", SITE_ID);
  const byType = (t) => (s0.els || []).find((e) => e.type === t && !e.dogEar);
  const subjects = [
    { name: "area measurement", sel: '[data-measure-mode="area"] polygon', present: (s0.measures || []).some((m) => m.mode === "area"), section: true },
    { name: "building", sel: byType("building") && `[data-el-id="${byType("building").id}"]`, present: !!byType("building") },
    { name: "car parking", sel: byType("parking") && `[data-el-id="${byType("parking").id}"]`, present: !!byType("parking") },
    { name: "detention pond", sel: byType("pond") && `[data-el-id="${byType("pond").id}"]`, present: !!byType("pond"), pond: true },
    { name: "road", sel: byType("road") && `[data-el-id="${byType("road").id}"]`, present: !!byType("road") },
  ];
  for (const sj of subjects) ok(`drawn with the real tool: ${sj.name}`, sj.present);

  const narrow = {};
  for (const sj of subjects.filter((x) => x.present && x.sel)) {
    const at = await openOne(sj.sel);
    if (sj.pond) { const hdr = panel.getByRole("button", { name: /^Appearance/ }); if ((await hdr.getAttribute("aria-expanded")) !== "true") { await hdr.click(); await sleep(250); } }
    const r = await readPanel();
    narrow[sj.name] = r;
    ok(`[default] ${sj.name}: the panel read found its columns (known-good arm)`, r.pairedCells.length + r.compactCells.length + r.boxed.length > 0, `paired ${r.pairedCells.length} compact ${r.compactCells.length} boxes ${r.boxed.length}`);
    ok(`[default] ${sj.name}: every value column is at most the compact width`, [...r.pairedCells, ...r.compactCells].every((x) => x <= VALUE_W + 0.6), [...new Set([...r.pairedCells, ...r.compactCells])].join(","));
    ok(`[default] ${sj.name}: each number box and its ▲▼ touch`, r.boxed.every((b) => b.gap == null || b.gap <= 2));
    ok(`[default] ${sj.name}: no sideways scroll, no "pt" beside a weight, pattern selects right-aligned`, r.overflow <= 1 && r.weightRows.every((w) => !/\bpt\b/.test(w)) && r.sels.every((a) => a === "right"), `overflow ${r.overflow}; ${r.weightRows.join(" | ")}`);
    if (sj.section) {
      ok("area measurement: header reads Area measurement", r.title.trim() === "Area measurement", r.title);
      ok("area measurement: sections Appearance → Size & position", JSON.stringify(r.sections) === JSON.stringify(["Appearance", "Size & position"]), JSON.stringify(r.sections));
      for (const gone of ["Layer", "Send behind the plan", "Bring to front", "Send to back", "Set at current zoom", "Reset to default", "Drag the line to move it"]) ok(`area measurement: panel has no "${gone}"`, !r.text.includes(gone));
      // right-click ordering menu
      await page.mouse.click(at.x, at.y, { button: "right" }); await sleep(300);
      const menu = page.locator(".menu").last();
      ok("right-click: Bring to Front and Send to Back are offered", (await menu.getByText("Bring to Front", { exact: true }).count()) === 1 && (await menu.getByText("Send to Back", { exact: true }).count()) === 1);
      await menu.getByText("Send behind the plan", { exact: true }).click(); await sleep(600);
      const behind = (await site()).measures?.find((m) => m.mode === "area")?.behindEls === true;
      ok("right-click: Send behind the plan works (the measurement is now behind the plan)", behind);
    }
  }

  await widen();
  for (const sj of subjects.filter((x) => x.present && x.sel)) {
    await openOne(sj.sel);
    if (sj.pond) { const hdr = panel.getByRole("button", { name: /^Appearance/ }); if ((await hdr.getAttribute("aria-expanded")) !== "true") { await hdr.click(); await sleep(250); } }
    const w = await readPanel();
    const was = narrow[sj.name];
    ok(`[widest] ${sj.name}: the panel really is wider now (known-good arm)`, w.width > was.width + 150, `${Math.round(was.width)} → ${Math.round(w.width)}`);
    ok(`[widest] ${sj.name}: paired columns, compact cells and number boxes are EXACTLY the width they were`, JSON.stringify(w.pairedCells) === JSON.stringify(was.pairedCells) && JSON.stringify(w.compactCells) === JSON.stringify(was.compactCells) && JSON.stringify(w.boxed.map((b) => b.w)) === JSON.stringify(was.boxed.map((b) => b.w)), `${was.pairedCells.join(",")} → ${w.pairedCells.join(",")}`);
    ok(`[widest] ${sj.name}: each number box and its ▲▼ touch; no sideways scroll`, w.boxed.every((b) => b.gap == null || b.gap <= 2) && w.overflow <= 1);
    await panel.screenshot({ path: `${OUT}/${sj.name.replace(/\W+/g, "-")}-wide.png` }).catch(() => {});
  }
  ok("no page errors", errors.length === 0, errors.join(" | "));
} catch (e) { console.error("HARNESS ERROR:", e.message); ok("harness ran to completion", false, e.message); }
finally {
  if (!LOCAL) {
    const gone = !SITE_ID ? true : await page.evaluate(async ([id, uid]) => {
      await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
      await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await window.pfSupabase.from("sites").delete().eq("id", id);
      const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
      try { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } catch (e) {}
      return !q.error && (q.data || []).length === 0;
    }, [SITE_ID, UID]).catch(() => false);
    ok("throwaway site deleted and confirmed gone from the cloud", gone);
  }
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
