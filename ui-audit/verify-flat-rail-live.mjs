/* verify-flat-rail-live — V1421552 (B1996464): the flat left-rail panels with REAL flood / GIS data, signed in.
 *
 * Signs in as the throwaway test account through the one shared helper (ui-audit/lib/signedInSession.mjs),
 * seeds ONE throwaway georeferenced site (a Houston parcel + a building + a pond, id `zz-flatrail-live-<ts>`),
 * drives Drainage (live FEMA/3DEP/county pulls), Analysis (live screening), and Overlays, and asserts the
 * flat-panel contract on the POPULATED state — what the offline harness (verify-flat-rail-panels.mjs) could not
 * see. The served /version.json is read in the same call as the assertions. Everything it creates is deleted at
 * the end (cloud row + local copy), pass or fail.
 *
 * Usage:  node ui-audit/verify-flat-rail-live.mjs [https://planyr.io] [--phone] [--out=<dir>]
 */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { mkdirSync } from "node:fs";

const BASE = process.argv.find((a) => /^https?:/.test(a)) || "https://planyr.io";
const PHONE = process.argv.includes("--phone");
const OUT = (process.argv.find((a) => a.startsWith("--out=")) || "--out=ui-audit/screens/").slice(6);
mkdirSync(OUT, { recursive: true });
const TAG = PHONE ? "phone" : "desktop";
const SITE_ID = `zz-flatrail-live-${Date.now().toString(36)}`;

let fail = 0;
const log = (ok, msg) => { console.log((ok ? "✓ " : "✗ ") + msg); if (!ok) fail++; };
const note = (m) => console.log("· " + m);

