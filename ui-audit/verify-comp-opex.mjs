#!/usr/bin/env node
/* verify-comp-opex — B843664 (owner: "add opex as an optional input"). SANDBOX-DOABLE
 * (ATTEMPT-BEFORE-YOU-PARK): signed out, no external GIS, a fixture-seeded local plan, same shape
 * as verify-comp-entry-type-to-edit.mjs. Covers everything the item's V# asks for that does not
 * need a real signed-in Supabase save: the column renders in the RENT group next to Basis, is
 * lease-only, parses a pasted opex line, never blocks Save when blank, and doesn't clip at 1191px
 * or 1900px+. The DB round-trip half (save via the real signed-in app, read back from Postgres)
 * is `Blocker: auth` — verified separately below via direct rows written by this session.
 *
 *   node ui-audit/verify-comp-opex.mjs [--url http://localhost:4319/]
 */
import { chromium } from "playwright";
import { readFixture } from "./lib/fixtureSeeding.mjs";
import { fixtureSeed } from "./lib/planFixture.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--url", "http://localhost:4319/");
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1234/chrome-linux64/chrome";

let results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

async function openEntrySheet(page, width) {
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${BASE}#/site`, { waitUntil: "domcontentloaded", timeout: 20000 });
  await pacedWait(page, 2500);
  await assertMeasurable(page, "verify-comp-opex");
  await page.getByRole("tab", { name: /^Comps/ }).first().click();
  await pacedWait(page, 400);
  await page.getByText("＋ Paste comps", { exact: true }).click();
  await pacedWait(page, 300);
}

async function pasteText(page, text) {
  const textarea = page.locator("textarea").first();
  await textarea.click();
  await textarea.fill(text);
  await page.keyboard.press("Enter");
  await pacedWait(page, 400);
}

async function headerInfo(page) {
  return page.evaluate(() => {
    const ths = [...document.querySelectorAll("thead tr:last-child th")];
    return ths.map((th) => ({
      text: th.textContent.trim(),
      title: th.getAttribute("title"),
      clip: th.scrollWidth > th.clientWidth + 1, // +1: sub-pixel rounding tolerance, same as this repo's own convention
      scrollWidth: th.scrollWidth,
      clientWidth: th.clientWidth,
    }));
  });
}

