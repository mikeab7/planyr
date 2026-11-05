/* V1681328 (B2254144) — parcel / setback / dimension-label styling, signed in as the throwaway test account on a real deploy.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-parcel-look-signed-in.mjs [https://planyr.io] [--expect-sha <merge sha>]
 * Seeds a throwaway two-parcel plan on the test account, drives the Style panel, reads profiles.prefs.parcelLook back from
 * the account, then deletes the plan and clears parcelLook to {} (and verifies both). */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";

const args = process.argv.slice(2);
const base = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const expectSha = args.includes("--expect-sha") ? args[args.indexOf("--expect-sha") + 1] : null;
let failed = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };

const ID = "zz-look-" + Math.random().toString(36).slice(2, 8);
const sq = (x0, y0, x1, y1) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const SITE = {
  id: ID, groupId: ID, site: "zz Parcel look check", name: "Plan 1", origin: { lat: 29.86, lon: -95.17 }, county: "harris",
  parcels: [
    { id: "pcA", active: true, locked: false, points: sq(-700, -300, -100, 300) },
    { id: "pcB", active: true, locked: false, points: sq(100, -300, 700, 300) },
  ],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
};
const setRange = (loc, v) => loc.evaluate((el, val) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
  setter.call(el, String(val)); el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
}, v);

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const { page } = s;
const prefsLook = () => page.evaluate(async () => {
  const { data: u } = await window.pfSupabase.auth.getUser();
  const r = await window.pfSupabase.from("profiles").select("prefs").eq("id", u.user.id).maybeSingle();
  return r.error ? { error: String(r.error.message) } : (r.data && r.data.prefs && r.data.prefs.parcelLook) ?? null;
});
const T = (id) => page.getByTestId(id);
const outline = (id) => page.locator(`[data-feature="parcel:${id}"] [data-testid="parcel-outline"]`);
try {
  await assertMeasurable(page, "verify-parcel-look-signed-in");
  // Build identity read in the SAME call as the first assertion.
  const served = await page.evaluate(async () => {
    const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).catch(() => null);
    const chunk = performance.getEntriesByType("resource").map((r) => r.name.split("/").pop()).filter((n) => /^SitePlannerApp-.*\.js$/.test(n))[0] || null;
    return { build: v && v.build, chunk };
  });
  console.log("signed in as", s.proof.email, "| served", JSON.stringify(served));
  if (expectSha) check("the deploy is serving the merge commit", String(served.build || "").startsWith(expectSha.slice(0, 7)), `served ${served.build}`);
  const before = await prefsLook();
  console.log("parcelLook before:", JSON.stringify(before));

  const ins = await page.evaluate(async (site) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
    let r = await window.pfSupabase.from("sites").insert(row);
    if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
    return r.error ? String(r.error.message) : null;
  }, SITE);
  check("throwaway plan written to the test account", !ins, ins || "");
  await page.goto(`${base}/#/project/${ID}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await T("planner-canvas").waitFor({ timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-feature^="parcel:"]').length >= 2, null, { timeout: 30000 });
  await page.waitForTimeout(2500);

  // 1. Open parcel A's page → Style
  const landOpen = (await T("parcels-panel").count()) + (await T("parcel-page").count());
  if (!landOpen) await page.locator('[data-rail-tab="parcel"]').click();
  const back = page.getByRole("button", { name: /All parcels/ });
  if (await back.count()) await back.first().click();
  await T("parcel-row-pcA").click();
  await T("parcel-style-panel").waitFor({ timeout: 15000 });
  check("1. scope selector offers both scopes, panel lists the three objects",
    await T("parcel-style-scope-default").isEnabled() && await T("parcel-style-scope-parcel").isEnabled()
    && (await T("parcel-style-panel").innerText()).match(/Boundary/i) && /Setback line/i.test(await T("parcel-style-panel").innerText()) && /Dimension labels/i.test(await T("parcel-style-panel").innerText()));

  // 2. This parcel only: red / 4 / dashed — only parcel A changes
  await T("look-boundary-color").fill("#ff0000");
  await setRange(T("look-boundary-weight"), 4);
  await T("look-boundary-dashed").click();
  await page.waitForTimeout(500);
  const a = await outline("pcA").evaluate((e) => ({ s: e.getAttribute("stroke"), w: +e.getAttribute("stroke-width"), d: e.getAttribute("stroke-dasharray") }));
  const b0 = await outline("pcB").evaluate((e) => ({ s: e.getAttribute("stroke"), w: +e.getAttribute("stroke-width"), d: e.getAttribute("stroke-dasharray") }));
  check("2. parcel A is red, heavy and dashed", a.s === "#ff0000" && a.w >= 4 && !!a.d, JSON.stringify(a));
  check("2. parcel B is untouched", b0.s !== "#ff0000" && b0.w < 4, JSON.stringify(b0));

  // 3. zoom in/out — stroke width constant
  const box = await T("planner-canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < 4; i++) { await page.mouse.wheel(0, -300); await page.waitForTimeout(150); }
  await page.waitForTimeout(500);
  const wIn = await outline("pcA").getAttribute("stroke-width");
  for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(150); }
  await page.waitForTimeout(500);
  const wOut = await outline("pcA").getAttribute("stroke-width");
  check("3. stroke width identical zoomed in and out", wIn === wOut && +wIn === a.w, `in ${wIn} · out ${wOut} · at start ${a.w}`);

  // 4. All parcels: green — B follows, A (override) stays red, no failure notice
  await T("parcel-style-scope-default").click();
  await T("look-boundary-color").fill("#00ff00");
  await page.waitForTimeout(600);
  check("4. parcel B follows the default (green)", (await outline("pcB").getAttribute("stroke")) === "#00ff00");
  check("4. parcel A keeps its own red", (await outline("pcA").getAttribute("stroke")) === "#ff0000");
  // 5. account read-back, after the trailing write
  let pl = null;
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(500); pl = await prefsLook(); if (pl && pl.boundary && pl.boundary.color === "#00ff00") break; }
  check("5. profiles.prefs.parcelLook holds the FINAL value", !!(pl && pl.boundary && pl.boundary.color === "#00ff00"), JSON.stringify(pl));
  const body = await page.evaluate(() => document.body.innerText);
  check("4/5. no 'couldn't save' / 'this computer only' notice while signed in", !/Couldn.t save your style|saved on this computer only/i.test(body));

  // 6. reload — default still in force (from the account)
  await page.waitForTimeout(800);
  await page.reload({ waitUntil: "load" });
  await T("planner-canvas").waitFor({ timeout: 45000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-feature^="parcel:"]').length >= 2, null, { timeout: 30000 });
  await page.waitForTimeout(2500);
  check("6. after reload parcel B is still green", (await outline("pcB").getAttribute("stroke")) === "#00ff00");

  // 7. Reset to workspace default on parcel A
  const landOpen2 = (await T("parcels-panel").count()) + (await T("parcel-page").count());
  if (!landOpen2) await page.locator('[data-rail-tab="parcel"]').click();
  const back2 = page.getByRole("button", { name: /All parcels/ });
  if (await back2.count()) await back2.first().click();
  await T("parcel-row-pcA").click();
  await T("parcel-style-panel").waitFor({ timeout: 15000 });
  await T("parcel-style-scope-parcel").click();
  check("7. Reset is enabled while the override exists", await T("parcel-look-reset").isEnabled());
  await T("parcel-look-reset").click();
  await page.waitForTimeout(600);
  check("7. parcel A now inherits green", (await outline("pcA").getAttribute("stroke")) === "#00ff00");
  check("7. Reset greys out", await T("parcel-look-reset").isDisabled());
  if (s.errors.length) console.log("page errors:", s.errors.slice(0, 3));
  check("no page errors", s.errors.length === 0);
} finally {
  // 8. cleanup — always, and verified
  const clean = await page.evaluate(async ([id]) => {
    const out = {};
    // the table refuses a permanent delete of a live row — trash it first, then remove it
    await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    const d = await window.pfSupabase.from("sites").delete().eq("id", id);
    out.delErr = d.error ? String(d.error.message) : null;
    const left = await window.pfSupabase.from("sites").select("id").eq("id", id);
    out.siteLeft = left.data ? left.data.length : "?";
    const { data: u } = await window.pfSupabase.auth.getUser();
    const cur = await window.pfSupabase.from("profiles").select("prefs").eq("id", u.user.id).maybeSingle();
    const prefs = { ...((cur.data && cur.data.prefs) || {}) };
    delete prefs.parcelLook;
    const up = await window.pfSupabase.from("profiles").update({ prefs }).eq("id", u.user.id);
    out.prefsErr = up.error ? String(up.error.message) : null;
    const chk = await window.pfSupabase.from("profiles").select("prefs").eq("id", u.user.id).maybeSingle();
    out.parcelLookAfter = chk.data && chk.data.prefs && chk.data.prefs.parcelLook !== undefined ? chk.data.prefs.parcelLook : "(absent)";
    return out;
  }, [ID]);
  console.log("cleanup:", JSON.stringify(clean));
  check("8. throwaway plan deleted and gone", !clean.delErr && clean.siteLeft === 0);
  check("8. parcelLook cleared from the account", !clean.prefsErr && (clean.parcelLookAfter === "(absent)" || (clean.parcelLookAfter && Object.keys(clean.parcelLookAfter).length === 0)));
  await s.close();
}
console.log(failed ? `\n${failed} check(s) FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);
