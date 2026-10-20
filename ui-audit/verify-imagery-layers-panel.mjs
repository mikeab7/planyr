/* Headless verifier for the Imagery & Layers two-pane redesign (NEW-1, owner-approved mockup round 3, 2026-10-20).
 * Drives the REAL panel (components/LayerPanel.jsx, via ui-audit/imagery-layers-harness.html) in Chromium over a `vite` dev
 * server and asserts the rendered DOM against the owner's acceptance list:
 *
 *   LAYOUT      no text box overlaps another · nothing clipped or ellipsised in the left pane · every closed row is ONE line,
 *               its name whole · exactly ONE dropdown open at a time · no source/vintage text anywhere until ⓘ is pressed ·
 *               no horizontal overflow — at phone (group dropdown) + desktop (two pane) widths, light + dark, both surfaces.
 *   LOCATION    a Georgia site shows no Houston-only or Texas-only row · a Harris site shows Drainage District · a Colorado site
 *               shows MHFD rows and no Texas ones · the ETJ key entry exists only on a Texas site.
 *   CONTROLS    Contour Interval (1/2/5/10) changes the row's value and persists per device · the easement corridor lives in the
 *               Pipelines dropdown (checkbox + width, a saved odd width still shows) and the old row is gone · opacity slider and
 *               typed % stay in sync · "Too far out to draw" + Zoom In · Hide Layers changes NO saved state and hollows the dots ·
 *               turning a layer on while hidden ends the hide · the last group is remembered.
 *
 * ⛔ KNOWN-GOOD ARM (FOREGROUND-OR-VOID / the instrument is on trial): the overlap detector is first pointed at a page with a
 * DELIBERATE overlap and must flag it, and at a clean pair and must not — a run whose detector cannot see overlap is VOID, not green.
 *
 * Run:  npm run dev -- --port 5199 --strictPort   (in the background)
 *       node ui-audit/verify-imagery-layers-panel.mjs        (BASE_URL defaults to :5199; PW_CHROME = a Chromium binary)
 */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:5199";
const URL = `${BASE}/ui-audit/imagery-layers-harness.html`;
const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); };

const HOUSTON = "state=TX&lat=29.76&lng=-95.37&county=harris";
const ATLANTA = "state=GA&lat=33.75&lng=-84.39&county=none";
const DENVER = "state=CO&lat=39.74&lng=-104.99&county=co_denver";
const CASES = [
  { name: "planner · desktop · light", q: `surface=planner&w=384&theme=light&${HOUSTON}`, vw: 520 },
  { name: "planner · desktop · dark", q: `surface=planner&w=384&theme=dark&${HOUSTON}`, vw: 520 },
  { name: "finder · desktop · light", q: `surface=finder&w=384&theme=light&${HOUSTON}`, vw: 520 },
  { name: "finder · desktop · dark", q: `surface=finder&w=384&theme=dark&${HOUSTON}`, vw: 520 },
  { name: "planner · phone · light", q: `surface=planner&w=300&theme=light&${HOUSTON}`, vw: 340 },
  { name: "finder · phone · dark", q: `surface=finder&w=300&theme=dark&${HOUSTON}`, vw: 340 },
  { name: "finder · phone · light · Georgia", q: `surface=finder&w=300&theme=light&${ATLANTA}`, vw: 340 },
  { name: "planner · desktop · dark · Colorado", q: `surface=planner&w=384&theme=dark&${DENVER}`, vw: 520 },
];

/* In-page measuring helpers, injected once per page. Text boxes are measured with Range rects so a clipped/wrapped line counts as the
 * box the eye sees, not the element's layout box. */
const INJECT = () => {
  window.__textBoxes = (root) => {
    const out = [];
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement;
      const cs = el && getComputedStyle(el);
      if (!cs || cs.visibility === "hidden" || cs.display === "none") continue;
      const r = document.createRange(); r.selectNodeContents(n);
      for (const b of r.getClientRects()) if (b.width > 0.5 && b.height > 0.5) out.push({ x: b.left, y: b.top, r: b.right, b: b.bottom, text: n.textContent.trim().slice(0, 30), el });
    }
    return out;
  };
  /* Pairs of text boxes (from different elements) that overlap by more than 1px in BOTH axes. */
  window.__overlaps = (root) => {
    const boxes = window.__textBoxes(root);
    const hits = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], c = boxes[j];
        if (a.el === c.el) continue;
        const ox = Math.min(a.r, c.r) - Math.max(a.x, c.x), oy = Math.min(a.b, c.b) - Math.max(a.y, c.y);
        if (ox > 1 && oy > 1) hits.push(`${a.text} ⨯ ${c.text}`);
      }
    }
    return hits;
  };
};

