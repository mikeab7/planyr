/**
 * NEW-1 — Review empty state at phone width (390): State 1 (pick a project) then State 2 (current set)
 * must not scroll horizontally, and every tappable row/card must be >= 44px tall. Logged-out: drawings
 * are cloud-only so counts read "No drawings yet" — the layout, overflow and touch-target contract is
 * what this measures. Known-good arm: the seeded project cards MUST be present or the run is VOID.
 * Run: node ui-audit/verify-review-empty-state.mjs   (preview server on :4173)
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium";
const OUT = new URL("./screens/review-empty/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
let failures = 0;
const check = (ok, label) => { console.log(`  ${ok ? "✓" : "✗"} ${label}`); if (!ok) failures++; };

const mk = (id, name) => ({ id, groupId: id, site: name, name, role: "pursuit", status: "pursuit", updatedAt: Date.now(), savedAt: Date.now() });
const sites = { p1: mk("p1", "Goose Creek Industrial With A Very Long Project Name That Must Ellipsise Not Overflow"), p2: mk("p2", "Bain") };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
await ctx.addInitScript((s) => { try { localStorage.setItem("planarfit:sites:v1", JSON.stringify(s)); } catch (_) {} }, sites);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-review-empty-state");
await page.goto(BASE + "#/markup", { waitUntil: "load" });
await page.waitForSelector('[data-testid="doc-review-root"]', { timeout: 20000 });
await page.waitForTimeout(1200);

const measure = () => page.evaluate(() => {
  const root = document.querySelector('[data-testid="review-empty"]');
  const tall = [...document.querySelectorAll('[data-testid="empty-project-card"],[data-testid="sheet-row"],[data-testid="empty-upload"],[data-testid="empty-upload-no-project"]')]
    .map((e) => Math.round(e.getBoundingClientRect().height));
  return { overflowX: document.documentElement.scrollWidth - window.innerWidth, rootOverflow: root ? root.scrollWidth - root.clientWidth : null, minH: tall.length ? Math.min(...tall) : null, n: tall.length };
});

const cards = await page.locator('[data-testid="empty-project-card"]').count();
check(cards === 2, `known-good arm: both seeded projects render as cards (got ${cards})`);
const t = await page.locator('[data-testid="doc-review-root"]').innerText();
for (const gone of ["Browse the Library", "Open PDF", "Compare revisions", "drop a construction PDF", "No drawing open"]) check(!t.includes(gone), `State 1 has no "${gone}"`);
check(/Pick a project/.test(t) && /Upload a file without a project/.test(t), "State 1 heading + no-project upload link");
let m = await measure();
check(m.overflowX <= 0 && (m.rootOverflow ?? 0) <= 0, `State 1: no horizontal overflow at 390 (page ${m.overflowX}, panel ${m.rootOverflow})`);
check(m.minH >= 44, `State 1: every tappable >= 44 tall (min ${m.minH})`);
await page.screenshot({ path: OUT + "state1-390.png" });

await page.locator('[data-testid="empty-project-card"]').first().click();
await page.waitForTimeout(900);
const t2 = await page.locator('[data-testid="doc-review-root"]').innerText();
check(/Current set/.test(t2) && /Upload file/.test(t2), "tapping a card selects the project and moves to State 2");
check(await page.locator('[data-testid="empty-project-card"]').count() === 0, "State 2 replaced the card list");
m = await measure();
check(m.overflowX <= 0 && (m.rootOverflow ?? 0) <= 0, `State 2: no horizontal overflow at 390 (page ${m.overflowX}, panel ${m.rootOverflow})`);
check(m.minH >= 44, `State 2: Upload file target >= 44 tall (min ${m.minH})`);
await page.screenshot({ path: OUT + "state2-390.png" });

await browser.close();
console.log(failures === 0 ? "\n✓ Review empty state OK at 390." : `\n✗ ${failures} failed.`);
process.exit(failures === 0 ? 0 : 1);
