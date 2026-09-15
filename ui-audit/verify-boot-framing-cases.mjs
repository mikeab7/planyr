#!/usr/bin/env node
/* verify-boot-framing-cases — THE HIDE-UNTIL-READY GATE ACROSS EVERY ADJACENT CASE. (B1574432)
 *
 * The gate can fail in two opposite directions and only one of them is loud:
 *   · it stays SHUT   → a blank, unclickable canvas. This is B1594320, a P0.
 *   · it opens EMPTY  → revealed, but showing the `useState` boot default or a plan that is
 *                       off-screen. Looks plausible, reads to the owner as "my plan is gone".
 * Both are asserted here, on every case, because a plan shape that nobody drove is a plan shape
 * where either can hide.
 *
 * ⛔ THE TRAP THIS HARNESS IS BUILT AROUND, AND IT WOULD HAVE MADE THE WHOLE RUN WRONG:
 * `ppf 0.35 off (60, 60)` IS NOT A FAILURE SIGNATURE. It is the `useState` boot default AND the
 * answer `fit()` honestly computes for a plan with nothing in it (SitePlanner.jsx's
 * `pts.length === 0` branch). An empty plan is SUPPOSED to sit there. So no case below judges on
 * that triple. The verdict is instead:
 *   · WAS the canvas revealed at all (the outage direction), and
 *   · WHY — `data-planner-reveal` must read "framed", meaning `fit()` ran against a real measured
 *     container and caused the reveal in the same commit, never "ceiling" (the rescue fired) and
 *     never "" (never revealed). That distinguishes "nothing to frame" from "could not frame"
 *     without reading the numbers at all, and
 *   · for a plan that HAS drawn content, whether that content is on screen and hit-testable.
 *
 * Run:  node ui-audit/verify-boot-framing-cases.mjs [--assert]
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DIST = join(ROOT, "dist");
const ASSERT = process.argv.includes("--assert");
const SETTLE_MS = 4500;

if (!existsSync(join(DIST, "index.html"))) {
  console.error("verify-boot-framing-cases: no dist/ build — run `npm run build` first.");
  process.exit(2);
}

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };
const server = createServer((req, res) => {
  const url = (req.url || "/").split("?")[0].split("#")[0];
  let p = join(DIST, url === "/" ? "index.html" : url.replace(/^\/+/, ""));
  if (!existsSync(p) || p.endsWith("/")) p = join(DIST, "index.html");
  try {
    const body = readFileSync(p);
    res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch (_) { res.writeHead(404); res.end("nope"); }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}/`;

const full = JSON.parse(readFileSync(join(ROOT, "ui-audit", "fixtures", "goose-creek-plan1copy.json"), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));
/* The plan SHAPES. Each strips something real off a real plan rather than hand-authoring one, so a
 * case cannot accidentally differ from the app's own idea of a plan in some other way too. */
const noParcel = { ...clone(full), parcels: [], parcelDrawings: [] };
const noEls = { ...clone(full), els: [], markups: [], measures: [], callouts: [] };
const empty = { ...clone(full), parcels: [], parcelDrawings: [], els: [], markups: [], measures: [], callouts: [], sheetOverlays: [], rasters: [] };

const browser = await chromium.launch({
  ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}),
  args: ["--no-sandbox", "--disable-background-networking"],
});

