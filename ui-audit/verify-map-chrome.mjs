#!/usr/bin/env node
/* B427408–B427413 — THE MAP VIEW'S CHROME, verified at the OWNER'S breakpoint.
 *
 * Every one of the six defects in that block was reported from a WIDE desktop window with the
 * Your-sites panel EXPANDED and the Layers panel OPEN — and two of them (the unreachable zoom
 * control, the un-collapsible Layers panel) exist precisely because the phone path was fixed and
 * the desktop path was left behind. So this harness drives that exact state first, and then the
 * phone, because a fix that trades one breakpoint for the other is the defect again.
 *
 * ⛔ The zoom check is a real HIT TEST, not a bounding-box comparison. "Is the control covered"
 * is a question about what answers a press at a point, and `elementFromPoint` is the browser's
 * own answer to it — a rect check would pass on a control sitting under an opaque panel.
 *
 *   node ui-audit/verify-map-chrome.mjs [--url http://localhost:4319/] [--shots]
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const URL = arg("--url", "http://localhost:4319/");
const SHOTS = process.argv.includes("--shots");
const OUT = "ui-audit/out/map-chrome";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok, detail }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

/* ⛔ THE SITES MUST BE SEEDED, and this is the whole reason the first cut of this harness was
 * worthless. `MapFinder` renders the Your-sites panel behind `sites.length > 0`, so a signed-out
 * run with an empty device has NO panel — the very thing reported as covering the zoom control is
 * not on the page, the hit test passes, and B427408 gets a green tick on a build that still has the
 * bug. Measured: this harness scored 6/13 against pre-fix `main` WITH the zoom checks passing.
 * Seeding also makes the panel TALL (the owner has 28 sites), which is the reported state.
 * Shape borrowed verbatim from verify-landing-view.mjs — one fixture vocabulary, not two. */
const sq = (ft) => [{ x: 0, y: 0 }, { x: ft, y: 0 }, { x: ft, y: ft }, { x: 0, y: ft }];
const NOW = 1754000000000;   // fixed: Date.now() in a harness makes a run unreproducible
const SEED_SITES = Object.fromEntries(Array.from({ length: 14 }, (_, i) => {
  const id = `mc${i + 1}`;
  return [id, {
    id, groupId: id, site: `Harris ${i + 1}`, name: `Harris ${i + 1}`,
    origin: { lat: 29.8 + ((i % 5) - 2) * 0.09, lon: -95.4 + ((i % 4) - 1.5) * 0.12 }, county: "harris",
    parcels: [{ id: `${id}p`, points: sq(600) }], els: [], measures: [], callouts: [], markups: [],
    settings: {}, underlay: null, status: ["active", "pursuit", "onhold"][i % 3], updatedAt: NOW - i * 1000,
  }];
}));

/* The map view is the app's default surface; wait for Leaflet to have painted its controls.
 * Both panels are forced OPEN through their own persisted keys — that IS the reported state, and
 * both now persist, so a stale value from an earlier arm must not decide what this run measures. */
async function openMap(browser, viewport) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await ctx.addInitScript(`(()=>{try{
    localStorage.clear();
    localStorage.setItem('planarfit:sites:v1', ${JSON.stringify(JSON.stringify(SEED_SITES))});
    localStorage.setItem('planarfit:sitesPanelClosed:v1', '0');
    localStorage.setItem('planarfit:layersPanelClosed:v1', '0');
  }catch(e){}})();`);
  const page = await ctx.newPage();
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await assertMeasurable(page, "verify-map-chrome");
  await page.waitForSelector(".leaflet-container", { timeout: 20000 });
  await page.waitForSelector("text=Your sites", { timeout: 20000 });
  await pacedWait(page, 1200);
  return page;
}

/* What actually answers a press at the centre of `sel` — the element itself, or something over it? */
async function hitAt(page, sel) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return { found: false };
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { found: true, painted: false };
    const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
    const top = document.elementFromPoint(cx, cy);
    return {
      found: true, painted: true, rect: { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) },
      // `contains` rather than identity: the control's own <span> is a legitimate answer.
      reachable: !!(top && (el === top || el.contains(top) || top.contains(el))),
      blockedBy: top ? `${top.tagName.toLowerCase()}${top.className && typeof top.className === "string" ? "." + top.className.split(" ").filter(Boolean).slice(0, 2).join(".") : ""}` : null,
    };
  }, sel);
}

