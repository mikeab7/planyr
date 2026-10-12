/* B2244016 / B2244017 / V1671200 — LIVE, TWO ACCOUNTS: sharing a project shares its overlays and comps,
 * and a teammate opening it never erases the owner's overlay pointer.
 *   E2E_LOGIN_KEY=… node ui-audit/verify-shared-overlay-access.mjs [https://planyr.io] [<expected commit prefix>]
 *
 * Owner = the primary test account; teammate = the second pinned test account (e2e-teammate@planyr.test).
 * Everything it touches it creates and deletes: one throwaway plan (zz-share-ovl-a), its uploaded PDF, one
 * comp attached to it, and one throwaway team. Never opens Goose Creek / Bain / Mason & Clay / 8 South /
 * Grand Port / Papadopoulos, never touches overlay aa2d8163-… or plan sms93j3sfc04.
 *
 * KNOWN-GOOD ARMS (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): the OWNER loads the image on their own plan (a
 * fact true before and after this change) and, before sharing, the teammate provably can NOT read the
 * plan — so a green "teammate sees it" cannot be an instrument that sees everything. */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const base = process.argv[2] || "https://planyr.io";
const want = process.argv[3] || "";
const A = "zz-share-ovl-a", NAME = "ZZ shared overlay verify";
const rec = { id: A, groupId: A, site: NAME, name: "Concept A", origin: { lat: 29.78, lon: -95.82 }, county: "harris",
  parcels: [{ id: "p", active: true, points: [{ x: 0, y: 0 }, { x: 800, y: 0 }, { x: 800, y: 600 }, { x: 0, y: 600 }] }],
  els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, parcelDrawings: [], sheetOverlays: [], updatedAt: Date.now() };

function pdf1() { // a minimal, valid one-page PDF with a filled rectangle
  const t = "0 0 0 rg 100 100 300 400 re f";
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >>", `<< /Length ${t.length} >>\nstream\n${t}\nendstream`];
  let out = "%PDF-1.4\n"; const off = [];
  objs.forEach((o, i) => { off.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(out, "latin1");
}

let owner, mate, failed = false, teamId = null, compId = null, key = null;
const check = (ok, msg) => { console.log((ok ? "PASS " : "FAIL ") + msg); if (!ok) failed = true; };
const E2E = [[() => { window.__PLANYR_E2E = true; }, null]];

const openPlan = async (page, harness) => {
  await page.evaluate((i) => localStorage.setItem("planarfit:currentSite:v1", i), A);
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByTestId("module-tab-site-planner").filter({ visible: true }).click().catch(() => {});
  await page.evaluate((i) => { window.location.hash = `#/project/${i}/site`; }, A);
  for (let k = 0; k < 30; k++) {
    if ((await page.evaluate(() => window.__plannerForeign && window.__plannerForeign.siteId()).catch(() => null)) === A) break;
    await pacedWait(page, 1000);
  }
  await page.getByTestId("planner-canvas").first().waitFor({ state: "visible", timeout: 30000 }).catch(async (e) => {
    const body = (await page.locator("body").innerText().catch(() => "")).slice(0, 400).replace(/\n/g, " | ");
    await page.screenshot({ path: `/tmp/claude-0/${harness.replace(/[^a-z-]/gi, "_")}.png` }).catch(() => {});
    throw new Error(`${harness}: planner never opened — url ${page.url()} — screen: ${body} (${e.message.split("\n")[0]})`);
  });
  const cur = await page.evaluate(() => window.__plannerForeign && window.__plannerForeign.siteId());
  if (cur !== A) throw new Error(`${harness}: opened ${cur}, wanted ${A}`);
  await pacedWait(page, 1500);
  await assertMeasurable(page, harness);
};
const F = (page, fn, ...args) => page.evaluate(([f, a]) => (window.__plannerForeign ? window.__plannerForeign[f](...a) : null), [fn, args]);
const until = async (page, fn, what, ms = 60000) => { const t0 = Date.now(); for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t0 > ms) throw new Error("timed out: " + what); await pacedWait(page, 500); } };
const dbOverlays = (page) => page.evaluate(async (i) => { const r = await window.pfSupabase.from("sites").select("o:data->sheetOverlays").eq("id", i).maybeSingle(); return r.error ? { error: r.error.message } : (r.data ? r.data.o || [] : null); }, A);
// Asks the SERVER (a signed URL is issued only for an object the caller's storage RLS admits) — a plain
// download can be answered from the browser's HTTP cache, which made a revoked read look still-granted.
const canRead = (page, k) => page.evaluate(async (kk) => { const r = await window.pfSupabase.storage.from("doc-review-files").createSignedUrl(kk, 30); return !r.error && !!(r.data && r.data.signedUrl); }, k);
const sees = (page, table, id) => page.evaluate(async ([t, i]) => { const r = await window.pfSupabase.from(t).select("id").eq("id", i); return (r.data || []).length; }, [table, id]);
const share = (page, team) => page.evaluate(async ([g, t]) => { const r = await window.pfSupabase.rpc("set_project_team_state", { p_group_id: g, p_team_id: t }); return r.error ? "ERR " + r.error.message : r.data && r.data.outcome; }, [A, team]);