/** One case: seed a plan shape, open a route at a width, read the gate's own account of itself. */
async function drive({ fixture, route = "#/project/bootframe/site", width = 430, height = 830, hidden = false, tab = null }) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
  await ctx.route("**", (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.abort()));
  await ctx.addInitScript(fixtureSeed(fixture, { id: "bootframe", name: "Boot framing", site: "Boot framing" }));
  if (hidden) {
    await ctx.addInitScript(`(() => { try {
      window.__planyrForceHidden = true;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (window.__planyrForceHidden ? 'hidden' : 'visible') });
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => !!window.__planyrForceHidden });
    } catch (e) {} })();`);
  }
  const page = await ctx.newPage();
  let decoy = null;
  if (hidden) { decoy = await ctx.newPage(); await decoy.goto("about:blank"); await decoy.bringToFront(); }
  await page.goto(`${BASE}${route}`, { waitUntil: "load" }).catch(() => {});
  await new Promise((r) => setTimeout(r, SETTLE_MS));
  /* ⛔ THE MODULE TABS EXIST TWICE IN THE DOM. `SitePlannerApp` keeps BOTH hosts mounted and hides
     the inactive one with `display:none` + `inert` (to keep its Leaflet map alive), so a bare text
     locator resolves to the inert copy and the click times out on a control a user can see. Scope
     to the VISIBLE one — and assert against the surface, never against page text. */
  let tabClicked = null;
  if (tab) {
    const loc = page.locator("button", { hasText: new RegExp(`^${tab}$`) }).locator("visible=true").first();
    try { await loc.click({ timeout: 8000 }); tabClicked = true; await new Promise((r) => setTimeout(r, SETTLE_MS)); }
    catch (_) { tabClicked = false; }
  }
  const out = await page.evaluate(() => {
    const c = document.querySelector('[data-testid="planner-canvas"]');
    const body = (document.body.innerText || "").slice(0, 160).replace(/\s+/g, " ");
    if (!c) return { canvas: false, body };
    const cb = c.getBoundingClientRect();
    /* el-tier: one drawn ELEMENT's own node is the subject — whether a press at its own centre
       reaches it. The count is this case's vacuity precondition, never a plan census. */
    const els = [...document.querySelectorAll("[data-el-id]")];
    let hit = null;
    if (els[0]) {
      const b = els[0].getBoundingClientRect();
      const t = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
      const owner = t && t.closest ? t.closest("[data-el-id]") : null;
      hit = owner ? owner.getAttribute("data-el-id") : (t ? `<${(t.tagName || "?").toLowerCase()}>` : null);
    }
    const onScreen = els.filter((e) => {
      const b = e.getBoundingClientRect();
      return b.right > cb.x && b.x < cb.right && b.bottom > cb.y && b.y < cb.bottom;
    }).length;
    return {
      canvas: true, body,
      visibility: getComputedStyle(c).visibility,
      reveal: c.getAttribute("data-planner-reveal") || "",
      ppf: +c.getAttribute("data-view-ppf"), offX: +c.getAttribute("data-view-offx"), offY: +c.getAttribute("data-view-offy"),
      els: els.length, onScreen, hit,
      box: `${Math.round(cb.width)}x${Math.round(cb.height)}`,
    };
  });
  if (!hidden) await assertMeasurable(page, "verify-boot-framing-cases").catch(() => {});
  if (decoy) await decoy.close();
  await ctx.close();
  return { ...out, tabClicked };
}

/* ── the cases ──────────────────────────────────────────────────────────────────────────────────
 * `expectContent` is what makes each case's verdict non-vacuous: a case that says it has drawn
 * content must PROVE it painted some, or it has not asked its question and fails rather than
 * scoring. A case that says it has none must prove that too — an empty plan that somehow painted
 * elements is not the empty case. */
const CASES = [
  { name: "foregrounded cold load (phone width)", fixture: full, expectContent: true },
  { name: "foregrounded cold load (desktop)", fixture: full, width: 1440, height: 900, expectContent: true },
  { name: "hidden boot (the tab is not frontmost)", fixture: full, hidden: true, expectContent: true },
  { name: "a project with NO PARCEL (elements only)", fixture: noParcel, expectContent: true },
  { name: "a parcel with NO ELEMENTS", fixture: noEls, expectContent: false },
  { name: "a genuinely EMPTY plan (fit() legitimately answers the boot default)", fixture: empty, expectContent: false },
];
/* The other modules. The gate touches only the planner canvas, but the planner stays MOUNTED behind
 * them (`SitePlannerApp` hides the inactive mode with `display:none` to keep its map alive), so a
 * gate that could wedge would wedge here too — and a module that fails to render at all is exactly
 * what a bad paint gate looks like from the outside. */
const MODULES = [
  { name: "Map", tab: "Map" },
  { name: "Schedule", tab: "Schedule" },
  { name: "Notes", tab: "Notes" },
  { name: "Review", tab: "Review" },
];

