/* verify-rail-scrollbar-live — V1656176 (B2237072): the right tool rail's thin scrollbar, tighter left edge and
 * headings-on-the-icon-column, signed in on a real deploy, light + dark, tall + short window.
 *
 * Signs in as the throwaway test account through the one shared helper, seeds ONE throwaway cloud site
 * (`zz-railsb-live-<ts>`), reads the served /version.json in the same call as the assertions, and deletes the
 * site again (pass or fail). Launches Chromium WITHOUT --hide-scrollbars, otherwise no scrollbar can ever be seen.
 *
 * Usage:  node ui-audit/verify-rail-scrollbar-live.mjs [https://planyr.io] [--expect=<build prefix>] [--out=<dir>]
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.argv.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const EXPECT = (process.argv.find((a) => a.startsWith("--expect=")) || "").slice(9);
const OUT = (process.argv.find((a) => a.startsWith("--out=")) || "--out=ui-audit/screens/").slice(6);
mkdirSync(OUT, { recursive: true });
const SITE_ID = `zz-railsb-live-${Date.now().toString(36)}`;
let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const note = (m) => console.log("· " + m);

const site = {
  id: SITE_ID, groupId: SITE_ID, site: "zz rail scrollbar live (throwaway)", name: "Concept A", status: "active",
  origin: { lat: 29.8885, lon: -95.2952 }, county: "harris",
  parcels: [{ id: "pc1", locked: false, active: true, points: [{ x: -300, y: -250 }, { x: 300, y: -250 }, { x: 300, y: 250 }, { x: -300, y: 250 }] }],
  els: [{ id: "e1", type: "building", cx: -60, cy: 0, w: 260, h: 180, rot: 0 }], measures: [], callouts: [], markups: [],
  settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};

/* in-page: every geometry fact the acceptance names */
const measure = () => {
  const r = document.querySelector(".rail-scroll");
  if (!r) return null;
  const rr = r.getBoundingClientRect();
  const sbW = r.offsetWidth - r.clientWidth - r.clientLeft;
  const icons = [...r.querySelectorAll("svg.rbtn-icon")].map((i) => i.getBoundingClientRect().left);
  const splits = [...r.querySelectorAll(".rail-split")].map((el) => {
    const main = el.querySelector(".rail-split-main"), pill = el.querySelector(".rail-split-pill"), c = el.querySelector(".rail-caret");
    return { name: main.textContent.trim().replace(/\s+/g, " "), mainOver: main.scrollWidth - main.clientWidth, pillOver: pill.scrollWidth - pill.clientWidth, caretRight: c.getBoundingClientRect().right, val: el.querySelector(".rail-pill-val")?.textContent || null };
  });
  const plain = [...r.querySelectorAll(":scope > button")].map((b) => ({ name: b.textContent.trim().replace(/\s+/g, " "), over: b.scrollWidth - b.clientWidth, left: b.getBoundingClientRect().left, right: b.getBoundingClientRect().right }));
  const heads = [...r.querySelectorAll("[data-rail-heading]")].map((h) => {
    const t = [...h.childNodes].find((n) => n.nodeType === 3), rg = document.createRange(); rg.selectNodeContents(t);
    const next = h.nextElementSibling, ic = next && next.querySelector("svg.rbtn-icon");
    return { text: h.textContent, textLeft: rg.getBoundingClientRect().left, iconLeft: ic ? ic.getBoundingClientRect().left : null };
  });
  const cs = getComputedStyle(r);
  return { outerLeft: rr.left, sbW, scrollable: r.scrollHeight > r.clientHeight, iconMin: Math.min(...icons), splits, plain, heads, sbWidth: cs.scrollbarWidth, sbColor: cs.scrollbarColor, width: rr.width };
};

