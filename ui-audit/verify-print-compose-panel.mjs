/* verify-print-compose-panel — NEW-1 (2026-10-30): the redesigned "Exhibit settings" panel on the Print / Compose screen,
 * driven in a real browser. Proves what the static-markup test (test/printComposePanel.test.js) cannot: that the clicks
 * do what the mockup says, against the SAME sheet the PDF is built from.
 *
 *   node ui-audit/verify-print-compose-panel.mjs                       # local: http://localhost:4173 (vite preview)
 *   node ui-audit/verify-print-compose-panel.mjs --live [--base https://planyr.io] [--shot /abs/panel.png]
 *
 * --live signs in as the test account (ui-audit/lib/signedInSession.mjs), writes ONE throwaway site to that account,
 * checks the panel on it, then deletes the site and verifies it is gone (constraint #15). Nothing here changes a saved
 * setting: only paper / orientation (React state), which are never persisted.
 *
 * Known-good arm (CLAUDE.md DANGEROUS-MEANS-UNOBSERVABLE / DRIVER-SCROLL §6): the stock Letter sheet must read 11×8.5 in
 * BEFORE anything is clicked — if the preview read is wrong the run is void, not scored. */
import { chromium } from "playwright";
import { perfScenarioSeed } from "./lib/perf-scenario.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
const live = process.argv.includes("--live");
const base = (arg("--base", live ? "https://planyr.io" : (process.env.BASE_URL || "http://localhost:4173/"))).replace(/\/?$/, "/");
const shot = arg("--shot", null);
const RUN = Math.random().toString(36).slice(2, 6);
const SITE_ID = `zz-composepanel-${RUN}`;
const RECT = [[-900, -1170], [900, -1170], [900, 1170], [-900, 1170]].map(([x, y]) => ({ x, y }));
const site = {
  id: SITE_ID, groupId: SITE_ID, site: `zz compose panel ${RUN}`, name: "Concept A", origin: { lat: 33.2458963792457, lon: -84.16362918465775 }, county: "ga_spalding",
  parcels: [{ id: "pc1", active: true, locked: false, points: RECT, setbacks: RECT.map(() => 25) }],
  els: [], measures: [], callouts: [], markups: [], settings: { setback: 25 }, underlay: null, updatedAt: Date.now(), status: "active",
};

const fail = [], ok = [];
const check = (cond, pass, bad) => (cond ? ok.push(pass) : fail.push(bad || pass));
let page, closeAll, served = null;

