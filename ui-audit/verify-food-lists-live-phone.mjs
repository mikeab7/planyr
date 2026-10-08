#!/usr/bin/env node
/* verify-food-lists-live-phone — V1513232 phone arms, on the REAL deploy, signed in as the test account.
 * ENGINE: Chromium with an iPhone 15 device descriptor (touch, isMobile) in portrait and landscape — an EMULATION, NOT WebKit/Safari
 * (the shared signed-in helper is Chromium-only). It makes a list through the real UI and runs the shared layout probe
 * (ui-audit/lib/foodListsKit.mjs): one screen wide, search field + Map|List fully on screen and hittable, chip strip + card inside
 * the visible screen and clear of the basemap switch / zoom stack. Deletes the list it made (by name) and verifies it is gone. */
import { devices } from "@playwright/test";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { listsLayoutProbe } from "./lib/foodListsKit.mjs";

const BASE = (process.argv.find((a, i) => i > 1 && a.startsWith("http")) || "https://planyr.io").replace(/\/$/, "");
let failed = 0;
const row = (n, ok, d = "") => { if (!ok) failed += 1; console.log(`${ok ? "PASS" : "FAIL"}  ${n}${d ? " — " + d : ""}`); };

for (const [label, desc] of [["portrait", "iPhone 15"], ["landscape", "iPhone 15 landscape"]]) {
  let s = null;
  for (let a = 1; a <= 6 && !s; a++) {
    try { s = await openSignedIn({ base: BASE, viewport: devices[desc].viewport, contextOptions: { ...devices[desc] } }); }
    catch (e) { if (!/answered 50\d/.test(e.message) || a === 6) throw e; await new Promise((r) => setTimeout(r, 15000)); }
  }
  const page = s.page; page.setDefaultTimeout(90000);
  try {
    await page.goto(`${BASE}/?cb=${Date.now()}#/food`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="food-map"]');
    await assertMeasurable(page, "verify-food-lists-live-phone");
    await page.waitForTimeout(3000);
    await listsLayoutProbe(page, row, `live Chromium ${desc} (${label})`);
  } catch (e) { row(`${label} aborted`, false, String(e.message).split("\n")[0]); }
  finally {
    const left = await page.evaluate(async () => { const c = window.pfSupabase; const ls = (await c.from("food_lists").select("id,name")).data || []; for (const l of ls) if (l.name === "Lunch @ Work") await c.from("food_lists").delete().eq("id", l.id); return ((await c.from("food_lists").select("id,name")).data || []).filter((l) => l.name === "Lunch @ Work").length; }).catch(() => -1);
    row(`${label}: the list this run made is deleted`, left === 0, `left ${left}`);
    console.log(`${label} served build:`, JSON.stringify(s.build));
    await s.close();
  }
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
