/* verify-grading-harness — drives the REAL GradingController + panels (ui-audit/harness/grading-harness.*) in a
 * browser against the real Chehaw Rd parcel + USGS 3DEP lattice. Exercises what Node cannot: the worker protocol
 * (sweep + mask jobs), the controller hooks, the FFE suggestion (balanced dirt, pond spoil, rock), the painted
 * layers and the labels. The is_admin gate is NOT under test here (test/gradingGate.test.js owns it); this proves
 * the gated code works.
 *   node ui-audit/verify-grading-harness.mjs        (starts its own vite dev server on :5199) */
import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const PORT = 5199, BASE = `http://localhost:${PORT}`;
const EXEC = process.env.PW_CHROME || undefined;
const fails = [], notes = [];
const check = (name, ok, extra = "") => { (ok ? notes : fails).push(`${ok ? "✓" : "✗"} ${name}${extra ? " — " + extra : ""}`); };

const vite = spawn("npx", ["vite", "--port", String(PORT), "--strictPort"], { stdio: "ignore" });
try {
  for (let i = 0; i < 100; i++) { try { const r = await fetch(BASE); if (r.ok) break; } catch {} await sleep(300); }
  const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
  const errs = [];
  const open = async (qs = "") => {
    const page = await (await browser.newContext({ viewport: { width: 1500, height: 1000 } })).newPage();
    page.on("pageerror", (e) => errs.push(String(e)));
    page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
    await page.goto(`${BASE}/ui-audit/harness/grading-harness.html${qs}`);
    await assertMeasurable(page, "verify-grading-harness");
    await page.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    return page;
  };
  const ffeText = (page) => page.textContent("[data-ffe-value], [data-testid=\"grading-ffe\"]").catch(() => "");
  const readFfe = async (page) => {
    const v = await page.evaluate(() => { const a = document.querySelector("[data-ffe-value]"); if (a) return a.textContent; const i = document.querySelector('[data-testid="grading-ffe"]'); return i ? i.value : ""; });
    const m = /(-?\d+(\.\d+)?)/.exec(v || ""); return m ? +m[1] : null;
  };
  const waitFfe = async (page, t = 90000) => {
    const t0 = Date.now();
    await page.waitForFunction(() => { const a = document.querySelector("[data-ffe-value]"); return a && /\d/.test(a.textContent); }, null, { timeout: t });
    return Date.now() - t0;
  };
  const waitEarthwork = (page) => page.waitForFunction(() => { const e = document.querySelector("[data-grading-earthwork]"); return e && e.getAttribute("data-grading-earthwork") !== "pending"; }, null, { timeout: 90000 });

  // ================= 1. the default view: ground row, grading group, an FFE already there =================
  let page = await open("?buildable=0");
  await page.waitForSelector('[data-ground-state="ready"]', { timeout: 60000 });
  const fig = await page.textContent('[data-ground-figure]');
  const ac = parseFloat(fig);
  check("Ground row: best single pad is 35-40 AC", ac > 35 && ac < 40, fig);
  const subTxt = await page.textContent('[data-ground-row="level"]');
  const fin = +(/finish (\d+) ft/.exec(subTxt) || [])[1];
  check("Ground row: best finish 793-797", fin >= 793 && fin <= 797, `finish ${fin}`);
  check("Ground row: severity pill Workable", (await page.textContent('[data-ground-severity]')) === "Workable");
  check("Ground row: relief ~95 ft, 719 to 814", /9[3-7] ft · 719 to 814/.test(await page.textContent('[data-ground-row="relief"]')));

  const ms = await waitFfe(page);
  await waitEarthwork(page);
  await page.waitForTimeout(1200);
  const baseFfe = await readFfe(page);
  check("the FFE is ALREADY THERE (no chips, no pick prompt) — time to first number", baseFfe != null, `${baseFfe} ft after ${ms} ms`);
  check("FFE is a plausible balance for the Chehaw ground (790-805)", baseFfe > 790 && baseFfe < 805, `${baseFfe}`);
  const body = await page.textContent("#panel");
  check("no Building tab, no chips, no walls strip, no 'pick' prompt", !/Balanced dirt|Least dirt|Most room|Pick a chip|Pick a finish|Walls|role=\"tab\"/.test(body) && (await page.locator('[role="tab"]').count()) === 0);
  check("title line: Building 1 · 520×300 = 156,000 SF", /Building 1 · 156,000 SF/.test(await page.textContent("[data-card-title]")));
  check("FFE shown grey as auto", (await page.getAttribute("[data-ffe-value]", "data-ffe-value")) === "auto" && (await page.locator('[data-ffe-source="auto"]').count()) === 1);
  const basis = await page.textContent("[data-ffe-note]");
  check("basis leads with the balance clause in plain words", /^Balances the dirt: \d+k? CY cut( on the \w+)?, \d+k? CY fill( on the \w+)?; (nothing to haul|[\d,]+k? CY (import|export))\./.test(basis), basis);
  check("basis has at most three sentences and no slope ratio", (basis.match(/\.(\s|$)/g) || []).length <= 3 && !/\d:1/.test(basis), basis);
  const ew = await page.textContent("[data-grading-earthwork]");
  check("earthwork is ONE line: Cut · Fill · import/export/balanced", /^Cut [\d,]+ · Fill [\d,]+ · (Balanced|[\d,]+ CY (import|export))$/.test(ew), ew);
  const nums = (/Cut ([\d,]+) · Fill ([\d,]+)/.exec(ew) || []).slice(1).map((x) => +x.replace(/,/g, ""));
  check("the suggestion is balanced to within a few hundred CY", Math.abs(nums[1] - nums[0]) <= 1000, ew);
  check("settings are not visible in the card (behind the gear)", !/Pavement slope|Dock drop|Max cut or fill|Grading slopes/.test(await page.textContent("[data-grading-card]")) && (await page.locator('[data-grading-gear]').count()) === 1);
  check("clear when it daylights inside the setback", (await page.locator('[data-grading-flag="clear"]').count()) === 1);
  // ---- NEW-1 (amends B2315856): the left-dock Grading panel — cards first, Ground under them, the gear in the header
  check("the panel: cards first, then the three Ground rows (moved out of Site Analysis, not copied)", await page.evaluate(() => {
    const card = document.querySelector("[data-grading-card]"), g = document.querySelector('[data-section="ground"]');
    return !!card && !!g && !!(card.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING) && g.querySelectorAll("[data-ground-row]").length === 3;
  }));
  check("the settings gear + info ride the panel HEADER, not the body", await page.evaluate(() => {
    const head = document.querySelector("#panel-header-actions");
    return !!head && !!head.querySelector("[data-grading-gear]") && !document.querySelector('[data-grading-panel] [data-grading-gear]');
  }));
  // the Ground rows carry the ordinary row-label size at the panel's width (the dock body hands down a larger size; the panel must not inherit it)
  const gm = await page.evaluate(() => {
    const t = document.querySelector('[data-ground-row="level"] > div > span');
    const cs = getComputedStyle(t), lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.3;
    const r = t.getBoundingClientRect();
    return { font: parseFloat(cs.fontSize), lines: Math.round(r.height / lh), card: parseFloat(getComputedStyle(document.querySelector("[data-card-title]")).fontSize), relief: parseFloat(getComputedStyle(document.querySelector('[data-ground-row="relief"]')).fontSize), steep: parseFloat(getComputedStyle(document.querySelector('[data-ground-row="steep"]')).fontSize) };
  });
  check("Ground row title is at most two lines at the panel's width", gm.lines <= 2, JSON.stringify(gm));
  check("Ground rows use the same label size as the cards (not the dock's heading size)", gm.font === gm.card && gm.relief === gm.card && gm.steep === gm.card, JSON.stringify(gm));
  check("no 'Ground › Grading' group heading survives", !/Ground › Grading/.test(await page.textContent("#panel")));

  // ---- the level-ground alternative: one text link, sets the FFE (typed), basis says so, auto chip resets
  await page.waitForSelector("[data-alt-ffe]", { timeout: 60000 });
  const altTxt = await page.textContent("[data-alt-ffe]");
  const altE = +(await page.getAttribute("[data-alt-ffe]", "data-alt-ffe"));
  check("alternative reads 'Or sit it on the most level ground: FFE n (n AC stays level, n CY import|export)'", /^Or sit it on the most level ground: FFE \d+ \(\d+ AC stays level, [\d.k,]+ CY (import|export|balanced)\)$/.test(altTxt), altTxt);
  check("alternative IS the Ground row's best finish", altE === fin, `${altE} vs ${fin}`);
  check("only one alternative link", (await page.locator("[data-alt-ffe]").count()) === 1);
  await page.click("[data-alt-ffe]");
  await page.waitForFunction((e) => { const i = document.querySelector('[data-testid="grading-ffe"]'); return i && Math.abs(+i.value - e) < 0.01; }, altE, { timeout: 30000 });
  check("clicking it types the FFE (black field + auto chip)", (await page.locator('[data-ffe-source="typed"]').count()) === 1);
  await page.waitForFunction(() => /most level ground/.test(document.querySelector("[data-ffe-note]").textContent), null, { timeout: 30000 });
  check("basis line now says so", /Sitting it on the most level ground: \d+ AC stays level at this finish\./.test(await page.textContent("[data-ffe-note]")), await page.textContent("[data-ffe-note]"));
  check("the alternative link is gone once taken", (await page.locator("[data-alt-ffe]").count()) === 0);
  await waitEarthwork(page);
  const ew2 = await page.textContent("[data-grading-earthwork]");
  check("earthwork re-priced at the typed finish (not balanced any more)", /(import|export)/.test(ew2) && ew2 !== ew, ew2);

  // typing in place from auto, and the reset
  await page.click('[data-ffe-reset]');
  await waitFfe(page);
  await page.waitForTimeout(1500);
  check("the auto chip returns to the SAME suggestion", Math.abs((await readFfe(page)) - baseFfe) < 0.05, `${await readFfe(page)} vs ${baseFfe}`);
  await page.click("[data-ffe-value]");
  await page.fill('[data-testid="grading-ffe"]', "801");
  await page.keyboard.press("Enter");
  await page.waitForSelector('[data-ffe-source="typed"]');
  check("typing in place makes it typed", Math.abs((await readFfe(page)) - 801) < 0.01);
  check("typed basis offers the way back", /Reset to auto/.test(await page.textContent("[data-ffe-note]")));
  await page.click('[data-ffe-reset]');
  await waitFfe(page);

  // ---- layers: Cut & Fill (default ON) paints the SLOPES, never the pad
  await page.waitForSelector('[data-layer="cutfill"] image', { timeout: 30000 });
  check("Cut & Fill is on by default and painted (image + daylight line)", (await page.locator('[data-layer="cutfill"] image').count()) === 1 && (await page.locator('[data-layer="cutfill"] path').count()) === 2);
  check("Level-pad limit is OFF by default: no tint, no line", (await page.locator('[data-layer="buildable"]').count()) === 0);
  const ink = await page.evaluate(async () => {
    const m = window.__harness.model;
    const L = m.cutfill;
    const img = new Image(); img.src = L.dataUrl; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height;
    const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    const px = (ft) => { const i = Math.floor((ft.x - L.bboxFt.x) / (L.bboxFt.w / c.width)), j = Math.floor((ft.y - L.bboxFt.y) / (L.bboxFt.h / c.height)); return d[(j * c.width + i) * 4 + 3]; };
    const els = window.__harness.els;
    const cen = (ring) => ({ x: ring.reduce((a, p) => a + p.x, 0) / ring.length, y: ring.reduce((a, p) => a + p.y, 0) / ring.length });
    let inked = 0; for (let k = 3; k < d.length; k += 4) if (d[k] > 0) inked++;
    return { pad: px(cen(els[0].ring)), court: px(cen(els[1].ring)), lot1: px(cen(els[2].ring)), lot2: px(cen(els[3].ring)), inked, total: c.width * c.height };
  });
  check("the pad, the court and both rows of parking carry NO ink", ink.pad === 0 && ink.court === 0 && ink.lot1 === 0 && ink.lot2 === 0, JSON.stringify(ink));
  check("the slopes DO carry ink", ink.inked > 150, `${ink.inked} px`);
  const pills = await page.locator("[data-grade-pill] text").allTextContents();
  const corners = await page.locator("[data-pad-corner]").count();
  check("four pad-corner pills, 'cut n.n' / 'fill n.n'", corners === 4 && pills.filter((t) => /^(cut|fill) \d+\.\d$/.test(t)).length === 4, pills.join(" | "));
  check("the pad and the court carry enough legible pills (four corners + dock face + far edge + fall tag at least)", pills.length >= 8, `${pills.length}`);
  check("spot elevations: a dock label, a curb label, far-edge values", pills.some((t) => /^dock \d/.test(t)) && pills.some((t) => /^curb \d/.test(t)));
  check("fall tag reads 1.5% fall", pills.includes("1.5% fall"));
  await page.screenshot({ path: "/tmp/grading-r2-default.png" });

  // ---- Level-pad limit: Show → dashed line + hatch + label + the map fits; Hide clears it
  await page.click("[data-ground-show-buildable]");
  await page.waitForSelector('[data-layer="buildable"] image', { timeout: 60000 });
  check("button reads Hide while the line is on", (await page.textContent("[data-ground-show-buildable]")) === "Hide");
  const dash = await page.getAttribute('[data-layer="buildable"] path', "stroke-dasharray");
  check("dashed accent line (1.5 px) around the pad limit", !!dash && (await page.getAttribute('[data-layer="buildable"] path', "stroke-width")) === "1.5", dash);
  const lbl = await page.textContent("[data-buildable-label]");
  check("one label at the visual centre: 'Level pad possible inside · NN AC at NNN ft'", /^Level pad possible inside · \d+ AC at \d+(\.\d)? ft$/.test(lbl), lbl);
  check("no flat fill: the only <image> is the sparse hatch (<20% of its box inked)", await page.evaluate(async () => {
    const L = window.__harness.model.buildable; const img = new Image(); img.src = L.dataUrl; await img.decode();
    const c = document.createElement("canvas"); c.width = img.width; c.height = img.height; const g = c.getContext("2d"); g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, c.width, c.height).data; let n = 0, max = 0; for (let k = 3; k < d.length; k += 4) { if (d[k] > 0) n++; if (d[k] > max) max = d[k]; }
    return n / (c.width * c.height) < 0.2 && max <= 40;
  }));
  check("the model hands the map a box to fit", !!(await page.evaluate(() => window.__harness.model.buildable.fitBoxFt)));
  await page.screenshot({ path: "/tmp/grading-r2-levelpad.png" });
  await page.click("[data-ground-show-buildable]");
  await page.waitForFunction(() => !document.querySelector('[data-layer="buildable"]'), null, { timeout: 15000 });
  check("pressing it again clears the line; the button reads Show again", (await page.textContent("[data-ground-show-buildable]")) === "Show buildable area on map");
  await page.close();

  // ================= 1b. no building on the plan: one line, and the Ground section still shows =================
  page = await open("?buildable=0&none=1");
  await page.waitForSelector('[data-grading-panel="empty"]', { timeout: 60000 });
  check("empty state: 'Place a building to grade it.'", /Place a building to grade it\./.test(await page.textContent("[data-grading-empty]")));
  await page.waitForSelector('[data-ground-state="ready"]', { timeout: 60000 });
  check("empty state: the Ground rows are still there", (await page.locator("[data-ground-row]").count()) === 3);
  check("empty state: no building card", (await page.locator("[data-grading-card]").count()) === 0);
  await page.close();

  // ================= 2. zoomed out: bands and the daylight line only =================
  page = await open("?buildable=0&ppf=0.2");
  await waitFfe(page); await waitEarthwork(page); await page.waitForTimeout(1500);
  await page.waitForSelector('[data-layer="cutfill"] image');
  check("zoomed out (parcel not filling the map): the bands and the line stay, the pills go", (await page.locator("[data-grade-pill]").count()) === 0 && (await page.locator('[data-layer="cutfill"] path').count()) === 2);
  await page.close();

  // ================= 3. pond spoil counts as fill =================
  page = await open("?buildable=0&pond=18000");
  await waitFfe(page); await waitEarthwork(page); await page.waitForTimeout(1500);
  const pondFfe = await readFfe(page);
  check("with an 18,000 CY pond the suggested floor rises (spoil to spare → a higher pad)", pondFfe > baseFfe + 0.3, `${pondFfe} vs ${baseFfe}`);
  check("the basis names the pond", /the pond digs 18k CY/.test(await page.textContent("[data-ffe-note]")), await page.textContent("[data-ffe-note]"));
  await page.close();

  // ================= 4. rock =================
  page = await open("?buildable=0&rock=6");
  await waitFfe(page); await waitEarthwork(page); await page.waitForTimeout(1500);
  const rockFfe = await readFfe(page);
  check("rock 6 ft down everywhere: the floor is raised to keep cuts 2 ft clear", rockFfe > baseFfe + 0.5, `${rockFfe} vs ${baseFfe}`);
  const rb = await page.textContent("[data-ffe-note]");
  check("the basis says it, in feet", /Raised [\d.]+ ft to stay out of rock( on the \w+ end)? \(bedrock about 6 ft down there\)\./.test(rb), rb);
  await page.close();

  // ================= 4b. two buildings: one open card, one line; each gets its own suggestion; a click opens the other =================
  page = await open("?buildable=0&two=1");
  await page.waitForFunction(() => document.querySelectorAll("[data-grading-card]").length === 2, null, { timeout: 90000 });
  await page.waitForFunction(() => { const m = window.__harness.model; return m && m.autoFfe && m.autoFfe.size === 2; }, null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  check("two buildings: ONE card open, one a single line", (await page.locator('[data-card-state="open"]').count()) === 1 && (await page.locator('[data-card-state="collapsed"]').count()) === 1);
  const collapsed = await page.textContent('[data-card-state="collapsed"]');
  check("the one-line card names the building, its size and its FFE", /^Building 2 · 60,000 SF.*FFE \d{3}\.\d ft$/.test(collapsed.replace(/\s+/g, " ").trim()), collapsed);
  const f1b = await page.evaluate(() => [...window.__harness.model.autoFfe.values()]);
  check("each building got its OWN suggestion (different ground, different finish)", new Set(f1b).size === 2, JSON.stringify(f1b));
  await page.click('[data-card-state="collapsed"]');
  await page.waitForFunction(() => document.querySelector('[data-card-state="open"] [data-card-title]')?.textContent.startsWith("Building 2"), null, { timeout: 30000 });
  check("clicking the one-line card selects that building and opens it", (await page.locator('[data-card-state="open"]').count()) === 1 && /Building 2/.test(await page.textContent('[data-card-state="open"] [data-card-title]')));
  await page.close();

  // ================= 5. the flag: push the building toward the property line =================
  page = await open("?buildable=0");
  await waitFfe(page); await waitEarthwork(page); await page.waitForTimeout(1200);
  const flagShot = async (dx, dy) => {
    await page.evaluate(([x, y]) => window.__harness.applyMove(x, y), [dx, dy]);
    await sleep(3500);
    return page.locator('[data-grading-flag="1"]').count();
  };
  let flagged = 0, used = null;
  for (const [dx, dy] of [[0, 120], [0, 240], [0, 360], [-200, 0], [200, 0], [0, 480]]) {
    flagged = await flagShot(dx, dy); used = [dx, dy];
    if (flagged) break;
  }
  check("moving toward the boundary raises the setback flag", flagged === 1, JSON.stringify(used));
  if (flagged) {
    const title = await page.textContent('[data-grading-flag="1"] > div');
    check("flag names a compass side", /Slope crosses (the setback · (North|South|East|West|North-east|North-west|South-east|South-west)|the property line)/.test(title), title);
    await page.waitForFunction(() => { const b = document.querySelector('[data-fix="ffe"]'); return b && !/Finding/.test(b.textContent); }, null, { timeout: 90000 });
    const ffeBtn = await page.textContent('[data-fix="ffe"]'), mvBtn = await page.textContent('[data-fix="move"]');
    check("fix buttons offered", /(Raise|Lower) FFE to|No finish elevation clears it/.test(ffeBtn) && /Move building|No move/.test(mvBtn), `${ffeBtn} | ${mvBtn}`);
    check("red dot with N ft past the setback", (await page.locator("[data-flag-dot]").count()) >= 1);
    check("wall fix is present and disabled", await page.locator('[data-fix="wall"]').isDisabled());
    await page.screenshot({ path: "/tmp/grading-r2-flag.png" });
    if (/Move building/.test(mvBtn)) {
      await page.click('[data-fix="move"]');
      await sleep(4000);
      check("applying Move building clears the flag", (await page.locator('[data-grading-flag="1"]').count()) === 0);
    }
  }
  await page.close();

  // ================= 6. NO FRAME OVER 100 MS (problem report 6cea9895) — the owner's real cross-dock, his screen =================
  // Viewport 1913×641 at deviceScaleFactor 2.68 (his capture). Long animation frames are recorded from the moment the
  // harness is ready (the lattice decode before it is harness setup, not app work): the plan opening (sweep, FFE solve,
  // surface, cards, Cut & Fill, labels), the panel settling, then a 20-step drag of the building and its release.
  // KNOWN-GOOD ARM first: the same instrument must SEE a deliberately blocking frame, or the run is VOID.
  {
    const ctx = await browser.newContext({ viewport: { width: 1913, height: 641 }, deviceScaleFactor: 2.68 });
    await ctx.addInitScript(() => {
      window.__lf = [];
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__lf.push({ t: e.startTime, d: e.duration, s: (e.scripts || []).map((x) => `${x.invoker}${x.sourceFunctionName ? "/" + x.sourceFunctionName : ""} ${Math.round(x.duration)}ms`).join(" | ") }); }).observe({ type: "long-animation-frame", buffered: true });
    });
    const pg = await ctx.newPage();
    pg.on("pageerror", (e) => errs.push(String(e)));
    await pg.goto(`${BASE}/ui-audit/harness/grading-harness.html?owner=1&buildable=0`);
    await assertMeasurable(pg, "verify-grading-harness (frames)");
    await pg.waitForFunction(() => window.__ready, null, { timeout: 60000 });
    const tReady = await pg.evaluate(() => performance.now());
    // the known-good arm: one 250 ms block in a real page TASK (a CDP evaluate is not a task the frame timing sees)
    await pg.evaluate(() => { setTimeout(() => { const t = performance.now(); while (performance.now() - t < 250) { /* block */ } }, 0); });
    const seen = await pg.waitForFunction((t0) => window.__lf.some((e) => e.t + e.d >= t0 + 200 && e.d >= 240), tReady, { timeout: 3000 }).then(() => true, () => false);
    if (!seen) { fails.push("✗ VOID — the frame instrument did not see a known 250 ms block, so its clean numbers would mean nothing"); }
    else {
      const t1 = await pg.evaluate(() => performance.now());
      await waitFfe(pg, 120000); await waitEarthwork(pg);
      await pg.waitForTimeout(4000);
      const openFrames = await pg.evaluate((t) => window.__lf.filter((e) => e.t >= t), t1);
      const openMax = Math.max(0, ...openFrames.map((e) => e.d));
      const ownerFfe = await readFfe(pg);
      check("the owner's cross-dock gets a suggested FFE (the same engine, off the render path)", ownerFfe != null && ownerFfe > 760 && ownerFfe < 840, `${ownerFfe} ft`);
      check("longest frame while the plan opens and the grading settles < 50 ms at DSF 2.68 (the brief asks < 100; nothing may block > ~50)", openMax < 50,
        `${Math.round(openMax)} ms${openMax >= 50 ? " — " + openFrames.filter((e) => e.d >= 50).map((e) => `${Math.round(e.d)}ms [${e.s}]`).join(" ; ") : ""}`);
      const before = await pg.evaluate(() => window.__harness.gradeSurface && window.__harness.gradeSurface.surfaceKey);
      const t2 = await pg.evaluate(() => performance.now());
      await pg.evaluate(() => window.__harness.dragStart());
      let heldThroughDrag = true;
      for (let k = 0; k < 20; k++) {
        await pg.evaluate(() => window.__harness.applyMove(3, 2));
        await pg.waitForTimeout(16);
        if (await pg.evaluate(() => window.__harness.gradeSurface && window.__harness.gradeSurface.surfaceKey) !== before) heldThroughDrag = false;
      }
      check("the surface is NOT rebuilt per pointer step: the last one stays painted for the whole drag", heldThroughDrag);
      await pg.evaluate(() => window.__harness.dragEnd());
      await pg.waitForFunction((b) => window.__harness.gradeSurface && window.__harness.gradeSurface.surfaceKey !== b, before, { timeout: 30000 }).catch(() => {});
      const after = await pg.evaluate(() => window.__harness.gradeSurface && window.__harness.gradeSurface.surfaceKey);
      check("released: the surface is rebuilt once for the new position", after && after !== before);
      await pg.waitForTimeout(5000);
      const dragFrames = await pg.evaluate((t) => window.__lf.filter((e) => e.t >= t), t2);
      const dragMax = Math.max(0, ...dragFrames.map((e) => e.d));
      check("longest frame during the 20-step drag, the release and the re-solve < 50 ms at DSF 2.68", dragMax < 50,
        `${Math.round(dragMax)} ms${dragMax >= 50 ? " — " + dragFrames.filter((e) => e.d >= 50).map((e) => `${Math.round(e.d)}ms [${e.s}]`).join(" ; ") : ""}`);
    }
    await ctx.close();
  }
  const real = errs.filter((e) => !/Failed to load resource|ERR_TUNNEL|ERR_CONNECTION/.test(e));     // the sandbox has no outside network
  check("no page errors", real.length === 0, real.slice(0, 3).join(" || "));
  await browser.close();
} finally { vite.kill(); }
console.log([...notes, ...fails].join("\n"));
process.exit(fails.length ? 1 : 0);
