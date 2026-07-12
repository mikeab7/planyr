/* Headless verifier for the B760–B762 Layers-panel overhaul (de-text · merged City/ETJ ·
 * folded county groups). Drives the real LayerPanel (ui-audit/layerpanel-harness.html) in
 * Chromium over a `vite` dev server and asserts the rendered DOM. Not part of the app build.
 *
 * Run:  npm run dev -- --port 5199 --strictPort   (in the background)
 *       node ui-audit/layerpanel-verify.mjs         (BASE defaults to :5199)
 */
import { chromium } from "playwright";

const BASE = process.env.BASE_URL || "http://localhost:5199";
const URL = `${BASE}/ui-audit/layerpanel-harness.html`;

const results = [];
const ok = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); };

const browser = await chromium.launch({ args: ["--no-sandbox", "--ignore-certificate-errors"] });
try {
  const page = await browser.newPage({ ignoreHTTPSErrors: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__READY__ === true, { timeout: 15000 });
  await page.waitForSelector("#panel-harris", { timeout: 15000 });

  const text = async (sel) => (await page.locator(sel).innerText()).replace(/\s+/g, " ");
  const harris = await text("#panel-harris");
  const fortbend = await text("#panel-fortbend");
  const chambers = await text("#panel-chambers");
  const etjon = await text("#panel-etjon");

  ok("no page errors while rendering", errors.length === 0, errors.join(" | "));

  // ── A3: group disclaimer paragraphs are gone; ONE footer replaces them ──
  ok("no 'has jurisdiction' group disclaimer", !/has jurisdiction/i.test(harris));
  ok("no 'Field evidence for screening' disclaimer", !harris.includes("Field evidence for screening"));
  ok("no 'Local agency layers' disclaimer", !harris.includes("Local agency layers"));
  ok("no 'verify with the issuing agency' disclaimer", !harris.includes("verify with the issuing agency"));
  ok("single screening footer present", harris.includes("Screening data — verify before relying on it."));

  // ── A1: no persistent per-row explanatory text when off (source/vintage live in the ⓘ) ──
  ok("no inline 'Source:' text on the closed panel", !harris.includes("Source:"), harris.slice(0, 400));
  ok("no inline 'As of:' text on the closed panel", !harris.includes("As of:"));
  ok("has ⓘ info buttons", (await page.locator('#panel-harris button[aria-label^="About "]').count()) > 5);

  // ── A2: plain-English renames ──
  ok("label 'Elevation shading'", harris.includes("Elevation shading"));
  ok("old 'Ground relief' label gone", !harris.includes("Ground relief"));
  ok("label 'Water flow direction'", harris.includes("Water flow direction"));
  ok("old 'Drainage direction' label gone", !harris.includes("Drainage direction"));
  ok("label 'MUD / water districts' (no jargon suffix)", harris.includes("MUD / water districts") && !harris.includes("(TCEQ, statewide)"));
  ok("kept 'Contour lines (1 ft)'", harris.includes("Contour lines (1 ft)"));

  // ── A4: one merged 'City limits & ETJ' toggle; the two old rows are gone ──
  ok("merged 'City limits & ETJ' row present", harris.includes("City limits & ETJ"));
  ok("old 'City ETJ (Houston region)' row gone", !harris.includes("City ETJ (Houston region)"));

  // ── A4 state: old saved state with jur_etj on → merged row loads ON ──
  const mergedHarris = page.locator('#panel-harris label:has-text("City limits & ETJ") input[type="checkbox"]');
  const mergedEtjOn = page.locator('#panel-etjon label:has-text("City limits & ETJ") input[type="checkbox"]');
  ok("merged toggle OFF when both off", !(await mergedHarris.isChecked()));
  ok("merged toggle ON when jur_etj was on", await mergedEtjOn.isChecked());
  ok("merged ON shows solid/ETJ legend key", /ETJ/.test(etjon));

  // ── A5: fold single-layer county groups ──
  // group headers are CSS-uppercased (text-transform), so innerText returns them upper-cased.
  ok("Harris keeps its ≥2-layer group", /HARRIS COUNTY/i.test(harris));
  ok("Fort Bend contours folded (relabeled)", fortbend.includes("1-ft contours (Fort Bend DD)"));
  ok("Fort Bend has NO lonely county group", !fortbend.includes("Fort Bend County"));
  ok("Chambers note-only group removed", !chambers.includes("Chambers County") && !/No public/i.test(chambers));

  // ── A1: the ⓘ opens with source + vintage ──
  const infoBtn = page.locator('#panel-harris button[aria-label="About Elevation shading"]');
  await infoBtn.click();
  const note = page.locator('[role="note"]');
  await note.waitFor({ state: "visible", timeout: 5000 });
  const noteText = (await note.innerText()).replace(/\s+/g, " ");
  ok("ⓘ popover shows the layer name", noteText.includes("Elevation shading"));
  ok("ⓘ popover shows source (USGS 3DEP)", noteText.includes("USGS 3DEP"));
  ok("ⓘ popover shows a vintage line", noteText.includes("As of:"));
  await page.mouse.move(2, 2); // move the pointer off the ⓘ so hover can't hold the popover open
  await page.keyboard.press("Escape");
  const closedByEsc = await note.waitFor({ state: "detached", timeout: 3000 }).then(() => true).catch(() => false);
  ok("Escape closes the ⓘ popover", closedByEsc);

  // ── B763: the passive jurisdiction badge renders each case ──
  ok("badge (in city) reads 'City of Houston · Harris County'", (await text("#badge-city")).includes("City of Houston · Harris County"));
  ok("badge (in ETJ) reads 'City of Baytown — ETJ · Harris County'", (await text("#badge-etj")).includes("City of Baytown — ETJ · Harris County"));
  ok("badge (unincorporated) reads 'Unincorporated · Waller County'", (await text("#badge-uninc")).includes("Unincorporated · Waller County"));
  ok("badge (straddle) lists both cities + ⚑ marker", /City of Houston \/ City of Katy · Harris County/.test(await text("#badge-straddle")) && (await text("#badge-straddle")).includes("⚑"));
  ok("badge tooltip carries source + screening note", (await page.locator('#badge-city [data-testid="jurisdiction-badge"]').getAttribute("title") || "").includes("Source: TxDOT / TxGIO / H-GAC"));
  ok("null badge renders nothing", (await page.locator('#badge-null [data-testid="jurisdiction-badge"]').count()) === 0);

  // ── B793: frontage-sliver qualification + the ETJ vintage / SB 2038 caveat ──
  ok("badge (sliver) leads with the ETJ and trails 'City of Katy — edge only', no ⚑",
    /City of Houston — ETJ \/ City of Katy — edge only · Fort Bend County · Katy ISD/.test(await text("#badge-sliver"))
    && !(await text("#badge-sliver")).includes("⚑"));
  {
    const sliverTitle = (await page.locator('#badge-sliver [data-testid="jurisdiction-badge"]').getAttribute("title")) || "";
    ok("badge (sliver) tooltip explains edge-only membership", sliverTitle.includes("touches only the parcel edge"));
    ok("badge (sliver) tooltip carries the ETJ vintage + SB 2038 caveat", sliverTitle.includes("SB 2038") && sliverTitle.includes("H-GAC ETJ"));
  }

  // ── B764: ISD panel row + ⓘ (the live endpoint itself is curl-verified via the proxy) ──
  ok("Jurisdictions group lists 'School districts (ISD)'", harris.includes("School districts (ISD)"));
  const isdInfo = page.locator('#panel-harris button[aria-label="About School districts (ISD)"]');
  await isdInfo.click();
  const isdNote = page.locator('[role="note"]');
  await isdNote.waitFor({ state: "visible", timeout: 5000 });
  ok("ISD ⓘ names the TEA source", (await isdNote.innerText()).includes("Texas Education Agency"));
  await page.keyboard.press("Escape");
} finally {
  await browser.close();
}

const failed = results.filter((r) => !r.pass);
for (const r of results) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass || !r.detail ? "" : `  →  ${r.detail}`}`);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
