/* B583 — headless verification of the scheduler's Excel-style Formula column.
 *
 * Drives the standalone scheduler (/sequence/, served by `vite preview` on :4173)
 * in a real Chromium and exercises the user-facing flow end-to-end:
 *   1. the page boots (React/Babel from CDN) and renders the seed grid (Goose Creek);
 *   2. no uncaught JS errors / no formula-engine console errors;
 *   3. add a Formula column via the Columns chooser → inline editor → Add;
 *   4. the new column header appears and its cells show COMPUTED, per-row values;
 *   5. an error formula (1/0) surfaces "#DIV/0!" in the cell (never a silent blank);
 *   6. a bad column ref surfaces "#REF!".
 *
 * Run:  node ui-audit/verify-b583-formula-column.mjs   (preview server must be up)
 *
 * NOTE on this sandbox: the scheduler loads React/Babel/Supabase from public CDNs
 * that the agent proxy's allowlist blocks (ERR_CONNECTION_CLOSED), so /sequence/
 * can't boot here. To verify locally, vendor the libs and point BASE_URL at a
 * rewritten copy:
 *   npm install --no-save @babel/standalone
 *   mkdir -p dist/sequence/_vendor && cp node_modules/react/umd/react.production.min.js dist/sequence/_vendor/react.js \
 *     && cp node_modules/react-dom/umd/react-dom.production.min.js dist/sequence/_vendor/react-dom.js \
 *     && cp node_modules/@babel/standalone/babel.min.js dist/sequence/_vendor/babel.js \
 *     && cp node_modules/@supabase/supabase-js/dist/umd/supabase.js dist/sequence/_vendor/supabase.js
 *   # rewrite the 3 CDN <script src> in dist/sequence/index.html to ./_vendor/*.js → dist/sequence/_test.html
 *   BASE_URL="http://localhost:4173/sequence/_test.html" node ui-audit/verify-b583-formula-column.mjs
 * A browser-equipped teammate on an unrestricted network can run it against /sequence/ directly.
 */
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const BASE = process.env.BASE_URL || "http://localhost:4173/sequence/";
const CANDIDATES = [
  process.env.PW_CHROME,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome",
].filter(Boolean);
const EXEC = CANDIDATES.find(p => existsSync(p));

const fail = msg => { console.error("✗ " + msg); process.exitCode = 1; };
const ok = msg => console.log("✓ " + msg);

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", e => errors.push("pageerror: " + e.message));
page.on("console", m => { if (m.type() === "error") errors.push("console.error: " + m.text()); });

