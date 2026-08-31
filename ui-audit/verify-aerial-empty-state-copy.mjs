/* B525632 — a plan with NO aerial must not announce one.
 *
 * B519152 audited the owner's report ("planner always shows this aerial backdrop overlay no matter
 * the project, but i dont know if this is even a thing") and found the heading, not a leaked row:
 * "Aerial backdrop" printed on every plan because the empty state's heading announced the thing it
 * was inviting you to add. The panel was honest underneath — it offered "Load screenshot…" and
 * explained what an aerial is — but the HEADING is what did the confusing, so the fix removes the
 * confusion rather than documenting it (owner instruction 2026-08-14).
 *
 * THE ASSERTION, and it is deliberately EXACT-NODE rather than page-text:
 *   - a plan with NO aerial    → the heading reads "Add an aerial"    (an invitation)
 *   - a plan WITH an aerial    → the heading reads "Aerial backdrop"  (UNCHANGED)
 *
 * ⛔ WHY EXACT-NODE MATTERS HERE, and why a substring check would be vacuous: both wordings share
 * the word "aerial", and the phrase first tried ("Add an aerial backdrop") literally CONTAINED the
 * old heading. A `body.innerText.includes` probe — which is what the B519152 diagnostic used,
 * correctly, for a different question — passes on BOTH builds and can never go red. So this reads
 * the heading NODE's own trimmed text.
 *
 * ⛔ THE HEIGHT ASSERTION IS NOT DECORATION — IT CAUGHT THE FIRST FIX. "Add an aerial backdrop"
 * (the wording first proposed) needs 134px in a slot that offers 124px, so it wrapped to two lines
 * and pushed the explainer and everything below it down: the heading was right and the panel
 * reflowed anyway. Copy alone would have shipped that green.
 *
 * ⛔ AND THE SECOND ARM IS NOT CEREMONY: the reword must not touch the heading when there IS an
 * aerial. That case is the one a careless fix breaks (one shared string, both branches), and it is
 * invisible to any check that only seeds an empty plan.
 *
 * Proven RED on the pre-fix build before the change was written:
 *   NONE/NULL arms → heading read "Aerial backdrop", expected the invitation  ✗✗
 *   PRESENT arm    → already green (the control — it proves the harness is not simply failing).
 * A guard whose failing state nobody has seen is a guard that rots green.
 *
 * Run:  npm run build && npm run preview &   # then:
 *       node ui-audit/verify-aerial-empty-state-copy.mjs
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

const store = {
  "copy-none": base("copy-none", "Copy NONE"),
  "copy-null": { ...base("copy-null", "Copy NULL"), underlay: null },
  "copy-has": {
    ...base("copy-has", "Copy PRESENT"),
    underlay: { src: PNG, imgW: 1000, imgH: 800, x: -300, y: -240, ftPerPx: 0.6, opacity: 0.8, locked: true },
  },
};

const INVITE = "Add an aerial";
const OWNED = "Aerial backdrop";

const ARMS = [
  { id: "copy-none", label: "NONE    (no `underlay` key at all)", expect: INVITE },
  { id: "copy-null", label: "NULL    (`underlay: null` — 13 of 71 production plans)", expect: INVITE },
  { id: "copy-has", label: "PRESENT (a real per-plan aerial)", expect: OWNED },
];

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const rows = [];

for (const arm of ARMS) {
  const seed = `(() => { try {
    localStorage.setItem('planarfit:sites:v1', JSON.stringify(${JSON.stringify(store)}));
    localStorage.setItem('planarfit:currentSite:v1', ${JSON.stringify(arm.id)});
  } catch (e) {} })();`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, ignoreHTTPSErrors: true });
  await ctx.addInitScript(seed);
  const page = await ctx.newPage();
  /* ⛔ FOREGROUND-OR-VOID: a background tab cannot be measured — not its clock, and not its
     pixels. Asserted before ANY reading is taken. */
  await assertMeasurable(page, "verify-aerial-empty-state-copy");
  await page.goto(BASE, { waitUntil: "load" });
  await page.waitForTimeout(1500);
  await page.locator('button:has-text("Overlays")').first().click();
  await page.waitForTimeout(500);

  const obs = await page.evaluate(({ invite, owned }) => {
    /* The heading is a <span> on the empty state and a <button> on the real row. Match on the
       NODE's own EXACT text so the two are distinguishable — a substring probe passes on both
       builds and could never go red.
       ⛔ Match against BOTH known headings rather than a shared fragment: keying the search on
       "aerial backdrop" made this return null the moment the invitation stopped containing that
       phrase, which reads as "the heading vanished" instead of "the wording changed". A regex over
       the bare word "aerial" is the opposite failure — it also matches the explainer sentence
       below ("The aerial sits beneath everything…") and the Hide/Show aerial controls. */
    const nodes = [...document.querySelectorAll("span, button")]
      .filter((n) => { const t = (n.textContent || "").trim(); return t === invite || t === owned; })
      .filter((n) => !n.querySelector("span, button")); // innermost text-bearing node only
    const heading = nodes[0];
    return {
      headingText: heading ? heading.textContent.trim() : null,
      headingTag: heading ? heading.tagName.toLowerCase() : null,
      // Position guard: the row must not move — same slot, same panel order.
      top: heading ? Math.round(heading.getBoundingClientRect().top) : null,
      left: heading ? Math.round(heading.getBoundingClientRect().left) : null,
      // A longer heading that WRAPS would silently grow the row; one line must stay one line.
      height: heading ? Math.round(heading.getBoundingClientRect().height) : null,
      cta: document.body.innerText.includes("Load screenshot…"),
    };
  }, { invite: INVITE, owned: OWNED });
  await page.screenshot({ path: `${OUT}aerial-copy-${arm.id}.png` });
  rows.push({ arm, obs });
  await ctx.close();
}

