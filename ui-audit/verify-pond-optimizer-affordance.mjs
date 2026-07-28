/* NEW-1 / NEW-2 — drive the REAL app, logged out, and check the two P0 regressions.
 *
 * NEW-1 — THE REGRESSION. The optimizer used to mount on the first NON-GREEN verdict row. Once
 * B1031 kept an over-dug ledger GREEN, an all-green panel had no row for it to ride and the tool
 * silently vanished. This drives the exact state that broke it — a COVERED / OVER-PROVIDED pond,
 * every row green — and asserts the optimizer affordance is there anyway. Per the owner's same-day
 * amendment it is no longer a button but ONE apply-gated suggestion line, present when a
 * materially smaller basin exists.
 *
 * NEW-2 — THE WORDINESS. Measures the rendered character and line count of the yield panel's
 * detention group at the panel's NORMAL and DOCKED widths, so "less wordy" is demonstrated in a
 * browser rather than asserted from a source scan.
 *
 * Fixture-driven (never pins live-project values); the seed carries a REMEMBERED drainage check so
 * no GIS fetch is needed. Run: node ui-audit/verify-pond-optimizer-affordance.mjs (preview :4173)
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";

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

async function open({ id, half, earthworkCy, width = 1440, shot = null }) {
  const site = siteFor({ id, half, earthworkCy });
  const seed = `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify({ ${id}: ${JSON.stringify(site)} }));
    localStorage.setItem('planarfit:currentSite:v1', '${id}');
  } catch (e) {} })();`;
  const ctx = await browser.newContext({ viewport: { width, height: 980 }, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  const errors = [];
  const NOISE = /ERR_TUNNEL|ERR_CONNECTION|ERR_CERT|Failed to load resource|net::/i;
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error" && !NOISE.test(m.text())) errors.push(m.text()); });
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(2600);
  await page.getByRole("button", { name: /Yield/ }).first().click().catch(() => {});
  await page.waitForTimeout(600);
  return { ctx, page, errors, shot };
}

async function openPond(o) {
  const pondLink = o.page.locator('[data-testid="yield-panel"] button[title="Detention Pond"], [data-testid="yield-panel"] button:has-text("↗")').first();
  await pondLink.click({ timeout: 1500 }).catch(() => {});
  await o.page.waitForTimeout(900);
}

// ── NEW-1 — the ALL-GREEN / OVER-PROVIDED pond: the exact state that lost the optimizer ────────
{
  const o = await open({ id: "s_over", half: 470, earthworkCy: 8 });
  await openPond(o);
  const state = await o.page.evaluate((sel) => {
    const panel = document.querySelector(sel);
    if (!panel) return null;
    const cards = Array.from(panel.querySelectorAll('[data-testid="pond-verdict-card"]'));
    const tone = cards.map((c) => {
      const d = Array.from(c.children).find((x) => x.tagName === "DIV");
      return d ? getComputedStyle(d).color : "";
    });
    const sug = panel.querySelector('[data-testid="pond-rightsize"]');
    return {
      cardCount: cards.length,
      headlines: cards.map((c) => (Array.from(c.children).find((x) => x.tagName === "DIV")?.textContent || "").trim()),
      tone,
      anyShortHeadline: cards.some((c) => /short/i.test(c.textContent || "")),
      suggestion: sug ? (sug.textContent || "").trim() : null,
      hasApply: !!(sug && Array.from(sug.querySelectorAll("button")).some((b) => /Apply/i.test(b.textContent || ""))),
      // the old coupling would have put an "Optimize pond" BUTTON inside a card
      buttonInsideCard: cards.some((c) => Array.from(c.querySelectorAll("button")).some((b) => /Optimize pond/i.test(b.textContent || ""))),
    };
  }, panelSel);

  log(!!state && state.cardCount > 0, "the pond inspector renders its verdict card(s) on the over-provided fixture");
  if (state) {
    console.log(`   headlines=${JSON.stringify(state.headlines)}`);
    console.log(`   suggestion="${state.suggestion}"`);
    log(!state.anyShortHeadline, "NEW-1 — the panel is in the ALL-GREEN state (no row reads short) — the state that broke it");
    log(state.suggestion != null, "NEW-1 — THE REGRESSION: the optimizer affordance is PRESENT on an all-green / over-provided pond");
    if (state.suggestion) {
      log(/frees [\d.]+ ac/.test(state.suggestion), `NEW-1 — it states the delta plainly :: "${state.suggestion}"`);
      log(state.hasApply, "NEW-1 — it is APPLY-gated (the tool proposes; drawing stays the owner's)");
    }
    log(!state.buttonInsideCard, "NEW-1 — no Optimize button rides a verdict card any more (the tone coupling is gone)");
  }
  await o.page.screenshot({ path: OUT + "pond-optimizer-affordance.png", clip: { x: 0, y: 96, width: 400, height: 620 } }).catch(() => {});
  const real = o.errors.filter((e) => !/ResizeObserver/.test(e));
  log(real.length === 0, `no console/page errors (${real.length})${real.length ? " :: " + real[0] : ""}`);
  await o.ctx.close();
}

// ── NEW-2 — measure the rendered detention-group copy at two panel widths ──────────────────────
for (const [label, width] of [["normal", 1440], ["docked", 1100]]) {
  const o = await open({ id: `s_w_${width}`, half: 470, earthworkCy: 8, width });
  const m = await o.page.evaluate(() => {
    const panel = document.querySelector('[data-testid="yield-panel"]');
    if (!panel) return null;
    // The detention group's rendered body: every visible text node under it.
    const vis = (el) => {
      const cs = getComputedStyle(el);
      return cs.display !== "none" && cs.visibility !== "hidden" && el.offsetParent !== null;
    };
    const groups = Array.from(panel.querySelectorAll("div")).filter((d) => /Detention detail/.test(d.textContent || "") && d.children.length < 12);
    const host = groups[0] || panel;
    const texts = [];
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === 3) {
          const t = (child.textContent || "").replace(/\s+/g, " ").trim();
          if (t.length > 3 && /[A-Za-z]/.test(t) && t.includes(" ")) texts.push(t);
        } else if (child.nodeType === 1 && vis(child)) walk(child);
      }
    };
    walk(host);
    return { lines: texts.length, chars: texts.reduce((s, t) => s + t.length, 0), sample: texts.slice(0, 6) };
  });
  if (m) {
    console.log(`   NEW-2 [${label} · ${width}w] detention group: ${m.lines} visible text runs, ${m.chars} chars`);
    for (const s of m.sample) console.log(`        · ${s.slice(0, 110)}`);
    log(m.chars > 0, `NEW-2 — the detention group still renders its content at the ${label} width (nothing was blanked)`);
    // The pre-consolidation panel spent a single ~200-char prose sentence on the storage explainer
    // alone; the consolidated line is the counted-of-held number pair.
    log(!/the outline could hold/.test(m.sample.join(" ")), `NEW-2 — the long storage-explainer prose is gone from the ${label} default view`);
  } else {
    log(false, `NEW-2 — could not read the yield panel at the ${label} width`);
  }
  await o.ctx.close();
}

await browser.close();
console.log(fail === 0 ? "\nALL PASS" : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);
