/**
 * B736 — verify the deed importer reads .doc + PDF, accepts several files at once, lists them,
 * and plots each in turn ("Plot all"). Full end-to-end in a real browser, logged-out (pure client
 * UI). Drives the actual pdf.js worker path (which node can't) with the real fixtures.
 *
 * Run:  npm run build && npx vite preview --host --port 4173 (bg), then
 *       node ui-audit/verify-b736-multiformat-deed.mjs
 */
import { chromium } from "playwright";
import { fileURLToPath } from "url";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || ""; // empty → let Playwright resolve via PLAYWRIGHT_BROWSERS_PATH
const fx = (n) => fileURLToPath(new URL(`../test/fixtures/deeds/${n}`, import.meta.url));

const PARCEL = [{ x: -1300, y: -975 }, { x: 1300, y: -975 }, { x: 1050, y: 675 }, { x: -1150, y: 975 }];
const site = {
  s_mb: {
    id: "s_mb", groupId: "s_mb", site: "MB Import Test", name: "Plan 1", status: "active",
    origin: { lat: 29.80, lon: -95.83 }, county: "harris",
    parcels: [{ id: "pA", points: PARCEL, locked: true }],
    els: [], measures: [], callouts: [], markups: [],
    deletedIds: [], settings: { showSetback: false }, underlay: null, updatedAt: Date.now(),
  },
};
const seed = `(() => { try {
  localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(site)}));
  localStorage.setItem('planarfit:currentSite:v1', 's_mb');
} catch (e) {} })();`;

let failures = 0;
const expect = (label, cond, extra = "") => { if (!cond) failures++; console.log(`  [${cond ? "PASS" : "FAIL"}] ${label}${extra ? ` — ${extra}` : ""}`); };
const markups = (page) => page.evaluate(() => {
  try { const s = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}").s_mb; return (s && s.markups) || []; } catch (e) { return []; }
});

async function run() {
  const launchOpts = { args: ["--no-sandbox", "--ignore-certificate-errors"] };
  if (EXEC) launchOpts.executablePath = EXEC;
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({ viewport: { width: 1320, height: 860 }, deviceScaleFactor: 1 });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const errors = [];
  const isNetNoise = (t) => /ERR_(CONNECTION|TUNNEL|NAME|INTERNET|NETWORK|ABORT|TIMED)|Failed to load resource|net::/i.test(t);
  page.on("console", (m) => { if (m.type() === "error" && !isNetNoise(m.text())) errors.push(m.text()); });
  page.on("pageerror", (e) => { if (!isNetNoise(String(e))) errors.push(String(e)); });

  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2800);
  const svg = page.locator('svg[aria-label="Site plan canvas"]');
  await svg.waitFor({ timeout: 12000 });

  // Open the Deed / Title tool from the Parcel ▾ menu.
  await page.getByRole("button", { name: /Parcel/ }).first().click();
  await page.waitForTimeout(300);
  await page.locator('[data-testid="boundary-menu-mb"]').click();
  await page.waitForTimeout(500);

  // Drop three deeds at once: legacy .doc, a text-layer PDF, and a .txt.
  await page.locator('[data-testid="deed-file-input"]').setInputFiles([
    fx("deed-poa-parcel3.doc"), fx("deed-poa-parcel3.pdf"), fx("deed-simple.txt"),
  ]);
  // pdf.js worker + parsing takes a beat.
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="deed-queue-row"]').length >= 3, { timeout: 20000 }).catch(() => {});
  const rows = page.locator('[data-testid="deed-queue-row"]');
  const nRows = await rows.count();
  expect("dropping 3 files lists 3 deeds in the queue", nRows === 3, `${nRows} rows`);

  const rowTexts = await rows.allInnerTexts();
  const readable = rowTexts.filter((t) => /\bcall/i.test(t)).length;
  expect("all three deeds parsed to bearing/distance calls (.doc, PDF, .txt)", readable === 3, `${readable}/3 show calls`);
  expect(".doc row read (shows its filename)", rowTexts.some((t) => /parcel3\.doc/i.test(t)));
  expect("PDF row read via the browser pdf.js worker (shows calls)", rowTexts.some((t) => /parcel3\.pdf/i.test(t) && /\bcall/i.test(t)));

  // Click the PDF row → its text loads into the plotter textarea.
  const pdfRow = rows.filter({ hasText: /parcel3\.pdf/i }).first();
  await pdfRow.click();
  await page.waitForTimeout(300);
  const ta = await page.locator("textarea").first().inputValue();
  expect("clicking a queue row loads that deed's text into the textarea", /THENCE/i.test(ta) && ta.length > 200, `${ta.length} chars`);

  // Plot all → sequential POB placement.
  const plotAll = page.getByRole("button", { name: /Plot all 3/i });
  expect("a 'Plot all 3' button is offered", await plotAll.isVisible().catch(() => false));
  await plotAll.click();
  await page.waitForTimeout(400);
  const banner1 = await page.getByText(/Deed 1 of 3/i).isVisible().catch(() => false);
  expect("Plot all arms the sequence — banner reads 'Deed 1 of 3'", banner1);

  // Place three POBs by clicking the canvas.
  const box = await svg.boundingBox();
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  await page.mouse.click(cx, cy);
  await page.waitForTimeout(500);
  const banner2 = await page.getByText(/Deed 2 of 3/i).isVisible().catch(() => false);
  expect("after the first POB click the sequence advances to 'Deed 2 of 3'", banner2);
  await page.mouse.click(cx + 60, cy + 40);
  await page.waitForTimeout(500);
  await page.mouse.click(cx - 60, cy - 40);
  await page.waitForTimeout(700);

  const mk = await markups(page);
  const groups = new Set(mk.filter((m) => m.kind === "encumbrance" && !m.except).map((m) => m.deedGroup));
  expect("all three deeds plotted as independent groups", groups.size === 3, `${groups.size} deed groups, ${mk.length} markups`);
  const allPlaced = await page.getByText(/All 3 deeds placed/i).isVisible().catch(() => false);
  expect("a final 'All 3 deeds placed' summary shows", allPlaced);

  expect("no console/page errors through the whole flow", errors.length === 0, errors.slice(0, 2).join(" | "));

  await browser.close();
  console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILED"}`);
  process.exit(failures === 0 ? 0 : 1);
}
run().catch((e) => { console.error(e); process.exit(1); });
