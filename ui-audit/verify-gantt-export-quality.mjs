/* B397–B400 — exported Gantt quality (z-order, single left edge, two-tier weighted header, fit/pan),
 *
 * Drives page → sequence iframe → Export → PDF/Print Exhibit → the (blob:) preview iframe and
 * asserts on the REAL rendered exhibit SVG + the parent preview controls:
 *   B397  the vertical rules (grid / today / dependency) all paint BEHIND the bars (SVG order).
 *         — every <line>/<path class=dep> precedes every bar/bracket/milestone in SVG order.
 *   B398  the left chart-edge boundary is ONE continuous full-height line, not per-row segments.
 *   B399  two-tier light Year-over-Month header + weighted year>quarter>month grid rules; rows aligned.
 *   B400  viewBox fits the whole timeline (no clip); preview Fit + Move (drag-pan). Connectors stay main B396 curved.
 *         the preview exposes Fit + Move controls and Move-drag pans the chart.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";

const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1700, height: 1050 }, ignoreHTTPSErrors: true });
const page = await ctx.newPage();
const seqFrame = () => page.frames().find((f) => f.url().includes("/sequence/"));
const blobFrames = () => page.frames().filter((f) => f.url().startsWith("blob:"));

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[title^="All projects —"]', { timeout: 20000 });
  await page.evaluate(() => { const t = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Schedule"); if (t) t.click(); });
  let frame = null;
  for (let i = 0; i < 50; i++) {
    frame = seqFrame();
    if (frame) {
      const ready = await page.evaluate(() => { const h = document.querySelector("header"); return !!h && [...h.querySelectorAll("button[title]")].some((b) => b.getAttribute("title").startsWith("Export")); }).catch(() => false);
      if (ready) break;
    }
    await page.waitForTimeout(400);
  }
  if (!frame) throw new Error("sequence iframe never became interactive");
  await page.waitForTimeout(500);
  await page.evaluate(() => { const h = document.querySelector("header"); const b = h && [...h.querySelectorAll("button[title]")].find((x) => x.getAttribute("title").startsWith("Export")); if (b) b.click(); });
  await page.waitForTimeout(300);
  const opened = await page.evaluate(() => { const item = [...document.querySelectorAll("div,span,button")].find((e) => e.textContent.trim() === "PDF / Print Exhibit" && e.getClientRects().length > 0); const click = item && (item.closest("[role='menuitem'],[style*='cursor'],button") || item.parentElement || item); if (click) { click.click(); return true; } return false; });
  ok("Export → PDF / Print Exhibit opens the exhibit modal", opened);

  let blob = null;
  for (let i = 0; i < 50; i++) {
    blob = blobFrames()[0];
    if (blob && await blob.evaluate(() => !!document.querySelector(".split-gantt svg")).catch(() => false)) break;
    await page.waitForTimeout(300);
  }
  if (!blob) throw new Error("exhibit preview iframe never rendered the gantt");
  await page.waitForTimeout(1000);
  blob = blobFrames()[0];

  // ── Probe the rendered gantt SVG ──
  const g = await blob.evaluate(() => {
    const svg = document.querySelector(".split-gantt svg");
    const kids = [...svg.children];
    const svgH = +svg.getAttribute("height");
    const isBar = (el) => (el.tagName === "rect" && el.hasAttribute("rx")) || (el.tagName === "polygon" && (el.getAttribute("stroke") || "") === "#94a3b8");
    // A "body rule" is a vertical line that drops into the chart body (y2 at the bottom) or a
    // dependency path — these MUST sit behind the bars. Horizontal header dividers (y2 small)
    // are header chrome and legitimately paint on top, so they're excluded.
    const isRule = (el) => (el.tagName === "line" && Math.round(+el.getAttribute("y2")) >= svgH - 1) || (el.tagName === "path" && (el.getAttribute("class") || "").includes("dep"));
    let lastRule = -1, firstBar = Infinity;
    kids.forEach((el, i) => { if (isRule(el)) lastRule = Math.max(lastRule, i); if (isBar(el) && i < firstBar) firstBar = i; });
    // left edge: exactly one #c4c8ce line, spanning the full height (top → bottom)
    const edges = kids.filter((el) => el.tagName === "line" && el.getAttribute("stroke") === "#c4c8ce");
    const edge = edges[0];
    const edgeFull = !!edge && Math.round(+edge.getAttribute("y1")) <= 1 && Math.round(+edge.getAttribute("y2")) === svgH;
    // weighted grid rules: year (1.3) > quarter (0.8) > month (0.4), all distinct widths present
    const ruleW = new Set([...svg.querySelectorAll("line")].map((l) => l.getAttribute("stroke-width")));
    const weighted = ["1.3", "0.8", "0.4"].every((w) => ruleW.has(w));
    // two-tier light header: a year-number label (<text> = a 4-digit year) is present
    const yearLabel = [...svg.querySelectorAll("text")].some((t) => /^\d{4}$/.test(t.textContent.trim()));
    // dependency paths: orthogonal? parse each d into points, every segment axis-aligned, no curves
    const deps = [...svg.querySelectorAll("path.dep")];
    let curved = 0, nonOrtho = 0;
    const colors = new Set();
    for (const p of deps) {
      const d = p.getAttribute("d") || "";
      colors.add(p.getAttribute("stroke"));
      if (/[CcQqSsAaTt]/.test(d)) curved++;
      const nums = d.match(/-?\d+(\.\d+)?/g)?.map(Number) || [];
      for (let i = 2; i + 1 < nums.length; i += 2) {
        const dx = Math.abs(nums[i] - nums[i - 2]), dy = Math.abs(nums[i + 1] - nums[i - 1]);
        if (dx > 0.6 && dy > 0.6) nonOrtho++;     // a diagonal segment
      }
    }
    const sg = document.querySelector(".split-gantt").getBoundingClientRect();
    return {
      childCount: kids.length, lastRule, firstBar, edgeCount: edges.length, edgeFull,
      depCount: deps.length, curved, nonOrtho, colors: [...colors], weighted, yearLabel, ruleW: [...ruleW],
      hasViewBox: svg.hasAttribute("viewBox"),
      svgRight: Math.round(svg.getBoundingClientRect().right), ganttRight: Math.round(sg.right),
      svgW: Math.round(svg.getBoundingClientRect().width), ganttW: Math.round(sg.width),
    };
  });
  console.log(`  svg: ${g.childCount} els · lastRule@${g.lastRule} firstBar@${g.firstBar} · deps=${g.depCount} curved=${g.curved} nonOrtho=${g.nonOrtho} · colors=[${g.colors.join(",")}] · ruleWidths=[${g.ruleW.join(",")}]`);

  ok("B397 — every vertical rule is painted BEHIND the bars (rules before bars in SVG order)", g.lastRule >= 0 && g.firstBar < Infinity && g.lastRule < g.firstBar, `lastRule@${g.lastRule} < firstBar@${g.firstBar}`);
  ok("B398 — exactly ONE continuous full-height left-edge line (not per-row)", g.edgeCount === 1 && g.edgeFull, `count=${g.edgeCount} full=${g.edgeFull}`);
  ok("B399 — weighted grid rules present (year 1.3 > quarter 0.8 > month 0.4)", g.weighted, `widths=[${g.ruleW.join(",")}]`);
  ok("B399 — two-tier light header shows a year-band label", g.yearLabel);
  ok("B400 — gantt SVG has a viewBox", g.hasViewBox);
  ok("B400 — the whole timeline fits its column (no horizontal clip)", g.svgW > 0 && Math.abs(g.svgRight - g.ganttRight) <= 2 && g.svgW <= g.ganttW + 2, `svg ${g.svgW}px fits gantt ${g.ganttW}px`);
  // Connectors are intentionally main's CURVED bézier (owner's B396 pick) — confirm they're still curved + on-palette, NOT re-elbowed.
  ok("main B396 preserved — dependency connectors stay CURVED (bézier), on-palette", g.depCount > 0 && g.curved > 0 && g.colors.every((c) => ["#0969da", "#7c3aed", "#0891b2", "#be185d"].includes(c)), `${g.curved}/${g.depCount} curved, colors=[${g.colors.join(",")}]`);

  // The taller two-tier header must not desync table rows from their bars — the table column
  // header and the gantt header have to be the same height. Compare the first table row's top
  // to the first gantt row-band's top in page coords.
  const align = await blob.evaluate(() => {
    const tr = document.querySelector(".split-table tbody tr");
    const svg = document.querySelector(".split-gantt svg");
    const band = [...svg.querySelectorAll("rect")].find((r) => Math.round(+r.getAttribute("height")) === 18);
    if (!tr || !band) return null;
    return { diff: Math.round(Math.abs(tr.getBoundingClientRect().top - band.getBoundingClientRect().top)) };
  });
  ok("B399 — table rows stay aligned with their gantt bars (header heights match)", align && align.diff <= 2, align ? `Δ${align.diff}px` : "n/a");

  // ── B396 preview controls (live in the SEQUENCE iframe, where the modal renders) ──
  const ctrls = await frame.evaluate(() => {
    const btns = [...document.querySelectorAll("button")];
    return { fit: btns.some((b) => b.textContent.trim() === "Fit"), move: btns.some((b) => b.textContent.trim() === "Move") };
  });
  ok("B400 — preview exposes a Fit control", ctrls.fit);
  ok("B400 — preview exposes a Move (drag-to-pan) control", ctrls.move);

  // Zoom in, enter Move mode, drag — the preview must scroll (pan). Scope the zoom button to the
  // PREVIEW toolbar (the Move button's own toolbar) — the live Scheduler behind the modal also
  // has a "Zoom in" control, and a flat search would hit that one instead.
  const panned = await (async () => {
    for (let i = 0; i < 4; i++) { await frame.evaluate(() => { const mv = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Move"); const bar = mv && mv.parentElement; const b = bar && [...bar.querySelectorAll("button")].find((x) => x.getAttribute("title") === "Zoom in"); if (b) b.click(); }); await page.waitForTimeout(80); }
    await frame.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Move"); if (b) b.click(); });
    await page.waitForTimeout(200);
    // Drag from the VISIBLE pane center (the zoomed iframe is wider than the pane, so its own
    // center sits in the clipped overflow region — off-screen — and wouldn't receive the drag).
    const paneH = await frame.evaluateHandle(() => { const f = document.querySelector('iframe[title="PDF Preview"]'); return f.parentElement.parentElement; });
    const pbox = await paneH.boundingBox().catch(() => null); // page-relative coords
    if (!pbox) return { ok: false, before: "?", after: "?" };
    const before = await frame.evaluate(() => { const f = document.querySelector('iframe[title="PDF Preview"]'); return f.parentElement.parentElement.scrollLeft; });
    const cx = pbox.x + pbox.width / 2, cy = pbox.y + pbox.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx - 170, cy - 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(150);
    const after = await frame.evaluate(() => { const f = document.querySelector('iframe[title="PDF Preview"]'); return f.parentElement.parentElement.scrollLeft; });
    return { ok: after > before + 8, before, after };
  })();
  ok("B400 — Move mode: dragging pans the preview horizontally", panned.ok, `scrollLeft ${panned.before}→${panned.after}`);

  // Capture the corrected exhibit for the record.
  await blob.locator(".split-gantt").first().screenshot({ path: "ui-audit/screens/gantt-export-after.png" }).catch(() => {});
  console.log("  artifact: ui-audit/screens/gantt-export-after.png");
} catch (e) {
  console.log("HARNESS ERROR:", e.message);
} finally {
  const passed = results.filter((r) => r.pass).length;
  console.log(`\n=== ${passed}/${results.length} checks passed ===`);
  await browser.close();
  process.exit(passed === results.length && results.length >= 12 ? 0 : 1);
}
