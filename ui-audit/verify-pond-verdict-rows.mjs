/* NEW-1 / NEW-2 — verify the pond inspector's DETENTION verdict row in a REAL browser, logged out.
 *   NEW-1 — the row's headline NAMES its ledger ("Detention covered" / "Detention short X ac-ft"),
 *           never the bare buildability answer ("Buildable"), and the buildability fact is still
 *           present, demoted to the card's qualifier line.
 *   NEW-2 — an over-provided detention ledger is NOT a clean green pass: the row carries a warn-tone
 *           "Over by ~X ac-ft — … buys no detention credit" qualifier, with the excavation volume,
 *           and a dollar figure ONLY when a $/CY unit price is set (never fabricated).
 * Fixture-driven (never pins live-project values); the seed carries a REMEMBERED drainage check so
 * no GIS fetch is needed. Run: node ui-audit/verify-pond-verdict-rows.mjs   (preview on :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const H = 660; // ~40-acre square parcel
const PARCEL = [{ x: -H, y: -H }, { x: H, y: -H }, { x: H, y: H }, { x: -H, y: H }];
const box = (s) => [{ x: -s, y: -s }, { x: s, y: -s }, { x: s, y: s }, { x: -s, y: s }];

const slim = {
  authority: { primaryReviewerId: "fortbend", channelAuthority: null, overlays: [], ambiguous: [], flags: [], mudState: null, jurisdiction: { city: [], county: ["Fort Bend"], etj: [] } },
  flood: { zones: [], state: "loaded", ageMs: 0 },
  channel: null, watershed: null, groundElevFt: 90, groundDatum: "NAVD88",
};

/* `half` sizes the pond: a big one over-provides the site requirement, a small one falls short.
 * `earthworkCy` seeds the Earthwork card's $/CY so the priced / unpriced branches are both driven. */
const siteFor = ({ id, half, earthworkCy = null }) => ({
  id, groupId: id, site: "Fixture", name: "Concept A", status: "active",
  origin: { lat: 29.55, lon: -95.80 }, county: "fortbend",
  parcels: [{ id: "pA", points: PARCEL, locked: true }],
  els: [
    { id: "b1", type: "building", cx: 420, cy: 420, w: 300, h: 200, rot: 0 },
    { id: "p1", type: "pond", points: box(half), det: { depth: 12, freeboard: 1, slope: 3, role: "detention" } },
  ],
  measures: [], callouts: [], markups: [], deletedIds: [],
  settings: {
    showSetback: false,
    ...(earthworkCy != null ? { prices: { earthworkCy } } : {}),
    drainage: { autoFacts: false, lastCheck: { ...slim, sig: "seed-sig", checkedAt: Date.now() - 3 * 86400000, detSplit: { screened: true, fmZonesSig: "seed:0", byId: { p1: { wseFt: null, inTrigger: false, estPoolDepthFt: 0 } } } } },
  },
  underlay: null, updatedAt: Date.now(),
});

const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const panelSel = '[data-testid="property-panel"]';