console.log("\n=== The heading a plan shows, by whether it HAS an aerial ===\n");
for (const { arm, obs } of rows) {
  console.log(`  ${arm.label}`);
  console.log(`      heading   : ${JSON.stringify(obs.headingText)}  <${obs.headingTag}>`);
  console.log(`      expected  : ${JSON.stringify(arm.expect)}`);
  console.log(`      at        : top ${obs.top} · left ${obs.left}\n`);
}

for (const { arm, obs } of rows) {
  log(obs.headingText === arm.expect,
    `${arm.id}: heading reads ${JSON.stringify(arm.expect)} (got ${JSON.stringify(obs.headingText)})`);
}

// The empty state must still offer the way IN — a reword may not cost the affordance.
log(rows.filter((r) => r.arm.expect === INVITE).every((r) => r.obs.cta),
  "the empty state still offers \"Load screenshot…\" — the reword removed an announcement, not an affordance");

/* POSITION — the owner asked that the row not move, so the panel does not reflow.
 *
 * ⛔ THE CONTROL IS THE PRE-FIX EMPTY STATE, NOT THE PRESENT ARM. Comparing empty-vs-present is the
 * WRONG question and this check made that mistake on its first run: the two branches render
 * DIFFERENT markup by design (a dashed invitation box with a <span>, versus a solid row with a
 * <button>), and they already sat 7px apart on the untouched build — so that comparison reports a
 * pre-existing, intended difference as a regression this change caused.
 *
 * The honest question is whether the REWORD moves the empty row, so the baseline is that row's own
 * geometry MEASURED ON THE PRE-FIX BUILD, before a line of the fix was written:
 *     empty-state heading — top 322 · left 90 · height 15 (one line), at 1440×900
 * The real risk the longer string carries is a WRAP (a two-line heading grows the row and pushes
 * everything under it down), which is why height is pinned as well as origin. */
const EMPTY_BASELINE = { top: 322, left: 90, height: 15 };
for (const { arm, obs } of rows.filter((r) => r.arm.expect === INVITE)) {
  log(obs.top === EMPTY_BASELINE.top && obs.left === EMPTY_BASELINE.left && obs.height === EMPTY_BASELINE.height,
    `${arm.id}: the reworded row holds its pre-fix position and stays one line ` +
    `(top ${obs.top}/${EMPTY_BASELINE.top} · left ${obs.left}/${EMPTY_BASELINE.left} · h ${obs.height}/${EMPTY_BASELINE.height})`);
}

console.log(fail ? `\n${fail} check(s) failed` : "\nAll checks passed");
await browser.close();
process.exit(fail ? 1 : 0);
