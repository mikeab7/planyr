/* READ-ONLY DIAGNOSTIC for the owner's report: "planner always shows this aerial backdrop overlay
 * no matter the project, but i dont know if this is even a thing."
 *
 * THE QUESTION, four candidate causes:
 *   (a) ONE row returned for every project because the references query is not scoped — a query bug
 *   (b) MANY rows, one per project, intended behaviour, just confusingly named
 *   (c) a CLIENT-SIDE DEFAULT rendered whether or not any row exists — cosmetic
 *   (d) a REAL cross-project leak — a row belonging to one project surfacing in others
 *
 * This harness answers it BEHAVIOURALLY rather than by reading source, by seeding three plans that
 * differ in EXACTLY ONE FACT — whether the plan record carries an `underlay` — and asking what the
 * References panel says about each:
 *
 *   NONE    — `underlay` absent entirely (the key is not present)
 *   NULL    — `underlay: null` (the shape 13 of the owner's 71 production plans are in)
 *   PRESENT — a real per-plan aerial
 *
 * If "Aerial backdrop" appears on all three, the LABEL is client-side chrome and cannot be evidence
 * of a row — which discriminates (c) from (a)/(b)/(d) directly. The harness additionally requires
 * the three to be DISTINGUISHABLE (the empty state must offer "Load screenshot…" and must NOT carry
 * the real row's opacity/lock controls), because a label that renders identically whether or not
 * data exists is the actual defect shape worth reporting — that is the `layerZoomGate.js` lesson,
 * where static helper text under a control that said ON read the same whether the layer was drawing
 * or not.
 *
 * ⛔ READ-ONLY. It seeds its own throwaway plans into localStorage on a preview build and touches no
 * production data, no cloud row and no stored bytes. The owner has six plans (Goose Creek ×4, Bain
 * ×2) that were armed against the B487600 shared-asset bug; nothing here deletes anything.
 *
 * Run:  npm run build && npm run preview &   # then:
 *       node ui-audit/diagnose-aerial-backdrop-row.mjs
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
const { chromium } = pw;
import { mkdirSync } from "node:fs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const OUT = new URL("./screens/", import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFElEQVR4nGNgYGD4//8/w38gAGYAJv0H/dbCTPYAAAAASUVORK5CYII=";
const parcel = { id: "pc1", locked: false, points: [{ x: -360, y: -300 }, { x: 360, y: -300 }, { x: 360, y: 300 }, { x: -360, y: 300 }] };

const base = (id, name) => ({
  id, groupId: id, site: name, name: "Concept A",
  origin: null, county: null, parcels: [parcel], els: [], measures: [], callouts: [], markups: [],
  settings: {}, sheetOverlays: [], parcelDrawings: [], updatedAt: 1,
});

// The three arms differ in EXACTLY ONE FACT: whether an `underlay` row exists.
const noKey = base("diag-none", "Diag NONE");            // `underlay` key absent entirely
const nullKey = { ...base("diag-null", "Diag NULL"), underlay: null };
const present = {
  ...base("diag-has", "Diag PRESENT"),
  underlay: { src: PNG, imgW: 1000, imgH: 800, x: -300, y: -240, ftPerPx: 0.6, opacity: 0.8, locked: true },
};

const ARMS = [
  { id: "diag-none", label: "NONE    (no `underlay` key at all)", expectRow: false },
  { id: "diag-null", label: "NULL    (`underlay: null` — 13 of 71 production plans)", expectRow: false },
  { id: "diag-has", label: "PRESENT (a real per-plan aerial)", expectRow: true },
];

const store = { "diag-none": noKey, "diag-null": nullKey, "diag-has": present };

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const results = [];

for (const arm of ARMS) {
  const seed = `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(store)}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(arm.id)});
  } catch (e) {} })();`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  /* ⛔ FOREGROUND-OR-VOID: a background tab cannot be measured — not its clock, and not its pixels.
     Asserted before ANY reading is taken. */
  await assertMeasurable(page, "diagnose-aerial-backdrop-row");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);

  await page.locator('button:has-text("Overlays")').first().click();
  await page.waitForTimeout(500);

  /* The aerial row's opacity slider renders only once the row is SELECTED (`aerialSel`), so a
     probe that reads it without expanding measures the collapsed state and calls a working row
     broken. On the empty state there is no button to click — the label is a plain <span> — which
     is itself part of the answer. */
  const expander = page.locator('button:has-text("Aerial backdrop")');
  if (await expander.count()) { await expander.first().click(); await page.waitForTimeout(300); }

  const obs = await page.evaluate(() => {
    const txt = document.body.innerText;
    /* ⛔ SCOPE THE CONTROL COUNTS TO THE AERIAL ROW ITSELF. A page-wide
       `input[type=range]` sweep also catches sliders in other panels, which reports a
       control the aerial row does not have — the harness then "finds" a defect that is
       its own selector. Walk up from the "Aerial backdrop" text to its row container. */
    const labelEl = [...document.querySelectorAll("span, button")]
      .find((n) => n.textContent.trim() === "Aerial backdrop");
    let row = labelEl;
    for (let i = 0; i < 4 && row?.parentElement; i++) row = row.parentElement;
    const within = (sel) => (row ? row.querySelectorAll(sel).length : -1);
    return {
      labelPresent: txt.includes("Aerial backdrop"),
      emptyStateCta: txt.includes("Load screenshot…"),
      // The real row's own controls — absent on the empty state.
      opacitySliders: within('input[type=range]'),
      lockToggle: within('button[title*="Unlock (drag to reposition)"], button[title*="Lock (click-through)"]'),
    };
  });
  await page.screenshot({ path: `${OUT}aerial-row-${arm.id}.png` });
  results.push({ arm, obs });
  await ctx.close();
}

console.log("\n=== Does the \"Aerial backdrop\" label depend on a row existing? ===\n");
for (const { arm, obs } of results) {
  console.log(`  ${arm.label}`);
  console.log(`      label "Aerial backdrop" shown : ${obs.labelPresent ? "YES" : "no"}`);
  console.log(`      "Load screenshot…" empty CTA  : ${obs.emptyStateCta ? "YES" : "no"}`);
  console.log(`      real-row controls (opac/lock) : ${obs.opacitySliders}/${obs.lockToggle}\n`);
}

const allShowLabel = results.every((r) => r.obs.labelPresent);
log(allShowLabel,
  "the \"Aerial backdrop\" LABEL renders on every plan, with and without an underlay row " +
  "⇒ the label is CLIENT-SIDE CHROME and is not evidence that any row exists (case c)");

// The label being unconditional is only benign if the two states are still TELLABLE APART.
for (const { arm, obs } of results) {
  if (arm.expectRow) {
    log(obs.opacitySliders >= 1 && obs.lockToggle >= 1 && !obs.emptyStateCta,
      `a plan WITH an aerial shows the real row's controls and no empty-state CTA (${arm.id})`);
  } else {
    log(obs.emptyStateCta && obs.opacitySliders === 0 && obs.lockToggle === 0,
      `a plan WITHOUT an aerial shows the "Load screenshot…" empty state and NO row controls (${arm.id})`);
  }
}

console.log(fail ? `\n${fail} check(s) failed` : "\nAll checks passed");
await browser.close();
process.exit(fail ? 1 : 0);