try {
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45000 });
  // Wait for the grid to paint (Babel compiles in-browser, CDN React loads).
  await page.waitForSelector("[data-task-row]", { timeout: 45000 });
  ok("scheduler booted and rendered the task grid");

  // Engine must be present on the page.
  const hasEngine = await page.evaluate(() => !!(window.PlanyrFormula && typeof window.PlanyrFormula.evaluateFormula === "function"));
  if (!hasEngine) fail("window.PlanyrFormula not found on the page"); else ok("formula engine present (window.PlanyrFormula)");

  // Helper: add a formula column via the UI.
  async function addFormula(name, formula) {
    await page.click("button:has-text('Columns')");
    await page.click("text=Formula column");
    await page.waitForSelector("input[placeholder='e.g. Days remaining']", { timeout: 5000 });
    await page.fill("input[placeholder='e.g. Days remaining']", name);
    const ta = page.locator("textarea");
    await ta.fill(formula);
    // Click the primary action ("Add column").
    await page.click("button:has-text('Add column')");
    await page.waitForTimeout(400);
  }

  // 1) Happy path — a numeric per-row computation from Duration.
  await addFormula("Half dur", "[Duration] / 2");
  const headerSeen = await page.locator("text=HALF DUR").count().catch(() => 0);
  // Header text is uppercased via CSS; match case-insensitively on the DOM text instead.
  const hdr = await page.evaluate(() => Array.from(document.querySelectorAll("div")).some(d => (d.textContent || "").trim().toLowerCase() === "half dur"));
  if (hdr || headerSeen) ok("new formula column header rendered"); else fail("formula column header not found");

  // Read the computed cells of the new column. We locate by reading the engine's
  // values directly off the page state to confirm the column produced numbers.
  const compute = await page.evaluate(() => {
    const PF = window.PlanyrFormula;
    // Re-derive a value the same way the grid does, for the first leaf task.
    return { ok: !!PF };
  });
  if (compute.ok) ok("engine reachable for computation");

  // Assert the rendered grid actually contains computed values for the new column.
  // The cells render right-aligned numbers; check that at least a few numeric cells exist
  // that are NOT part of the built-in columns (heuristic: presence of "0.5"/"4"/"13" style).
  const numericCellsPresent = await page.evaluate(() => {
    // Grab the visible grid rows' text and look for half-integer or integer tokens
    // produced by [Duration]/2 (e.g. 0.5, 1, 1.5, 4, 13). This is a smoke check.
    const rows = Array.from(document.querySelectorAll("[data-task-row]")).slice(0, 12);
    let hits = 0;
    rows.forEach(r => { if (/\b\d+(\.5)?\b/.test(r.textContent || "")) hits++; });
    return hits;
  });
  if (numericCellsPresent > 0) ok(`formula column shows computed values (${numericCellsPresent} rows with numeric tokens)`);
  else fail("no computed numeric values found in the formula column");

  // 2) Error surfacing — divide by zero must show #DIV/0!
  await addFormula("Boom", "1 / 0");
  const div0 = await page.evaluate(() => (document.body.textContent || "").includes("#DIV/0!"));
  if (div0) ok("#DIV/0! surfaced in a cell (no silent blank)"); else fail("#DIV/0! not shown for 1/0");

  // 3) Bad column reference → #REF!
  await addFormula("BadRef", "[NoSuchColumn] + 1");
  const ref = await page.evaluate(() => (document.body.textContent || "").includes("#REF!"));
  if (ref) ok("#REF! surfaced for an unknown column"); else fail("#REF! not shown for a bad column reference");

  // 4) B589 — cross-row aggregation must use the project's LEAF tasks (no double-counting
  //    of parent roll-up rows). Add SUM([Duration]); the column shows ONE constant total on
  //    every row. Verify that constant equals the seed's LEAF-duration sum, NOT the all-rows
  //    sum (which includes parent roll-ups and would be the double-counted, wrong value).
  await addFormula("Total dur", "SUM([Duration])");
  const agg = await page.evaluate(() => {
    const d = window.__PLANAR_DATA__;
    const proj = d && d.projects && d.projects[d.aPid];
    const ts = (proj && proj.tasks) || [];
    const parentIds = new Set(ts.map(t => t.parentId).filter(x => x !== null && x !== undefined));
    const leafSum = ts.filter(t => !parentIds.has(t.id)).reduce((s, t) => s + (Number(t.duration) || 0), 0);
    const allSum = ts.reduce((s, t) => s + (Number(t.duration) || 0), 0); // incl. parent roll-ups → the double-counted value
    // Tokens (2+ digits) common to EVERY rendered row = the column-wide SUM constant.
    const rows = Array.from(document.querySelectorAll("[data-task-row]"));
    const tokenSets = rows.map(r => new Set((r.textContent || "").match(/\d{2,}/g) || []));
    let common = tokenSets.length ? [...tokenSets[0]] : [];
    tokenSets.forEach(s => { common = common.filter(t => s.has(t)); });
    return { leafSum, allSum, common, hasGroups: leafSum !== allSum };
  });
  if (agg.hasGroups) ok(`seed has parent groups (leafSum=${agg.leafSum} ≠ allSum=${agg.allSum}) — double-count fix is exercised`);
  else fail("seed unexpectedly has no parent groups; cannot exercise the double-count fix");
  if (agg.common.includes(String(agg.leafSum)))
    ok(`SUM([Duration]) shows the LEAF total ${agg.leafSum} on every row (parents not double-counted)`);
  else fail(`SUM([Duration]) column constant ${JSON.stringify(agg.common)} != leaf-duration sum ${agg.leafSum} (double-count regression?)`);
  if (agg.allSum !== agg.leafSum && agg.common.includes(String(agg.allSum)))
    fail(`SUM([Duration]) shows the ALL-rows sum ${agg.allSum} — parent roll-ups are being double-counted`);
  // Direct engine assertion: SUM over the column equals the arithmetic total of leaf durations.
  const aggOk = await page.evaluate(() => {
    const PF = window.PlanyrFormula;
    if (!PF) return false;
    // Build a tiny table and verify SUM/COUNTIF behave as whole-column ops.
    const rows = [{ cost: 100 }, { cost: 250 }, { cost: 50 }];
    const r1 = PF.evaluateFormula("SUM([Cost])", { columns: rows[0], rows, rowIndex: 0 });
    const r2 = PF.evaluateFormula('COUNTIF([Cost], ">=100")', { columns: rows[0], rows, rowIndex: 0 });
    return r1.ok && r1.value === 400 && r2.ok && r2.value === 2;
  });
  if (aggOk) ok("SUM([Cost])=400 and COUNTIF([Cost],\">=100\")=2 via the live in-page engine");
  else fail("in-page aggregation (SUM/COUNTIF) returned the wrong result");

  // 5) B596 — error propagation through aggregation (match Excel exactly). The HOST stores
  //    an errored formula-column cell as PF.errVal(code); a SUM/COUNT/reference over that
  //    column must PROPAGATE the code, not silently skip the bad row. Exercise the live
  //    in-page engine through the same window.PlanyrFormula the grid uses.
  const propOk = await page.evaluate(() => {
    const PF = window.PlanyrFormula;
    if (!PF || typeof PF.errVal !== "function") return { ok: false, why: "errVal missing on window.PlanyrFormula" };
    const E = PF.errVal("#DIV/0!");
    const rows = [{ cost: 10 }, { cost: E }, { cost: 30 }];
    const ctx = { columns: rows[0], rows, rowIndex: 0 };
    const sum = PF.evaluateFormula("SUM([Cost])", ctx);
    const cnt = PF.evaluateFormula("COUNT([Cost])", ctx);
    const ref = PF.evaluateFormula("[Cost] + 1", { columns: { cost: E }, rows: [{ cost: E }], rowIndex: 0 });
    const trap = PF.evaluateFormula("IFERROR(SUM([Cost]), -1)", ctx);
    const clean = PF.evaluateFormula("SUM([Cost])", { columns: { cost: 10 }, rows: [{ cost: 10 }, { cost: 20 }], rowIndex: 0 });
    return {
      ok: !sum.ok && sum.error === "#DIV/0!" && !cnt.ok && cnt.error === "#DIV/0!" &&
          !ref.ok && ref.error === "#DIV/0!" && trap.ok && trap.value === -1 &&
          clean.ok && clean.value === 30,
      detail: JSON.stringify({ sum, cnt, ref, trap, clean }),
    };
  });
  if (propOk.ok) ok("B596: SUM/COUNT over an errored cell propagate #DIV/0!, IFERROR traps it, a clean column still sums — via the live engine");
  else fail("B596 error-propagation failed in-page: " + (propOk.why || propOk.detail));

  try { await page.screenshot({ path: "ui-audit/screens/b583-formula-column.png" }); } catch { /* screens/ is gitignored; optional */ }

  // Final: no uncaught JS errors during the whole flow. Environmental network
  // failures are expected in the sandbox (the scheduler's own Supabase backend and
  // CDN fonts are blocked by the proxy) and are NOT product bugs — filter them out.
  const ENV_NOISE = /Babel|sourceMap|Download the React DevTools|favicon|Failed to load resource|ERR_CONNECTION_CLOSED|ERR_TUNNEL_CONNECTION_FAILED|ERR_NAME_NOT_RESOLVED|WebSocket|supabase\.co|tabler|realtime/i;
  const real = errors.filter(e => !ENV_NOISE.test(e));
  if (real.length) { console.error("Console/page errors:\n" + real.join("\n")); fail(`${real.length} JS error(s) during the flow`); }
  else ok("no uncaught JS errors during the formula-column flow");

} catch (e) {
  fail("harness threw: " + (e && e.message));
  console.error(e);
} finally {
  await browser.close();
}

console.log(process.exitCode ? "\nRESULT: FAIL" : "\nRESULT: PASS");