let failed = false;
const W = 96;
console.log("═".repeat(W));
console.log("verify-boot-framing-cases — the gate across every adjacent case");
console.log("═".repeat(W));
console.log("⛔ `ppf 0.35 off (60,60)` is NOT judged: it is both the boot default AND the honest answer for an");
console.log("   empty plan. The verdict is WHETHER the canvas was revealed and WHY (data-planner-reveal).\n");

for (const c of CASES) {
  const r = await drive(c);
  console.log(`CASE: ${c.name}`);
  if (!r.canvas) { console.log(`  ❌ no planner canvas at all — "${r.body}"`); failed = true; console.log(""); continue; }
  console.log(`  canvas ${r.box}  visibility=${r.visibility}  reveal="${r.reveal || "(empty — never revealed)"}"`);
  console.log(`  view ppf=${r.ppf} off=(${Math.round(r.offX)}, ${Math.round(r.offY)})   drawn elements: ${r.els} (${r.onScreen} on screen)`);
  if (r.visibility !== "visible") { console.log("  ❌ the canvas was never revealed — B1594320's outage shape"); failed = true; }
  if (r.reveal !== "framed") {
    console.log(`  ❌ reveal reason is "${r.reveal || "(empty)"}", not "framed" — a healthy container must be revealed BY ITS FRAMING; "ceiling" means the normal path failed and the rescue covered for it`);
    failed = true;
  }
  if (c.expectContent) {
    if (!r.els) { console.log("  ❌ this case claims drawn content and painted NONE — it did not ask its question (VACUOUS)"); failed = true; }
    else if (!r.onScreen) { console.log("  ❌ every drawn element is OUTSIDE the canvas box — revealed, but the plan is off-screen, which reads as \"my plan is gone\""); failed = true; }
    else if (!r.hit || String(r.hit).startsWith("<")) { console.log(`  ❌ elementFromPoint at an element's own centre resolved to ${r.hit ?? "null"} — the plan is unclickable`); failed = true; }
    else console.log(`  ✅ revealed by its framing, ${r.onScreen}/${r.els} elements on screen, hit-testable (${r.hit})`);
  } else {
    if (r.els) { console.log(`  ❌ this case claims NO drawn content and painted ${r.els} elements — it is not the case it says it is (VACUOUS)`); failed = true; }
    else console.log("  ✅ revealed by its framing — `fit()` ran against a real container and had nothing to frame, which is the correct answer, not a failure");
  }
  console.log("");
}

console.log("OTHER MODULES (reached by clicking the real tab; the planner stays mounted behind them, so a gate that could wedge would wedge here)");
for (const m of MODULES) {
  const r = await drive({ fixture: full, tab: m.tab });
  /* ⛔ THE PRECONDITION. A tab this harness could not actually click was never visited, so any
     verdict about it is about the Site view it never left. That is a vacuous pass, and the whole
     reason this harness stopped using bare hash routes: `#/project/<id>/map` silently fell through
     to plan mode and "Map" was being reported on a reading of the Site view. */
  if (r.tabClicked !== true) {
    console.log(`  ❌ ${m.name.padEnd(9)} the "${m.tab}" tab could not be clicked — this module was never visited, so nothing about it was tested. VACUOUS.`);
    failed = true;
    continue;
  }
  const broken = /doesn't exist|went wrong|Something broke/i.test(r.body || "");
  /* Where a planner canvas is mounted behind the module it must not be stuck shut — that is the
     wedge being looked for. `reveal === ""` with no canvas painted is simply "no gate to judge". */
  const stuck = r.canvas && r.visibility !== "visible" && r.reveal !== "";
  const ok = !broken && !stuck;
  console.log(`  ${ok ? "✅" : "❌"} ${m.name.padEnd(9)} tab clicked, module rendered  ·  planner canvas behind it: ${r.canvas ? `${r.visibility}, reveal="${r.reveal || "(none)"}"` : "not mounted"}`);
  if (broken) { console.log(`       ❌ the module rendered an error state: "${r.body}"`); failed = true; }
  if (stuck) { console.log(`       ❌ a planner canvas is mounted behind this module and is stuck hidden (reveal="${r.reveal}")`); failed = true; }
}

await browser.close();
server.close();
console.log(`\n${failed ? "VERDICT: ✗ FAIL" : "VERDICT: ✓ PASS"}`);
if (ASSERT && failed) process.exit(1);
