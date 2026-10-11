/* NEW-1 / V1620096 — REAL-PANEL live acceptance (clicks the Overlays panel; setup on plan A uses the app's own upload + the crop write). Original data-layer harness: verify-sibling-overlays.mjs.
 * Was: LIVE acceptance for "an overlay added on one plan is available on every sibling plan,
 * hidden until shown". Signed in as the test account on a THROWAWAY site with two plans it creates and deletes:
 *   E2E_LOGIN_KEY=… node ui-audit/verify-sibling-overlays.mjs [https://planyr.io] [<expected commit prefix>]
 * Drives the real upload on plan A; the foreign-row actions go through `window.__plannerForeign` (E2E-gated, the
 * same functions the panel row calls). Touches ONLY zz-sibling-ovl-a / -b and the Storage objects it uploads.
 * Never opens Goose Creek / Bain, never touches overlay aa2d8163-… or plan sms93j3sfc04. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const want = process.argv[3] || "";
const A = "zz-sibling-ovl-a", B = "zz-sibling-ovl-b", NAME = "ZZ sibling overlays verify";
const rec = (id, name) => ({ id, groupId: A, site: NAME, name, origin: { lat: 29.78, lon: -95.82 }, county: "harris",
  parcels: [{ id: "p", active: true, points: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], sheetOverlays: [], updatedAt: Date.now() });

/* a minimal, valid 3-page PDF (xref offsets computed) */
function pdf3() {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R] /Count 3 >>"];
  for (let i = 0; i < 3; i++) objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${6 + i} 0 R >>`);
  for (let i = 0; i < 3; i++) { const t = `0 0 0 rg ${50 + i * 100} 100 200 300 re f`; objs.push(`<< /Length ${t.length} >>\nstream\n${t}\nendstream`); }
  let out = "%PDF-1.4\n"; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

let s, failed = false;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failed = true; };
const uploaded = new Set();
try {
  s = await openSignedIn({ base, initScripts: [[() => { window.__PLANYR_E2E = true; }, null]] });
  const page = s.page;
  console.log("served build:", JSON.stringify(s.build));
  if (want && !JSON.stringify(s.build).includes(want)) throw new Error(`deployed build does not contain ${want} yet`);
  await page.evaluate(async ([a, b, gid]) => {
    const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}");
    for (const r of [a, b]) {
      all[r.id] = r;
      const e = await window.pfSupabase.from("sites").upsert({ id: r.id, group_id: gid, site: r.site, name: r.name, county: "harris", updated_at: new Date().toISOString(), data: r });
      if (e.error) throw new Error("seed " + r.id + ": " + e.error.message);
    }
    localStorage.setItem("planarfit:sites:v1", JSON.stringify(all));
  }, [rec(A, "Concept A"), rec(B, "Concept B"), A]);

  const openPlan = async (id) => {
    await page.evaluate((i) => localStorage.setItem("planarfit:currentSite:v1", i), id);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click().catch(() => {});
    await page.evaluate((i) => { window.location.hash = `#/project/${i}/site`; }, A); // the PROJECT (group) id; the newest plan opens
    for (let k = 0; k < 20; k++) {
      const cur = await page.evaluate(() => window.__plannerForeign && window.__plannerForeign.siteId()).catch(() => null);
      if (cur === id) break;
      await pacedWait(page, 1000);
    }
    await page.getByTestId("planner-canvas").first().waitFor({ state: "visible", timeout: 30000 });
    if ((await page.evaluate(() => window.__plannerForeign && window.__plannerForeign.siteId())) !== id) {
      // the project opened its newest plan: switch through the real plan switcher
      await page.getByTestId("plan-crumb").first().click();
      await page.getByText(id === A ? "Concept A" : "Concept B", { exact: true }).last().click();
      for (let k = 0; k < 20; k++) { if ((await page.evaluate(() => window.__plannerForeign && window.__plannerForeign.siteId()).catch(() => null)) === id) break; await pacedWait(page, 1000); }
    }
    const cur = await page.evaluate(() => window.__plannerForeign && window.__plannerForeign.siteId());
    if (cur !== id) throw new Error(`opened ${cur}, wanted ${id} (switch plans by hand-driving the Sites list)`);
    await pacedWait(page, 1500);
    await assertMeasurable(page, "verify-sibling-overlays");
  };
  const openPanel = async () => {
    await page.evaluate(() => { if (!document.querySelector('[data-testid="overlays-panel"]')) document.querySelector('[data-rail-tab="references"]')?.click(); });
    await page.getByTestId("overlays-panel").waitFor({ state: "visible", timeout: 20000 });
  };
  const foreignRowsUI = () => page.locator('[data-testid="overlays-panel"] [data-foreign="1"]');
  const ownRowsUI = () => page.locator('[data-testid="overlays-panel"] [data-overlay-row]');
  const F = (fn, ...args) => page.evaluate(([f, a]) => (window.__plannerForeign ? window.__plannerForeign[f](...a) : Promise.reject(new Error("hook-null"))), [fn, args]).catch((e) => { if (/hook-null/.test(String(e))) return undefined; throw e; });
  const until = async (fn, what, ms = 40000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out: " + what); await pacedWait(page, 500); } };
  const dbOverlays = (id) => page.evaluate(async (i) => { const r = await window.pfSupabase.from("sites").select("o:data->sheetOverlays").eq("id", i).maybeSingle(); return r.error ? null : (r.data && r.data.o) || []; }, id);
  const readable = (key) => page.evaluate(async (k) => { const r = await window.pfSupabase.storage.from("doc-review-files").createSignedUrl(k, 30); return !r.error; }, key);

  /* ---- plan A: add a PDF (real upload), crop it, and put page 1 + page 3 on the plan ---- */
  await openPlan(A);
  await page.locator('input[type="file"][accept*="pdf"]').first().setInputFiles({ name: "zz-sibling.pdf", mimeType: "application/pdf", buffer: pdf3() });
  const first = await until(async () => ((await F("own")) || []).find((o) => o.storageKey), "overlay uploaded on A");
  uploaded.add(first.storageKey);
  const CROP = { kind: "rect", x: 100, y: 80, w: 500, h: 400 };
  check(await F("crop", first.id, CROP), "A: crop committed through setOverlayCrop");
  await F("duplicate", first.id);
  const ownA = await until(async () => { const o = await F("own"); return o.length === 2 ? o : null; }, "duplicate on A");
  const dup = ownA.find((o) => o.id !== first.id);
  await F("setPage", dup.id, 3);
  await until(async () => { const d = await dbOverlays(A); return d && d.length === 2 && d.some((o) => (o.page || 1) === 3) && d.every((o) => o.storageKey) ? d : null; }, "A's two overlays pushed to the cloud");
  const aSnap = JSON.stringify(await dbOverlays(A));

  /* ---- plan B: listed hidden, not drawn ---- */
  await openPlan(B);
  await until(async () => (await F("status")) !== undefined, "planner hook present on B", 30000).catch(async (e) => { console.log("URL:", page.url(), "canvas:", await page.getByTestId("planner-canvas").count(), "body:", (await page.locator("body").innerText()).slice(0, 300).replace(/\n/g, " | ")); await page.screenshot({ path: "/tmp/claude-0/sib-fail.png" }); throw e; });
  console.log("B status before wait:", JSON.stringify(await F("status")), "A in db:", (await dbOverlays(A) || []).length, "B grp:", JSON.stringify(await page.evaluate(() => { try { const o = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); return o["zz-sibling-ovl-b"] && o["zz-sibling-ovl-b"].groupId; } catch (e) { return String(e); } })));
  await openPanel();
  await until(async () => (await foreignRowsUI().count()) >= 2, "foreign rows render in the real panel");
  const r1 = (await F("rows")) || [];
  check((await foreignRowsUI().locator('[data-testid="overlay-row-sub"]').allInnerTexts()).every((t) => /added on Concept A/i.test(t)), "panel sub-line reads 'added on Concept A' on every foreign row");
  check(r1.length === 2, `B lists TWO foreign rows for the page-1 and page-3 overlays (got ${r1.length})`);
  check(r1.every((r) => /Concept A/.test(r.planName)), "each row says it was added on Concept A");
  check(((await F("own")) || [null]).length === 0, "B's own overlay list is empty — nothing auto-overlays");
  check(await page.locator("[data-overlay-id], [data-overlay]").count() === 0, "B's map draws no overlay");

  /* ---- show: copy lands lined up + cropped; survives reload; edits do not propagate ---- */
  const row1 = r1.find((r) => r.page === 1);
  const eye = page.locator(`[data-testid="reference-eye-foreign:${row1.key}"]`);
  check(await eye.count() === 1, "the page-1 foreign row has its eye in the real panel");
  await eye.click();
  const copy = await until(async () => ((await F("own")) || []).find((o) => o.sharedFrom), "copy on B");
  check(copy.id !== first.id && copy.sharedFrom.siteId === A && copy.sharedFrom.overlayId === first.id, "copy has a fresh id, stamped sharedFrom A");
  check(JSON.stringify(copy.crop && { x: copy.crop.x, y: copy.crop.y, w: copy.crop.w, h: copy.crop.h }) === JSON.stringify({ x: CROP.x, y: CROP.y, w: CROP.w, h: CROP.h }), "copy arrives cropped as on A");
  check(copy.idbKey === null || copy.idbKey === undefined, "copy carries no device-cache key from A");
  check(Math.abs(copy.x - first.x) < 1 && Math.abs(copy.y - first.y) < 1, "copy lands where it sits on A (same origin)");
  await until(async () => ((await F("own")) || []).find((o) => o.sharedFrom && o.hasSrc), "copy hydrates its picture from the stored file");
  check(await page.locator(`[data-testid="reference-row-foreign:${row1.key}"]`).count() === 0, "the shown row leaves the foreign list in the panel");
  check(await ownRowsUI().count() === 1, "the panel now lists the copy as B's own row");
  await until(async () => { const d = await dbOverlays(B); return d && d.some((o) => o.sharedFrom) ? d : null; }, "B's copy pushed to the cloud");
  await openPlan(B); // reload B
  await until(async () => ((await F("own")) || []).find((o) => o.sharedFrom), "copy still there after reload");
  check(true, "B: still there after reload");
  const edited = { kind: "rect", x: 150, y: 120, w: 300, h: 250 };
  await F("crop", ((await F("own")) || []).find((o) => o.sharedFrom).id, edited);
  await pacedWait(page, 4000);
  check(JSON.stringify(await dbOverlays(A)) === aSnap, "edit on B left A's stored overlays byte-identical");

  /* ---- remove on B: this plan only, back as a foreign row, undo restores ---- */
  const bId = ((await F("own")) || []).find((o) => o.sharedFrom).id;
  await openPanel();
  await page.locator(`[data-testid="reference-more-${bId}"]`).click();
  await page.getByRole("menuitem", { name: /remove overlay/i }).click();
  await until(async () => ((await F("own")) || [null]).length === 0, "removed from B");
  await until(async () => (await page.locator(`[data-testid="reference-row-foreign:${row1.key}"]`).count()) === 1, "row returns in the panel after remove");
  check(true, "removed overlay is back as a hidden foreign row in the real panel");
  let toastSeen = false, lastText = "";
  for (let k = 0; k < 14 && !toastSeen; k++) { lastText = await page.locator("body").innerText(); toastSeen = /Still on Concept A/.test(lastText); if (!toastSeen) await pacedWait(page, 500); }
  check(toastSeen, "toast names the sibling that still holds it" + (toastSeen ? "" : " — saw: " + (lastText.match(/Removed[^\n]{0,80}/) || ["no 'Removed…' text"])[0]));
  check(JSON.stringify(await dbOverlays(A)) === aSnap, "A unaffected by B's remove");
  check(await readable(first.storageKey), "stored object kept (A still references it)");
  await page.locator('[data-testid="planner-canvas"]').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("Control+z");
  await until(async () => ((await F("own")) || []).find((o) => o.sharedFrom), "undo restores the copy on B");
  check(true, "undo on B restores the overlay");

  /* ---- bytes released only after NOTHING references them ---- */
  await openPlan(A);
  await openPanel();
  const removeViaPanel = async (id) => { await page.locator(`[data-testid="reference-more-${id}"]`).click(); await page.getByRole("menuitem", { name: /remove overlay/i }).click(); };
  for (const o of await F("own")) { await removeViaPanel(o.id); await until(async () => !((await F("own")) || []).some((x) => x.id === o.id), "A removal " + o.id); }
  await pacedWait(page, 4000);
  check(await readable(first.storageKey), "after removing everything on A, the object is KEPT (B's copy still references it)");
  await openPlan(B);
  await openPanel();
  await removeViaPanel(((await F("own")) || []).find((o) => o.sharedFrom).id);
  await until(async () => !(await readable(first.storageKey)), "object released once nothing references it (30 s undo grace)", 100000);
  check(true, "object released after the last holder let go");
  await F("refresh");
  await F("refresh");
  check((await foreignRowsUI().count()) === 0, "nothing is offered on B's panel any more");
} catch (e) { console.error("ERROR", e.message); failed = true; }
finally {
  if (s) {
    try {
      await pacedWait(s.page, 6000); // let any in-flight autosave land first, or it re-creates the row we delete
      const gone = await s.page.evaluate(async ([ids, keys]) => {
        const out = {};
        for (let pass = 0; pass < 3; pass++) for (const id of ids) {
          await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
          await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
          await window.pfSupabase.from("sites").delete().eq("id", id);
          await new Promise((r) => setTimeout(r, 1500));
        }
        if (keys.length) { const r = await window.pfSupabase.storage.from("doc-review-files").remove(keys); out.storage = r.error ? String(r.error.message) : "removed"; }
        for (const k of ["planarfit:sites:v1", "planarfit:sites:history:v1"]) { try { const o = JSON.parse(localStorage.getItem(k) || "{}"); ids.forEach((i) => delete o[i]); localStorage.setItem(k, JSON.stringify(o)); } catch (_) {} }
        localStorage.removeItem("planarfit:currentSite:v1");
        const left = await window.pfSupabase.from("sites").select("id").in("id", ids);
        out.remaining = (left.data || []).length;
        return out;
      }, [[A, B], [...uploaded]]);
      console.log("cleanup:", JSON.stringify(gone));
      if (gone.remaining !== 0) failed = true;
    } catch (e) { console.error("cleanup ERROR", e.message); failed = true; }
    await s.close();
  }
}
process.exit(failed ? 1 : 0);
