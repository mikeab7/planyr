#!/usr/bin/env node
/* verify-print-scale-bar-live — B2671281 / V2671271 (NEW-1, 2026-11-13): the Print panel's "Scale bar" checkbox, driven through the
 * REAL flow on a deploy: File ▾ → Download PDF / pick frame… → Continue ➜ → Exhibit settings → (un)tick "Scale bar" → Download PDF.
 *
 *   E2E_LOGIN_KEY=… node ui-audit/verify-print-scale-bar-live.mjs https://planyr.io
 *
 * Signed in as the test account on a THROWAWAY plan (written, used, deleted — owner constraints 7 + 15). Reads `/version.json` in the
 * same call as the first assertion. For each of ticked / unticked it checks, on the real panel:
 *   · the "Scale bar" row sits in "On the plan" and is ticked by default (a plan with no saved key);
 *   · the LIVE PREVIEW (the sheet SVG the PDF rasterizes — one string, PDF-PARITY) has / lacks the scale-bar plate, its FEET label and
 *     the stated scale in the title block, while the north arrow and Buildings table stay;
 *   · the downloaded file (Flatten markups OFF, the editable PDF) has / lacks the "Scale bar" Stamp, always has the north arrow and
 *     Buildings table Stamps, and ALWAYS carries the page's embedded measurement scale (/Type /Viewport … /Measure);
 *   · Flatten markups ON: no annotations, and the preview (= the page picture) follows the same rule.
 * A known-good arm: the TICKED preview must show the bar, or the run is VOID (an "absent" reading would mean nothing).
 */
import { readFileSync } from "node:fs";
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const base = process.argv.slice(2).find((a) => /^https?:/.test(a)) || "https://planyr.io";
const FIX = JSON.parse(readFileSync(new URL("./fixtures/goose-creek-plan1copy.json", import.meta.url), "utf8"));
const ID = "zz-scalebar-" + Math.random().toString(36).slice(2, 8);
const bld = FIX.els.find((e) => e.type === "building");
const rec = {
  id: ID, groupId: ID, site: "ZZ scale bar live", name: "ZZ scale bar live", origin: null, county: "harris",
  parcels: FIX.parcels, els: FIX.els, markups: [], callouts: [], settings: FIX.settings || {}, underlay: null, parcelDrawings: [], updatedAt: Date.now(),
  measures: [{ id: "meScaleBar", mode: "area", z: 900005, pts: [[-60, -60], [60, -60], [60, 40], [-60, 40]].map(([x, y]) => ({ x: bld.cx + x, y: bld.cy + y - bld.h })) }],
};

let pass = 0, fail = 0, void_ = false;
const check = (c, m) => { console.log(`${c ? "  ✓" : "  ✗"} ${m}`); c ? pass++ : fail++; };
const HOOK = () => {
  window.__pdfs = [];
  const real = URL.createObjectURL.bind(URL);
  const b64 = (ab) => { let s = ""; const u = new Uint8Array(ab); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
  URL.createObjectURL = (b) => { try { if (b && b.type === "application/pdf") b.arrayBuffer().then((ab) => window.__pdfs.push(b64(ab))); } catch (_) {} return real(b); };
  const click = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (this.download) return; return click.call(this); };
};

