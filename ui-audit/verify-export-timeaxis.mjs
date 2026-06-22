/* B361 / B401 / B402 / B403 — PDF/Print Exhibit export: time-axis controls, auto-fit framing,
 * connector reroute, and silent persistence.
 *
 * Drives page → /sequence/ iframe → Export → PDF/Print Exhibit → the blob preview iframe and
 * asserts on the REAL rendered exhibit + the modal controls:
 *   B361  the floating toolbar is present, visible and CLICKABLE (the old dead/intermittent
 *         float-in-flex toolbar bug); a discrete Time-scale selector + a continuous Time −/+
 *         stretch the axis (fewer month rules when zoomed in); Fit restores; "Pan" exists.
 *   B401  the default frame auto-fits: no name label clips past the chart edges, and there is
 *         lead room (the earliest bar is not jammed against the left edge).
 *   B402  dependency connectors stay CURVED and now terminate at 12 o'clock (a vertical entry:
 *         the final control x == the end x) with a down-pointing arrowhead.
 *   B403  page orientation, a column toggle and a collapsed sidebar section all come back after
 *         close+reopen, with NO "restored" badge.
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
const pageErrors = [];
page.on("pageerror", e => pageErrors.push(e.message));
const seqFrame = () => page.frames().find((f) => f.url().includes("/sequence/"));
const blobFrame = () => page.frames().filter((f) => f.url().startsWith("blob:")).slice(-1)[0];

async function openModal() {
  await page.evaluate(() => { const h = document.querySelector("header"); const b = h && [...h.querySelectorAll("button[title]")].find((x) => x.getAttribute("title").startsWith("Export")); if (b) b.click(); });
  await page.waitForTimeout(300);
  await page.evaluate(() => { const item = [...document.querySelectorAll("div,span,button")].find((e) => e.textContent.trim() === "PDF / Print Exhibit" && e.getClientRects().length > 0); const c = item && (item.closest("button") || item.parentElement || item); if (c) c.click(); });
  await waitGantt();
}
async function waitGantt() {
  for (let i = 0; i < 60; i++) { const b = blobFrame(); if (b && await b.evaluate(() => !!document.querySelector(".split-gantt svg")).catch(() => false)) break; await page.waitForTimeout(250); }
  await page.waitForTimeout(900);
}
async function probeGantt() {
  const b = blobFrame();
  return await b.evaluate(() => {
    const svg = document.querySelector(".split-gantt svg");
    const svgH = +svg.getAttribute("height");
    const lines = [...svg.querySelectorAll("line")];
    const gridLines = lines.filter((l) => Math.round(+l.getAttribute("y2")) >= svgH - 1).length;
    const months = [...svg.querySelectorAll("text")].filter((t) => +t.getAttribute("font-size") <= 8 && /^[A-Z]/.test(t.textContent.trim()) && t.textContent.trim().length <= 3).map((t) => Math.round(+t.getAttribute("x"))).join(",");
    const years = [...svg.querySelectorAll("text")].filter((t) => /^\d{4}$/.test(t.textContent.trim())).map((t) => t.textContent.trim()).join(",");
    // names = fs>=7.5 text; check clip vs [0,width]
    const W = +svg.getAttribute("width");
    const names = [...svg.querySelectorAll("text")].filter((t) => +t.getAttribute("font-size") >= 7.5);
    let minX0 = 1e9, maxX1 = -1e9, earliestBarX = 1e9;
    names.forEach((t) => { const bb = t.getBBox(); if (bb.x < minX0) minX0 = bb.x; if (bb.x + bb.width > maxX1) maxX1 = bb.x + bb.width; });
    [...svg.querySelectorAll("rect[rx]")].forEach((r) => { const x = +r.getAttribute("x"); if (x > 0 && x < earliestBarX) earliestBarX = x; });
    // dep paths
    const deps = [...svg.querySelectorAll("path.dep")];
    let curved = 0, vertEntry = 0;
    const colors = new Set();
    deps.forEach((p) => { const d = p.getAttribute("d") || ""; colors.add(p.getAttribute("stroke")); if (/C/.test(d)) curved++; const n = (d.match(/-?\d+(\.\d+)?/g) || []).map(Number); if (n.length >= 8 && Math.abs(n[4] - n[6]) < 2) vertEntry++; });
    // down arrowheads: a filled triangle path whose tip y > its base y (points down)
    const heads = [...svg.querySelectorAll("path:not(.dep)")].filter((p) => { const n = (p.getAttribute("d") || "").match(/-?\d+(\.\d+)?/g)?.map(Number) || []; return n.length === 6 && n[1] > n[3] && Math.abs(n[3] - n[5]) < 0.6; }).length;
    return { gridLines, months, years, W, minX0: Math.round(minX0), maxX1: Math.round(maxX1), earliestBarX: Math.round(earliestBarX), depCount: deps.length, curved, vertEntry, downHeads: heads, colors: [...colors] };
  });
}
// click a SegBtn option (a <span>) by its label, scoped to a sibling label that disambiguates
async function clickSeg(label, sibling) {
  return await seqFrame().evaluate(([label, sibling]) => {
    const segs = [...document.querySelectorAll("div")].filter((d) => { const t = [...d.children].map((c) => c.textContent.trim()); return t.includes(label) && (!sibling || t.includes(sibling)); });
    for (const seg of segs) { const opt = [...seg.children].find((c) => c.textContent.trim() === label); if (opt) { opt.click(); return true; } }
    return false;
  }, [label, sibling]);
}
async function clickBtn(text) {
  return await seqFrame().evaluate((text) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === text || x.textContent.includes(text)); if (b) { b.click(); return true; } return false; }, text);
}

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('button[title^="All projects —"]', { timeout: 20000 });
  await page.evaluate(() => { const t = [...document.querySelectorAll("button")].find((b) => b.innerText.trim() === "Schedule"); if (t) t.click(); });
  for (let i = 0; i < 50; i++) { if (seqFrame() && await page.evaluate(() => { const h = document.querySelector("header"); return !!h && [...h.querySelectorAll("button[title]")].some((b) => b.getAttribute("title").startsWith("Export")); }).catch(() => false)) break; await page.waitForTimeout(400); }
  await page.waitForTimeout(600);
  await openModal();

  // ── Toolbar present + clickable (B361 dead-toolbar fix) ──
  const tb = await seqFrame().evaluate(() => {
    const want = ["Fit", "✋ Pan"];
    const out = {};
    for (const w of want) { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === w || x.textContent.includes(w.replace("✋ ", ""))); if (!b) { out[w] = "missing"; continue; } const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); out[w] = (top === b || (top && b.contains(top))) ? "clickable" : "blocked:" + (top ? top.tagName : "none"); }
    const pct = [...document.querySelectorAll("span")].some((s) => /^\d+%$/.test(s.textContent.trim()));
    const timeTag = [...document.querySelectorAll("span")].some((s) => s.textContent.trim() === "Time");
    return { ...out, pct, timeTag };
  });
  ok("B361 — toolbar Fit + Pan present and not covered (dead-toolbar bug fixed)", tb["Fit"] === "clickable" && tb["✋ Pan"] === "clickable", JSON.stringify(tb));
  ok("B361 — toolbar exposes page Zoom (%) and a Time stretch group", tb.pct && tb.timeTag);

  const fit = await probeGantt();
  console.log("  FIT:", JSON.stringify({ gridLines: fit.gridLines, years: fit.years, minX0: fit.minX0, maxX1: fit.maxX1, earliestBarX: fit.earliestBarX, deps: fit.depCount, curved: fit.curved, vertEntry: fit.vertEntry, downHeads: fit.downHeads }));

  // ── B401 auto-fit: no clip + lead room ──
  ok("B401 — no name label clips the left/right chart edges", fit.minX0 >= -1 && fit.maxX1 <= fit.W + 1, `x0=${fit.minX0} x1=${fit.maxX1} W=${fit.W}`);
  ok("B401 — auto-fit leaves lead room (earliest bar not jammed at x=0)", fit.earliestBarX >= 3, `earliestBarX=${fit.earliestBarX}`);

  // ── B402 connectors: curved + 12 o'clock vertical entry + down arrowheads ──
  ok("B402 — dependency connectors stay CURVED and on-palette", fit.depCount > 0 && fit.curved === fit.depCount && fit.colors.every((c) => ["#0969da", "#7c3aed", "#0891b2", "#be185d"].includes(c)), `${fit.curved}/${fit.depCount} curved`);
  ok("B402 — connectors enter the target at 12 o'clock (vertical: ctrl.x == end.x)", fit.depCount > 0 && fit.vertEntry >= fit.depCount * 0.9, `${fit.vertEntry}/${fit.depCount} vertical`);
  ok("B402 — down-pointing arrowheads present (entering from above)", fit.downHeads >= fit.depCount * 0.9, `${fit.downHeads} heads / ${fit.depCount} deps`);

  // ── B361 discrete selector narrows the window ──
  await clickSeg("Mo", "Qtr");
  await page.waitForTimeout(700); await waitGantt();
  const mo = await probeGantt();
  ok("B361 — discrete 'Mo' time-scale narrows the window (fewer month rules)", mo.gridLines < fit.gridLines, `fit=${fit.gridLines} → Mo=${mo.gridLines}`);

  // ── B361 continuous Time + narrows further (same scale state, composes) ──
  await clickBtn("+"); // first '+' in DOM is the Zoom +, but Time + has title; click via title instead
  const timePlus = await seqFrame().evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("Expand the time axis")); if (b) { b.click(); return true; } return false; });
  await page.waitForTimeout(700); await waitGantt();
  const moPlus = await probeGantt();
  ok("B361 — continuous Time + composes with the unit (narrows further)", timePlus && moPlus.gridLines <= mo.gridLines, `Mo=${mo.gridLines} → Mo+=${moPlus.gridLines}`);

  // ── B361 Pan: drag slides the time window ──
  const beforePan = moPlus.months + "|" + moPlus.years;
  await seqFrame().evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => (x.getAttribute("title") || "").startsWith("Pan")); if (b) b.click(); });
  await page.waitForTimeout(200);
  // drag horizontally across the preview via absolute coords of the overlay
  const ifr = await seqFrame().$('iframe[title="PDF Preview"]');
  const box = ifr ? await ifr.boundingBox() : null;   // top-page coords; drag near its VISIBLE top
  let panChanged = false;
  if (box) {
    const cx = box.x + box.width / 2, cy = box.y + Math.min(box.height / 2, 110);
    await page.mouse.move(cx, cy); await page.mouse.down();
    for (let i = 1; i <= 9; i++) { await page.mouse.move(cx - i * 26, cy); await page.waitForTimeout(35); }
    await page.mouse.up();
    await page.waitForTimeout(800); await waitGantt();
    const afterPan = await probeGantt();
    panChanged = (afterPan.months + "|" + afterPan.years) !== beforePan;
    if (!panChanged) console.log("  pan before:", beforePan, "\n  pan after :", afterPan.months + "|" + afterPan.years);
  }
  ok("B361 — Pan drag slides the visible time window", panChanged, `iframe=${!!box}`);

  // ── Fit resets the axis ──
  await seqFrame().evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Fit"); if (b) b.click(); });
  await page.waitForTimeout(700); await waitGantt();
  const refit = await probeGantt();
  ok("B361 — Fit restores the whole-timeline frame", Math.abs(refit.gridLines - fit.gridLines) <= 1, `back to ${refit.gridLines} (fit ${fit.gridLines})`);

  // ── B403 persistence: orientation + column + section ──
  await clickSeg("Portrait", "Landscape");
  await page.waitForTimeout(150);
  // turn Owner column OFF
  await seqFrame().evaluate(() => { const lab = [...document.querySelectorAll("label")].find((l) => l.textContent.trim() === "Owner"); const cb = lab && lab.querySelector('input[type="checkbox"]'); if (cb && cb.checked) cb.click(); });
  await page.waitForTimeout(150);
  // collapse the Margins section
  await seqFrame().evaluate(() => { const h = [...document.querySelectorAll("div")].find((d) => d.style && d.style.cursor === "pointer" && d.textContent.replace(/[^A-Za-z]/g, "") === "Margins"); if (h) h.click(); });
  await page.waitForTimeout(200);
  const noBadge = await seqFrame().evaluate(() => ![...document.querySelectorAll("*")].some((e) => /restored from last/i.test(e.textContent || "")));
  ok("B403 — no 'restored' badge is shown", noBadge);
  // close + reopen
  await seqFrame().evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Cancel"); if (b) b.click(); });
  await page.waitForTimeout(400);
  await openModal();
  const restored = await seqFrame().evaluate(() => {
    const portraitSel = (() => { const segs = [...document.querySelectorAll("div")].filter((d) => { const t = [...d.children].map((c) => c.textContent.trim()); return t.includes("Portrait") && t.includes("Landscape"); }); for (const s of segs) { const p = [...s.children].find((c) => c.textContent.trim() === "Portrait"); if (p) return getComputedStyle(p).backgroundColor; } return null; })();
    const ownerChecked = (() => { const lab = [...document.querySelectorAll("label")].find((l) => l.textContent.trim() === "Owner"); const cb = lab && lab.querySelector('input[type="checkbox"]'); return cb ? cb.checked : null; })();
    const marginInputs = [...document.querySelectorAll('input[type="number"]')].length;
    return { portraitBg: portraitSel, ownerChecked, marginInputs };
  });
  const portraitOn = restored.portraitBg && restored.portraitBg !== "rgba(0, 0, 0, 0)" && restored.portraitBg !== "transparent";
  ok("B403 — orientation restored to Portrait", portraitOn, `bg=${restored.portraitBg}`);
  ok("B403 — Owner column stays OFF after reopen", restored.ownerChecked === false, `ownerChecked=${restored.ownerChecked}`);
  ok("B403 — Margins section stays collapsed after reopen", restored.marginInputs === 0, `marginInputs=${restored.marginInputs}`);

  ok("no uncaught page errors", pageErrors.length === 0, pageErrors.slice(0, 3).join(" | "));
} catch (e) {
  ok("harness completed without throwing", false, e.message);
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} checks passed`);
await browser.close();
process.exit(passed === results.length ? 0 : 1);
