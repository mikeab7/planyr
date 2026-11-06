/* verify-counties-cities-live — Counties & Cities carry identifying information (NEW-1, owner 2026-11-05, Academy › Concept A, Sugar Land / Fort Bend County).
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-counties-cities-live.mjs [https://planyr.io] [--expect-sha <sha>] [--shots <dir>]
 *
 * READ-ONLY on the owner's project: it never opens his plan (a different account's rows are not readable anyway). It signs in as the test account, seeds a THROWAWAY located plan on the
 * same ground (29.614, −95.658 — inside the City of Sugar Land, Fort Bend County), turns the merged Counties & Cities row on and asserts, against the DEPLOYED build (read from
 * /version.json in the same call):
 *   A. KNOWN-GOOD ARM — TxGIO's own city layer (asked separately from the page) says the plan origin is in "Sugar Land"; the run is VOID if it does not (the instrument is on trial).
 *   B. NAMES AT WORKING ZOOM — at the plan's own zoom and at zoom 15 / 13 the map prints "Sugar Land" and "Fort Bend Co."; every name's whole box is inside the map (nothing cut off).
 *   C. ONE HUE PER CITY — neighbouring cities (Sugar Land / Missouri City / Stafford) wear different colours on their name pills and outlines; limits are the bold solid line with a tint,
 *      ETJ the thinner dashed line.
 *   D. ONE CLICK CARD — a click on the planner canvas answers with ONE card: the city, "inside the city limits", and "Fort Bend County" (the planner used to answer nothing).
 *   E. SITE-ON-A-LINE FLAG — a second throwaway plan centred on a vertex of Sugar Land's own limits line (taken from TxGIO) shows the chip's ⚑ with the crossing sentence.
 * FOREGROUND-OR-VOID first. Throwaway plans are deleted and the deletion re-read (owner rule 15). */
