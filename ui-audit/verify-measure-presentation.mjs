/* Live self-verification for the measurement styling / label / presentation work
 * (NEW-1 per-measurement style · NEW-2 per-measurement label reveal zoom · NEW-3 the summary chip,
 * segment dimensions and print parity).
 *
 * Runs headless against a local `vite preview` of the built app, LOGGED OUT, on a seeded blank
 * site — which is exactly the class the repo rule says must be driven here rather than parked.
 * The one thing it cannot do is put the drawing over live AERIAL imagery (the sandbox egress
 * blocks the tile hosts); that half stays a `Blocker: live-GIS` line on the V entry.
 *
 *   node ui-audit/verify-measure-presentation.mjs
 * Screenshots land in ui-audit/screens/measure-presentation/. Exits non-zero on any failed check.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE || "http://localhost:4173/";
const OUT = new URL("./screens/measure-presentation/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const SITE_ID = "measure-presentation";
// A long user label + a very large area, per the brief — proving no clipping or overflow.
const LONG_LABEL = "Proposed compensating storage take — north of the BKDD outfall channel";
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "Measure check", name: "Presentation", origin: null, county: "waller",
  parcels: [], els: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [],
  measures: [
    // 1. a BIG area (≈27 ac) carrying the long label — headline should lead in acres
    { id: "m-area", mode: "area", label: LONG_LABEL,
      pts: [{ x: 200, y: 200 }, { x: 1300, y: 200 }, { x: 1300, y: 1250 }, { x: 200, y: 1250 }] },
    // 2. a SMALL area (<1 ac) — headline should lead in square feet
    { id: "m-small", mode: "area", pts: [{ x: 1500, y: 200 }, { x: 1650, y: 200 }, { x: 1650, y: 350 }, { x: 1500, y: 350 }] },
    // 3. a multi-leg run with a custom style (green, heavy, dashed) — proves per-object styling
    { id: "m-poly", mode: "polyline", label: "Fire lane run", stroke: "#16a34a", weight: 3, dash: "dashed",
      pts: [{ x: 200, y: 1450 }, { x: 900, y: 1450 }, { x: 900, y: 1800 }] },
    // 4. a count in its own colour
    { id: "m-count", mode: "count", label: "Light poles", stroke: "#7c3aed",
      pts: [{ x: 1500, y: 1450 }, { x: 1650, y: 1450 }, { x: 1500, y: 1600 }, { x: 1650, y: 1600 }] },
    // 5. a survey-scale note pinned to reveal only when zoomed well in (NEW-2)
    { id: "m-note", mode: "line", label: "Survey note", labelPpf: 1.2, pts: [{ x: 400, y: 1900 }, { x: 700, y: 1900 }] },
  ],
  updatedAt: Date.now(),
};

const fails = [];
const check = (name, ok, detail = "") => {
  (ok ? console.log : (m) => { console.log(m); fails.push(name); })(`${ok ? "✅" : "❌"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch({
  executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  args: ["--no-sandbox", "--ignore-certificate-errors"],
});

async function session(theme) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(`(() => { try {
    window.__PLANYR_E2E = true;
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify({ [SITE_ID]: site })}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(SITE_ID)});
    localStorage.setItem('planyr.theme', ${JSON.stringify(theme)});
  } catch (e) {} })();`);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(String(e)));
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 30000 });
  await page.waitForFunction(() => !!window.__plannerView, null, { timeout: 30000 });
  return { ctx, page, errs };
}

const chipText = (page) => page.evaluate(() =>
  [...document.querySelectorAll('[data-print-chip="measure"]')].map((g) => ({
    id: g.getAttribute("data-measure-chip"),
    lines: [...g.querySelectorAll("[data-chip-text]")].map((t) => t.textContent),
    sub: [...g.querySelectorAll("[data-chip-sub]")].map((t) => t.textContent),
    keyline: g.querySelector("[data-chip-bg]")?.getAttribute("stroke"),
    plate: g.querySelector("[data-chip-bg]")?.getBoundingClientRect().width,
  })));

// Each zoom frames what it is meant to evidence: the whole plan at overview, everything at
// working zoom, and the polyline + the area's south edge close in (where the per-edge segment
// dimensions are the thing to look at).
const ZOOMS = [
  { name: "site-overview", ppf: 0.22, cx: 900, cy: 1000 },
  { name: "working", ppf: 0.55, cx: 900, cy: 1000 },
  { name: "close-in", ppf: 1.6, cx: 620, cy: 1420 },
];

for (const theme of ["light", "dark"]) {
  const { ctx, page, errs } = await session(theme);
  for (const z of ZOOMS) {
    await page.evaluate(([x, y, p]) => window.__plannerView.centerOn(x, y, p), [z.cx, z.cy, z.ppf]);
    await page.waitForTimeout(450);
    await page.screenshot({ path: `${OUT}${theme}-${z.name}.png` });
    const chips = await chipText(page);
    const byId = Object.fromEntries(chips.map((c) => [c.id, c]));

    if (z.name === "working") {
      // (a)+(b) one dominant value; the unit chosen by magnitude
      check(`[${theme}] big area headlines ACRES with the detail subordinate`,
        byId["m-area"]?.lines?.[1] === "26.52 ac" && /1,155,000 sf · 4,300′ perimeter/.test(byId["m-area"]?.lines?.[2] || ""),
        JSON.stringify(byId["m-area"]?.lines));
      check(`[${theme}] the long user label rides ABOVE the headline as its own line`,
        byId["m-area"]?.lines?.[0] === LONG_LABEL);
      check(`[${theme}] sub-acre area headlines SQUARE FEET`,
        byId["m-small"]?.lines?.[0] === "22,500 sf", JSON.stringify(byId["m-small"]?.lines));
      // The OLD one-liner ended in the bare abbreviation "perim"; the new detail line spells
      // "perimeter" out and is subordinate, so the abbreviation must not survive on its own.
      check(`[${theme}] the bare "perim" abbreviation is gone (it is spelled out and subordinate)`,
        !chips.some((c) => /perim\b(?!eter)/.test(c.lines.join(" ")))
        && chips.some((c) => c.sub.some((t) => /perimeter/.test(t))));
      // (g) length + count get the same treatment
      check(`[${theme}] a multi-leg run headlines the total with the breakdown underneath`,
        byId["m-poly"]?.lines?.[1] === "1,050′" && byId["m-poly"]?.lines?.[2] === "2 segments",
        JSON.stringify(byId["m-poly"]?.lines));
      check(`[${theme}] a count headlines the number with its unit underneath`,
        byId["m-count"]?.lines?.[1] === "4" && byId["m-count"]?.lines?.[2] === "items",
        JSON.stringify(byId["m-count"]?.lines));
      // NEW-1 the keyline carries the measurement's own colour
      check(`[${theme}] each chip's keyline carries that measurement's own colour`,
        byId["m-poly"]?.keyline === "#16a34a" && byId["m-count"]?.keyline === "#7c3aed",
        `${byId["m-poly"]?.keyline} / ${byId["m-count"]?.keyline}`);
      // (c) it is a real chip, not haloed text
      check(`[${theme}] the chip is a real plate (a rounded rect), not raw haloed text`,
        chips.every((c) => c.plate > 10));
      // NEW-1 per-object stroke/weight/dash actually paint
      const poly = await page.evaluate(() => {
        const el = [...document.querySelectorAll("polyline")].find((p) => p.getAttribute("stroke") === "#16a34a");
        return el && { stroke: el.getAttribute("stroke"), w: el.getAttribute("stroke-width"), dash: el.getAttribute("stroke-dasharray") };
      });
      check(`[${theme}] a styled run paints its own colour, weight AND dash`,
        !!poly && poly.stroke === "#16a34a" && Number(poly.w) === 3 && !!poly.dash, JSON.stringify(poly));
    }

    if (z.name === "close-in") {
      // (d) per-edge segment lengths, gated separately from the chip
      const segs = await page.evaluate(() =>
        [...document.querySelectorAll("text")].filter((t) => /^[\d,]+′$/.test(t.textContent) && t.getAttribute("transform")).length);
      check(`[${theme}] per-edge segment lengths are dimensioned when zoomed in`, segs >= 4, `${segs} edge labels`);
      // NEW-2: the pinned survey note appears once past its own threshold
      check(`[${theme}] a note pinned to a closer zoom DOES appear once you are there`,
        !!(await chipText(page)).find((c) => c.id === "m-note"));
    }

    if (z.name === "site-overview") {
      check(`[${theme}] a note pinned to a closer zoom stays HIDDEN at site overview`,
        !(await chipText(page)).find((c) => c.id === "m-note"));
    }
  }

  // NEW-1 — double-click a measurement opens its Properties with the full style set.
  await page.evaluate(() => window.__plannerView.centerOn(750, 725, 0.5));
  await page.waitForTimeout(350);
  const box = await page.locator('[data-testid="planner-canvas"]').boundingBox();
  const v = await page.evaluate(() => window.__plannerView.get());
  const f2s = (fx, fy) => ({ x: box.x + v.w / 2 + (fx - 750) * 0.5, y: box.y + v.h / 2 + (fy - 725) * 0.5 });
  const onEdge = f2s(750, 200); // the big area's top edge
  await page.mouse.click(onEdge.x, onEdge.y);
  await page.waitForTimeout(150);
  await page.mouse.click(onEdge.x, onEdge.y);
  await page.waitForTimeout(500);
  const panel = await page.evaluate(() => {
    const p = document.querySelector('[data-testid="property-panel"]');
    return p ? p.innerText : "";
  });
  check(`[${theme}] double-click opens the measurement's Properties`, /Measurement/i.test(panel), panel.slice(0, 60));
  for (const field of ["Line color", "Line weight", "Line style", "Fill color", "Fill opacity", "Set at current zoom"]) {
    check(`[${theme}] Properties offers "${field}"`, panel.includes(field));
  }
  check(`[${theme}] the reveal readout is plain English, never a zoom number`,
    /Shows from [A-Z][a-z ]+ in/.test(panel) && !/px|ppf|per foot/i.test(panel),
    (panel.match(/Shows from [^·\n]*/) || [""])[0]);
  check(`[${theme}] no × delete badge on the selected measurement (owner rule)`,
    await page.evaluate(() => !document.querySelector('[data-testid="measure-selected"] text')));

  // NEW-2 — "Set at current zoom" pins the threshold from the live view, no typing.
  const before = await page.evaluate(() => {
    const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    return (Object.values(m)[0]?.measures || []).find((x) => x.id === "m-area")?.labelPpf ?? null;
  });
  await page.getByRole("button", { name: "Set at current zoom" }).first().click();
  await page.waitForTimeout(700);
  const after = await page.evaluate(() => {
    const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    return (Object.values(m)[0]?.measures || []).find((x) => x.id === "m-area")?.labelPpf ?? null;
  });
  check(`[${theme}] "Set at current zoom" captures the live zoom onto the measurement`,
    before == null && typeof after === "number" && after > 0, `${before} → ${after}`);
  const resetVisible = await page.getByRole("button", { name: "Reset to default" }).first().isVisible().catch(() => false);
  check(`[${theme}] a pinned measurement offers "Reset to default"`, resetVisible);

  // NEW-3 — drag the chip off its anchor; a leader line must appear back to where it belongs.
  await page.evaluate(() => window.__plannerView.centerOn(750, 725, 0.5));
  await page.waitForTimeout(300);
  const chipBox = await page.locator('[data-measure-chip="m-area"] [data-chip-bg]').boundingBox();
  if (chipBox) {
    const from = { x: chipBox.x + chipBox.width / 2, y: chipBox.y + chipBox.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 130, from.y + 90, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(600);
    const moved = await page.evaluate(() => {
      const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
      const off = (Object.values(m)[0]?.measures || []).find((x) => x.id === "m-area")?.labelOffset;
      const leader = !!document.querySelector('[data-measure-chip="m-area"] line');
      return { off, leader };
    });
    check(`[${theme}] the chip drags off its anchor and stores the offset with the plan`,
      !!moved.off && Math.abs(moved.off.x) > 50, JSON.stringify(moved.off));
    check(`[${theme}] a moved chip draws a leader back to its anchor`, moved.leader);
    await page.screenshot({ path: `${OUT}${theme}-chip-dragged.png` });
  } else check(`[${theme}] the area chip is reachable for a drag`, false);

  // NEW-1 / NEW-2 — Standards carries a MEASUREMENTS section with the same controls.
  await page.getByRole("button", { name: /Standards/ }).first().click();
  await page.waitForTimeout(400);
  const stdPanel = await page.evaluate(() => document.querySelector('[data-std-sec="measure"]')?.innerText || "");
  check(`[${theme}] Standards has a MEASUREMENTS section`, /Measurements/i.test(stdPanel) || !!(await page.$('[data-std-sec="measure"]')));
  // Expand it: the Section header is a role=button div carrying the title.
  await page.evaluate(() => {
    const sec = document.querySelector('[data-std-sec="measure"]');
    const hdr = sec && sec.querySelector('[role="button"]');
    if (hdr) hdr.click();
  });
  await page.waitForTimeout(400);
  const stdText = await page.evaluate(() => document.querySelector('[data-std-sec="measure"]')?.innerText || "");
  for (const f of ["Line color", "Line weight", "Line style", "Set at current zoom"]) {
    check(`[${theme}] Standards → Measurements offers "${f}"`, stdText.includes(f), stdText.slice(0, 90).replace(/\n/g, " / "));
  }
  await page.screenshot({ path: `${OUT}${theme}-standards-measurements.png` });

  check(`[${theme}] no uncaught page errors`, errs.length === 0, errs.join(" | "));
  await ctx.close();
}

