#!/usr/bin/env node
/* verify-pin-overlap.mjs — NEW-1 (B2013744): a map note's pin must not hide a comp's pin (or the
 * site's) when they sit on one parcel. Owner-measured 2026-10-02: comp marker 14x14 wholly inside the
 * note marker 34x46, and elementFromPoint never returned the comp across every 2 px sample.
 *
 * HOW: ui-audit/fixtures/pin-overlap.html builds a real Leaflet map from the app's OWN marker modules
 * + the same pinCluster helper MapFinder uses (the real map needs a signed-in session to have any
 * comps/notes — `Blocker: auth`, logged as V in VERIFICATION.md). KNOWN-GOOD / RED ARM: with
 * `?cluster=0` (the pre-fix layout) the comp MUST be unreachable; if it is reachable the probe is
 * blind and the run is VOID. The fixed arm then requires the comp, the note and the site each be
 * reachable at their own centre, and the comp's WHOLE box answers to the comp.
 * Needs a dev server: `npx vite --port 4183` (BASE_URL overrides). */
import { chromium } from "playwright";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const BASE = (process.env.BASE_URL || "http://localhost:4183/").replace(/\/$/, "");
const EXEC = process.env.PW_CHROME || undefined;
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
await assertMeasurable(page, "verify-pin-overlap");
let fail = 0;
const ok = (t, pass, d = "") => { if (!pass) fail++; console.log(`  ${pass ? "✅" : "❌"} ${t}${d ? " — " + d : ""}`); };

async function probe(cluster) {
  await page.goto(`${BASE}/ui-audit/fixtures/pin-overlap.html?cluster=${cluster ? 1 : 0}`, { waitUntil: "load" });
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 20000 });
  await pacedWait(page, 400);
  return page.evaluate(() => {
    const kinds = { site: ".map-site-feature", comp: ".map-comp-feature", note: ".map-note-feature" };
    const own = (el, sel) => !!el && !!el.closest(sel);
    const out = {};
    for (const [k, sel] of Object.entries(kinds)) {
      const el = document.querySelector(sel);
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      out[k] = { centreHit: own(document.elementFromPoint(cx, cy), sel), box: [r.width, r.height] };
      if (k === "comp") { // every 2 px sample inside the comp's own rect
        let hit = 0, n = 0;
        for (let x = r.left + 1; x < r.right; x += 2) for (let y = r.top + 1; y < r.bottom; y += 2) { n++; if (own(document.elementFromPoint(x, y), sel)) hit++; }
        out.compSamples = { hit, n };
      }
    }
    return out;
  });
}

const before = await probe(false);
console.log("RED ARM (no separation — the pre-fix layout)");
ok("known-bad arm reproduces the owner's defect: the comp is NOT reachable at its centre", before.comp.centreHit === false, `comp samples ${before.compSamples.hit}/${before.compSamples.n}`);
if (before.comp.centreHit) { console.log("❌ VOID: the probe cannot see the defect it exists to catch"); await browser.close(); process.exit(1); }

const after = await probe(true);
console.log("FIXED ARM (cluster offsets on)");
ok("comp marker box is 14x14 (the measured one)", after.comp.box[0] === 14 && after.comp.box[1] === 14, after.comp.box.join("x"));
ok("elementFromPoint at the comp centre returns the comp", after.comp.centreHit);
ok("every sample inside the comp's box answers to the comp", after.compSamples.hit === after.compSamples.n, `${after.compSamples.hit}/${after.compSamples.n}`);
ok("the note is reachable at its own centre", after.note.centreHit);
ok("the site pin is reachable at its own centre", after.site.centreHit);
await browser.close();
console.log(fail ? `\n❌ ${fail} check(s) failed` : "\n✅ all checks passed");
process.exit(fail ? 1 : 0);