import { writeFileSync, mkdirSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { LIVE_PREFIX, throwawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";

const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const BASE = args.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const EXPECT_SHA = flag("--expect-sha");
const SHOTS = flag("--shots");
if (SHOTS) mkdirSync(SHOTS, { recursive: true });
let failed = 0, voided = 0;
const check = (name, ok, detail = "") => { console.log(`${ok ? "✅" : "❌"} ${name}${detail ? "  — " + detail : ""}`); if (!ok) failed++; };
const voidRun = (why) => { console.log(`⚠ VOID — ${why}`); voided++; };

const ACADEMY = { lat: 29.614, lng: -95.658 };
const LINE_VERTEX = { lat: 29.608068, lng: -95.660556 }; // a vertex of the City of Sugar Land's limits line (TxGIO ring 0, vertex 740)
const TXGIO_CITY = "https://feature.geographic.texas.gov/arcgis/rest/services/City_Boundaries/Texas_City_Boundaries/MapServer/0/query";

let s = null;
for (let attempt = 1; attempt <= 6 && !s; attempt++) {
  try { s = await openSignedIn({ base: BASE, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] }); }
  catch (e) { if (!/answered 50\d/.test(String(e.message)) || attempt === 6) throw e; await new Promise((r) => setTimeout(r, 20000)); }
}
const page = s.page;
await assertMeasurable(page, "verify-counties-cities-live");
await page.setViewportSize({ width: 1500, height: 950 });
const served = await page.evaluate(async () => (await fetch("/version.json", { cache: "no-store" }).then((r) => r.json())).build);
console.log(`signed in as ${s.proof.email} · served build ${served}`);
if (EXPECT_SHA) check("served build is the merge commit", String(served).startsWith(EXPECT_SHA.slice(0, 7)), `${served} vs ${EXPECT_SHA}`);
const sleep = (ms) => page.waitForTimeout(ms);
const cleanupIds = [];

const seed = async (id, at, label) => {
  const plan = { ...throwawayPlan(id), origin: { lat: at.lat, lon: at.lng }, site: `ZZ Live Check — ${label}` };
  const err = await page.evaluate(async ([pl]) => { const { data: u } = await window.pfSupabase.auth.getUser(); const { error } = await window.pfSupabase.from("sites").insert({ id: pl.id, group_id: pl.groupId, site: pl.site, name: pl.name, county: null, user_id: u.user.id, version: 1, data: pl }); return error ? String(error.message) : null; }, [plan]);
  cleanupIds.push(id);
  if (err) throw new Error("throwaway plan insert failed — " + err);
};
const openPlan = async (id) => {
  await page.goto(`${BASE}/?planyrDiag=1#/project/${id}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
  await sleep(2500);
};
const turnOnCountiesCities = async () => {
  const chip = page.getByTestId("layers-expand").filter({ visible: true });
  if (await chip.count()) await chip.first().click();
  const panel = page.locator('[data-testid="layer-panel"][data-surface="planner"]').first();
  await panel.waitFor({ state: "visible", timeout: 20000 });
  await panel.getByTestId("layer-group-jur").click(); await sleep(300);
  const cb = panel.locator('[data-testid="layer-row-counties_cities"] input[type="checkbox"]').first();
  if (!(await cb.count())) throw new Error("Counties & Cities row is not offered at this plan");
  if (!(await cb.isChecked())) await cb.check();
};
/* What the map prints right now: every name pill with its text, colour and whole box, plus the map's own box. */
const readNames = () => page.evaluate(() => {
  /* the VISIBLE box: the planner's backdrop map is overscanned (bigger than the canvas it sits behind), so a name is judged against the canvas the person sees, never the map's own box */
  const m = window.__geoMap, r = m && m.getContainer().parentElement.getBoundingClientRect();
  /* `.leaflet-marker-icon > span` exists on every build (the name markers), so the SAME read answers on main and on the fix */
  const labels = [...document.querySelectorAll(".leaflet-marker-icon > span")].filter((e) => e.textContent.trim() && getComputedStyle(e).whiteSpace === "nowrap").map((e) => { const b = e.getBoundingClientRect(), cs = getComputedStyle(e); return { text: e.textContent.trim(), bg: cs.backgroundColor, dashed: /dashed/.test(cs.borderStyle), l: b.left, t: b.top, r: b.right, b: b.bottom }; });
  return { zoom: m && m.getZoom(), box: r ? { l: r.left, t: r.top, r: r.right, b: r.bottom } : null, labels };
});
const readPaths = () => page.evaluate(() => {
  const out = [];
  for (const p of document.querySelectorAll(".leaflet-gisLine-pane svg path")) out.push({ stroke: p.getAttribute("stroke"), w: Number(p.getAttribute("stroke-width")), dash: p.getAttribute("stroke-dasharray"), fo: Number(p.getAttribute("fill-opacity")) });
  return out;
});
const insideMap = (n, box) => n.l >= box.l - 0.5 && n.r <= box.r + 0.5 && n.t >= box.t - 0.5 && n.b <= box.b + 0.5;

try {
  /* ── A. known-good arm ─────────────────────────────────────────────────────────────────────────── */
  const truth = await page.evaluate(async ([url, p]) => {
    const u = `${url}?geometry=${p.lng},${p.lat}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=city_name&returnGeometry=false&f=json`;
    try { const j = await (await fetch(u)).json(); return (j.features || []).map((f) => f.attributes.city_name); } catch (e) { return null; }
  }, [TXGIO_CITY, ACADEMY]);
  if (!truth) voidRun("TxGIO's city layer could not be asked from this browser — the known-good arm has no ground truth");
  else check("A · KNOWN-GOOD arm: TxGIO says the Academy origin is in Sugar Land", truth.includes("Sugar Land"), JSON.stringify(truth));
  if (truth && !truth.includes("Sugar Land")) voidRun("the plan origin is not inside Sugar Land, so the expected names below are not known");

  /* ── B–D. the Academy-area plan ────────────────────────────────────────────────────────────────── */
  const id1 = `${LIVE_PREFIX}cc-${Date.now().toString(36)}`;
  await seed(id1, ACADEMY, "Academy area");
  await openPlan(id1);
  await turnOnCountiesCities();
  await sleep(9000);

  let n = await readNames();
  console.log(`B · working zoom ${n.zoom}: names =`, n.labels.map((l) => l.text).join(" | "));
  check("B · at the plan's OWN zoom the map names the city (Sugar Land)", n.labels.some((l) => l.text === "Sugar Land"), `zoom ${n.zoom}`);
  check("B · …and the county in full (Fort Bend Co.)", n.labels.some((l) => l.text === "Fort Bend Co."));
  { const cutW = n.labels.filter((l) => !insideMap(l, n.box)); check("B · at the plan's own zoom every name is whole inside the VISIBLE canvas", n.labels.length > 0 && cutW.length === 0, cutW.map((l) => `${l.text}@${Math.round(l.l)},${Math.round(l.t)}`).join(", ")); }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-working-zoom.png` });
  for (const z of [15, 13, 12]) {
    await page.evaluate(([a, b, zz]) => window.__geoMap.setView([a, b], zz, { animate: false }), [ACADEMY.lat, ACADEMY.lng, z]);
    await sleep(6000);
    n = await readNames();
    check(`B · zoom ${z}: Sugar Land is named`, n.labels.some((l) => l.text === "Sugar Land"), n.labels.length + " names");
    check(`B · zoom ${z}: Fort Bend Co. is named`, n.labels.some((l) => l.text === "Fort Bend Co."));
    const cut = n.labels.filter((l) => !insideMap(l, n.box));
    check(`B · zoom ${z}: every name is whole inside the map (nothing cut off)`, cut.length === 0, cut.map((l) => l.text).join(", "));
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/B-zoom${z}.png` });
  }

  // C — hues + line styles, read at zoom 12 where the neighbours are all in view
  await page.evaluate(([a, b]) => window.__geoMap.setView([a, b], 12, { animate: false }), [ACADEMY.lat, ACADEMY.lng]);
  await sleep(7000);
  n = await readNames();
  const hue = (t) => (n.labels.find((l) => l.text === t && !l.dashed) || {}).bg;
  const pairs = [["Sugar Land", "Missouri City"], ["Sugar Land", "Stafford"], ["Missouri City", "Stafford"]];
  const known = pairs.filter(([a, b]) => hue(a) && hue(b));
  if (!known.length) voidRun("none of the neighbouring city names is on screen at zoom 12 — the colour arm cannot be read");
  for (const [a, b] of known) check(`C · neighbouring cities ${a} / ${b} wear different colours`, hue(a) !== hue(b), `${hue(a)} vs ${hue(b)}`);
  const pillColours = new Set(n.labels.filter((l) => !l.dashed && /^rgb\(/.test(l.bg || "") && !/Co\.$/.test(l.text)).map((l) => l.bg));
  check("C · at least four different city colours are on the map", pillColours.size >= 4, [...pillColours].join(" "));
  const paths = await readPaths();
  const limits = paths.filter((p) => !p.dash && p.w >= 3 && p.fo > 0), etj = paths.filter((p) => p.dash && p.w <= 2.5 && p.w >= 1.5 && p.fo > 0);
  check("C · city limits are bold solid lines with a tint", limits.length > 0, `${limits.length} paths`);
  check("C · city outlines are not all one colour", new Set(limits.map((p) => p.stroke)).size >= 3, [...new Set(limits.map((p) => p.stroke))].join(" "));
  check("C · ETJ is the thinner dashed line, tinted fainter than the limits", etj.length > 0 && Math.max(...etj.map((p) => p.fo)) < Math.min(...limits.map((p) => p.fo)), `${etj.length} dashed`);
  check("C · the county line is its own style (heavier dashed grey)", paths.some((p) => p.stroke === "#4b5563" && p.dash), "");

  // D — one click card on the planner canvas
  await openPlan(id1);
  await turnOnCountiesCities();
  await sleep(9000);
  const box = await page.getByTestId("planner-canvas").boundingBox();
  let card = "";
  for (const [dx, dy] of [[260, 40], [-300, 60], [280, 200], [-280, 200], [320, -60], [0, 230]]) {
    await page.mouse.click(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy);
    await sleep(2500);
    card = await page.getByTestId("gis-identify").first().innerText().catch(() => "");
    if (/Sugar Land/.test(card)) break;
  }
  console.log("D · click card:\n" + card.split("\n").map((l) => "     " + l).join("\n"));
  check("D · the planner click card names the city", /Sugar Land/.test(card));
  check("D · …says it is inside the city limits", /inside the city limits/i.test(card));
  check("D · …and names the county", /Fort Bend County/.test(card));
  check("D · ONE card, not one per layer", (card.match(/Fort Bend County/g) || []).length === 1);
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/D-click-card.png` });

  /* ── E. a site on a limits line ───────────────────────────────────────────────────────────────── */
  const id2 = `${LIVE_PREFIX}cc-line-${Date.now().toString(36)}`;
  await seed(id2, LINE_VERTEX, "on Sugar Land limits line");
  await openPlan(id2);
  await sleep(9000);
  const chip = await page.evaluate(() => { const c = document.querySelector('[data-testid="jurisdiction-badge"]'); const f = document.querySelector('[data-testid="jurisdiction-line-flag"]'); return c ? { full: c.getAttribute("data-jurisdiction-full"), title: c.getAttribute("title") || "", flag: !!f, line: f ? f.getAttribute("data-limit-line") : null } : null; });
  console.log("E · chip:", JSON.stringify(chip));
  if (!chip) voidRun("the jurisdiction chip did not render on the line plan");
  else {
    check("E · a site on a city-limits line shows the ⚑ flag", chip.flag);
    check("E · its tooltip says the site crosses (or touches) that limits line", /The site (crosses|'s edge touches) the City of [A-Za-z ]+ limits line/.test(chip.title), chip.title.split("\n").filter((l) => /⚑/.test(l)).join(" / "));
  }
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/E-line-chip.png` });
} finally {
  for (const id of cleanupIds) {
    const r = await cleanupLive(page, { planId: id }).catch((e) => ({ error: String(e) }));
    check(`throwaway plan ${id.slice(-8)} deleted and verified gone`, r && r.left && r.left.site === 0 && !(r.errors || []).length, JSON.stringify(r));
  }
  await s.close();
}
if (voided) console.log(`VOID — ${voided} precondition(s) failed; the run proves nothing`);
console.log(failed ? `FAIL (${failed})` : voided ? "VOID" : "PASS");
process.exit(failed ? 1 : voided ? 2 : 0);
