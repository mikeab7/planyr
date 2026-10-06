#!/usr/bin/env node
/* Live signed-in pass for B2127664 / V1544944 steps 1–2 on the test account: draws a polygon, a callout and a
 * length measurement on the fixture plan, exports with "Flatten markups" OFF then ON through the real compose
 * screen, checks annotation counts + the toggle's memory, then deletes what it drew (and confirms after reload).
 *   E2E_LOGIN_KEY=… node ui-audit/verify-pdf-markup-annotations-live.mjs [https://planyr.io] */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { pacedWait } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const ID = "zz-pdfann-" + Math.random().toString(36).slice(2, 8);
const SITE = {
  id: ID, groupId: ID, site: "zz PDF markup check", name: "Plan 1", origin: { lat: 29.86, lon: -95.17 }, county: "harris",
  parcels: [{ id: "pc1", active: true, locked: false, points: [{ x: -500, y: -500 }, { x: 500, y: -500 }, { x: 500, y: 500 }, { x: -500, y: 500 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now(), data: { status: "active" }, status: "active",
};
const s = await openSignedIn({ base });
const { page } = s;
await assertMeasurable(page, "verify-pdf-markup-annotations-live");
let pass = 0, fail = 0;
const check = (c, m) => { console.log(`${c ? "  ✓" : "  ✗"} ${m}`); c ? pass++ : fail++; };
page.on("dialog", (d) => { console.log("  dialog:", d.message()); d.dismiss().catch(() => {}); });
  const ins = await page.evaluate(async (site) => {
  const { data: u } = await window.pfSupabase.auth.getUser();
  const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
  let r = await window.pfSupabase.from("sites").insert(row);
  if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
  return r.error ? String(r.error.message) : null;
}, SITE);
  check(!ins, "throwaway plan written to the test account" + (ins ? " — " + ins : ""));
await page.goto(`${base}/#/project/${ID}/site`, { waitUntil: "load" });
await page.reload({ waitUntil: "load" });
const canvas = page.getByTestId("planner-canvas");
await canvas.waitFor({ state: "visible", timeout: 60000 });
await pacedWait(page, 2500);
await page.evaluate(() => {
  window.__pdfs = [];
  const real = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (b) => { if (b && b.type === "application/pdf") b.arrayBuffer().then((ab) => { let t = ""; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) t += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); window.__pdfs.push(btoa(t)); }); return real(b); };
  const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) return; return click.call(this); };
});
const keys = () => page.evaluate(() => [...document.querySelectorAll('[data-testid="planner-canvas"] [data-feature]')].map((n) => n.getAttribute("data-feature")));
const before = new Set(await keys());
console.log("build:", JSON.stringify(s.build), "| features before:", before.size);
const box = await canvas.boundingBox();
const P = (fx, fy) => [box.x + box.width * fx, box.y + box.height * fy];
await page.keyboard.press("Shift+P");
for (const [fx, fy] of [[0.30, 0.30], [0.46, 0.30], [0.46, 0.46]]) { await page.mouse.click(...P(fx, fy)); await page.waitForTimeout(100); }
await page.mouse.dblclick(...P(0.30, 0.46)); await page.waitForTimeout(600);
await page.getByRole("button", { name: /^Select V$/ }).click();
await page.getByRole("button", { name: "Measure modes" }).click();
await page.getByRole("button", { name: "Length", exact: true }).click();
await page.mouse.click(...P(0.30, 0.62)); await page.mouse.click(...P(0.46, 0.62)); await page.waitForTimeout(600);
await page.getByRole("button", { name: /^Select V$/ }).click();
await page.keyboard.press("q");
await page.mouse.click(...P(0.60, 0.62)); await page.mouse.click(...P(0.72, 0.70));
await page.keyboard.type("Live check callout"); await page.keyboard.press("Escape"); await page.waitForTimeout(600);
await page.getByRole("button", { name: /^Select V$/ }).click();
const mine = (await keys()).filter((k) => !before.has(k));
console.log("drawn:", mine.join(", "));
check(mine.some((k) => k.startsWith("markup:")) && mine.some((k) => k.startsWith("measure:")) && mine.some((k) => k.startsWith("callout:")), "a markup, a measurement and a callout were drawn on the test plan");

async function compose() {
  await page.getByRole("button", { name: "File ▾" }).click();
  await page.getByRole("button", { name: "Download PDF / pick frame…" }).click();
  await pacedWait(page, 600);
  await page.getByRole("button", { name: "Continue ➜" }).click();
  await pacedWait(page, 1500);
}
async function exportPdf(flatten) {
  await compose();
  const box = page.getByLabel("Flatten markups");
  if ((await box.isChecked()) !== flatten) await box.click();
  const n = await page.evaluate(() => window.__pdfs.length);
  await page.getByRole("button", { name: /Download PDF/ }).first().click();
  let pdfs; for (let i = 0; i < 200; i++) { pdfs = await page.evaluate(() => window.__pdfs); if (pdfs.length > n) break; await page.waitForTimeout(250); }
  if (pdfs.length <= n) throw new Error("no PDF produced");
  await pacedWait(page, 800);
  return Buffer.from(pdfs[pdfs.length - 1], "base64").toString("latin1");
}
try {
  await compose();
  check(!(await page.getByLabel("Flatten markups").isChecked()), "Flatten markups starts UNCHECKED");
  await page.getByRole("button", { name: "Cancel" }).click(); await pacedWait(page, 500);
  const off = await exportPdf(false);
  const offAnnots = (off.match(/\/Type \/Annot /g) || []).length;
  check(offAnnots >= 3, `toggle OFF: PDF carries ${offAnnots} native annotations (≥3 drawn)`);
  check(/\/Subtype \/FreeText/.test(off) && (/\/Subtype \/Polygon/.test(off)) && /\/Subtype \/Line/.test(off), "FreeText callout, Polygon and Line subtypes present");
  check(!/\/F (64|128|192) /.test(off), "no annotation is ReadOnly/Locked");
  await compose();
  check(!(await page.getByLabel("Flatten markups").isChecked()), "toggle remembers OFF after reopen");
  await page.getByRole("button", { name: "Cancel" }).click(); await pacedWait(page, 500);
  const on = await exportPdf(true);
  check(!/\/Annots/.test(on), "toggle ON: PDF has zero annotations");
  await compose();
  check(await page.getByLabel("Flatten markups").isChecked(), "toggle remembers ON after reopen");
  await page.getByLabel("Flatten markups").click(); // back to the default
  await page.getByRole("button", { name: "Cancel" }).click(); await pacedWait(page, 500);
} finally {
  const gone = await page.evaluate(async (id) => {
    try {
      const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); delete all[id]; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all));
      if (window.pfSupabase) { await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id); await window.pfSupabase.from("sites").delete().eq("id", id); } // the table refuses a hard delete until the row is in the trash
      const q = window.pfSupabase ? await window.pfSupabase.from("sites").select("id").eq("id", id) : { data: [] };
      return { local: !JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}")[id], cloud: !(q.data && q.data.length) };
    } catch (e) { return { error: String(e) }; }
  }, ID).catch((e) => ({ error: String(e) }));
  check(!!gone.local && !!gone.cloud, "throwaway plan deleted (local + cloud) and verified gone " + JSON.stringify(gone));
}
console.log(`\n${pass} passed, ${fail} failed | served build ${JSON.stringify(s.build)}`);
await s.close();
process.exit(fail ? 1 : 0);