try {
  owner = await openSignedIn({ base, initScripts: E2E });
  mate = await openSignedIn({ account: "teammate", base, initScripts: E2E });
  console.log("served build:", JSON.stringify(owner.build));
  if (want && !JSON.stringify(owner.build).includes(want)) throw new Error(`deployed build does not contain ${want} yet`);
  const O = owner.page, M = mate.page;
  const mateId = await M.evaluate(async () => (await window.pfSupabase.auth.getUser()).data.user.id);

  /* ---- owner: a throwaway plan with a real PDF upload ---- */
  await O.evaluate(async (r) => {
    const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); all[r.id] = r; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all));
    const e = await window.pfSupabase.from("sites").upsert({ id: r.id, group_id: r.id, site: r.site, name: r.name, county: "harris", updated_at: new Date().toISOString(), data: r });
    if (e.error) throw new Error("seed: " + e.error.message);
  }, rec);
  await openPlan(O, "verify-shared-overlay-access:owner");
  await O.locator('input[type="file"][accept*="pdf"]').first().setInputFiles({ name: "zz-share.pdf", mimeType: "application/pdf", buffer: pdf1() });
  const ov = await until(O, async () => ((await F(O, "own")) || []).find((o) => o.storageKey), "overlay uploaded");
  key = ov.storageKey;
  await until(O, async () => { const d = await dbOverlays(O); return Array.isArray(d) && d.some((o) => o.storageKey === key) ? d : null; }, "overlay pushed to the cloud");
  check(await canRead(O, key), "KNOWN-GOOD: the owner loads their own overlay file");
  compId = await O.evaluate(async (p) => {
    const r = await window.pfSupabase.from("comps").insert({ user_id: (await window.pfSupabase.auth.getUser()).data.user.id, project_id: p, comp_type: "land",
      comp_date: new Date().toISOString().slice(0, 10), anchor_kind: "pin", lat: 29.78, lon: -95.82, land_price: 1, land_size_value: 1, land_size_unit: "ac", title: "ZZ share verify" }).select("id").single();
    if (r.error) throw new Error("comp: " + r.error.message); return r.data.id;
  }, A);

  /* ---- before sharing: the teammate sees nothing (the instrument can say "no") ---- */
  check((await sees(M, "sites", A)) === 0, "KNOWN-GOOD: before sharing, the teammate cannot read the plan");
  check(!(await canRead(M, key)), "before sharing, the teammate cannot load the overlay file");
  check((await sees(M, "comps", compId)) === 0, "before sharing, the teammate cannot see the comp");

  /* ---- share through the real share control's RPC ---- */
  teamId = await O.evaluate(async () => { const r = await window.pfSupabase.rpc("create_team", { p_name: "ZZ share-overlay verify (throwaway)" }); if (r.error) throw new Error("team: " + r.error.message); return r.data; });
  await O.evaluate(async ([t, u]) => { const me = (await window.pfSupabase.auth.getUser()).data.user.id; const r = await window.pfSupabase.from("team_members").insert({ team_id: t, user_id: u, role: "member", added_by: me }); if (r.error) throw new Error("member: " + r.error.message); }, [teamId, mateId]);
  check((await share(O, teamId)) === "changed", "owner shares the project with the throwaway team");

  check((await sees(M, "sites", A)) === 1, "teammate can read the shared plan");
  check(await canRead(M, key), "teammate can LOAD the shared plan's overlay file (B2244017)");
  check((await sees(M, "comps", compId)) === 1, "teammate sees the comp attached to the project (B2244017)");

  /* ---- teammate opens it in the app, sees the image, reloads ---- */
  await M.evaluate((r) => { const all = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); all[r.id] = r; localStorage.setItem("planarfit:sites:v1", JSON.stringify(all)); }, (await O.evaluate(async (i) => (await window.pfSupabase.from("sites").select("data").eq("id", i).single()).data.data, A)));
  await openPlan(M, "verify-shared-overlay-access:teammate");
  await until(M, async () => ((await F(M, "own")) || []).find((o) => o.id === ov.id && o.hasSrc), "teammate's planner draws the overlay image");
  check(true, "teammate's planner shows the overlay picture");
  const body1 = await M.locator("body").innerText();
  check(!/Couldn.t load|not readable from this account/.test(body1), "no broken-overlay placeholder on the teammate's screen");
  await openPlan(M, "verify-shared-overlay-access:teammate-reload");
  await until(M, async () => ((await F(M, "own")) || []).find((o) => o.id === ov.id && o.hasSrc), "image again after the teammate reloads");
  check(true, "teammate still sees it after a reload");
  await pacedWait(M, 6000); // any teammate autosave lands
  const after = await dbOverlays(O);
  const mine = Array.isArray(after) && after.find((o) => o.id === ov.id);
  check(!!mine && mine.storageKey === key && !mine.storageMissing, "the OWNER's record still has its storageKey after the teammate opened + reloaded (B2244016)");

  /* ---- unshare: the teammate loses access ---- */
  check((await share(O, null)) === "changed", "owner makes the project private again");
  check((await sees(M, "sites", A)) === 0, "after unsharing, the teammate cannot read the plan");
  check(!(await canRead(M, key)), "after unsharing, the teammate cannot load the overlay file");
  check((await sees(M, "comps", compId)) === 0, "after unsharing, the teammate cannot see the comp");
} catch (e) { console.error("ERROR", e.message); failed = true; }
finally {
  try {
    if (mate) await mate.page.evaluate((i) => { try { const o = JSON.parse(localStorage.getItem("planarfit:sites:v1") || "{}"); delete o[i]; localStorage.setItem("planarfit:sites:v1", JSON.stringify(o)); } catch (_) {} localStorage.removeItem("planarfit:currentSite:v1"); }, A).catch(() => {});
    if (owner) {
      await pacedWait(owner.page, 6000);
      const gone = await owner.page.evaluate(async ([id, k, t, c]) => {
        const sb = window.pfSupabase, out = {};
        if (c) await sb.from("comps").delete().eq("id", c);
        for (let pass = 0; pass < 3; pass++) {
          await sb.from("site_elements").delete().eq("site_id", id);
          await sb.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", id);
          await sb.from("sites").delete().eq("id", id);
          await new Promise((r) => setTimeout(r, 1500));
        }
        if (k) { const r = await sb.storage.from("doc-review-files").remove([k]); out.storage = r.error ? String(r.error.message) : "removed"; }
        if (t) {
          // ORDER MATTERS: deleting a team needs the caller to still be its admin, and team_members has no FK to
          // teams (no cascade). So: drop the teammate, delete the team while still admin, then leave it.
          const me = (await sb.auth.getUser()).data.user.id;
          await sb.from("team_members").delete().eq("team_id", t).neq("user_id", me);
          const d = await sb.from("teams").delete({ count: "exact" }).eq("id", t);
          await sb.from("team_members").delete().eq("team_id", t).eq("user_id", me);
          out.team = d.error ? String(d.error.message) : (d.count === 1 ? "deleted" : `NOT deleted (${d.count} rows)`);
          out.teamLeft = ((await sb.rpc("list_my_teams")).data || []).filter((x) => x.id === t).length;
        }
        for (const s of ["planarfit:sites:v1", "planarfit:sites:history:v1"]) { try { const o = JSON.parse(localStorage.getItem(s) || "{}"); delete o[id]; localStorage.setItem(s, JSON.stringify(o)); } catch (_) {} }
        localStorage.removeItem("planarfit:currentSite:v1");
        out.sitesLeft = ((await sb.from("sites").select("id").eq("id", id)).data || []).length;
        out.compsLeft = c ? ((await sb.from("comps").select("id").eq("id", c)).data || []).length : 0;
        out.fileLeft = k ? !(await sb.storage.from("doc-review-files").createSignedUrl(k, 30)).error : false; // a download can be served from the HTTP cache
        return out;
      }, [A, key, teamId, compId]);
      console.log("cleanup:", JSON.stringify(gone));
      if (gone.sitesLeft || gone.compsLeft || gone.fileLeft || gone.teamLeft || (teamId && gone.team !== "deleted")) failed = true;
    }
  } catch (e) { console.error("cleanup ERROR", e.message); failed = true; }
  if (mate) await mate.close().catch(() => {});
  if (owner) await owner.close().catch(() => {});
}
process.exit(failed ? 1 : 0);