const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors"], ...(process.env.PW_CHROME ? { executablePath: process.env.PW_CHROME } : {}) });
const errors = [];
async function open(q, vw = 520) {
  const page = await browser.newPage({ viewport: { width: vw, height: 820 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(`${URL}?${q}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__READY__ === true, { timeout: 20000 });
  await page.evaluate(INJECT);
  await page.waitForTimeout(250);
  return page;
}
const visibleGroupKeys = (page) => page.evaluate(() => {
  const nav = document.querySelector('[data-testid="layer-group-nav"]');
  if (nav) return [...nav.querySelectorAll("[data-testid^='layer-group-']")].map((b) => b.getAttribute("data-testid").replace("layer-group-", "")).filter((k) => !k.startsWith("count-"));
  const sel = document.querySelector('[data-testid="layer-group-select"]');
  return sel ? [...sel.options].map((o) => o.value) : [];
});
async function selectGroup(page, key) {
  const nav = await page.$('[data-testid="layer-group-nav"]');
  if (nav) await page.click(`[data-testid="layer-group-${key}"]`);
  else await page.selectOption('[data-testid="layer-group-select"]', key);
  await page.waitForTimeout(120);
}
const rowLabels = (page) => page.evaluate(() => [...document.querySelectorAll('[data-testid^="layer-row-"]')]
  .filter((r) => !r.getAttribute("data-testid").endsWith("-menu"))
  .map((r) => (r.querySelector("label span[title]") || r.querySelector("label") || r).textContent.trim()));
const paneText = (page) => page.evaluate(() => document.querySelector('[data-testid="layer-pane"]').innerText.replace(/\s+/g, " "));

try {
  // ───────────────────────── 0) the instrument on trial ─────────────────────────
  {
    const page = await open(`surface=planner&w=384&${HOUSTON}`);
    await assertMeasurable(page, "verify-imagery-layers-panel");
    const probe = await page.evaluate(() => {
      const host = document.createElement("div");
      host.id = "probe"; host.style.cssText = "position:relative;width:200px;height:60px";
      host.innerHTML = '<span style="position:absolute;left:0;top:0">Alpha overlap</span><span style="position:absolute;left:20px;top:2px">Beta overlap</span><span style="position:absolute;left:0;top:30px">Clear below</span>';
      document.body.appendChild(host);
      const dirty = window.__overlaps(host);
      host.innerHTML = '<span style="position:absolute;left:0;top:0">Alpha</span><span style="position:absolute;left:120px;top:0">Beta</span>';
      const clean = window.__overlaps(host);
      host.remove();
      return { dirty: dirty.length, clean: clean.length };
    });
    ok("instrument: the overlap detector flags a DELIBERATE overlap (known-bad arm)", probe.dirty >= 1, JSON.stringify(probe));
    ok("instrument: …and reports none for a clean pair (known-good arm)", probe.clean === 0, JSON.stringify(probe));
    await page.close();
  }

  // ───────────────────────── 1) layout matrix ─────────────────────────
  for (const c of CASES) {
    const page = await open(c.q, c.vw);
    const phone = c.q.includes("w=300");
    const keys = await visibleGroupKeys(page);
    ok(`${c.name}: ${phone ? "group DROPDOWN" : "two-pane group list"} (no ⓘ/⋯ crowding)`, phone ? !!(await page.$('[data-testid="layer-group-select"]')) && !(await page.$('[data-testid="layer-group-nav"]')) : !!(await page.$('[data-testid="layer-group-nav"]')), keys.join(","));
    const hdr = await page.evaluate(() => {
      const h = document.querySelector('[data-testid="layers-header"]');
      const t = h.querySelector('[data-testid="layers-collapse"]');
      return { title: t && t.textContent.trim(), hide: h.querySelector('[data-testid="layers-hide-toggle"]')?.textContent.trim(), more: !!h.querySelector('[data-testid="layers-more"]'), noCount: !/\d+ on\b/.test(h.textContent), noTurnAll: !document.querySelector('[data-testid="layer-panel"]').innerText.includes("Turn all") };
    });
    ok(`${c.name}: header is ▾ Imagery & Layers · Hide Layers · ⋯ (no "N on", no full-width Turn-all bar)`, hdr.title === "▾Imagery & Layers" || /Imagery & Layers/.test(hdr.title || ""), JSON.stringify(hdr));
    ok(`${c.name}: header carries the pill and the ⋯ and nothing else`, hdr.hide === "Hide Layers" && hdr.more && hdr.noCount && hdr.noTurnAll, JSON.stringify(hdr));

    for (const key of keys) {
      await selectGroup(page, key);
      const label = `${c.name} › ${key}`;
      const snap = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="layer-panel"]');
        const card = document.querySelector("#scroll");
        const rows = [...document.querySelectorAll('[data-testid^="layer-row-"]')].filter((r) => !r.getAttribute("data-testid").endsWith("-menu"));
        const tall = [], clipped = [];
        for (const r of rows) {
          const line = r.firstElementChild; // the one-line row
          if (line && line.getBoundingClientRect().height > 34) tall.push(r.getAttribute("data-testid"));
          const nm = r.querySelector("label span[title]");
          if (nm && nm.scrollWidth > nm.clientWidth + 1) clipped.push(nm.textContent.trim());
        }
        const navClipped = [...document.querySelectorAll("[data-testid^='layer-group-']")].filter((b) => b.tagName === "BUTTON").flatMap((b) => {
          const s = b.querySelector("span"); return s && (s.scrollWidth > s.clientWidth + 1 || /(\w-?)$/.test("") ) ? [s.textContent.trim()] : [];
        });
        // a nav label must wrap at WORD boundaries only — measure each word's own box against the label's box
        const midWord = [];
        document.querySelectorAll("[data-testid='layer-group-nav'] button span:first-child").forEach((s) => {
          const w = document.createRange(); w.selectNodeContents(s);
          const words = s.textContent.trim().split(/\s+/);
          const single = document.createElement("span"); single.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;font:inherit"; s.appendChild(single);
          for (const word of words) { single.textContent = word; if (single.getBoundingClientRect().width > s.clientWidth + 0.5) midWord.push(word); }
          single.remove();
        });
        return {
          // VISIBLE overflow only: no element's painted box may cross the panel's right edge. (`scrollWidth` also counts the invisible 44px
          // tap-target pseudo-element IconButton extends, which is not something a person can see or scroll to.)
          overflowRoot: [...root.querySelectorAll("*")].some((e) => e.getBoundingClientRect().right > root.getBoundingClientRect().right + 1 && getComputedStyle(e).visibility !== "hidden"),
          overflowCard: card ? card.scrollWidth > card.clientWidth + 1 : false,
          tall, clipped, navClipped, midWord, openMenus: document.querySelectorAll('[data-testid$="-menu"]').length,
          overlaps: window.__overlaps(root), rows: rows.length,
        };
      });
      ok(`${label}: no horizontal overflow`, !snap.overflowRoot && !snap.overflowCard);
      ok(`${label}: no text box overlaps another`, snap.overlaps.length === 0, snap.overlaps.slice(0, 3).join(" | "));
      ok(`${label}: every closed row is ONE line`, snap.tall.length === 0, snap.tall.join(","));
      ok(`${label}: no row name clipped or ellipsised`, snap.clipped.length === 0, snap.clipped.join(" | "));
      ok(`${label}: group names wrap at word boundaries — never clipped, never split mid-word`, snap.midWord.length === 0 && snap.navClipped.length === 0, JSON.stringify({ mid: snap.midWord, clip: snap.navClipped }));
      ok(`${label}: nothing open by default`, snap.openMenus === 0);
      ok(`${label}: no source / vintage text visible until ⓘ`, !/Source:|As of:/.test(await paneText(page)));

      // one dropdown at a time: open every caret in turn
      const carets = await page.$$('[data-testid^="layer-caret-"]');
      const ids = [];
      for (const cEl of carets) ids.push((await cEl.getAttribute("data-testid")).replace("layer-caret-", ""));
      let maxOpen = 0, overlapsOpen = [];
      for (const id of ids) {
        await page.click(`[data-testid="layer-caret-${id}"]`);
        await page.waitForTimeout(40);
        const n = await page.evaluate(() => document.querySelectorAll('[data-testid$="-menu"]').length);
        maxOpen = Math.max(maxOpen, n);
        const ov = await page.evaluate(() => window.__overlaps(document.querySelector('[data-testid="layer-panel"]')));
        if (ov.length) overlapsOpen.push(`${id}: ${ov[0]}`);
      }
      ok(`${label}: exactly ONE dropdown open at a time (${ids.length} rows opened in turn)`, ids.length === 0 || maxOpen === 1, `max open ${maxOpen}`);
      ok(`${label}: no overlaps with any dropdown open`, overlapsOpen.length === 0, overlapsOpen.slice(0, 2).join(" | "));
      if (ids.length) await page.click(`[data-testid="layer-caret-${ids[ids.length - 1]}"]`); // close
    }
    await page.close();
  }

  // ───────────────────────── 2) location ─────────────────────────
  const rowsAcross = async (q, vw = 520) => {
    const page = await open(q, vw);
    const keys = await visibleGroupKeys(page);
    const all = {}, tiers = [];
    for (const k of keys) {
      await selectGroup(page, k);
      all[k] = await rowLabels(page);
      if (k === "flood") tiers.push(...(await page.evaluate(() => [...document.querySelectorAll("[data-testid^='flood-tier-']")].map((t) => t.getAttribute("data-testid").replace("flood-tier-", "")))));
    }
    await page.close();
    return { keys, all, tiers, flat: Object.values(all).flat() };
  };
  const ga = await rowsAcross(`surface=finder&w=384&${ATLANTA}`);
  const TX_ONLY = ["Road Ownership", "School Districts", "Water & Sewer", "Oil & Gas Wells", "Leaking Petroleum Tanks", "Traffic Counts", "Pipelines"];
  const HOUSTON_ONLY = ["Channels & ROW", "Watersheds & BFE", "Drainage Easements", "Storm Sewer", "Master Plan Floodplains", "Active Surface Faults"];
  ok("Georgia: no Texas-only row appears anywhere (Road Ownership · School Districts · Water & Sewer · Oil & Gas Wells · LPST · TxDOT counts)", TX_ONLY.filter((n) => ga.flat.some((x) => x.startsWith(n) && n !== "Pipelines")).length === 0, JSON.stringify(ga.all));
  ok("Georgia: no Houston-only row appears (HCFCD / BKDD / Storm Sewer / Master Plan / faults)", HOUSTON_ONLY.filter((n) => ga.flat.includes(n)).length === 0, JSON.stringify(ga.all));
  ok("Georgia: the Pipelines row IS offered (the approximate EIA lines drive it) and Drainage District is absent", ga.flat.includes("Pipelines") && !ga.tiers.includes("local"), JSON.stringify({ tiers: ga.tiers, env: ga.all.env }));
  ok("Georgia: Counties & Cities is ONE row", ga.flat.filter((x) => x === "Counties & Cities").length === 1);
  const hx = await rowsAcross(`surface=planner&w=384&${HOUSTON}`);
  ok("Harris County: Drainage District shows its rows (Channels & ROW · Watersheds & BFE · Drainage Easements · Storm Sewer)", hx.tiers.includes("local") && ["Channels & ROW", "Watersheds & BFE", "Drainage Easements", "Storm Sewer"].every((n) => hx.flat.includes(n)), JSON.stringify(hx.all.flood));
  ok("Harris County: Texas rows present (Road Ownership · Oil & Gas Wells · Active Surface Faults) and Houston utilities fold into Water & Sewer", ["Road Ownership", "Oil & Gas Wells", "Active Surface Faults", "Water & Sewer"].every((n) => hx.flat.includes(n)), JSON.stringify(hx.all));
  ok("Group order is Map Base · Topography · Jurisdictions · Flood & Drainage · Utilities · Environmental · Access", JSON.stringify(hx.keys) === JSON.stringify(["base", "topo", "jur", "flood", "util", "env", "access"]), JSON.stringify(hx.keys));
  const co = await rowsAcross(`surface=planner&w=384&${DENVER}`);
  ok("Colorado: MHFD rows sit under Drainage District (Drainageways & Basins · Channels & Outfalls)", co.tiers.includes("local") && co.flat.includes("Drainageways & Basins") && co.flat.includes("Channels & Outfalls"), JSON.stringify(co.all.flood));
  ok("Colorado: no Texas row (Road Ownership · Oil & Gas · LPST · Pipelines · HCFCD/BKDD/Storm Sewer/faults)", [...["Road Ownership", "Oil & Gas Wells", "Leaking Petroleum Tanks", "Pipelines"], ...HOUSTON_ONLY].every((n) => !co.flat.includes(n)), JSON.stringify(co.all));
  const un = await rowsAcross(`surface=planner&w=384&state=none&lat=none&county=harris`);
  ok("Unknown location fails OPEN: every state's rows show", ["Road Ownership", "Oil & Gas Wells", "Channels & ROW"].every((n) => un.flat.includes(n)) && un.flat.some((x) => /Hazardous Sites/.test(x)), `${un.flat.length} rows`);

  // ETJ only on a Texas site — the key inside the Counties & Cities dropdown
  const keyOf = async (q) => {
    const page = await open(q + "&on=jur_county,jur_city,jur_etj,ga_county,ga_city");
    await selectGroup(page, "jur");
    await page.click('[data-testid="layer-caret-counties_cities"]');
    const txt = await page.evaluate(() => document.querySelector('[data-testid="layer-row-counties_cities-menu"] [data-part="legend"]')?.innerText.replace(/\s+/g, " ") || "");
    await page.close();
    return txt;
  };
  const txKey = await keyOf(`surface=planner&w=384&${HOUSTON}`), gaKey = await keyOf(`surface=planner&w=384&${ATLANTA}`);
  ok("Counties & Cities key on a Texas site: County · City Limits · ETJ", /County/.test(txKey) && /City Limits/.test(txKey) && /ETJ/.test(txKey), txKey);
  ok("Counties & Cities key on a Georgia site: County · City Limits, and NO ETJ (ETJ is Texas-only)", /County/.test(gaKey) && /City Limits/.test(gaKey) && !/ETJ/.test(gaKey), gaKey);

  // ───────────────────────── 3) controls ─────────────────────────
  {
    // contour interval
    let page = await open(`surface=planner&w=384&${HOUSTON}&on=contours`);
    await page.evaluate(() => localStorage.removeItem("planyr:contourInterval"));
    await selectGroup(page, "topo");
    await page.click('[data-testid="layer-caret-contours"]');
    const opts = await page.$$eval('[data-testid="contour-interval"] option', (o) => o.map((x) => x.textContent));
    ok("Contour Lines dropdown: Interval is a standard select of 1 ft / 2 ft / 5 ft / 10 ft", JSON.stringify(opts) === JSON.stringify(["1 ft", "2 ft", "5 ft", "10 ft"]), JSON.stringify(opts));
    const vals = [];
    for (const v of ["2", "5", "10", "1"]) {
      await page.selectOption('[data-testid="contour-interval"]', v);
      await page.waitForTimeout(80);
      vals.push(await page.textContent('[data-testid="layer-value-contours"]'));
    }
    ok("the row shows the current interval (2′ · 5′ · 10′ · 1′)", JSON.stringify(vals.map((x) => x.trim())) === JSON.stringify(["2′", "5′", "10′", "1′"]), JSON.stringify(vals));
    await page.selectOption('[data-testid="contour-interval"]', "5");
    ok("the interval persists on this device (localStorage planyr:contourInterval)", (await page.evaluate(() => localStorage.getItem("planyr:contourInterval"))) === "5");
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.__READY__ === true);
    await selectGroup(page, "topo");
    ok("…and a fresh page load still reads 5′", (await page.textContent('[data-testid="layer-value-contours"]')).trim() === "5′");
    await page.evaluate(() => localStorage.removeItem("planyr:contourInterval"));
    await page.close();

    // easement corridor
    page = await open(`surface=planner&w=384&${HOUSTON}&on=txrrc_pipe&corridor=on&corridorWidth=60`);
    await selectGroup(page, "env");
    const labels = await rowLabels(page);
    ok("the old 'Pipeline easement corridor (assumed)' row no longer exists", !labels.some((x) => /easement corridor/i.test(x)) && labels.includes("Pipelines"), JSON.stringify(labels));
    await page.click('[data-testid="layer-caret-pipelines"]');
    ok("Pipelines dropdown: 'Easement corridor' checkbox, ON for a saved corridor-on plan", await page.isChecked('[data-testid="pipeline-corridor"]'));
    const wopts = await page.$$eval('[data-testid="pipeline-corridor-width"] option', (o) => o.map((x) => x.textContent));
    ok("…width dropdown 25/50/75/100 ft, PLUS the saved odd width (60 ft) which still shows", JSON.stringify(wopts) === JSON.stringify(["25 ft", "50 ft", "60 ft", "75 ft", "100 ft"]), JSON.stringify(wopts));
    ok("…and selects the saved width", (await page.inputValue('[data-testid="pipeline-corridor-width"]')) === "60");
    await page.selectOption('[data-testid="pipeline-corridor-width"]', "100");
    ok("changing the width writes widthFt on the SAME txrrc_pipe_easement key", (await page.evaluate(() => window.__overlays.txrrc_pipe_easement.widthFt)) === 100);
    await page.uncheck('[data-testid="pipeline-corridor"]');
    ok("unchecking writes txrrc_pipe_easement.on=false (same key and state as before)", (await page.evaluate(() => window.__overlays.txrrc_pipe_easement.on)) === false);
    await page.close();

    // opacity: slider + typed %, in sync
    page = await open(`surface=planner&w=384&${HOUSTON}&on=fema`);
    await selectGroup(page, "flood");
    await page.click('[data-testid="layer-caret-fema"]');
    const typed = page.locator('[data-testid="layer-row-fema-menu"] input[type="text"]');
    await typed.fill("30");
    ok("typing 30 in the % box sets the saved opacity to 0.30 and the slider follows", (await page.evaluate(() => window.__overlays.fema.opacity)) === 0.3 && (await page.inputValue('[data-testid="layer-row-fema-menu"] input[type="range"]')) === "0.3");
    await page.fill('[data-testid="layer-row-fema-menu"] input[type="range"]', "0.7");
    ok("dragging the slider to 70% updates the typed box", (await typed.inputValue()) === "70");
    ok("the word is 'Opacity' everywhere — never 'See-through'", !/see.?through/i.test(await page.evaluate(() => document.body.innerText)) && /Opacity/.test(await page.evaluate(() => document.body.innerText)));
    ok("FEMA's ⓘ holds the facts note + the FEMA-vs-channels line (reachable, not visible)", await (async () => {
      const before = await paneText(page);
      await page.click('[data-testid="layer-row-fema-menu"] button[aria-label^="About"]');
      const info = await page.textContent('[data-testid="layer-info-text"]');
      return !/FEMA maps flood ZONES|As of:|Agency:/.test(before) && /FEMA maps flood ZONES, not channels/.test(info) && /As of:/.test(info) && /Agency: FEMA/.test(info);
    })());
    await page.close();

    // too far out + Zoom In
    page = await open(`surface=planner&w=384&${HOUSTON}&on=contours&zoom=10`);
    await selectGroup(page, "topo");
    await page.click('[data-testid="layer-caret-contours"]');
    const zt = await page.textContent('[data-testid="layer-zoom-note"]');
    ok("a gated row's dropdown leads with 'Too far out to draw' and a Zoom In button", /Too far out to draw/.test(zt) && !!(await page.$('[data-testid="layer-zoom-fix"]')));
    ok("the row itself shows no 'zoom in N levels' line", !/zoom in \d/i.test(await paneText(page)));
    await page.click('[data-testid="layer-zoom-fix"]');
    ok("Zoom In asks the host to go to the layer's gate", Number(await page.evaluate(() => window.__lastZoom)) >= 13);
    await page.close();

    // elevation ramp
    page = await open(`surface=planner&w=384&${HOUSTON}&on=elevation`);
    await selectGroup(page, "topo");
    await page.click('[data-testid="layer-caret-elevation"]');
    const ramp = await page.evaluate(() => {
      const r = document.querySelector('[data-testid="layer-row-elevation-menu"] [data-part="ramp"]');
      return r ? { grad: r.firstElementChild.style.background, text: r.innerText.replace(/\s+/g, " ") } : null;
    });
    ok("Elevation Shading's dropdown carries a Lower → Higher colour bar built from the layer's own ramp (blue → cream → red)", !!ramp && /Lower/.test(ramp.text) && /Higher/.test(ramp.text) && /rgb\(49, 54, 149\)/.test(ramp.grad) && /rgb\(255, 255, 191\)/.test(ramp.grad) && /rgb\(215, 48, 39\)/.test(ramp.grad), JSON.stringify(ramp));
    await page.close();

    // Hide Layers
    page = await open(`surface=planner&w=384&${HOUSTON}&on=fema,contours,txrrc_pipe`);
    const before = JSON.stringify(await page.evaluate(() => window.__overlays));
    await page.click('[data-testid="layers-hide-toggle"]');
    await selectGroup(page, "flood");
    const hid = await page.evaluate(() => ({
      label: document.querySelector('[data-testid="layers-hide-toggle"]').textContent.trim(),
      pressed: document.querySelector('[data-testid="layers-hide-toggle"]').getAttribute("aria-pressed"),
      checked: document.querySelector('[data-testid="layer-row-fema"] input[type="checkbox"]').checked,
      dot: document.querySelector('[data-testid="layer-row-fema"] [data-layer-dot]')?.getAttribute("data-layer-dot"),
      saved: JSON.stringify(window.__overlays),
    }));
    ok("Hide Layers flips the pill to 'Show Layers'", hid.label === "Show Layers" && hid.pressed === "true", JSON.stringify(hid));
    ok("…without unchecking anything: the saved overlay state is BYTE-IDENTICAL", hid.saved === before && hid.checked === true);
    ok("…and a checked row's status dot reads as a hollow 'hidden' dot", hid.dot === "hidden", hid.dot);
    await page.click('[data-testid="layers-hide-toggle"]');
    const back = await page.evaluate(() => ({ label: document.querySelector('[data-testid="layers-hide-toggle"]').textContent.trim(), saved: JSON.stringify(window.__overlays), dots: document.querySelectorAll('[data-layer-dot="hidden"]').length }));
    ok("Show Layers puts back exactly what was on (saved state still byte-identical, no hidden dots)", back.label === "Hide Layers" && back.saved === before && back.dots === 0);
    await page.click('[data-testid="layers-hide-toggle"]');
    await selectGroup(page, "flood");
    await page.check('[data-testid="layer-row-hcfcd_row"] input[type="checkbox"]');
    ok("turning a layer ON while hidden ends the hide", (await page.textContent('[data-testid="layers-hide-toggle"]')).trim() === "Hide Layers");
    await page.close();

    // ⋯ menu
    page = await open(`surface=planner&w=384&${HOUSTON}&on=fema,contours&relevance=dim`);
    await page.click('[data-testid="layers-more"]');
    const menu = await page.evaluate(() => document.querySelector('[data-testid="layers-more-menu"]')?.innerText.replace(/\s+/g, " ") || "");
    ok("⋯ menu: Turn all layers off · Layers with no data here (Show / Dim / Hide) · the one screening line", /Turn all layers off/.test(menu) && /Layers with no data here/.test(menu) && /Show/.test(menu) && /Dim/.test(menu) && /Hide/.test(menu) && /Screening data\. Verify before relying on it\./.test(menu), menu);
    await page.click('[data-testid="layers-clear-all"]');
    ok("Turn all layers off clears every layer (same sweep as before)", (await page.evaluate(() => Object.values(window.__overlays).filter((o) => o.on).length)) === 0);
    await page.close();

    // last-selected group is remembered per device
    page = await open(`surface=planner&w=384&${HOUSTON}`);
    await page.evaluate(() => localStorage.removeItem("planyr:layerPanelGroup"));
    await selectGroup(page, "flood");
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => window.__READY__ === true);
    ok("the last-selected group is remembered per device (Flood & Drainage after a reload)", (await page.getAttribute('[data-testid="layer-pane"]', "data-group")) === "flood");
    await page.evaluate(() => localStorage.removeItem("planyr:layerPanelGroup"));
    await page.close();

    // collapse + unlocated
    page = await open(`surface=planner&w=384&${HOUSTON}`);
    await page.click('[data-testid="layers-collapse"]');
    ok("clicking the title collapses the panel", !!(await page.$("#expand")) && !(await page.$('[data-testid="layer-panel"]')));
    await page.close();
    page = await open(`surface=planner&w=384&unlocated=1&state=none&lat=none`);
    const un2 = await page.evaluate(() => ({ nav: !!document.querySelector('[data-testid="layer-group-nav"]'), btn: !!document.querySelector('[data-testid="layers-set-location"]'), disabled: document.querySelector('[data-testid="basemap-source"]').disabled }));
    ok("an unlocated plan shows only Map Base: the disabled source, the reason and the Set-location button", !un2.nav && un2.btn && un2.disabled, JSON.stringify(un2));
    await page.close();

    // Your Data (finder) + Labels
    page = await open(`surface=finder&w=384&${HOUSTON}`);
    const base = await page.evaluate(() => document.querySelector('[data-testid="layer-pane"]').innerText.replace(/\s+/g, " "));
    ok("Map Base (finder): Satellite Imagery Source · Labels (Road Names, City Names) · Your Data (Sites, Comps, Notes)", /Satellite Imagery Source/.test(base) && /Labels/.test(base) && /Road Names/.test(base) && /City Names/.test(base) && /Your Data/.test(base) && /Sites/.test(base) && /Comps/.test(base) && /Notes/.test(base) && !/Aerial/.test(base), base);
    const sel = await page.$$eval('[data-testid="basemap-source"] option', (o) => o.map((x) => x.textContent));
    ok("the imagery source is a standard dropdown (Esri / USGS)", JSON.stringify(sel) === JSON.stringify(["Esri", "USGS"]), JSON.stringify(sel));
    await page.close();
    page = await open(`surface=planner&w=384&${HOUSTON}`);
    const sel2 = await page.$$eval('[data-testid="basemap-source"] option', (o) => o.map((x) => x.textContent));
    const base2 = await page.evaluate(() => document.querySelector('[data-testid="layer-pane"]').innerText.replace(/\s+/g, " "));
    ok("the planner keeps its Off choice (Off / Esri / USGS) and has no Your Data / City Names", JSON.stringify(sel2) === JSON.stringify(["Off", "Esri", "USGS"]) && !/Your Data|City Names/.test(base2), JSON.stringify(sel2));
    await page.close();
  }

  // ───────────────────────── 4) brevity numbers (PANEL-BREVITY rule 7) ─────────────────────────
  {
    const page = await open(`surface=planner&w=384&${HOUSTON}&on=fema,contours`);
    const brev = {};
    for (const k of ["base", "topo", "jur", "flood", "util", "env", "access"]) {
      await selectGroup(page, k);
      brev[k] = await page.evaluate(() => {
        const root = document.querySelector('[data-testid="layer-panel"]');
        const boxes = window.__textBoxes(root);
        const lines = new Set(boxes.map((b) => Math.round(b.y / 4))).size;
        return { lines, chars: root.innerText.replace(/\s+/g, " ").trim().length };
      });
    }
    console.log("PANEL-BREVITY (planner, Harris, FEMA + Contour Lines on) — visible text lines / characters per group:", JSON.stringify(brev));
    await page.close();
  }
} finally {
  await browser.close();
}

ok("no page errors while rendering", errors.length === 0, errors.slice(0, 3).join(" | "));
const fail = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass || !r.detail ? "" : `\n        ↳ ${r.detail}`}`);
console.log(`\n${results.length - fail.length}/${results.length} passed${fail.length ? ` — ${fail.length} FAILED` : ""}`);
process.exit(fail.length ? 1 : 0);