const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome" });
try {
  if (SHOTS) mkdirSync(OUT, { recursive: true });

  // ─────────────────────────────────────────────────────────────── DESKTOP, the owner's state
  console.log("\nDESKTOP 1600×900 — Your sites EXPANDED, Layers OPEN (the reported state)");
  const page = await openMap(browser, { width: 1600, height: 900 });
  if (SHOTS) await page.screenshot({ path: `${OUT}/desktop-after.png` });

  /* The seed only matters if it landed — a silently empty panel is the failure mode this whole
   * harness exists to avoid, so prove the reported state is on screen before measuring against it. */
  const sitesPanelBox = await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /sites panel/.test(x.title || ""));
    if (!b) return null;
    const r = b.closest("div").getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  });
  check("setup · the Your-sites panel is rendered and EXPANDED", !!sitesPanelBox && sitesPanelBox.h > 200,
    sitesPanelBox ? `${sitesPanelBox.w}×${sitesPanelBox.h} at ${sitesPanelBox.x},${sitesPanelBox.y}` : "no panel — the seed did not land");

  // NEW-1 / B427408 — both zoom buttons fully clickable with the panels open.
  for (const [label, sel] of [["+", ".leaflet-control-zoom-in"], ["−", ".leaflet-control-zoom-out"]]) {
    const h = await hitAt(page, sel);
    check(`B427408 · zoom "${label}" is reachable`, !!h.reachable,
      h.reachable ? `at ${h.rect.x},${h.rect.y}` : `covered by ${h.blockedBy}`);
  }

  // NEW-2 / B427409 — one control collapses the whole Layers panel, and it frees the map.
  const layersBtn = page.locator('button[title="Collapse layers"], button[title="Imagery & layers"]').first();
  const hadBtn = await layersBtn.count() > 0;
  check("B427409 · a collapse control exists on desktop", hadBtn);
  if (hadBtn) {
    const wideBefore = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Collapse layers|Imagery & layers/.test(x.title || ""));
      return b ? Math.round(b.closest("div").getBoundingClientRect().width) : null;
    });
    await layersBtn.click();
    await pacedWait(page, 500);
    const wideAfter = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Collapse layers|Imagery & layers/.test(x.title || ""));
      return b ? Math.round(b.closest("div").getBoundingClientRect().width) : null;
    });
    check("B427409 · collapsing FREES the map (panel narrows)", wideAfter != null && wideBefore != null && wideAfter < wideBefore,
      `${wideBefore} → ${wideAfter}`);
    if (SHOTS) await page.screenshot({ path: `${OUT}/desktop-layers-collapsed.png` });
    await layersBtn.click();  // re-expand
    await pacedWait(page, 500);
    const wideBack = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Collapse layers|Imagery & layers/.test(x.title || ""));
      return b ? Math.round(b.closest("div").getBoundingClientRect().width) : null;
    });
    check("B427409 · re-expands from the same control", wideBack === wideBefore, `${wideAfter} → ${wideBack}`);
  }

  // NEW-3 / B427410 — imagery reads as a base layer; the labels toggle explains itself.
  /* ⛔ Read the whole map-chrome REGION, not the collapse button's container: pre-fix there IS no
   * collapse button, so a button-anchored read returns "" and every NEGATIVE check below passes on
   * the broken build for free. The finder's LayerPanel stamps its own surface, so scope to the
   * panel's own parent overlay and fall back to the panel itself. */
  const panelText = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="layer-panel"][data-surface="finder"]')
      || document.querySelector('[data-testid="layer-panel"]');
    if (!p) return "";
    const box = p.closest("div[style*='position: absolute']") || p;
    return box.innerText || "";
  });
  check("B427410 · no separate 'Imagery' strip above the list", !/^\s*Imagery\s*$/m.test(panelText));
  check("B427410 · no bare 'Labels' control", !/\bLabels\b/.test(panelText), panelText.match(/\bLabels\b/) ? "still present" : "");
  check("B427410 · 'Place names' names what it draws", /Place names/.test(panelText));
  /* ⛔ "the panel says Base & terrain" is NOT the check — that heading already existed for the
   * terrain rows and passes on the pre-fix build. The claim is that the IMAGERY CONTROL now lives
   * INSIDE the layer list, so ask where the control is: pre-fix it is a <select> in MapFinder,
   * outside the panel entirely. */
  const basemapInPanel = await page.evaluate(() => {
    const g = document.querySelector('[role="group"][aria-label="Aerial basemap source"]');
    if (!g) return { found: false };
    const panel = document.querySelector('[data-testid="layer-panel"][data-surface="finder"]')
      || document.querySelector('[data-testid="layer-panel"]');
    return { found: true, inside: !!(panel && panel.contains(g)) };
  });
  check("B427410 · the imagery control is INSIDE the layer list", !!basemapInPanel.inside,
    basemapInPanel.found ? (basemapInPanel.inside ? "" : "rendered outside the panel") : "no basemap control found");
  check("B427410 · it sits under the Base & terrain heading", /Base & terrain/i.test(panelText));

  /* NEW-5 / B427412 — the placeholder. Pick the SEARCH input by what it is for: with sites seeded
   * the first `input[placeholder]` on the page is the sites panel's "Filter by name…" box, and the
   * match must resolve on the pre-fix build too or the check goes red for the wrong reason. */
  const searchPlaceholder = (p) => p.evaluate(() => {
    const i = [...document.querySelectorAll("input[placeholder]")]
      .find((x) => /address|place|Find a site/i.test(x.placeholder));
    return i ? i.placeholder : null;
  });
  const ph = await searchPlaceholder(page);
  check("B427412 · placeholder has no dash", !!ph && !/[—–-]/.test(ph), ph || "(not found)");
  check("B427412 · placeholder says what to type", !!ph && /^Type /.test(ph), ph || "");

  // NEW-4 / B427411 — every radius on screen is on the scale.
  const radii = await page.evaluate(() => {
    const allowed = new Set(["999px", "6px", "8px", "12px"]);
    const bad = [];
    const seen = {};
    for (const el of document.querySelectorAll("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width < 6 || r.height < 6) continue;                       // invisible / hairline
      const cs = getComputedStyle(el);
      for (const corner of ["borderTopLeftRadius", "borderTopRightRadius", "borderBottomLeftRadius", "borderBottomRightRadius"]) {
        const v = cs[corner];
        if (v === "0px" || v === "" || v.includes("%")) continue;
        seen[v] = (seen[v] || 0) + 1;
        if (!allowed.has(v)) bad.push({ v, tag: el.tagName.toLowerCase(), cls: (el.className || "").toString().slice(0, 30) });
      }
    }
    return { seen, bad: bad.slice(0, 12), badCount: bad.length };
  });
  check("B427411 · every visible radius is on the scale", radii.badCount === 0,
    radii.badCount ? `${radii.badCount} off-scale: ${[...new Set(radii.bad.map((b) => b.v))].join(", ")}` : `values in use: ${Object.keys(radii.seen).sort().join(", ")}`);

  // ───────────────────────────────────────────────────────────── PHONE — the other direction
  console.log("\nPHONE 390×844 — confirm the desktop fixes did not cost the phone layout");
  const phone = await openMap(browser, { width: 390, height: 844 });
  if (SHOTS) await phone.screenshot({ path: `${OUT}/phone-after.png` });
  for (const [label, sel] of [["+", ".leaflet-control-zoom-in"], ["−", ".leaflet-control-zoom-out"]]) {
    const h = await hitAt(phone, sel);
    check(`phone · zoom "${label}" still reachable`, !!h.reachable, h.reachable ? "" : `covered by ${h.blockedBy}`);
  }
  const phonePh = await searchPlaceholder(phone);
  check("phone · placeholder is a shortening of the wide one", !!phonePh && /^Type an address/.test(phonePh), phonePh || "");

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${failed.length ? "✗" : "✓"} ${results.length - failed.length}/${results.length} checks passed`);
  if (SHOTS) { writeFileSync(`${OUT}/results.json`, JSON.stringify(results, null, 2)); console.log(`  screenshots + results → ${OUT}/`); }
  process.exitCode = failed.length ? 1 : 0;
} finally {
  await browser.close();
}
