/* verify-dock-layer-panel — the redesigned dock-layer Properties panel (truck court · trailer parking · buffer),
 * driven LIVE as the test account on a THROWAWAY site that is always deleted and confirmed gone (owner constraint 15).
 *
 * Seeds one cross-dock building (rotated so the walls read W/E), gives BOTH dock walls a truck court → trailer parking →
 * buffer through the Building panel's own "Docks & walls" strip, then selects the truck court on one wall and checks:
 *   (a) the layout: sub-line "Building 1 › · Dock layer 1 of 3", Size / Grade / Style, ONE Remove, and NONE of the old copy
 *       in the rendered text; no "px" and no hex; Area is plain body weight;
 *   (b) Length: stepper shortens → "Full wall" becomes a link → the trailer parking on that wall follows → the link restores;
 *       Depth edit leaves the OTHER wall's court untouched;
 *   (c) Grade: Auto pill pressed + muted number; typing flips it off and keeps the number; 3.5 % shows the amber band notice
 *       and is KEPT; Auto returns to the band default and clears the notice; Elevation stepper flips Auto off, Auto restores;
 *   (d) Remove: confirm card names the three layers; Cancel keeps all; "Remove all three" removes the wall's three layers,
 *       selects the building, shows "Removed. … wall has no dock layers." and Undo restores all three with the same depths;
 *   (e) the buffer alone: "Remove buffer", plain "Remove", a one-layer card, no Grade section.
 * KNOWN-GOOD ARM: the run is VOID unless the untouched panel's Depth equals the stored depth of that very court.
 * Usage: BASE_URL=https://planyr.io E2E_LOGIN_KEY=… [SHOTS_DIR=/path] node ui-audit/verify-dock-layer-panel.mjs */
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const BASE = (process.env.BASE_URL || "https://planyr.io").replace(/\/$/, "");
const SHOTS = process.env.SHOTS_DIR || "";
const results = [];
const ok = (name, cond, extra = "") => { results.push({ name, pass: !!cond }); console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RUN = "zz-dlp-" + Math.random().toString(36).slice(2, 7);
const ID = RUN, NAME = `ZZ DLP ${RUN.slice(-5)}`;
const seed = () => ({
  id: ID, groupId: ID, site: NAME, name: "Plan 1", origin: { lat: 29.76, lon: -95.37 }, county: "harris", parcels: [],
  els: [{ id: "dlb1", type: "building", cx: 600, cy: 400, w: 520, h: 210, rot: 90, z: 1, dock: "cross", dockAxis: "x", dockSide: "bottom" }],
  measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), status: "active", schemaVersion: 12,
});

const s = await openSignedIn({ base: BASE });
const { browser, page } = s;
console.log("signed in as", s.proof.email, "| served build", JSON.stringify(s.build));
const UID = await page.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);
const errors = []; page.on("pageerror", (e) => errors.push(String(e)));
const model = () => page.evaluate(([id, uid]) => { const m = JSON.parse(localStorage.getItem("planarfit:sites:cloud:" + uid) || "{}"); return m[id] || null; }, [ID, UID]);
const kids = async () => ((await model())?.els || []).filter((e) => e.attachedTo === "dlb1" && !e.dogEar);
const T = (id) => page.getByTestId(id);
const stepper = (id, which) => T(id).locator("xpath=ancestor::*[@data-numbox][1]").getByRole("button", { name: which });
async function waitFor(fn, ms = 10000) { const t = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) return v; await sleep(150); } }
async function dbl(id) {
  const box = await T("planner-canvas").boundingBox();
  const pt = await page.evaluate(({ elId, box }) => {
    const r = document.querySelector(`[data-el-id="${elId}"]`).querySelector("rect, path").getBoundingClientRect();
    const x0 = Math.max(r.left, box.x + 8), x1 = Math.min(r.right, box.x + box.width - 8), y0 = Math.max(r.top, box.y + 8), y1 = Math.min(r.bottom, box.y + box.height - 8);
    return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
  }, { elId: id, box });
  await page.mouse.dblclick(pt.x, pt.y);
}
const stackOf = async (courtId) => { const k = await kids(); const c = k.find((e) => e.id === courtId); const t = k.find((e) => e.forCourt === courtId); const b = k.find((e) => e.buffer && t && e.prevZone === t.id); return { c, t, b }; };
const long = (e) => Math.round(Math.max(e.w, e.h));