const parcel = { id: "pc1", locked: false, active: true, points: [{ x: -300, y: -250 }, { x: 300, y: -250 }, { x: 300, y: 250 }, { x: -300, y: 250 }] };
const building = { id: "e1", type: "building", cx: -60, cy: 0, w: 260, h: 180, rot: 0 };
const pond = { id: "e2", type: "pond", cx: 190, cy: 120, w: 150, h: 90, rot: 0 };
const site = {
  id: SITE_ID, groupId: SITE_ID, site: "zz flatrail live (throwaway)", name: "Concept A", status: "active",
  origin: { lat: 29.8885, lon: -95.2952 }, county: "harris",
  parcels: [parcel], els: [building, pond], measures: [], callouts: [], markups: [],
  settings: {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
};

/* in-page: facts about the open left panel (same contract as verify-flat-rail-panels.mjs) */
const measure = () => {
  const panel = document.querySelector('[data-testid="left-menu-panel"]');
  if (!panel) return { open: false };
  const pr = panel.getBoundingClientRect();
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const closes = [...panel.querySelectorAll("button")].filter((b) => vis(b) && /^close\b/i.test(b.getAttribute("aria-label") || ""));
  const close = closes[0] || null;
  const header = close ? (close.parentElement.closest('[data-testid^="panel-chrome-"]') || close.parentElement) : null;
  const hitsOf = (el) => { const r = el.getBoundingClientRect(); const h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && (el === h || el.contains(h)); };
  const px = (v) => parseFloat(v) || 0;
  const isControl = (el) => /^(BUTTON|INPUT|SELECT|TEXTAREA|LABEL|A|SUMMARY)$/.test(el.tagName) || el.closest("button,select,textarea");
  const cards = [];
  for (const el of panel.querySelectorAll("*")) {
    if (header && header.contains(el)) continue;
    if (isControl(el) || el.closest("svg")) continue;
    const cs = getComputedStyle(el), r = el.getBoundingClientRect();
    if (r.width < pr.width * 0.6 || r.height < 24) continue;
    const sides = ["Top", "Right", "Bottom", "Left"].filter((s) => px(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] === "solid" && !/rgba?\(\s*0,\s*0,\s*0,\s*0\)|transparent/.test(cs[`border${s}Color`]));
    if (sides.length >= 3 && px(cs.borderTopLeftRadius) >= 6) cards.push({ tag: el.tagName, text: (el.innerText || "").slice(0, 40).replace(/\s+/g, " ") });
  }
  const rows = [...panel.querySelectorAll("[data-verdict-row]")].map((row) => {
    const l = row.querySelector("[data-verdict-label]"), v = row.querySelector("[data-verdict-value]");
    return { key: row.getAttribute("data-verdict-row"), ok: !!(l && v && l.getBoundingClientRect().left < v.getBoundingClientRect().left && v.getBoundingClientRect().right > pr.left + pr.width * 0.6), label: l?.textContent, value: v?.innerText.replace(/\s+/g, " ").trim(), status: row.querySelector("[data-verdict-status]")?.getAttribute("data-verdict-status") || null };
  });
  const findings = [...panel.querySelectorAll("[data-check-row]")].map((f) => ({ id: f.getAttribute("data-check-row"), text: f.innerText.replace(/\s+/g, " ").slice(0, 90) }));
  return {
    open: true, headerText: header ? header.innerText.replace(/[✕×]/g, "").replace(/\s+/g, " ").trim() : "", closeCount: closes.length,
    closeReachable: close ? hitsOf(close) : false, actionsReachable: [...panel.querySelectorAll("[data-panel-actions] button, [data-verdict-row] button")].every(hitsOf),
    cards, rows, findings, gutterChips: [...panel.querySelectorAll("span,div")].filter((el) => el.children.length === 0 && (el.textContent || "").trim() === "…" && vis(el) && el.getBoundingClientRect().left - pr.left < pr.width * 0.34 && el.getBoundingClientRect().width < 60).length,
    overflowX: panel.scrollWidth - panel.clientWidth, headerActions: header?.querySelector("[data-panel-actions]")?.innerText.replace(/\s+/g, " ").trim() || "",
  };
};

const s = await openSignedIn({ base: BASE, ...(PHONE ? { device: "iPhone 15" } : {}) });
const page = s.page;
let cleaned = false;
const cleanup = async () => {
  if (cleaned) return; cleaned = true;
  try {
    const r = await page.evaluate(async (id) => {
      const out = {};
      // The DB refuses to hard-delete a row that is not in the trash (sites_block_delete_live_group): trash first.
      const tr = await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      out.trash = tr.error ? String(tr.error.message) : "ok";
      const de = await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
      out.site_elements = de.error ? String(de.error.message) : "deleted";
      const ds = await window.pfSupabase.from("sites").delete().eq("id", id);
      out.sites = ds.error ? String(ds.error.message) : "deleted";
      try { const m = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); delete m[id]; localStorage.setItem("planarfit:sites:v1", JSON.stringify(m)); } catch (_) {}
      const left = await window.pfSupabase.from("sites").select("id").eq("id", id);
      out.remaining = (left.data || []).length;
      return out;
    }, SITE_ID);
    note("cleanup " + JSON.stringify(r));
    if (r.remaining !== 0) { log(false, "throwaway site row still present after cleanup"); }
  } catch (e) { log(false, "cleanup failed: " + e.message); }
};
try {
  await assertMeasurable(page, "verify-flat-rail-live");
  /* same-call build read + proof the served bundle carries the flat-panel work */
  const served = await page.evaluate(async () => {
    const v = await fetch("/version.json", { cache: "no-store" }).then((r) => r.json());
    const srcs = [...document.querySelectorAll("script[src]")].map((x) => x.getAttribute("src"));
    return { v, srcs };
  });
  note(`served build ${served.v.build}; chunks ${served.srcs.slice(0, 3).join(" ")}`);
  note(`signed in as ${s.proof.email}; fixture visible ${s.proof.fixtureVisible}; throwaway site ${SITE_ID}`);

  /* A signed-in app only opens projects that exist in the CLOUD, so the throwaway site is a real row owned by
     the test account, in the exact shape cloudSync.siteRowFor writes. It is deleted again in cleanup(). */
  const ins = await page.evaluate(async (st) => {
    const r = await window.pfSupabase.from("sites").insert({ id: st.id, group_id: st.groupId, site: st.site, name: st.name, county: st.county, updated_at: new Date(st.updatedAt).toISOString(), data: st });
    return r.error ? String(r.error.message) : null;
  }, site);
  if (ins) throw new Error("could not create the throwaway cloud site: " + ins);
  await page.goto(`${BASE}/#/project/${SITE_ID}/site`, { waitUntil: "domcontentloaded" });
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-rail-tab="drainage"]', { state: "attached", timeout: 60000 });
  await page.waitForTimeout(3000);
  const hasFlat = await page.evaluate(() => { document.querySelector('[data-rail-tab="drainage"]').click(); return true; });
  await page.waitForSelector('[data-testid="drainage-panel"][data-flat-panel="1"]', { timeout: 20000 }).then(
    () => log(true, "served bundle carries the flat Drainage panel (data-flat-panel)"),
    () => log(false, "served bundle does NOT carry the flat Drainage panel — wrong build?"));

  /* ---- STEP 1/2: Drainage, live check ---- */
  await page.waitForTimeout(1500);
  const before = await page.evaluate(measure);
  log(before.open && before.headerText.length > 0 && before.closeCount === 1, `Drainage: one header row ("${before.headerText.slice(0, 70)}")`);
  note("header action text before check: " + before.headerActions);
  const startedAt = Date.now();
  await page.evaluate(() => document.querySelector('[data-panel-actions] button[aria-label="Re-check flood data"]')?.click());
  let after = null, done = false;
  for (let i = 0; i < 45; i++) { // up to ~135 s for live FEMA / 3DEP / county pulls
    await page.waitForTimeout(3000);
    after = await page.evaluate(measure);
    const pending = after.rows.some((r) => /checking|not checked yet|retrying/i.test(r.value || ""));
    if (after.rows.length && !pending && !/checking/i.test(after.headerActions)) { done = true; break; }
  }
  note(`check settled=${done} after ${Math.round((Date.now() - startedAt) / 1000)}s; header: ${after.headerActions}`);
  for (const r of after.rows) note(`row ${r.key}: ${r.label} → ${r.value} [${r.status}]`);
  await page.screenshot({ path: `${OUT}flat-live-${TAG}-drainage.png` });
  log(done, "Drainage: live check completed (no row left on 'checking' / 'not checked yet')");
  log(after.rows.length > 0 && after.rows.every((r) => r.ok), "Drainage: every verdict row reads label-left / value-right");
  log(after.rows.some((r) => r.status || /\d/.test(r.value || "")), "Drainage: at least one row carries a real status word or number");
  log(after.cards.length === 0 && after.gutterChips === 0, `Drainage: no nested card, no gutter chip${after.cards.length ? " — " + JSON.stringify(after.cards.slice(0, 2)) : ""}`);
  log(after.closeReachable && after.actionsReachable && after.overflowX <= 1, "Drainage: × and ↻ reachable, no horizontal overflow");
  log(/\b(ago|just now|now)\b|checked/i.test(after.headerActions) && !/not checked$/i.test(after.headerActions.trim()), `Drainage: header freshness shows an age ("${after.headerActions}")`);
  const open = await page.evaluate(() => { const b = [...document.querySelectorAll('[data-testid="drainage-panel"] button[aria-expanded]')]; b.forEach((x) => x.getAttribute("aria-expanded") === "false" && x.click()); return b.length; });
  await page.waitForTimeout(1200);
  const expanded = await page.evaluate(measure);
  note(`expanded ${open} folds; cards after expand: ${expanded.cards.length} ${JSON.stringify(expanded.cards.slice(0, 3))}`);
  log(expanded.cards.length === 0, "Drainage: still no nested card with every fold expanded");
  await page.screenshot({ path: `${OUT}flat-live-${TAG}-drainage-expanded.png` });


  /* ---- STEP 5 (desktop): detach Drainage to a floating card and back ---- */
  if (!PHONE) {
    await page.evaluate(() => document.querySelector('[data-rail-tab="drainage"]').click());
    await page.waitForTimeout(800);
    await page.evaluate(() => document.querySelector('[aria-label="Detach panel"]')?.click());
    await page.waitForSelector('[data-testid^="floating-panel-"]', { timeout: 10000 }).catch(() => {});
    await page.waitForTimeout(1200);
    const fl = await page.evaluate(() => {
      const c = document.querySelector('[data-testid^="floating-panel-"]');
      if (!c) return null;
      const h = c.querySelector('[data-testid$="-chrome"]');
      return { title: h?.querySelector("[data-panel-title]")?.textContent || "", subtitle: h?.querySelector("[data-panel-subtitle]")?.textContent || "", icon: !!h?.querySelector("[data-panel-icon]"), actions: h?.querySelector("[data-panel-actions]")?.innerText.replace(/\s+/g, " ").trim() || "", refresh: !!c.querySelector('[data-panel-actions] [aria-label="Re-check flood data"]') };
    });
    note("floating card header: " + JSON.stringify(fl));
    await page.screenshot({ path: `${OUT}flat-live-${TAG}-drainage-floating.png` });
    log(!!fl && /drainage/i.test(fl.title) && !!fl.subtitle && fl.icon && fl.refresh, "Detached: floating card header carries icon + title + subtitle + the flood-data ↻");
    await page.evaluate(() => document.querySelector('[aria-label="Dock panel"]')?.click());
    await page.waitForTimeout(800);
    const docked = await page.evaluate(() => !!document.querySelector('[data-testid="drainage-panel"]') && !document.querySelector('[data-testid^="floating-panel-"]'));
    log(docked, "Detached: docking returns it to the rail column");
  }

  /* ---- STEP 3: Analysis findings ---- */
  await page.evaluate(() => document.querySelector('[data-rail-tab="analysis"]').click());
  let an = null;
  for (let i = 0; i < 30; i++) { await page.waitForTimeout(3000); an = await page.evaluate(measure); if (an.findings.length) break; }
  note(`Analysis findings: ${an.findings.length}`); for (const f of an.findings.slice(0, 8)) note("finding " + f.id + ": " + f.text);
  await page.screenshot({ path: `${OUT}flat-live-${TAG}-analysis.png` });
  log(an.findings.length > 0, "Analysis: live screening returned findings");
  log(an.cards.length === 0 && an.closeReachable, `Analysis: findings are divider rows, no card${an.cards.length ? " — " + JSON.stringify(an.cards.slice(0, 2)) : ""}`);
  const exp = await page.evaluate(() => { const r = document.querySelector("[data-check-row] [role=button]"); if (r) r.click(); return !!r; });
  await page.waitForTimeout(800);
  const an2 = await page.evaluate(measure);
  log(exp && an2.cards.length === 0, "Analysis: expanding a finding keeps the flat layout");
  await page.screenshot({ path: `${OUT}flat-live-${TAG}-analysis-expanded.png` });

  /* ---- STEP 4: Overlays row (selected accent rule) ---- */
  await page.evaluate(() => document.querySelector('[data-rail-tab="references"]').click());
  await page.waitForTimeout(800);
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC", "base64");
  await page.setInputFiles('input[type="file"][accept*="pdf"]', { name: "zz-flatrail-test.png", mimeType: "image/png", buffer: png });
  let row = null;
  for (let i = 0; i < 20; i++) { await page.waitForTimeout(1000); row = await page.evaluate(() => { const r = document.querySelector('[data-testid^="reference-row-"]:not([data-testid="reference-row-legacy-aerial"])'); return r ? r.getAttribute("data-testid") : null; }); if (row) break; }
  log(!!row, `Overlays: dropped image appears as a row (${row})`);
  if (row) {
    const accentOf = (t) => page.evaluate((id) => { const cs = getComputedStyle(document.querySelector(`[data-testid="${id}"]`)); return cs.borderLeftColor; }, t);
    if (/rgba\(0, 0, 0, 0\)|transparent/.test(await accentOf(row))) { // not selected yet → select it with the row's own name button
      await page.evaluate((t) => document.querySelector(`[data-testid="${t}"] button`)?.click(), row);
    }
    await page.waitForTimeout(700);
    const sel = await page.evaluate((t) => { const r = document.querySelector(`[data-testid="${t}"]`); const cs = getComputedStyle(r); return { left: cs.borderLeftWidth + " " + cs.borderLeftColor, radius: cs.borderTopLeftRadius, bottom: cs.borderBottomWidth, buttons: r.querySelectorAll("button").length }; }, row);
    note("selected row: " + JSON.stringify(sel));
    log(parseFloat(sel.left) > 0 && !/rgba\(0, 0, 0, 0\)|transparent/.test(sel.left) && parseFloat(sel.radius) === 0, "Overlays: selected row shows an accent rule on its left edge, no card radius");
    const ov = await page.evaluate(measure);
    log(ov.cards.length === 0 && ov.closeReachable, "Overlays: no nested card with a real row present");
    await page.screenshot({ path: `${OUT}flat-live-${TAG}-overlays.png` });
    const del = await page.evaluate((t) => { const r = document.querySelector(`[data-testid="${t}"]`); const b = [...r.querySelectorAll("button")].find((x) => /remove|delete|✕|×/i.test((x.getAttribute("aria-label") || "") + (x.title || "") + x.textContent)); if (b) { b.click(); return true; } return false; }, row);
    note("removed overlay row via its own control: " + del);
  }
} catch (e) {
  log(false, "run aborted: " + (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : e));
} finally {
  if (s.errors.length) note("page errors: " + s.errors.slice(0, 3).join(" | "));
  await cleanup();
  await s.close();
}
console.log(`\n${fail === 0 ? "PASS" : "FAIL"} — ${fail} failing check(s) (${TAG}, ${BASE})`);
process.exit(fail === 0 ? 0 : 1);