async function readCards({ id, half, earthworkCy, shot }) {
  const site = siteFor({ id, half, earthworkCy });
  const seed = `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify({ ${id}: ${JSON.stringify(site)} }));
    localStorage.setItem('planarfit:currentSite:v1', '${id}');
  } catch (e) {} })();`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "verify-pond-verdict-rows");
  const errors = [];
  const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
  await page.waitForTimeout(500);
  const pondLink = page.locator('[data-testid="yield-panel"] button[title="Detention Pond"], [data-testid="yield-panel"] button:has-text("↗")').first();
  await pondLink.click({ timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(800);
  const cards = await page.evaluate((sel) => {
    const panel = document.querySelector(sel);
    if (!panel) return null;
    return Array.from(panel.querySelectorAll('[data-testid="pond-verdict-card"]')).map((card) => {
      const divs = Array.from(card.children).filter((c) => c.tagName === "DIV");
      const txt = (n) => (n ? (n.textContent || "").trim() : "");
      const qual = divs.find((d) => txt(d).startsWith("▲"));
      return {
        headline: txt(divs[0]),
        headlineColor: divs[0] ? getComputedStyle(divs[0]).color : "",
        subline: txt(divs[1]),
        qualifier: txt(qual),
        qualifierColor: qual ? getComputedStyle(qual).color : "",
        all: txt(card),
      };
    });
  }, panelSel);
  if (shot) await page.screenshot({ path: OUT + shot, clip: { x: 0, y: 96, width: 400, height: 620 } }).catch(() => {});
  await ctx.close();
  return { cards, errors };
}

// ── Scenario A — an OVER-PROVIDED pond with a $/CY price set ────────────────────────
const A = await readCards({ id: "s_over", half: 470, earthworkCy: 8, shot: "pond-verdict-over.png" });
const a = A.cards && A.cards[0];
log(!!a, "the pond verdict card renders (over-provided fixture)");
if (a) {
  console.log(`   headline="${a.headline}" | sub="${a.subline}" | qualifier="${a.qualifier}"`);
  log(/^Detention /.test(a.headline), `NEW-1 — the headline NAMES its ledger :: "${a.headline}"`);
  log(!/^Buildable/i.test(a.headline), "NEW-1 — the headline is no longer the bare buildability answer");
  log(/\d+\.\d of \d+\.\d ac-ft/.test(a.subline), `NEW-1 — the provided/required figure keeps its own sub-line :: "${a.subline}"`);
  log(/Over by ~[\d.]+ ac-ft/.test(a.qualifier), `NEW-2 — the over-provision is stated in ac-ft :: "${a.qualifier}"`);
  log(/buys no detention credit/.test(a.qualifier), "NEW-2 — it says plainly that the extra excavation buys nothing");
  log(/CY of excavation/.test(a.qualifier), "NEW-2 — the excess is priced as excavation volume");
  log(/\$[\d,]+/.test(a.qualifier), "NEW-2 — with a $/CY unit price set, the excess lands as a dollar figure");
  log(a.qualifierColor !== a.headlineColor, `NEW-2 — the over-dug qualifier reads in its own warn tone (headline ${a.headlineColor} vs qualifier ${a.qualifierColor})`);
}

// ── Scenario B — the SAME pond with NO $/CY price: volume only, never a fabricated cost ──
const B = await readCards({ id: "s_overnp", half: 470, earthworkCy: null });
const b = B.cards && B.cards[0];
if (b) {
  console.log(`   headline="${b.headline}" | qualifier="${b.qualifier}"`);
  log(/Over by ~[\d.]+ ac-ft/.test(b.qualifier), "NEW-2 — the over-provision still shows with no price set");
  log(!/\$[\d,]+/.test(b.qualifier), "NEW-2 (LOUD-FAILURE) — with no $/CY set, NO dollar figure is invented");
}

// ── Scenario C — a SHORT pond: the headline names the ledger AND the shortfall ──────
const C = await readCards({ id: "s_short", half: 90, shot: "pond-verdict-short.png" });
const c = C.cards && C.cards[0];
log(!!c, "the pond verdict card renders (short fixture)");
if (c) {
  console.log(`   headline="${c.headline}" | sub="${c.subline}" | qualifier="${c.qualifier}"`);
  log(/^Detention short [\d.]+ ac-ft$/.test(c.headline), `NEW-1 — a shortfall names the ledger and the gap :: "${c.headline}"`);
  log(!/Over by/.test(c.all), "NEW-2 — a short ledger never claims an over-provision");
}

// ── Scenario D (PDF-PARITY) — the PRINT SHEET carries the same over-provision figure ──
// The sheet is composed as ONE SVG and then rasterized, so we intercept the SVG blob on its
// way to the rasterizer and read the metrics band's text — a real end-to-end print check,
// logged out, with no GIS and no aerial needed.
const D = await (async () => {
  const site = siteFor({ id: "s_print", half: 470, earthworkCy: 8 });
  const seed = `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify({ s_print: ${JSON.stringify(site)} }));
    localStorage.setItem('planarfit:currentSite:v1', 's_print');
  } catch (e) {} })();`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 980 }, ignoreHTTPSErrors: true, acceptDownloads: true });
  await ctx.addInitScript(seed);
  await ctx.addInitScript(`(() => {
    const orig = URL.createObjectURL.bind(URL);
    window.__sheetSvgs = [];
    URL.createObjectURL = (blob) => {
      try { if (blob && blob.type === "image/svg+xml") blob.text().then((t) => window.__sheetSvgs.push(t)); } catch (e) {}
      return orig(blob);
    };
  })();`);
  const page = await ctx.newPage();
  /* ⛔ A BACKGROUND TAB CANNOT BE MEASURED — not its clock, and not its pixels. A hidden tab clamps
     setTimeout (a setTimeout-paced probe then times the clamp: 3,156 ms for a 138-182 ms gesture) AND
     suspends requestAnimationFrame, so after a view change the app's state attributes update while the
     drawing never repaints — every box, position, hit test and screenshot then agrees with every other
     and describes a view the app already left. One precondition covers both, rAF liveness probe
     included; see ui-audit/lib/tabTiming.mjs. Fails loudly rather than reporting either. */
  await assertMeasurable(page, "verify-pond-verdict-rows");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  // Export menu → "Download PDF / pick frame…" → "Download PDF"
  await page.locator('button:has-text("File ▾")').first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  await page.locator('button:has-text("Download PDF / pick frame")').first().click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(800);
  await page.locator('button:has-text("Download PDF")').last().click({ timeout: 3000 }).catch(() => {});
  // The aerial capture has to TIME OUT first in this sandbox (no outbound imagery host), and the
  // sheet is only composed after that — poll rather than guess a fixed wait.
  await page.waitForFunction(() => (window.__sheetSvgs || []).length > 0, null, { timeout: 120000 }).catch(() => {});
  const svgs = await page.evaluate(() => window.__sheetSvgs || []);
  await ctx.close();
  return svgs.join("\n");
})();
const sheetHasPair = /Det\. req \/ prov/.test(D);
log(sheetHasPair, "PDF-PARITY — the print sheet was composed and carries the detention req/prov line");
if (sheetHasPair) {
  log(/Over by ~[\d.]+ ac-ft/.test(D), "PDF-PARITY — the sheet states the SAME over-provision the panel shows");
  log(/buys no detention credit/.test(D), "PDF-PARITY — with the wording driven from the one shared helper");
}

const errs = [...A.errors, ...(B.errors || []), ...C.errors];
log(errs.length === 0, `no console/page errors (${errs.length})` + (errs.length ? ` :: ${errs.slice(0, 2).join(" | ")}` : ""));
await browser.close();
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