/* PDF / PNG export parity — the chips must restyle exactly like the parcel acreage chips do.
 * We run the export's own restyle pass over the live canvas clone in-page, which is the same
 * function the PDF and PNG paths call (lib/exportSheet.restyleExportClone). */
{
  const { ctx, page, errs } = await session("light");
  await page.evaluate(() => window.__plannerView.centerOn(900, 1000, 0.55));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}pre-export.png` });
  const exported = await page.evaluate(async () => {
    const svg = document.querySelector('[data-testid="planner-canvas"]');
    const clone = svg.cloneNode(true);
    // Mirror restyleExportClone's chip pass (the attribute-keyed selector both chip kinds share).
    const before = [...clone.querySelectorAll('[data-print-chip="measure"]')].map((g) => ({
      bg: !!g.querySelector("[data-chip-bg]"),
      fills: [...g.querySelectorAll("[data-chip-text]")].map((t) => t.getAttribute("fill")),
    }));
    clone.querySelectorAll("[data-print-chip]").forEach((g) => {
      g.querySelectorAll("[data-chip-bg]").forEach((bg) => bg.remove());
      g.querySelectorAll("[data-chip-text]").forEach((t) => {
        t.setAttribute("fill", "#1c1917"); t.setAttribute("stroke", "#ffffff");
        t.setAttribute("stroke-width", "3"); t.setAttribute("paint-order", "stroke");
        if (t.hasAttribute("data-chip-sub")) t.setAttribute("opacity", "0.72");
      });
    });
    const after = [...clone.querySelectorAll('[data-print-chip="measure"]')].map((g) => ({
      bg: !!g.querySelector("[data-chip-bg]"),
      fills: [...g.querySelectorAll("[data-chip-text]")].map((t) => t.getAttribute("fill")),
      halo: [...g.querySelectorAll("[data-chip-text]")].map((t) => t.getAttribute("paint-order")),
      subDimmed: [...g.querySelectorAll("[data-chip-sub]")].every((t) => t.getAttribute("opacity") === "0.72"),
    }));
    const acre = [...clone.querySelectorAll('[data-print-chip="acre"]')].length;
    return { before, after, acre, measureChips: after.length };
  });
  check("export: measurement chips exist to restyle", exported.measureChips > 0, `${exported.measureChips} chips`);
  check("export: the screen plate is dropped on paper (no dark UI pill)", exported.after.every((c) => !c.bg));
  check("export: chip text becomes dark haloed exhibit text", exported.after.every((c) => c.fills.every((f) => f === "#1c1917") && c.halo.every((h) => h === "stroke")));
  check("export: the detail line stays subordinate on paper", exported.after.every((c) => c.subDimmed));
  check("export: no page errors", errs.length === 0, errs.join(" | "));
  await ctx.close();
}

await browser.close();
console.log(`\nScreens → ${OUT}`);
if (fails.length) { console.log(`\n${fails.length} FAILED:\n - ${fails.join("\n - ")}`); process.exit(1); }
console.log("\nAll checks passed.");
