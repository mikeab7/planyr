/* verify-print-aerial-follows-map-live — B2589680 + B2589681 (V2038736): the Print / Compose panel has NO Aerial row (the exhibit
 * prints the aerial exactly when the map is showing it), and its two "Sheet" cards (Site summary strip, Buildings table) look identical.
 *
 *   node ui-audit/verify-print-aerial-follows-map-live.mjs --live [--base https://planyr.io] [--expect-sha <merge commit>]
 *
 * Signs in as the test account (ui-audit/lib/signedInSession.mjs), writes TWO throwaway LOCATED plans (one with the aerial showing,
 * one with it hidden — `settings.aerialHidden`, exactly what the map's own View/Overlays toggle persists), each with one building so
 * the Buildings table card is offered; for each it opens File ▾ → Download PDF / pick frame… → Continue ➜, reads the panel, clicks
 * Download PDF and rasterises the real downloaded file. Both plans are deleted (and verified gone) in `finally` (constraint #15).
 *
 * THE PDF PROOF is pixels, not strings: the page picture is rasterised with pdftoppm and the share of non-paper pixels in the PLAN
 * area is measured. Aerial imagery covers the plan area (≥ 0.5 of it); an aerial-less sheet is paper with a few drawn lines (< 0.2).
 * KNOWN-GOOD ARM (CLAUDE.md DRIVER-SCROLL §6): the aerial-showing PDF must read "photographic" and the aerial-hidden one "paper" — if
 * the showing one does not (e.g. imagery unreachable from this network) the run is VOID, never scored green. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { openSignedIn } from "./lib/signedInSession.mjs";

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : d; };
if (!process.argv.includes("--live")) { console.error("this check is live-only: pass --live"); process.exit(2); }
const base = (arg("--base", "https://planyr.io")).replace(/\/?$/, "/");
const expectSha = arg("--expect-sha", null);
const RUN = Math.random().toString(36).slice(2, 6);
const RECT = [[-900, -700], [900, -700], [900, 700], [-900, 700]].map(([x, y]) => ({ x, y }));
const mk = (suffix, settings) => {
  const id = `zz-printpa-${suffix}-${RUN}`; // NB: no "aerial" in the plan name — the title block prints it and the panel is searched for that word
  return {
    id, groupId: id, site: `zz print pa-${suffix} ${RUN}`, name: "Concept A", origin: { lat: 33.2458963792457, lon: -84.16362918465775 }, county: "ga_spalding",
    parcels: [{ id: "pc1", active: true, locked: false, points: RECT, setbacks: RECT.map(() => 25) }],
    els: [{ id: "b1", type: "building", cx: 0, cy: 0, w: 500, h: 300, rot: 0, dock: "cross" }],
    measures: [], callouts: [], markups: [], settings: { setback: 25, ...settings }, underlay: null, updatedAt: Date.now(), status: "active",
  };
};
const SITES = { showing: mk("on", {}), hidden: mk("off", { aerialHidden: true }) };

const fail = [], ok = [];
const check = (cond, pass, bad) => (cond ? ok.push(pass) : fail.push(bad || pass));
let page, closeAll, served = null;
const work = mkdtempSync(join(tmpdir(), "print-aerial-"));

/* share of non-paper pixels in the central plan area of page 1 of a PDF (white / near-white = paper). */
function planInk(pdfPath, tag) {
  const prefix = join(work, tag);
  execFileSync("pdftoppm", ["-r", "50", "-png", "-f", "1", "-l", "1", pdfPath, prefix]);
  const png = join(work, readdirSync(work).find((f) => f.startsWith(tag) && f.endsWith(".png")));
  const out = execFileSync("python3", ["-I", "-c", `
import sys
from PIL import Image
import numpy as np
im = np.asarray(Image.open(sys.argv[1]).convert("RGB")).astype(int)
h, w, _ = im.shape
a = im[int(h*0.18):int(h*0.62), int(w*0.18):int(w*0.82)]
nonpaper = ((a < 235).any(axis=2)).mean()
# photographic = colour spread (aerial is green/brown/grey; paper+lines is white and thin dark strokes)
spread = (a.max(axis=2) - a.min(axis=2)).mean()
print(f"{nonpaper:.4f} {spread:.2f}")
`, png]).toString().trim().split(" ").map(Number);
  return { nonpaper: out[0], spread: out[1], png };
}