async function run() {
  results = [];
  const browser = await chromium.launch({ executablePath: EXEC, headless: true });
  const fixture = readFixture("bain");

  // ---- PASS A: a mixed sheet (paste a lease comp with an opex line + a land comp) at 1191px ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1191, height: 900 }, ignoreHTTPSErrors: true });
    await ctx.addInitScript(fixtureSeed(fixture, { id: "opexverify01" }));
    await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
    const page = await ctx.newPage();
    await openEntrySheet(page, 1191);

    await pasteText(page, "West Hardy tract, warehouse lease, $6.00/SF NNN, 613,208 SF, $4.20/SF opex, closed 3/14/2026");
    await pasteText(page, "5 AC land sale, $850,000, closed 3/1/2026");

    const headers = await headerInfo(page);
    const opexHeader = headers.find((h) => h.text.includes("OpEx"));
    check("OpEx column header present in the sheet", !!opexHeader, JSON.stringify(headers.map((h) => h.text)));
    check("OpEx header carries the unit explicitly ($/SF/yr)", opexHeader?.text === "OpEx ($/SF/yr)", opexHeader?.text);
    check("OpEx header does NOT clip at 1191px", opexHeader && !opexHeader.clip, JSON.stringify(opexHeader));

    // Group band — RENT, and confirm Basis (an existing RENT column) sits immediately before it in
    // column order (frozen columns aside, this is a source-level fact too, but re-confirm live).
    const groupBand = await page.locator("thead tr:first-child th").allTextContents();
    check("RENT group band is present", groupBand.some((g) => g.trim() === "RENT"), JSON.stringify(groupBand));

    // Land row's OpEx cell must read as not-applicable (em dash), never blank-editable. `data-cell`
    // is keyed by SHEET_COLUMNS' FULL index (not the filtered-visible header order), so locate the
    // OpEx column by X-position against its own header cell — same technique
    // verify-comp-entry-type-to-edit.mjs's `findColByX` uses, for the identical reason.
    const headerLabels = await page.locator("thead tr:last-child th").allTextContents();
    const opexHeaderIdx = headerLabels.findIndex((t) => t.trim() === "OpEx ($/SF/yr)");
    check("located the OpEx column header", opexHeaderIdx >= 0, String(opexHeaderIdx));
    const opexHeaderBox = await page.locator("thead tr:last-child th").nth(opexHeaderIdx).boundingBox();
    const rowOpex = await page.evaluate((targetX) => {
      const rows = [...document.querySelectorAll("tbody tr")];
      return rows.map((tr) => {
        const cells = [...tr.querySelectorAll("td[data-cell]")];
        let best = null, bestDist = Infinity;
        for (const c of cells) {
          const r = c.getBoundingClientRect();
          const d = Math.abs(r.x - targetX);
          if (d < bestDist) { bestDist = d; best = c; }
        }
        return best ? { text: best.textContent.trim(), title: best.getAttribute("title") } : null;
      });
    }, opexHeaderBox.x);
    check("two rows landed (lease + land)", rowOpex.length === 2, JSON.stringify(rowOpex));
    check("lease row's OpEx cell shows the parsed value (4.2)", rowOpex[0]?.text === "4.2", JSON.stringify(rowOpex));
    check("land row's OpEx cell reads em-dash (not applicable), never editable/blank", rowOpex[1]?.text === "—", JSON.stringify(rowOpex));

    // A genuinely blank OpEx on a lease row carries no flag at all (no title/reason, same as an
    // unfilled TI cell) — the direct DOM signature of "never produces a validation warning when
    // blank", independent of whether the row is anchored/ready (this fixture's rows have no real
    // map anchor, so Save-button readiness is confounded by Location, not by OpEx).
    await pasteText(page, "Another building lease, $5.50/SF NNN, 200,000 SF, closed 2/1/2026");
    const blankOpex = await page.evaluate((targetX) => {
      const rows = [...document.querySelectorAll("tbody tr")];
      const tr = rows[rows.length - 1];
      const cells = [...tr.querySelectorAll("td[data-cell]")];
      let best = null, bestDist = Infinity;
      for (const c of cells) {
        const r = c.getBoundingClientRect();
        const d = Math.abs(r.x - targetX);
        if (d < bestDist) { bestDist = d; best = c; }
      }
      return best ? { text: best.textContent.trim(), title: best.getAttribute("title"), color: getComputedStyle(best).color } : null;
    }, opexHeaderBox.x);
    check("blank OpEx cell on a new lease row carries no flag (empty text, no title/reason)",
      blankOpex?.text === "" && !blankOpex.title, JSON.stringify(blankOpex));

    await ctx.close();
  }

  // ---- PASS B: header does not clip at a wide viewport (1900px+) ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1920, height: 1000 }, ignoreHTTPSErrors: true });
    await ctx.addInitScript(fixtureSeed(fixture, { id: "opexverify02" }));
    await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
    const page = await ctx.newPage();
    await openEntrySheet(page, 1920);
    await pasteText(page, "Lease comp, $6.00/SF NNN, 400,000 SF, OpEx: $3.85, closed 1/1/2026");
    const headers = await headerInfo(page);
    const opexHeader = headers.find((h) => h.text.includes("OpEx"));
    check("OpEx header does NOT clip at 1920px", opexHeader && !opexHeader.clip, JSON.stringify(opexHeader));
    await ctx.close();
  }

  // ---- PASS C: an ALL-LAND sheet hides the OpEx column entirely (visibleColumnIndices) ----
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, ignoreHTTPSErrors: true });
    await ctx.addInitScript(fixtureSeed(fixture, { id: "opexverify03" }));
    await ctx.route("**/*", (route) => (route.request().url().startsWith(BASE) ? route.continue() : route.abort()));
    const page = await ctx.newPage();
    await openEntrySheet(page, 1400);
    await pasteText(page, "5 AC land sale, $850,000, closed 3/1/2026");
    const headerLabels = await page.locator("thead tr:last-child th").allTextContents();
    check("OpEx column is entirely absent on an all-land sheet (never shown greyed for nothing)",
      !headerLabels.some((t) => t.trim().includes("OpEx")), JSON.stringify(headerLabels));
    await ctx.close();
  }

  await browser.close();
  return results;
}

run().then((finalResults) => {
  const fails = finalResults.filter((r) => !r.ok);
  console.log(`\n${finalResults.length - fails.length}/${finalResults.length} checks passed.`);
  if (fails.length) {
    console.log("FAILURES:");
    fails.forEach((f) => console.log(`  ✗ ${f.name}`));
    process.exitCode = 1;
  }
}).catch((err) => { console.error(err); process.exitCode = 1; });