try {
  await page.evaluate(([uid, site]) => { localStorage.setItem("planarfit:sites:cloud:" + uid, JSON.stringify({ [site.id]: site })); localStorage.setItem("planarfit:currentSite:v1", site.id); }, [UID, seed()]);
  await page.goto(BASE + "/#/site-planner", { waitUntil: "load" });
  await page.getByText(NAME, { exact: false }).filter({ visible: true }).first().evaluate((el) => el.click(), null, { timeout: 45000 });
  await T("planner-canvas").waitFor({ timeout: 25000 });
  await sleep(1500);
  { const f = page.getByTitle(/zoom to fit|fit to/i).first(); if (await f.count()) await f.click().catch(() => {}); await sleep(800); }
  await assertMeasurable(page, "verify-dock-layer-panel");
  const bpt = await page.evaluate(() => { const r = document.querySelector('[data-el-id="dlb1"]').querySelector("rect, path").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await page.mouse.dblclick(bpt.x, bpt.y);
  await T("building-header").waitFor({ timeout: 10000 });
  const dockRows = page.locator('[data-testid="wall-row"][data-role="dock"]');
  if ((await dockRows.count()) !== 2) throw new Error("VOID run — expected two dock rows on the cross-dock building");
  for (const row of [0, 1]) for (const key of ["court", "trailer", "buffer"]) { await dockRows.nth(row).getByTestId("wall-add").click(); await T(`wall-add-${key}`).click(); await sleep(450); }
  await waitFor(async () => { const k = await kids(); return k.filter((e) => e.truckCourt).length === 2 && k.filter((e) => e.forCourt).length === 2 && k.filter((e) => e.buffer).length === 2; });
  const k0 = await kids();
  const [court, court2] = k0.filter((e) => e.truckCourt);
  ok("setup: two walls each carry court · trailer parking · buffer", !!court && !!court2 && k0.length === 6);
  const depthSnap = (k) => k.map((e) => `${e.id}:${e.zd}`).sort().join("|");
  const snap0 = depthSnap(k0);

  await dbl(court.id);
  await T("dock-layer-panel").waitFor({ timeout: 10000 });
  // KNOWN-GOOD ARM
  const shownDepth = Number(await T("dock-depth").inputValue());
  if (shownDepth !== Math.round(court.zd)) throw new Error(`VOID run — the panel shows depth ${shownDepth}, the stored court says ${court.zd}`);
  ok("known-good: the panel's Depth equals this court's stored depth", true, String(shownDepth));

  // (a) layout
  const title = await T("props-panel-title").innerText();
  ok("(a) title reads 'Truck court · <wall>'", /^Truck court · [NSEW]{1,2}$/.test(title.trim()), title.trim());
  ok("(a) sub-line: 'Building 1 ›' link and 'Dock layer 1 of 3'", /Building 1 ›/.test(await T("dock-host-link").innerText()) && /Dock layer 1 of 3/.test(await T("dock-subline").innerText()));
  const text = await T("property-panel").innerText();
  const gone = ["Dock zone 1 of", "Or select the building to grow", "Dock zone: auto prices", "Feeds the auto-graded surface", "Pad elev.", "Footprint:", "Delete element", "(+ outer)", "never silently"].filter((x) => text.includes(x));
  ok("(a) none of the removed copy is in the rendered panel", gone.length === 0, gone.join(" | "));
  ok("(a) no 'px' and no hex in the panel", !/\bpx\b/.test(text) && !/#[0-9a-f]{6}/i.test(text));
  ok("(a) exactly one Remove control", (await page.getByRole("button", { name: /^Remove truck court$/ }).count()) === 1);
  const area = await T("dock-area").evaluate((el) => { const c = getComputedStyle(el); return { w: c.fontWeight, fs: parseFloat(c.fontSize), txt: el.textContent }; });
  ok("(a) Area is plain body weight, not a display number", Number(area.w) <= 500 && area.fs <= 14 && /^[\d,]+ SF$/.test(area.txt), JSON.stringify(area));
  // the app-wide stamp (shared/ui/phoneTyping.js) lands on a field as it is focused/touched — by design — so focus each field first, THEN read
  const acRows = [];
  for (const id of ["dock-depth", "dock-length", "dock-slope", "dock-weight", "dock-outline-opacity"]) { await T(id).focus(); acRows.push(await T(id).evaluate((el) => el.getAttribute("autocomplete"))); }
  ok("(a) every numeric input suppresses browser autofill once focused", acRows.every((v) => v === "off"), JSON.stringify(acRows));
  if (SHOTS) await T("property-panel").screenshot({ path: `${SHOTS}/dock-panel.png` }).catch(() => {});

  // (b) length + depth independence
  ok("(b) full length shows muted 'Full wall' text, not a link", (await T("dock-full-wall").count()) === 1 && (await T("dock-full-wall-link").count()) === 0);
  const full = Number(await T("dock-length").inputValue());
  await stepper("dock-length", "Decrease").click();
  ok("(b) the stepper shortens by one step", await waitFor(async () => Number(await T("dock-length").inputValue()) === full - 10));
  ok("(b) 'Full wall' is now a link", (await T("dock-full-wall-link").count()) === 1);
  ok("(b) the trailer parking on that wall follows the court's new length", await waitFor(async () => { const { c, t } = await stackOf(court.id); return c && t && long(c) === full - 10 && long(t) === full - 10; }));
  await T("dock-full-wall-link").click();
  ok("(b) the link restores the full wall", await waitFor(async () => { const { c, t } = await stackOf(court.id); return c && t && long(c) === full && long(t) === full; }) && (await T("dock-full-wall").count()) === 1);
  const o0 = (await kids()).find((e) => e.id === court2.id);
  await T("dock-depth").fill("90"); await T("dock-depth").press("Enter");
  ok("(b) depth edit lands on THIS wall's court", await waitFor(async () => (await stackOf(court.id)).c?.zd === 90));
  const o1 = (await kids()).find((e) => e.id === court2.id);
  ok("(b) the OTHER wall's court is unchanged", o1.w === o0.w && o1.h === o0.h && o1.zd === o0.zd);

  // (c) grade
  const pill = (n) => T(`dock-auto-${n}`);
  ok("(c) slope: Auto on, number shown muted (the band default)", (await pill("slope").getAttribute("aria-pressed")) === "true" && (await T("dock-slope").getAttribute("data-muted")) === "1" && (await T("dock-slope").inputValue()) === "1");
  await T("dock-slope").fill("3.5"); await T("dock-slope").press("Enter");
  ok("(c) typing 3.5 turns Auto off, full-strength number, KEPT as typed", (await pill("slope").getAttribute("aria-pressed")) === "false" && (await T("dock-slope").getAttribute("data-muted")) === null && await waitFor(async () => (await stackOf(court.id)).c?.grading?.slopePct === 3.5));
  ok("(c) the amber band notice names the band", /Outside the 1\.0–2\.0% truck court band\. Kept as typed\./.test(await T("dock-band-notice").innerText().catch(() => "")));
  await pill("slope").click();
  ok("(c) Auto returns to 1 and clears the notice", (await pill("slope").getAttribute("aria-pressed")) === "true" && (await T("dock-slope").inputValue()) === "1" && (await T("dock-band-notice").count()) === 0);
  await stepper("dock-elevation", "Increase").click();
  ok("(c) the elevation stepper turns Auto off and keeps the stepped number", (await pill("elevation").getAttribute("aria-pressed")) === "false" && await waitFor(async () => { const v = (await stackOf(court.id)).c?.padElevFt; return Number.isFinite(v); }));
  await pill("elevation").click();
  ok("(c) Auto restores the computed elevation (stored value cleared)", await waitFor(async () => ((await stackOf(court.id)).c?.padElevFt ?? null) === null));

  // (d) remove
  await T("dock-remove").click();
  ok("(d) the confirm card lists all three layers and the after state", /truck court → trailer parking → buffer/.test(await T("dock-confirm-now").innerText()) && /no dock layers/.test(await T("dock-confirm-after").innerText()) && (await T("dock-confirm-remove").innerText()) === "Remove all three");
  const snapBefore = depthSnap(await kids());
  await T("dock-confirm-cancel").click();
  ok("(d) Cancel keeps everything", (await T("dock-remove-confirm").count()) === 0 && depthSnap(await kids()) === snapBefore);
  await T("dock-remove").click(); await T("dock-confirm-remove").click();
  await T("building-header").waitFor({ timeout: 10000 });
  ok("(d) the selection moved to the host building and the note shows", /Removed\. .* wall has no dock layers\./.test(await T("dock-removed-note").innerText()));
  ok("(d) all three layers on that wall are gone (the other wall's three remain)", await waitFor(async () => { const k = await kids(); return k.length === 3 && !k.some((e) => e.id === court.id); }));
  await T("dock-removed-undo").click();
  ok("(d) Undo restores all three with the same depths", await waitFor(async () => depthSnap(await kids()) === snapBefore) && (await T("dock-removed-note").count()) === 0);

  // (e) the buffer alone
  const buf = (await stackOf(court.id)).b;
  await dbl(buf.id);
  await T("dock-layer-panel").waitFor({ timeout: 10000 });
  ok("(e) buffer: 'Dock layer 3 of 3', 'Remove buffer', no Grade section", /Dock layer 3 of 3/.test(await T("dock-subline").innerText()) && (await T("dock-remove").innerText()) === "Remove buffer" && (await T("dock-layer-panel").getByText("Grade", { exact: true }).count()) === 0);
  await T("dock-remove").click();
  ok("(e) one-layer card: plain 'Remove', no 'go with it' copy", (await T("dock-confirm-remove").innerText()) === "Remove" && !/go with it/.test(await T("dock-remove-confirm").innerText()));
  await T("dock-confirm-remove").click();
  ok("(e) only the buffer is removed", await waitFor(async () => { const { c, t, b } = await stackOf(court.id); return c && t && !b; }));
  ok("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
} finally {
  const gone = await page.evaluate(async ([id, uid]) => {
    await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
    await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
    await window.pfSupabase.from("sites").delete().eq("id", id);
    const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
    try { const k = "planarfit:sites:cloud:" + uid; const m = JSON.parse(localStorage.getItem(k) || "{}"); delete m[id]; localStorage.setItem(k, JSON.stringify(m)); } catch (e) {}
    return !q.error && !(q.data || []).length;
  }, [ID, UID]).catch(() => false);
  ok("throwaway site deleted and confirmed gone from the cloud", gone);
  await browser.close();
}
const fails = results.filter((r) => !r.pass);
console.log(`\n${results.length - fails.length}/${results.length} passed`);
process.exit(fails.length ? 1 : 0);
