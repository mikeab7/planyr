#!/usr/bin/env node
/* verify-kml-import-title — B2492544 / V1942768 live check.
 *
 *   node ui-audit/verify-kml-import-title.mjs --live https://planyr.io [--expect <sha>]
 *
 * Signed in as the TEST ACCOUNT only (ui-audit/lib/signedInSession.mjs). Imports a small KML whose
 * descriptions open with a deal word ("Lease, …", "Sale, …", "Lease") and one empty-name placemark,
 * then checks (1) the stored import drafts, (2) the Title shown in Import review, (3) the title of the
 * comps saved by Promote. Everything it creates (drafts, comps, tracked sites) is deleted at the end,
 * pass or fail. Known-good arm: the plain-name placemark whose description carries nothing misleading. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const arg = (f, d) => { const i = process.argv.indexOf(f); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--live", "https://planyr.io").replace(/\/$/, "");
const EXPECT = arg("--expect", null);
const TAG = "zz-V1942768";
const PM = [
  { nameXml: `${TAG} Dircks &amp; Logistics`, want: `${TAG} Dircks & Logistics`, desc: `Lease, 50,000 SF at $0.65/SF/mo NNN; ${TAG}`, lon: -95.4101, lat: 29.7701, promote: true },
  { nameXml: `${TAG} Acme Yard`, want: `${TAG} Acme Yard`, desc: `Sale, 3.2 AC, $850k; ${TAG}`, lon: -95.4102, lat: 29.7702, promote: true },
  { nameXml: `${TAG} Plain Name`, want: `${TAG} Plain Name`, desc: `Lease; ${TAG}`, lon: -95.4103, lat: 29.7703, promote: false },
  { nameXml: ``, want: ``, desc: `Lease, 5 yr term; ${TAG}`, lon: -95.4104, lat: 29.7704, promote: false },
];
const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`  ${ok ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`); };

const s = await openSignedIn({ base: BASE, viewport: { width: 1600, height: 1000 } });
const { page } = s;
const version = await page.evaluate(async (b) => (await fetch(`${b}/version.json`, { cache: "no-store" })).json().catch(() => null), BASE);
const chunks = await page.evaluate(() => performance.getEntriesByType("resource").map((e) => e.name.split("/").pop()).filter((n) => /CompsPanel|CompDrafts/.test(n)));
console.log(`signed in as ${s.proof.email} · served build ${JSON.stringify(version)} · chunks ${chunks.join(",") || "(load on first open)"}`);
if (EXPECT) check(`served build is ${EXPECT}`, JSON.stringify(version || {}).includes(EXPECT.slice(0, 7)));

const db = (fn, a) => page.evaluate(fn, a);
async function cleanup() {
  await db(async (tag) => {
    const sb = window.pfSupabase;
    const { data: u } = await sb.auth.getUser();
    const uid = u.user.id;
    const { data: rows } = await sb.from("comps").select("id,project_id,title,notes").eq("user_id", uid);
    const mine = (rows || []).filter((r) => (r.title || "").includes(tag) || (r.notes || "").includes(tag));
    const siteIds = [...new Set(mine.map((r) => r.project_id).filter(Boolean))];
    if (mine.length) await sb.from("comps").delete().in("id", mine.map((r) => r.id));
    for (const id of siteIds) {
      const { data: site } = await sb.from("sites").select("id,data").eq("id", id).maybeSingle();
      // Trash (the app's own delete) — a hard DELETE of a live site is refused. Never the standing fixture.
      if (site && site.data && site.data.role === "tracked" && site.id !== "e2e-fixture-site") {
        const { error } = await sb.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
        if (error) throw new Error(`could not trash test site ${id}: ${error.message}`);
      }
    }
    await sb.from("comp_import_drafts").delete().ilike("raw_description", `%${tag}%`);
  }, TAG);
}
const readDrafts = () => db(async (tag) => {
  const { data } = await window.pfSupabase.from("comp_import_drafts").select("raw_name,raw_description,proposed,status").ilike("raw_description", `%${tag}%`);
  return data || [];
}, TAG);
const readComps = () => db(async (tag) => {
  const sb = window.pfSupabase; const { data: u } = await sb.auth.getUser();
  const { data } = await sb.from("comps").select("id,title,notes,comp_type,county,project_id").eq("user_id", u.user.id).is("deleted_at", null);
  return (data || []).filter((r) => (r.title || "").includes(tag) || (r.notes || "").includes(tag));
}, TAG);

try {
  await cleanup(); // a previous aborted run's leftovers never count
  await page.goto(`${BASE}/#/site`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await page.waitForLoadState("load").catch(() => {});
  await pacedWait(page, 5000);
  for (let i = 0; ; i++) {
    try { await assertMeasurable(page, "verify-kml-import-title"); break; } catch (e) { if (i >= 3 || !/context was destroyed|navigation/i.test(String(e))) throw e; await pacedWait(page, 2500); }
  }
  const tab = page.getByRole("tab", { name: /^Records/ }).first();
  if ((await tab.getAttribute("aria-selected")) !== "true") await tab.evaluate((el) => el.click());
  await pacedWait(page, 800);

  const kml = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document>` +
    PM.map((p) => `<Placemark>${p.nameXml ? `<name>${p.nameXml}</name>` : ""}<description>${p.desc}</description><Point><coordinates>${p.lon},${p.lat},0</coordinates></Point></Placemark>`).join("") +
    `</Document></kml>`;
  await page.locator('input[type="file"][accept=".kml,.kmz"]').first().setInputFiles({ name: "zz-v1942768.kml", mimeType: "application/vnd.google-earth.kml+xml", buffer: Buffer.from(kml) });
  let drafts = [];
  for (let i = 0; i < 30; i++) { drafts = await readDrafts(); if (drafts.length >= PM.length) break; await pacedWait(page, 500); }
  check(`${PM.length} import drafts staged`, drafts.length === PM.length, `${drafts.length}`);

  // (1) stored drafts: proposed.title
  const draftFor = (p) => drafts.find((d) => (p.want ? d.raw_name === p.want : !d.raw_name));
  for (const p of PM) {
    const d = draftFor(p);
    check(`stored draft title for ${p.want ? `"${p.want}"` : "the empty-name placemark"}`, !!d && (d.proposed?.title || "") === p.want, JSON.stringify(d?.proposed?.title));
  }
  check("no draft was titled by a description word (Lease/Sale)", drafts.every((d) => !/^(lease|sale)$/i.test((d.proposed?.title || "").trim())));

  // (2) Import review shows the Title field
  await pacedWait(page, 1500);
  const cards = page.locator("div").filter({ has: page.getByRole("button", { name: "Promote to comp" }) }).filter({ hasText: TAG });
  const reviewTitles = await page.evaluate((tag) => {
    const out = [];
    for (const btn of document.querySelectorAll("button")) {
      if (btn.textContent.trim() !== "Promote to comp" && btn.textContent.trim() !== "Saving…") continue;
      let card = btn; while (card && !(card.querySelector && card.querySelector('input[placeholder="Property / deal name"]'))) card = card.parentElement;
      if (!card || !card.innerText.includes(tag)) continue;
      out.push(card.querySelector('input[placeholder="Property / deal name"]').value);
    }
    return out;
  }, TAG);
  void cards;
  for (const p of PM) check(`review Title field shows ${p.want ? `"${p.want}"` : "blank"}`, reviewTitles.includes(p.want), JSON.stringify(reviewTitles));
  check("review shows 4 cards (known-good: every placemark rendered)", reviewTitles.length === PM.length, `${reviewTitles.length}`);

  // (3) Promote the two deal placemarks, read the saved titles
  for (const p of PM.filter((x) => x.promote)) {
    const card = page.locator("div").filter({ hasText: p.desc }).filter({ has: page.getByRole("button", { name: "Promote to comp" }) }).last();
    await card.getByRole("button", { name: "Promote to comp" }).click();
    for (let i = 0; i < 40; i++) { const c = await readComps(); if (c.some((r) => r.title === p.want)) break; await pacedWait(page, 500); }
  }
  const comps = await readComps();
  for (const p of PM.filter((x) => x.promote)) {
    const c = comps.find((r) => r.title === p.want);
    check(`promoted comp titled "${p.want}"`, !!c, JSON.stringify(comps.map((r) => r.title)));
  }
  check("no promoted comp is titled Lease/Sale", comps.every((r) => !/^(lease|sale)$/i.test((r.title || "").trim())));
} finally {
  await cleanup().catch((e) => console.log("cleanup error", e));
  const leftC = await readComps().catch(() => null);
  const leftD = await readDrafts().catch(() => null);
  console.log(`\ncleanup: ${leftC ? leftC.length : "?"} test comps, ${leftD ? leftD.length : "?"} test drafts left`);
  await s.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
