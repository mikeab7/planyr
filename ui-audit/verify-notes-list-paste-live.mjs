#!/usr/bin/env node
/* verify-notes-list-paste-live — V2008752 / B2557984 + B2142464 ×4. Signed in as the TEST account on a real deploy, on a
 * THROWAWAY page it creates and deletes: the committed Word / OneNote outline fixtures (test/fixtures/clipboard-lists)
 * pasted onto blank paper must render as a REAL nested list with the table under its bullet and no bullet glyph left in
 * the text — read off the RENDERED page (a signed-in account's storage is keyed by user id), with the served
 * /version.json read in the same run. ⛔ The fixtures are SYNTHETIC models of Word / OneNote markup: a green run proves the
 * deployed wiring against faithful markup, not a capture from the owner's machine.
 * `BASE_URL` (default https://planyr.io) · `EXPECT_BUILD=<sha>` fails if /version.json differs · `SHOT` = screenshot prefix. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const FX = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../test/fixtures/clipboard-lists");
const load = (n) => ({ html: fs.readFileSync(path.join(FX, `${n}.html`), "utf8"), text: fs.readFileSync(path.join(FX, `${n}.txt`), "utf8") });
const BASE = process.env.BASE_URL || "https://planyr.io";
let s = null;
for (let i = 0; i < 12 && !s; i++) {
  try { s = await openSignedIn({ base: BASE }); }
  catch (e) { if (!/answered 502/.test(String(e)) || i === 11) throw e; console.log("sign-in route 502, retrying…"); await new Promise((r) => setTimeout(r, 15000)); }
}
const { page } = s;
await assertMeasurable(page, "verify-notes-list-paste-live");
let pass = 0, fail = 0;
const ok = (l, c, d = "") => { if (c) { pass++; console.log(`  ✓ ${l}`); } else { fail++; console.log(`  ✗ ${l}${d ? `\n      ${d}` : ""}`); } };
const SHOT = process.env.SHOT || "/tmp/claude-0/live-list-paste";

const build = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
console.log("signed in as", s.proof.email, "· served build", build.build);
if (process.env.EXPECT_BUILD) ok(`served build is the merge commit ${process.env.EXPECT_BUILD}`, String(build.build).startsWith(process.env.EXPECT_BUILD) || build.build === process.env.EXPECT_BUILD, JSON.stringify(build));
// the served chunk hash in the SAME observation as the assertions (a stale tab can serve a pre-deploy bundle)
const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((e) => e.getAttribute("src")).filter((x) => /index-/.test(x)));
console.log("served entry chunk(s):", chunks.join(", "));

const TITLE = "ZZ throwaway list paste " + Date.now().toString(36);
await page.goto(`${BASE}/?cb=${Date.now()}#/notes`, { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="notes-new-page"]', { timeout: 30000 });
await page.waitForTimeout(3500);
const before = await page.locator('[data-testid^="notes-row-"]').count();
/* one fresh throwaway page PER CASE: a big paste pans the workspace, so the title (which an earlier draft clicked to leave the box) can sit outside the viewport */
const newPage = async (n) => {
  await page.locator('[data-testid="notes-new-page"]').first().click();
  await page.waitForSelector('[data-testid="note-title"]', { timeout: 20000 });
  await page.locator('[data-testid="note-title"]').fill(`${TITLE} ${n}`);
  await page.locator('[data-testid="note-title"]').press("Tab").catch(() => {});
  await page.waitForTimeout(800);
};

