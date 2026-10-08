/* Removes any leftover throwaway files verify-doc-editor-live.mjs made on the test account (Drive bytes + the key map
 * + review rows), retrying the Drive delete, and proves they are gone.  node ui-audit/cleanup-doc-editor-live.mjs https://planyr.io */
import { openSignedIn } from "./lib/signedInSession.mjs";
const BASE = (process.argv[2] || "https://planyr.io").replace(/\/$/, "");
let s = null, err = null;
for (let a = 1; a <= 5 && !s; a++) { try { s = await openSignedIn({ base: BASE }); } catch (e) { err = e; console.log(`sign-in attempt ${a} failed: ${String(e.message).slice(0, 120)}`); await new Promise((r) => setTimeout(r, 30000)); } }
if (!s) throw err;
const out = await s.page.evaluate(async () => {
  const sb = window.pfSupabase; const res = { found: [], deleted: [], failed: [], rowsDeleted: 0 };
  const list = async () => { const { data, error } = await sb.from("drive_files").select("planyr_key,name").ilike("planyr_key", "%e2e-doc-editor-%"); if (error) throw new Error(error.message); return data || []; };
  res.found = (await list()).map((r) => r.planyr_key);
  for (const full of res.found) {
    const raw = full.replace(/^[^/]+\//, ""); let code = 0;
    for (let t = 0; t < 4 && !(code >= 200 && code < 300); t++) {
      const { data } = await sb.auth.getSession();
      const r = await fetch(`/api/files?key=${encodeURIComponent(raw)}`, { method: "DELETE", headers: { authorization: `Bearer ${data.session.access_token}` } }).catch(() => null);
      code = r ? r.status : 0; if (!(code >= 200 && code < 300)) await new Promise((r2) => setTimeout(r2, 4000));
    }
    (code >= 200 && code < 300 ? res.deleted : res.failed).push([raw, code]);
  }
  const rv = await sb.from("doc_reviews").select("id,title,data").order("updated_at", { ascending: false }).limit(60);
  const ids = (rv.data || []).filter((r) => /e2e-doc-editor-/.test(JSON.stringify((r.data || {}).sourceFile || "") + (r.title || ""))).map((r) => r.id);
  if (ids.length) { await sb.from("file_facts").delete().in("id", ids); const d = await sb.from("doc_reviews").delete().in("id", ids).select("id"); res.rowsDeleted = (d.data || []).length; }
  res.left = (await list()).map((r) => r.planyr_key);
  return res;
});
console.log(JSON.stringify(out, null, 1));
await s.close();
process.exit(out.left.length === 0 && out.failed.length === 0 ? 0 : 1);