const s = await openSignedIn({ base: BASE, viewport: { width: 1440, height: 520 }, ignoreDefaultArgs: ["--hide-scrollbars"] });
const page = s.page;
let cleaned = false;
const cleanup = async () => {
  if (cleaned) return; cleaned = true;
  try {
    const r = await page.evaluate(async (id) => {
      const out = {};
      const tr = await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); out.trash = tr.error ? String(tr.error.message) : "ok";
      const de = await window.pfSupabase.from("site_elements").delete().eq("site_id", id); out.els = de.error ? String(de.error.message) : "deleted";
      const ds = await window.pfSupabase.from("sites").delete().eq("id", id); out.sites = ds.error ? String(ds.error.message) : "deleted";
      try { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); delete m[id]; localStorage.setItem("planarfit:sites:v1", JSON.stringify(m)); } catch (_) {}
      out.remaining = ((await window.pfSupabase.from("sites").select("id").eq("id", id)).data || []).length;
      return out;
    }, SITE_ID);
    note("cleanup " + JSON.stringify(r));
    if (r.remaining !== 0) log(false, "throwaway site row still present after cleanup");
  } catch (e) { log(false, "cleanup failed: " + e.message); }
};
try {
  await assertMeasurable(page, "verify-rail-scrollbar-live");
  const served = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
  note(`served build ${served.build}; signed in as ${s.proof.email}; fixture visible ${s.proof.fixtureVisible}; throwaway ${SITE_ID}`);
  if (EXPECT) log(served.build.startsWith(EXPECT.slice(0, 7)), `served build ${served.build} is the shipped commit ${EXPECT}`);
  const ins = await page.evaluate(async (st) => {
    const r = await window.pfSupabase.from("sites").insert({ id: st.id, group_id: st.groupId, site: st.site, name: st.name, county: st.county, updated_at: new Date(st.updatedAt).toISOString(), data: st });
    return r.error ? String(r.error.message) : null;
  }, site);
  if (ins) throw new Error("could not create the throwaway cloud site: " + ins);
  await page.goto(`${BASE}/#/project/${SITE_ID}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".rail-scroll [data-rail-heading]", { timeout: 60000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(1500);

  for (const theme of ["light", "dark"]) {
    await page.evaluate((t) => { localStorage.setItem("planyr.theme", t); }, theme);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.waitForSelector(".rail-scroll [data-rail-heading]", { timeout: 60000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: /^Road$/ }).click();
    const served2 = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()));
    const chunks = await page.evaluate(() => [...document.querySelectorAll("script[src]")].map((x) => x.getAttribute("src")).slice(0, 2).join(" "));
    const m = await page.evaluate(measure);
    note(`${theme}: build ${served2.build}; chunks ${chunks}; rail ${m.width} wide; scrollbar strip ${m.sbW}; style ${m.sbWidth} / ${m.sbColor}`);
    log(m.scrollable, `${theme}: the short window makes the rail overflow`);
    log(m.sbW >= 4 && m.sbW <= 12, `${theme}: (a) a thin scrollbar strip is present (${m.sbW}px)`);
    log(m.sbWidth === "thin" && m.sbColor !== "auto", `${theme}: scrollbar is the thin, token-coloured one (${m.sbColor})`);
    const heads = m.heads.map((h) => Math.abs(h.textLeft - h.iconLeft));
    log(m.heads.length === 3 && heads.every((d) => d <= 1), `${theme}: (b) heading text left = icon left within 1px (${heads.map((d) => d.toFixed(2)).join(", ")})`);
    log(m.plain[0].left - m.outerLeft <= 7 && m.iconMin - m.outerLeft <= 15, `${theme}: (c) pills ${(m.plain[0].left - m.outerLeft).toFixed(1)}px / icons ${(m.iconMin - m.outerLeft).toFixed(1)}px from the rail's left edge (was 12 / ~22)`);
    const over = [...m.splits.map((x) => Math.max(x.mainOver, x.pillOver)), ...m.plain.map((x) => x.over)];
    log(over.every((o) => o <= 0), `${theme}: (d) no rail label or value overflows its box (worst ${Math.max(...over)})`);
    const cr = m.splits.map((x) => x.caretRight);
    log(Math.max(...cr) - Math.min(...cr) <= 0.5, `${theme}: (e) every ▾ shares one x (${(Math.max(...cr) - Math.min(...cr)).toFixed(2)}px spread)`);
    const rights = m.plain.map((x) => x.right);
    log(Math.max(...rights) - Math.min(...rights) <= 0.5, `${theme}: rows end on one x`);
    log(m.width === 168, `${theme}: rail width unchanged (${m.width})`);
    await page.screenshot({ path: `${OUT}rail-scrollbar-live-${theme}.png`, clip: { x: 1440 - 168, y: 0, width: 168, height: 520 } });
  }
} catch (e) { log(false, "run error: " + e.message); }
finally { await cleanup(); await s.close(); }
console.log(fail ? `\n${fail} check(s) FAILED` : "\nALL PASSED");
process.exit(fail ? 1 : 0);