async function arm(fx, fy) {
  const at = await page.evaluate(([a, b]) => { const r = document.querySelector('[data-testid="note-sheet"]').getBoundingClientRect(); return { x: r.left + r.width * a, y: r.top + r.height * b }; }, [fx, fy]);
  await page.mouse.dblclick(at.x, at.y); await page.waitForTimeout(500);
  return page.evaluate(() => !!document.querySelector('[data-testid="note-pending-caret"]'));
}
/* the rendered outline: each list item's own first paragraph at its list depth; a table as a grid */
const rendered = (anchorIndex) => page.evaluate((idx) => {
  const root = [...document.querySelectorAll(".planyr-anchor")][idx];
  if (!root) return null;
  const out = [];
  const own = (li) => { const p = li.querySelector(":scope > p"); return (p ? p.textContent : "").trim(); };
  const walk = (el, depth) => {
    for (const c of el.children) {
      if (c.tagName === "UL" || c.tagName === "OL") {
        [...c.children].forEach((li, i) => {
          out.push(`${"  ".repeat(depth)}${c.tagName === "OL" ? `${(parseInt(c.getAttribute("start") || "1", 10)) + i}.` : "•"} ${own(li)}`);
          walk(li, depth + 1);
        });
      } else if (c.tagName === "TABLE") {
        out.push(`${"  ".repeat(depth)}[table ${[...c.querySelectorAll("tr")].map((r) => [...r.children].map((x) => x.textContent.trim()).join(" | ")).join(" ; ")}]`);
      } else if (c.tagName === "P" && depth === 0) { const t = c.textContent.trim(); if (t) out.push(t); }
      else if (!["P", "LI"].includes(c.tagName)) walk(c, depth);
    }
  };
  walk(root.querySelector(".planyr-anchor-content") || root, 0);
  return out;
}, anchorIndex);
const paste = async (fx) => {
  await page.evaluate(([h, t]) => {
    const dt = new DataTransfer(); dt.setData("text/html", h); dt.setData("text/plain", t);
    (document.activeElement || document.body).dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, [fx.html, fx.text]);
  await page.waitForTimeout(1800);
};
const clickOut = async () => { await page.locator('[data-testid="note-title"]').click(); await page.waitForTimeout(900); };
const TABLE = "[table SF | $/SF ; <100K | 1 ; 100K - 250K | .60-.75 ; 500K - 750K | .50 - .40 ; 750K - 1M | .40 - .35]";
const GLYPH = /[·§□▪]/;

try {
  const cases = [
    ["word-outline-table", ["• Soft costs", "  • Design and engineering", "    • Fee by building size, per square foot", `      ${TABLE}`, "      • Fees step down as the building gets larger", "  • Permits and impact fees", "    • Impact fees are charged per lot", "• Hard costs"]],
    ["word-numbered-outline", ["1. Entitlements", "  1. Zoning", "    1. Confirm the district", "    2. Check the overlay", "  2. Platting", "2. Construction"]],
    ["onenote-outline-table-in-li", ["• Soft costs", "  • Design and engineering", "    • Fee by building size, per square foot", `      ${TABLE}`, "      • Fees step down as the building gets larger", "  • Permits and impact fees", "• Hard costs"]],
  ];
  let idx = 0;
  for (const [name, want] of cases) {
    console.log(`\n[${idx + 1}] ${name} on blank paper`);
    await newPage(idx + 1);
    ok("a double-click on blank paper armed a caret", await arm(0.08, 0.12));
    await paste(load(name));
    const got = await rendered(0);   // one box per throwaway page
    ok("it renders as the outline it was (real nested lists, table under its bullet)", JSON.stringify(got) === JSON.stringify(want), `\n      want ${JSON.stringify(want)}\n      got  ${JSON.stringify(got)}`);
    ok("no bullet glyph is left in the text", !(got || []).some((l) => GLYPH.test(l) || /^\s*[•\d.]+\s+o\s/.test(l)), JSON.stringify(got));
    await page.screenshot({ path: `${SHOT}-${idx + 1}-${name}.png` });
    idx += 1;
  }
} finally {
  console.log("\n[cleanup] deleting the throwaway page");
  try {
    for (let g = 0; g < 8 && (await page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).count()); g++) {
      const row = page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).first();
      await row.click({ button: "right" });
      await page.waitForTimeout(300);
      await page.locator('[data-testid^="notes-menu-"]', { hasText: /^Delete/ }).first().click();
      await page.waitForTimeout(800);
      const yes = page.locator('button[aria-label*="Confirm" i], button:has-text("✓")').first();
      if (await yes.count()) { await yes.click(); await page.waitForTimeout(1200); }
    }
  } catch (e) { console.log("  cleanup step error:", String(e).slice(0, 200)); }
  const left = await page.locator(`[data-testid^="notes-row-"]`, { hasText: TITLE }).count();
  ok("the throwaway page is gone from the list", left === 0);
  const after = await page.locator('[data-testid^="notes-row-"]').count();
  ok("page count is back to what it was", after === before, `${before} → ${after}`);
}
ok("no page error", s.errors.length === 0, s.errors.slice(0, 3).join(" | "));
console.log(`\n${pass} passed, ${fail} failed`);
await s.close();
process.exit(fail ? 1 : 0);