async function driveOne(label, site) {
  await page.goto(`${base}#/project/${site.id}/site`, { waitUntil: "load" });
  await page.reload({ waitUntil: "load" });
  await page.getByTestId("planner-canvas").waitFor({ timeout: 60000 });
  await page.waitForTimeout(5000); // let the basemap tiles (or their absence) settle before print snapshots the map
  await page.getByRole("button", { name: /^File/ }).filter({ visible: true }).first().click();
  await page.getByRole("button", { name: /Download PDF \/ pick frame/ }).first().click();
  await page.waitForFunction(() => /PRINT FRAME/i.test(document.body.innerText), null, { timeout: 20000 });
  await page.getByRole("button", { name: /^Continue ➜$/ }).first().click();
  await page.waitForSelector('[data-testid="print-compose"]', { timeout: 20000 });
  const panel = page.locator('[data-testid="print-compose"]');

  // the panel: other rows present (known-good), no Aerial anywhere
  const text = await panel.innerText();
  check(/Dimensions/.test(text) && /Square feet labels/.test(text), `${label}: known-good — the panel's other "On the plan" rows render`);
  check(!/aerial/i.test(text) && !(await panel.getByLabel(/aerial/i).count()), `${label}: the compose panel has no Aerial row`, `${label}: an Aerial control is still in the panel`);

  // the two Sheet cards: identical computed border + background
  const cards = await panel.evaluate((root) => ["Site summary strip", "Buildings table"].map((t) => {
    const lab = [...root.querySelectorAll("label")].find((l) => l.querySelector("input[type=checkbox]") && l.textContent.trim().startsWith(t));
    if (!lab) return null;
    const cs = getComputedStyle(lab);
    return { t, border: `${cs.borderTopWidth} ${cs.borderTopStyle} ${cs.borderTopColor}`, bg: cs.backgroundColor, bgImage: cs.backgroundImage };
  }));
  check(cards.every(Boolean), `${label}: both Sheet cards are present`, `${label}: a Sheet card is missing ${JSON.stringify(cards)}`);
  if (cards.every(Boolean)) {
    check(cards[0].border === cards[1].border, `${label}: both cards have the same border (${cards[0].border})`, `${label}: card borders differ: ${cards[0].border} vs ${cards[1].border}`);
    check(cards[0].bg === cards[1].bg && cards[0].bgImage === cards[1].bgImage, `${label}: both cards have the same background (${cards[0].bg})`, `${label}: card backgrounds differ: ${cards[0].bg} vs ${cards[1].bg}`);
  }
  if (label === "showing") await panel.screenshot({ path: join(work, "panel.png") }).catch(() => {});

  // download the real PDF
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 120000 }), panel.getByRole("button", { name: "Download PDF", exact: true }).click({ timeout: 8000 })]);
  const pdf = join(work, `${label}.pdf`);
  await dl.saveAs(pdf);
  return planInk(pdf, label);
}

try {
  const s = await openSignedIn({ base: base.replace(/\/$/, ""), viewport: { width: 1600, height: 900 } });
  page = s.page; closeAll = () => s.close();
  await assertMeasurable(page, "verify-print-aerial-follows-map-live");
  served = await page.evaluate(() => fetch("/version.json", { cache: "no-store" }).then((r) => r.json()).then((j) => j.build).catch(() => null));
  console.log("signed in as", s.proof.email, "| served build", served);
  if (expectSha) check(String(served || "").startsWith(expectSha.slice(0, 7)), `served build ${served} matches the merge commit ${expectSha.slice(0, 7)}`, `served build ${served} does NOT match ${expectSha}`);
  for (const site of Object.values(SITES)) {
    const err = await page.evaluate(async (row0) => {
      const { data: u } = await window.pfSupabase.auth.getUser();
      const r = await window.pfSupabase.from("sites").insert({ id: row0.id, group_id: row0.groupId, site: row0.site, name: row0.name, county: row0.county, updated_at: new Date().toISOString(), data: row0, user_id: u.user.id });
      return r.error ? String(r.error.message) : null;
    }, site);
    if (err) throw new Error("throwaway site insert failed: " + err);
  }

  const showing = await driveOne("showing", SITES.showing);
  console.log("showing PDF:", JSON.stringify(showing));
  // cancel any leftover print state by reloading in the next navigation
  const hidden = await driveOne("hidden", SITES.hidden);
  console.log("hidden PDF:", JSON.stringify(hidden));

  if (!(showing.nonpaper >= 0.5)) throw new Error(`VOID — the aerial-showing PDF did not read photographic (non-paper share ${showing.nonpaper}); imagery may be unreachable from this network, so nothing below proves the omit arm`);
  ok.push(`known-good arm: aerial showing on the map → the PDF plan area is photographic (non-paper share ${showing.nonpaper}, colour spread ${showing.spread})`);
  check(hidden.nonpaper < 0.2, `aerial hidden on the map → the PDF plan area is paper (non-paper share ${hidden.nonpaper}, colour spread ${hidden.spread})`, `aerial hidden on the map but the PDF still has imagery (non-paper share ${hidden.nonpaper})`);
  console.log("artifacts:", work);
} catch (e) {
  fail.push(String(e && e.stack ? e.stack : e).split("\n").slice(0, 3).join(" | "));
} finally {
  if (page) {
    try {
      const left = await page.evaluate(async (ids) => {
        let n = 0;
        for (const id of ids) {
          await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
          await window.pfSupabase.from("sites").delete().eq("id", id);
          const q = await window.pfSupabase.from("sites").select("id").eq("id", id);
          n += q.error ? 1000 : (q.data || []).length;
          for (const k of Object.keys(localStorage)) { if ((localStorage.getItem(k) || "").includes(id)) localStorage.removeItem(k); }
        }
        return n;
      }, Object.values(SITES).map((x) => x.id));
      console.log(`cleanup: throwaway plans left in the cloud = ${left}`);
      if (left !== 0) fail.push("cleanup left a throwaway plan behind");
    } catch (e) { console.log("cleanup FAILED", String(e).slice(0, 200)); fail.push("cleanup failed"); }
  }
  await closeAll?.().catch(() => {});
}

console.log("B2589680 + B2589681 — print panel: no Aerial row, identical Sheet cards" + (served ? ` (build ${served})` : "") + "\n");
for (const m of ok) console.log("  ✓", m);
for (const m of fail) console.log("  ✗", m);
console.log(fail.length ? "\n✗ FAIL" : "\n✓ PASS");
process.exit(fail.length ? 1 : 0);