try {
  if (live) {
    const s = await openSignedIn({ base: base.replace(/\/$/, ""), viewport: { width: 1600, height: 900 } });
    page = s.page; closeAll = () => s.close();
    await assertMeasurable(page, "verify-print-compose-panel");
    served = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
    console.log("signed in as", s.proof.email, "| served build", served);
    const err = await page.evaluate(async (row0) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const r = await window.pfSupabase.from("sites").insert({ id: row0.id, group_id: row0.groupId, site: row0.site, name: row0.name, county: row0.county, updated_at: new Date().toISOString(), data: row0, user_id: u.user.id });
      return r.error ? String(r.error.message) : null;
    }, site);
    if (err) throw new Error("throwaway site insert failed: " + err);
    await page.goto(`${base}#/project/${SITE_ID}/site`, { waitUntil: "load" });
    await page.reload({ waitUntil: "load" });
    await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
  } else {
    const browser = await chromium.launch({ executablePath: process.env.PW_CHROME || "/opt/pw-browsers/chromium-1248/chrome-linux64/chrome", args: ["--no-sandbox"] });
    const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
    await ctx.addInitScript(perfScenarioSeed());
    page = await ctx.newPage(); closeAll = () => browser.close();
    await assertMeasurable(page, "verify-print-compose-panel");
    await page.route(/^https?:\/\//, (r) => (r.request().url().startsWith(base) ? r.continue() : r.abort()));
    await page.goto(base, { waitUntil: "load" });
    await page.getByRole("button", { name: /^Site$/ }).first().click();
    await page.waitForSelector('[data-testid="planner-canvas"]', { timeout: 60000 });
  }

  await page.getByRole("button", { name: /^File/ }).filter({ visible: true }).first().click();
  await page.getByRole("button", { name: /Download PDF \/ pick frame/ }).first().click();
  await page.waitForFunction(() => /PRINT FRAME/i.test(document.body.innerText), null, { timeout: 20000 });
  await page.getByRole("button", { name: /^Continue ➜$/ }).first().click();
  await page.waitForSelector('[data-testid="print-compose"]', { timeout: 20000 });
  const panel = page.locator('[data-testid="print-compose"]');

  const sheetSize = async (prev) => {
    for (let i = 0; i < 40; i++) {
      await page.waitForTimeout(250);
      const src = await panel.locator('img[alt="Sheet preview"]').getAttribute("src").catch(() => null);
      if (!src) continue;
      const t = await page.evaluate(async (u) => { try { return await (await fetch(u)).text(); } catch { return null; } }, src);
      if (!t) continue;
      const w = (t.match(/width="([\d.]+)in"/) || [])[1], h = (t.match(/height="([\d.]+)in"/) || [])[1];
      if (w && h && `${w}x${h}` !== prev) return `${w}x${h}`;
    }
    return null;
  };
  const pressedPaper = () => panel.locator("button[aria-pressed=true]").filter({ hasText: /\d × \d/ }).allInnerTexts();
  const otherSel = panel.locator('select[aria-label="Other size"]');
  const orientBtns = panel.locator('[aria-label="Orientation"] button');

  // KNOWN-GOOD ARM: default Letter landscape must read 11×8.5 before anything is clicked.
  const letter = await sheetSize(null);
  if (letter !== "11x8.5") throw new Error(`VOID — default sheet read ${letter}, expected 11x8.5 (the preview read is wrong, nothing below is scored)`);
  ok.push("known-good arm: default sheet is Letter 11×8.5 in");

  // (a) structure
  const primaries = await panel.locator("button").filter({ hasText: /\d × \d/ }).allInnerTexts();
  check(primaries.length === 3 && /8\.5 × 11\s*Letter/.test(primaries[0]) && /11 × 17\s*Half-size/.test(primaries[1]) && /24 × 36\s*Full-size/.test(primaries[2]), "exactly three paper buttons: 8.5 × 11 Letter · 11 × 17 Half-size · 24 × 36 Full-size", `paper buttons wrong: ${JSON.stringify(primaries)}`);
  const opts = await otherSel.locator("option:not([disabled])").allInnerTexts();
  check(JSON.stringify(opts) === JSON.stringify(["18 × 24 (ARCH C)", "17 × 22 (ANSI C)", "22 × 34 (ANSI D)", "Custom (match my frame)"]), "the Other size dropdown holds the four entries", `dropdown wrong: ${JSON.stringify(opts)}`);
  check((await pressedPaper()).length === 1 && /Letter/.test((await pressedPaper())[0]), "Letter is the selected button on open");

  // stock buttons change the real sheet
  await panel.getByRole("button", { name: /Half-size/ }).click();
  check((await sheetSize(letter)) === "17x11", "Half-size → a real 17×11 in sheet");
  await panel.getByRole("button", { name: /Full-size/ }).click();
  const full = await sheetSize("17x11");
  check(full === "36x24", "Full-size → a real 36×24 in sheet (the ARCH D key)", `Full-size read ${full}`);

  // dropdown deselects the buttons; a button resets the dropdown
  await otherSel.selectOption({ label: "22 × 34 (ANSI D)" });
  const ansid = await sheetSize(full);
  check(ansid === "34x22", "Other size → 22 × 34 (ANSI D) gives a 34×22 in sheet", `ANSI D read ${ansid}`);
  check((await pressedPaper()).length === 0, "picking from the dropdown deselects all three buttons");
  await panel.getByRole("button", { name: /Letter/ }).click();
  await sheetSize(ansid);
  check((await otherSel.inputValue()) === "", "picking a button resets the dropdown to its placeholder");

  // (b) Custom
  await otherSel.selectOption({ label: "Custom (match my frame)" });
  await page.waitForTimeout(1200);
  check((await pressedPaper()).length === 0, "Custom: the three buttons are deselected");
  check((await orientBtns.evaluateAll((bs) => bs.map((b) => b.disabled))).every(Boolean), "Custom: Landscape / Portrait are disabled (the page follows the frame)");
  check((await otherSel.inputValue()) === "custom", "Custom: the dropdown shows Custom");
  await panel.getByRole("button", { name: /Letter/ }).click();
  await page.waitForTimeout(1200);
  check(!(await orientBtns.evaluateAll((bs) => bs.map((b) => b.disabled))).some(Boolean), "choosing a stock size re-enables orientation (fit-to-frame cleared)");

  // (c) labels
  const body = await panel.innerText();
  for (const s of ["Site summary strip", "Scale to fit (NTS)", "Flatten markups (unrecoverable)", "Square feet labels", "On the plan", "Markups"]) check(body.toLowerCase().includes(s.toLowerCase()) || (await panel.locator("select option", { hasText: s }).count()) > 0, `shows "${s}"`);
  const html = await panel.innerHTML();
  for (const s of ["Stats band", "Bluebeam", "Acrobat", "Fit to frame", "Element area", "Map / GIS layers"]) check(!html.includes(s), `"${s}" appears nowhere in the panel`);
  const tip = await panel.locator("label", { hasText: "Flatten markups" }).getAttribute("title");
  check(tip === "Off: callouts, lines, shapes and measurements stay editable in the PDF. On: they are burned into the page and can't be edited again.", "the Flatten markups tooltip is the approved text");

  // one text size across the panel (leaf text nodes inside the options column, minus the shared Section heading labels)
  const sizes = await panel.evaluate((root) => {
    const scroll = root.querySelector("[style*='overflow-y: auto']");
    const out = {};
    const w = document.createTreeWalker(scroll, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue;
      const el = n.parentElement; const fs = getComputedStyle(el).fontSize;
      const isHeading = getComputedStyle(el).textTransform === "uppercase";
      if (isHeading || n.textContent.trim() === "▶") continue; // shared Section heading label + its chevron
      (out[fs] = out[fs] || []).push(n.textContent.trim().slice(0, 24));
    }
    return out;
  });
  check(Object.keys(sizes).length === 1 && Object.keys(sizes)[0] === "12px", "one text size across the panel (12px; only the shared section headings differ)", `text sizes: ${JSON.stringify(sizes)}`);

  // the cards: whole card is the click target
  const stripBox = panel.getByLabel("Site summary strip");
  const was = await stripBox.isChecked();
  await panel.locator("label", { hasText: "Detention required vs. provided" }).locator("span", { hasText: "Detention required vs. provided" }).last().click();
  check((await stripBox.isChecked()) === !was, "clicking the card's description text toggles the Site summary strip (whole card is the target)");
  await stripBox.setChecked(was);

  if (shot) { await panel.screenshot({ path: shot }); console.log("screenshot →", shot); }
} catch (e) {
  fail.push(String(e && e.stack ? e.stack : e).split("\n").slice(0, 3).join(" | "));
} finally {
  if (live) {
    try {
      const gone = await page.evaluate(async (id) => {
        await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
        await window.pfSupabase.from("sites").delete().eq("id", id);
        const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
        for (const k of Object.keys(localStorage)) { if ((localStorage.getItem(k) || "").includes(id)) localStorage.removeItem(k); }
        return q.error ? "err:" + q.error.message : (q.data || []).length;
      }, SITE_ID);
      console.log(`cleanup: throwaway sites left in the cloud = ${gone}`);
      if (gone !== 0) fail.push("cleanup left the throwaway site behind");
    } catch (e) { console.log("cleanup FAILED", String(e).slice(0, 200)); fail.push("cleanup failed"); }
  }
  await closeAll?.().catch(() => {});
}

console.log("NEW-1 — Exhibit settings panel redesign" + (served ? ` (build ${served})` : "") + "\n");
for (const m of ok) console.log("  ✓", m);
for (const m of fail) console.log("  ✗", m);
console.log(fail.length ? "\n✗ FAIL" : "\n✓ PASS");
process.exit(fail.length ? 1 : 0);