const s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
const page = s.page;
let KEY = null;
try {
  await assertMeasurable(page, "verify-print-scale-bar-live");
  const served = await page.evaluate(() => fetch("/version.json").then((r) => r.json()));
  console.log("served build:", JSON.stringify(served), "| harness-reported:", JSON.stringify(s.build));
  const err = await page.evaluate(async (site) => {
    const { data: u } = await window.pfSupabase.auth.getUser();
    const row = { id: site.id, group_id: site.groupId, site: site.site, name: site.name, county: site.county || null, updated_at: new Date().toISOString(), data: site, user_id: u.user.id };
    await window.pfSupabase.from("sites").delete().eq("id", site.id);
    let r = await window.pfSupabase.from("sites").insert(row);
    if (r.error && /user_id/.test(String(r.error.message))) { delete row.user_id; r = await window.pfSupabase.from("sites").insert(row); }
    return r.error ? String(r.error.message) : null;
  }, rec);
  check(!err, `throwaway plan written to the test account${err ? " — " + err : ""}`);
  await page.goto(`${base}/#/project/${ID}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ state: "visible", timeout: 90000 });
  await pacedWait(page, 3500);
  await page.evaluate(HOOK);

  // enter the real print flow once; the panel stays open across the ticks
  await page.getByRole("button", { name: "File ▾" }).click();
  await page.getByRole("button", { name: "Download PDF / pick frame…" }).click();
  await pacedWait(page, 600);
  await page.getByRole("button", { name: "Continue ➜" }).click();
  await pacedWait(page, 1500);
  await page.locator('select[aria-label="Scale"]').selectOption("1000");

  const section = page.getByRole("button", { name: "On the plan" }).locator("xpath=ancestor::div[1]");
  const row = page.getByLabel("Scale bar", { exact: true });
  check(await row.count() === 1, '"Scale bar" row is on the panel');
  check(await section.getByLabel("Scale bar", { exact: true }).count() === 1, '…inside the "On the plan" section');
  check(await row.isChecked(), "…and ticked by default (this plan has no saved value)");

  const previewSvg = async (wantBar) => {
    for (let i = 0; i < 80; i++) {
      const svg = await page.evaluate(async () => { const im = document.querySelector('img[alt="Sheet preview"]'); return im ? await (await fetch(im.src)).text() : ""; });
      const has = svg.includes('data-furniture-kind="scale-bar"');
      // a ticked read waits for the stated scale too: choosing the scale re-builds the sheet a beat after the bar is already there
      if (svg && has === wantBar && (!wantBar || STATED.test(svg))) return svg;
      await page.waitForTimeout(250);
    }
    return await page.evaluate(async () => { const im = document.querySelector('img[alt="Sheet preview"]'); return im ? await (await fetch(im.src)).text() : ""; });
  };
  const download = async (flatten) => {
    const f = page.getByLabel("Flatten markups");
    if ((await f.isChecked()) !== flatten) await f.click();
    const before = await page.evaluate(() => window.__pdfs.length);
    await page.getByRole("button", { name: /Download PDF/ }).first().click();
    let pdfs = [];
    for (let i = 0; i < 240; i++) { pdfs = await page.evaluate(() => window.__pdfs); if (pdfs.length > before) break; await page.waitForTimeout(250); }
    if (pdfs.length <= before) throw new Error("no PDF was produced");
    await pacedWait(page, 800);
    // downloading ends the print session (cancelPrint) — re-enter it at the same settings for the next arm
    await page.getByRole("button", { name: "File ▾" }).click();
    await page.getByRole("button", { name: "Download PDF / pick frame…" }).click();
    await pacedWait(page, 600);
    await page.getByRole("button", { name: "Continue ➜" }).click();
    await pacedWait(page, 1500);
    await page.locator('select[aria-label="Scale"]').selectOption("1000");
    return Buffer.from(pdfs[pdfs.length - 1], "base64").toString("latin1");
  };
  const stamps = (pdf) => [...pdf.matchAll(/\/Subj \(([^)]*)\)/g)].map((m) => m[1]);
  const viewport = (pdf) => /\/Type \/Viewport/.test(pdf) && /\/Measure/.test(pdf);
  const STATED = /1&quot; = 1000'/; // the framed area is ~7,100 ft wide: 1" = 100' does not fit a Letter sheet (Download is disabled and nothing prints) — 1" = 1000' does

  // ---- TICKED: today's sheet --------------------------------------------------
  const on = await previewSvg(true);
  if (!on.includes('data-furniture-kind="scale-bar"') || !STATED.test(on)) { void_ = true; console.log("  ✗ VOID: the ticked preview does not show the bar / stated scale — an absent reading below would prove nothing"); }
  check(on.includes(">FEET<") && STATED.test(on), "TICKED preview: scale bar (FEET) and the stated scale are on the sheet");
  check(on.includes('data-furniture-kind="north-arrow"') && on.includes('data-furniture-kind="buildings-table"'), "TICKED preview: north arrow and Buildings table are on the sheet");
  const pdfOn = await download(false);
  check(stamps(pdfOn).includes("Scale bar"), 'TICKED download (editable): the "Scale bar" Stamp is in the file');
  check(viewport(pdfOn), "TICKED download: the page carries its embedded measurement scale");

  // ---- UNTICKED ---------------------------------------------------------------
  await row.click();
  check(!(await row.isChecked()), 'unticked the "Scale bar" box');
  const off = await previewSvg(false);
  check(!off.includes('data-furniture-kind="scale-bar"') && !off.includes(">FEET<"), "UNTICKED preview: no scale bar (and no FEET label)");
  check(!STATED.test(off), "UNTICKED preview: the stated scale is gone from the title block");
  check(off.includes('data-furniture-kind="north-arrow"') && off.includes('data-furniture-kind="buildings-table"'), "UNTICKED preview: north arrow and Buildings table are still there");
  const pdfOff = await download(false);
  const so = stamps(pdfOff);
  check(!so.includes("Scale bar"), 'UNTICKED download (editable): NO "Scale bar" Stamp');
  check(so.includes("North arrow") && so.includes("Buildings table"), "UNTICKED download: the North arrow and Buildings table Stamps are still in the file");
  check(viewport(pdfOff), "UNTICKED download: the page STILL carries its embedded measurement scale (/VP + /Measure)");
  // the flow re-opened the panel — the box must read as unticked still (the choice is remembered), then Flatten ON
  check(!(await page.getByLabel("Scale bar", { exact: true }).isChecked()), "the unticked choice survived re-opening the panel");
  const pdfFlat = await download(true);
  check(!/\/Subtype \/Stamp/.test(pdfFlat), "UNTICKED + Flatten markups ON: no annotations in the file (everything is the page picture)");
  const offFlat = await previewSvg(false);
  check(!offFlat.includes('data-furniture-kind="scale-bar"') && !STATED.test(offFlat), "UNTICKED + Flatten ON: the page picture (preview) has no scale bar and no stated scale");

  // ---- RE-TICKED: back to today's sheet ----------------------------------------
  await page.getByLabel("Scale bar", { exact: true }).click();
  const back = await previewSvg(true);
  check(back.includes('data-furniture-kind="scale-bar"') && back.includes(">FEET<") && STATED.test(back), "RE-TICKED preview: the bar and stated scale are back");
  KEY = true;
} catch (e) { fail++; console.error("ERROR", e.message); }
finally {
  try {
    const left = await page.evaluate(async (id) => {
      const sb = window.pfSupabase;
      await sb.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
      await sb.from("sites").delete().eq("id", id);
      return (await sb.from("sites").select("id").eq("id", id)).data;
    }, ID);
    console.log("throwaway cleared:", JSON.stringify(left) === "[]");
  } catch (e) { console.error("cleanup", e.message); }
  await s.close();
}
console.log(`\n${pass} passed, ${fail} failed${void_ ? " — RUN IS VOID (known-good arm failed)" : ""}`);
process.exit(fail === 0 && !void_ && KEY ? 0 : 1);
