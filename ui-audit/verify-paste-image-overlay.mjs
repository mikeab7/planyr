/* NEW-1 / V1626976 — LIVE acceptance for "Ctrl+V a clipboard image adds it as an overlay". Signed in as the test
 * account on a THROWAWAY site with two plans it creates and deletes:
 *   E2E_LOGIN_KEY=… node ui-audit/verify-paste-image-overlay.mjs [https://planyr.io] [<expected commit prefix>]
 * Delivers a real ClipboardEvent('paste') carrying a PNG after a real click on the map; touches ONLY zz-paste-ovl-a/-b
 * and the Storage object it uploads. Never opens Goose Creek / Bain. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const want = process.argv[3] || "";
const A = "zz-paste-ovl-a", B = "zz-paste-ovl-b", NAME = "ZZ paste overlay verify";
const rec = (id, name, age = 0) => ({ id, groupId: A, site: NAME, name, origin: { lat: 29.78, lon: -95.82 }, county: "harris",
  parcels: [{ id: "p", active: true, points: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], sheetOverlays: [], updatedAt: Date.now() - age });

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
  }, [rec(A, "Concept A"), rec(B, "Concept B", 120000), A]);

  const openPlan = async (id) => {
    await page.evaluate((i) => localStorage.setItem("planarfit:currentSite:v1", i), id);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click().catch(() => {});
    for (let k = 0; k < 4; k++) {
      const cur = await page.evaluate(() => window.__plannerForeign && window.__plannerForeign.siteId()).catch(() => null);
      if (cur === id) break;
      await page.getByPlaceholder("Filter by name…").fill(NAME).catch(() => {});
      const row = page.getByText(NAME, { exact: false }).first();
      if (await row.waitFor({ state: "visible", timeout: 15000 }).then(() => true, () => false)) {
        await row.click(); await pacedWait(page, 1500);
        const open = page.getByRole("button", { name: /^open( project| plan| site)?$/i }).first();
        if (await open.count()) await open.click().catch(() => {});
        await pacedWait(page, 3000);
      }
    }
    await page.getByTestId("planner-canvas").first().waitFor({ state: "visible", timeout: 30000 });
    const cur = await page.evaluate(() => window.__plannerForeign && window.__plannerForeign.siteId());
    if (cur !== id) throw new Error(`opened ${cur}, wanted ${id} (switch plans by hand-driving the Sites list)`);
    await pacedWait(page, 1500);
    await assertMeasurable(page, "verify-paste-image-overlay");
  };
  const F = (fn, ...args) => page.evaluate(([f, a]) => window.__plannerForeign[f](...a), [fn, args]);
  const until = async (fn, what, ms = 40000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out: " + what); await pacedWait(page, 500); } };
  const dbOverlays = (id) => page.evaluate(async (i) => { const r = await window.pfSupabase.from("sites").select("o:data->sheetOverlays").eq("id", i).maybeSingle(); return r.error ? null : (r.data && r.data.o) || []; }, id);
  const readable = (key) => page.evaluate(async (k) => { const r = await window.pfSupabase.storage.from("doc-review-files").createSignedUrl(k, 30); return !r.error; }, key);

  /* ---- plan A: click the map, paste a PNG ---- */
  await openPlan(A);
  const box = await page.getByTestId("planner-canvas").first().boundingBox();
  await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.9);
  const prevented = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 400; c.height = 250;
    const g = c.getContext("2d"); g.fillStyle = "#16a34a"; g.fillRect(0, 0, 400, 250); g.fillStyle = "#fff"; g.fillRect(30, 30, 120, 80);
    const blob = await new Promise((r) => c.toBlob(r, "image/png"));
    const dt = new DataTransfer(); dt.items.add(new File([blob], "image.png", { type: "image/png" }));
    const ev = new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  check(prevented, "paste event with a PNG was taken by the planner");
  const ov = await until(async () => (await F("own")).find((o) => o.storageKey), "pasted overlay uploaded to Storage on A");
  uploaded.add(ov.storageKey);
  check((await F("own")).length === 1, "exactly one overlay on A");
  const rec1 = await until(async () => { const d = await dbOverlays(A); return d && d.length === 1 && d[0].storageKey ? d : null; }, "A's overlay in the cloud row");
  check(rec1[0].name === "Pasted image", `named "Pasted image" (got ${rec1[0].name})`);
  check(rec1[0].imgW === 400 && rec1[0].imgH === 250, "decoded at its own pixel size");
  check(await readable(ov.storageKey), "stored object is readable");

  /* ---- cache-busted reload: it persists ---- */
  await openPlan(A);
  await until(async () => (await F("own")).length === 1, "overlay still on A after reload");
  check(true, "A: overlay persists after reload");

  /* ---- plan B: offered, not shown ---- */
  await openPlan(B);
  const rows = await until(async () => { await F("refresh"); const r = await F("rows"); return r.length ? r : null; }, "foreign row on B");
  check(rows.length === 1, `B is offered the pasted overlay (rows: ${rows.length})`);
  check((await F("own")).length === 0, "B does not show it automatically");
} catch (e) { console.error("ERROR", e.message); failed = true; }
finally {
  if (s) {
    try {
      const gone = await s.page.evaluate(async ([ids, keys]) => {
        const out = {};
        if (keys.length) { const r = await window.pfSupabase.storage.from("doc-review-files").remove(keys); out.storage = r.error ? String(r.error.message) : "removed"; }
        for (const id of ids) {
          await window.pfSupabase.from("site_elements").delete().eq("site_id", id);
          await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
          await window.pfSupabase.from("sites").delete().eq("id", id);
        }
        for (const k of ["planarfit:sites:v1", "planarfit:sites:history:v1"]) { try { const o = JSON.parse(localStorage.getItem(k) || "{}"); ids.forEach((i) => delete o[i]); localStorage.setItem(k, JSON.stringify(o)); } catch (_) {} }
        localStorage.removeItem("planarfit:currentSite:v1");
        const left = await window.pfSupabase.from("sites").select("id").in("id", ids);
        out.remaining = (left.data || []).length;
        return out;
      }, [[A, B], [...uploaded]]);
      // The planner can re-sync a just-deleted row while it is still mounted: stop it, clear the local copy, then delete.
      await s.page.goto("about:blank").catch(() => {});
      await s.page.goto(base, { waitUntil: "domcontentloaded" }).catch(() => {});
      await s.page.waitForFunction(() => !!window.pfSupabase, null, { timeout: 20000 }).catch(() => {});
      gone.remaining = await s.page.evaluate(async (ids) => {
        for (const k of ["planarfit:sites:v1", "planarfit:sites:history:v1"]) { try { const o = JSON.parse(localStorage.getItem(k) || "{}"); ids.forEach((i) => delete o[i]); localStorage.setItem(k, JSON.stringify(o)); } catch (_) {} }
        localStorage.removeItem("planarfit:currentSite:v1");
        await window.pfSupabase.from("sites").update({ deleted_at: new Date().toISOString() }).in("id", ids); // the DB refuses a hard delete of a live row
        for (const id of ids) { await window.pfSupabase.from("site_elements").delete().eq("site_id", id); await window.pfSupabase.from("sites").delete().eq("id", id); }
        const left = await window.pfSupabase.from("sites").select("id").in("id", ids); return (left.data || []).length;
      }, [A, B]);
      console.log("cleanup:", JSON.stringify(gone));
      if (gone.remaining !== 0) failed = true;
    } catch (e) { console.error("cleanup ERROR", e.message); failed = true; }
    await s.close();
  }
}
process.exit(failed ? 1 : 0);
