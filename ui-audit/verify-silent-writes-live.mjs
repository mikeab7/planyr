/* verify-silent-writes-live — NEW-1..NEW-5 of the "six silent write failures" block, SIGNED IN as the throwaway
 * test account against a real deploy. Each arm forces the failure the item is about with `page.route()` (a
 * PostgREST call answered 500, or 0 rows — the RLS / already-deleted no-op), asserts the surface SAYS so and the
 * database shows nothing changed, then lets the same call through and asserts the normal path still lands.
 *   A  NEW-1  Reviews ▾ delete refused → TrashNotice in the menu; a real delete soft-deletes + offers Undo.
 *   B  NEW-3  Org workbook create / rename / delete read the cloud result; a refused delete keeps the row.
 *   C  NEW-4  Folder tree: a failed read keeps the tree + says so (never the seed template); delete takes children.
 *   D  NEW-5  Site-plan upload: the raster_key attach write refused → notice; conflict → retried and attached.
 *   E  NEW-2  "Pin comp here" on an existing comp: a refused re-pin says "Pin not moved"; a real one persists.
 * Every row it makes carries LIVE_PREFIX / "zz-livechk" and is removed at the end (owner rule 15; delete-must-verify).
 * Run: E2E_LOGIN_KEY=… node ui-audit/verify-silent-writes-live.mjs [https://planyr.io] [arms e.g. ABC]   (key never printed) */
import { openSignedIn } from "./lib/signedInSession.mjs";
import { LIVE_PREFIX, seedThrowawayPlan, cleanupLive } from "./lib/liveFixtures.mjs";
import { assertMeasurable, pacedWait } from "./lib/tabTiming.mjs";

const BASE = process.argv[2] || "https://planyr.io";
const ARMS = (process.argv[3] || "ABCDE").toUpperCase();
const STAMP = Date.now().toString(36);
const PROJECT = `${LIVE_PREFIX}sw-${STAMP}`;
const TAG = `zz-livechk-sw-${STAMP}`;
let failures = 0;
const ok = (name, cond, extra = "") => { console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`); if (!cond) failures++; };
const settle = (p, ms = 1500) => pacedWait(p, ms);
const q = (page, fn, arg) => page.evaluate(fn, arg);
const pdfBuf = (() => {
  const s1 = `BT /F1 20 Tf 60 700 Td (${TAG}) Tj ET`;
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>", `<< /Length ${s1.length} >>\nstream\n${s1}\nendstream`, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  let pdf = "%PDF-1.4\n"; const off = [];
  objs.forEach((b, i) => { off[i] = Buffer.byteLength(pdf, "latin1"); pdf += `${i + 1} 0 obj\n${b}\nendobj\n`; });
  const x = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + off.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
})();

const s = await openSignedIn({ base: BASE });
const { page } = s;
const ctx = page.context();
const uid = await q(page, async () => (await window.pfSupabase.auth.getUser()).data.user.id);
console.log(`served build: ${JSON.stringify(s.build)}  account: ${s.proof.email}`);
const made = { reviews: [], workbooks: [], overlays: [], comps: [], plan: null };
const bodyHas = (p, re) => p.evaluate((r) => new RegExp(r, "i").test(document.body.innerText), re);

/* Answer ONE table's PATCH (or every method) with a canned failure while `on` is true. */
const failRoute = (p, re, { status = 500, body = "", methods = ["PATCH"], once = false } = {}) => {
  const state = { on: true, hits: 0 };
  const handler = async (route) => {
    if (!state.on || !methods.includes(route.request().method())) return route.continue();
    if (once && state.hits >= 1) return route.continue();
    state.hits++;
    return route.fulfill({ status, contentType: "application/json", body });
  };
  p.route(re, handler);
  state.off = async () => { state.on = false; await p.unroute(re, handler); };
  return state;
};

try {
  await assertMeasurable(page, "verify-silent-writes-live");
  if (/[CDE]/.test(ARMS)) { await seedThrowawayPlan(page, PROJECT); made.plan = PROJECT; }

  // ── A · NEW-1 — the "Reviews ▾" menu delete ───────────────────────────────────────────────────
  const arm = async (name, fn) => { try { await fn(); } catch (e) { ok(`${name}: the arm ran to its end`, false, String(e && e.message || e).replace(/\s+/g, " ").slice(0, 420)); } };
  await arm("A", async () => { if (!ARMS.includes("A")) return;
    const rid = `rv${TAG}`;
    const ins = await q(page, async ([id, uid, title]) => { const r = await window.pfSupabase.from("doc_reviews").insert({ id, user_id: uid, title, kind: "single", updated_at: new Date().toISOString(), data: { schemaVersion: 1, id, title, kind: "single", sources: [], markups: [] } }); return r.error ? r.error.message : null; }, [rid, uid, `${TAG} review`]);
    if (ins) throw new Error("A: could not seed a throwaway review — " + ins);
    made.reviews.push(rid);
    await page.goto(`${BASE}/#/markup`, { waitUntil: "load" });
    await settle(page, 2500);
    const openMenu = async () => { await page.getByRole("button", { name: /^Reviews ▾$/ }).first().click(); await settle(page, 2500); };
    await openMenu();
    const row = page.locator(`[aria-label="Open ${TAG} review"]`).first();
    ok("A known-good arm: the throwaway review is listed in Reviews ▾", (await row.count()) === 1);
    const patch = failRoute(page, /\/rest\/v1\/doc_reviews\?/, { status: 200, body: "[]" }); // 0 rows — the RLS / already-deleted no-op
    await row.getByTitle("Delete (moves to Recently deleted)").click();
    await row.getByTitle(/^Yes — restorable/).click();
    await settle(page, 2500);
    ok("A refused delete (0 rows): the menu says 'Couldn’t delete that file'", (await page.locator('[data-testid="trash-notice"]').filter({ hasText: /Couldn’t delete that file/ }).count()) === 1, `route hits ${patch.hits}`);
    ok("A refused delete: the review is still listed", (await page.locator(`[aria-label="Open ${TAG} review"]`).count()) === 1);
    ok("A refused delete: no Undo toast was offered", (await page.locator('[data-testid="trash-undo"]').count()) === 0);
    const dbA1 = await q(page, async (id) => (await window.pfSupabase.from("doc_reviews").select("deleted_at").eq("id", id).single()).data, rid);
    ok("A refused delete: the row is NOT soft-deleted in the database", dbA1 && dbA1.deleted_at === null, JSON.stringify(dbA1));
    await patch.off();
    const row2 = page.locator(`[aria-label="Open ${TAG} review"]`).first();
    await row2.getByTitle("Delete (moves to Recently deleted)").click();
    await row2.getByTitle(/^Yes — restorable/).click();
    await settle(page, 2500);
    ok("A real delete: Undo offered inline ('Moved … to Recently deleted')", (await page.locator('[data-testid="trash-undo"]').filter({ hasText: /Moved/ }).count()) === 1);
    ok("A real delete: the review left the list", (await page.locator(`[aria-label="Open ${TAG} review"]`).count()) === 0);
    const dbA2 = await q(page, async (id) => (await window.pfSupabase.from("doc_reviews").select("deleted_at").eq("id", id).single()).data, rid);
    ok("A real delete: the row IS soft-deleted (deleted_at set) — what Recently deleted lists", !!(dbA2 && dbA2.deleted_at), JSON.stringify(dbA2));
    await page.keyboard.press("Escape");
  });

  // ── B · NEW-3 — Organization workbooks ────────────────────────────────────────────────────────
  await arm("B", async () => { if (!ARMS.includes("B")) return;
    const idsOf = () => q(page, async () => ((await window.pfSupabase.from("org_model_sheets").select("id,name,deleted_at")).data || []));
    const before = new Set((await idsOf()).map((r) => r.id));
    await page.goto(`${BASE}/#/org/spreadsheet`, { waitUntil: "load" });
    await page.waitForSelector('[data-testid="org-workbook-new"]', { timeout: 60000 });
    await settle(page, 2000);
    await page.locator('[data-testid="org-workbook-new"]').click();
    await settle(page, 4000);
    let fresh = (await idsOf()).filter((r) => !before.has(r.id));
    for (let i = 0; i < 10 && !fresh.length; i++) { await settle(page, 1000); fresh = (await idsOf()).filter((r) => !before.has(r.id)); }
    ok("B create: the new workbook reached org_model_sheets", fresh.length === 1, JSON.stringify(fresh));
    const wid = fresh[0] && fresh[0].id; if (wid) made.workbooks.push(wid);
    await page.goto(`${BASE}/#/org/spreadsheet`, { waitUntil: "load" }); await page.reload({ waitUntil: "load" });
    await page.waitForSelector('[data-testid="org-workbook-row"]', { timeout: 60000 });
    await settle(page, 2500);
    const rowB = page.locator('[data-testid="org-workbook-row"]').filter({ hasText: "Untitled workbook" }).first();
    ok("B known-good arm: the workbook row is listed after a reload", (await rowB.count()) >= 1);
    await rowB.getByTitle("Rename").click();
    await page.keyboard.press("Control+A"); await page.keyboard.type(`${TAG} wb`); await page.keyboard.press("Enter");
    let named = null; for (let i = 0; i < 10; i++) { await settle(page, 800); named = (await idsOf()).find((r) => r.id === wid); if (named && named.name === `${TAG} wb`) break; }
    ok("B rename reached the cloud", !!named && named.name === `${TAG} wb`, JSON.stringify(named));
    const rowB2 = page.locator('[data-testid="org-workbook-row"]').filter({ hasText: `${TAG} wb` }).first();
    const patchB = failRoute(page, /\/rest\/v1\/org_model_sheets\?/, { status: 500, body: '{"message":"forced by verify-silent-writes-live"}' });
    await rowB2.getByTitle("Delete").click(); await rowB2.getByTitle("Delete", { exact: true }).last().click();
    await settle(page, 2500);
    ok("B refused delete: the picker says 'Couldn't delete that workbook in the cloud'", await bodyHas(page, "Couldn't delete that workbook in the cloud"), `route hits ${patchB.hits}`);
    ok("B refused delete: the row is still listed (local index NOT dropped)", (await page.locator('[data-testid="org-workbook-row"]').filter({ hasText: `${TAG} wb` }).count()) === 1);
    const dbB1 = (await idsOf()).find((r) => r.id === wid);
    ok("B refused delete: the cloud row is still live", !!dbB1 && dbB1.deleted_at === null, JSON.stringify(dbB1));
    await patchB.off();
    const rowB3 = page.locator('[data-testid="org-workbook-row"]').filter({ hasText: `${TAG} wb` }).first();
    await rowB3.getByTitle("Delete").click(); await rowB3.getByTitle("Delete", { exact: true }).last().click();
    await settle(page, 2500);
    ok("B real delete: the row left the picker", (await page.locator('[data-testid="org-workbook-row"]').filter({ hasText: `${TAG} wb` }).count()) === 0);
    const dbB2 = (await idsOf()).find((r) => r.id === wid);
    ok("B real delete: the cloud row is tombstoned", !!dbB2 && !!dbB2.deleted_at, JSON.stringify(dbB2));
    await page.reload({ waitUntil: "load" }); await page.waitForSelector('[data-testid="org-workbook-new"]', { timeout: 60000 }); await settle(page, 3000);
    ok("B real delete: stays gone after a reload (the cloud list no longer resurrects it)", (await page.locator('[data-testid="org-workbook-row"]').filter({ hasText: `${TAG} wb` }).count()) === 0);
  });

  // ── C · NEW-4 — the Library folder tree ───────────────────────────────────────────────────────
  await arm("C", async () => { if (!ARMS.includes("C")) return;
    await page.route("**/api/folders", (r) => r.abort()); // no Drive mirror for a throwaway tree (the index is what's under test)
    const folders = () => q(page, async (pid) => ((await window.pfSupabase.from("project_folders").select("id,name,parent_id,trashed").eq("project_id", pid)).data || []), PROJECT);
    await page.goto(`${BASE}/#/project/${PROJECT}/library`, { waitUntil: "load" });
    await page.waitForSelector('[data-testid="folder-tree"]', { timeout: 60000 }); await settle(page, 2500);
    ok("C known-good arm: a fresh project offers the standard template", (await page.getByRole("button", { name: /Create the standard/ }).count()) === 1);
    const tree = page.locator('[data-testid="folder-tree"]').first();
    await tree.click({ button: "right", position: { x: 40, y: (await tree.boundingBox()).height - 20 } }); await settle(page, 800);
    await page.locator('[data-testid="folder-context-menu"] [role="menuitem"]').filter({ hasText: "New folder" }).click(); await settle(page, 2500);
    await page.keyboard.press("Control+A"); await page.keyboard.type(`${TAG} parent`); await page.keyboard.press("Enter"); await settle(page, 2500);
    const parentRow = page.locator('[data-testid="folder-row"]').filter({ hasText: `${TAG} parent` }).first();
    await parentRow.scrollIntoViewIfNeeded().catch(() => {});
    ok("C parent folder created", (await parentRow.count()) === 1);
    await parentRow.click({ button: "right" }); await settle(page, 800);
    await page.locator('[data-testid="folder-context-menu"] [role="menuitem"]').filter({ hasText: "New folder" }).click(); await settle(page, 2500);
    await page.keyboard.press("Control+A"); await page.keyboard.type(`${TAG} child`); await page.keyboard.press("Enter"); await settle(page, 2500);
    const mine = (fs) => fs.filter((r) => r.name.startsWith(TAG));
    // The Library's one-time organizer (B663, Library.jsx) seeds the standard template into every project the
    // account owns on open, so this throwaway tree is never ONLY ours — every assertion is on OUR two rows.
    let fs = await folders();
    ok("C our parent + child are live in project_folders", mine(fs).length === 2 && mine(fs).every((r) => !r.trashed), JSON.stringify(mine(fs)));
    // failed FIRST read → nothing, "Try again", and NO seed template
    const readFail = failRoute(page, /\/rest\/v1\/project_folders\?/, { status: 500, body: '{"message":"forced"}', methods: ["GET"] });
    await page.reload({ waitUntil: "load" }); await page.waitForSelector('[data-testid="folder-tree"]', { timeout: 60000 }); await settle(page, 3000);
    ok("C failed first read: 'Couldn’t load this project’s folders' + Try again", (await page.locator('[data-testid="folder-tree-load-failed"]').count()) === 1, `route hits ${readFail.hits}`);
    ok("C failed first read: NO 'Create the standard structure' button", (await page.getByRole("button", { name: /Create the standard/ }).count()) === 0);
    ok("C failed first read: no folder rows shown", (await page.locator('[data-testid="folder-row"]').count()) === 0);
    await readFail.off();
    await page.locator('[data-testid="folder-tree-load-failed"] button').click(); await settle(page, 3000);
    ok("C Try again after the read recovers: our parent folder is back (the child sits under its collapsed parent)", (await page.locator('[data-testid="folder-row"]').filter({ hasText: `${TAG} parent` }).count()) === 1);
    ok("C recovered read: the failure line is gone", !(await bodyHas(page, "Couldn’t load folders")));
    // failed RE-read mid-session keeps the rows + says so; a delete during a failed read is REFUSED
    const readFail2 = failRoute(page, /\/rest\/v1\/project_folders\?/, { status: 500, body: '{"message":"forced"}', methods: ["GET"] });
    const pr = page.locator('[data-testid="folder-row"]').filter({ hasText: `${TAG} parent` }).first();
    await pr.click({ button: "right" }); await settle(page, 800);
    await page.locator('[data-testid="folder-context-menu"] [role="menuitem"]').filter({ hasText: "Delete" }).click(); await settle(page, 2000);
    await page.getByRole("button", { name: "Delete", exact: true }).last().click(); await settle(page, 2500);
    ok("C delete during a failed read is REFUSED and says why", await bodyHas(page, "Couldn't read the folder tree, so the delete wasn't done"), `route hits ${readFail2.hits}`);
    ok("C delete during a failed read: our parent row is still shown", (await page.locator('[data-testid="folder-row"]').filter({ hasText: `${TAG} parent` }).count()) === 1);
    await readFail2.off(); // the database read below goes through the page's own client — it must not be the call being failed
    fs = await folders();
    ok("C delete during a failed read: nothing trashed in the database", mine(fs).length === 2 && mine(fs).every((r) => !r.trashed), JSON.stringify(mine(fs)));
    await page.keyboard.press("Escape");
    await pr.click({ button: "right" }); await settle(page, 800);
    await page.locator('[data-testid="folder-context-menu"] [role="menuitem"]').filter({ hasText: "Delete" }).click(); await settle(page, 2000);
    await page.getByRole("button", { name: "Delete", exact: true }).last().click(); await settle(page, 3000);
    fs = await folders();
    ok("C real delete of the parent trashes the CHILD too", mine(fs).length === 2 && mine(fs).every((r) => r.trashed), JSON.stringify(mine(fs)));
    ok("C real delete: neither of our rows is shown", (await page.locator('[data-testid="folder-row"]').filter({ hasText: TAG }).count()) === 0);
    await page.unroute("**/api/folders");
  });

  // ── D · NEW-5 — the site-plan raster attach write · E · NEW-2 — re-pin an existing comp ──────
  let overlayId = null, overlayRow = null;
  await arm("D/E", async () => { if (!/[DE]/.test(ARMS)) return;
    await page.goto(`${BASE}/#/site`, { waitUntil: "load" }); await settle(page, 4000);
    await page.getByRole("tab", { name: /^Records/ }).first().click(); await settle(page, 1500);
    const inserted = [];
    page.on("response", async (r) => { try { if (r.request().method() === "POST" && /\/rest\/v1\/site_plan_overlays\b/.test(r.url())) { const j = await r.json(); const row = Array.isArray(j) ? j[0] : j; if (row && row.id) inserted.push(row); } } catch (_) {} });
    const upload = async (title) => {
      await page.getByTitle("Upload a broker flyer or park plan").first().click(); await settle(page, 1200);
      await page.locator('input[type="file"][accept="application/pdf,image/*"]').first().setInputFiles({ name: `${title}.pdf`, mimeType: "application/pdf", buffer: pdfBuf });
      await page.getByRole("button", { name: "Place on map" }).waitFor({ timeout: 60000 }); await settle(page, 800);
      // the Field primitive renders its label as a sibling (no <label for>), so address the inputs by structure
      await page.locator("xpath=//div[*[starts-with(normalize-space(.),'Document title')]]/input").first().fill(title);
      await page.locator("xpath=//div[*[starts-with(normalize-space(.),'Document date')]]/input").first().fill("2026-10-20");
      const sel = page.locator("select").filter({ has: page.locator(`option[value="${PROJECT}"]`) }).first();
      if (await sel.count()) await sel.selectOption(PROJECT); // the option's VALUE is the project id
      await page.getByRole("button", { name: "Place on map" }).click();
      await page.waitForFunction(() => !/Uploading|Saving/.test(document.body.innerText), null, { timeout: 120000 }).catch(() => {});
      await settle(page, 4000);
      // The flow's auto site-resolver may re-home a plan placed at the map's default centre onto whichever
      // tracked site sits nearby (sweep debris lives there) — pin it to OUR throwaway project so arm E's
      // comp record can list it. Own row, RLS-bounded; the arm's assertions are about the attach / re-pin writes.
      if (!inserted.some((r) => r.doc_title === title)) { // the response listener can miss a body — the database is the truth
        const row = await q(page, async (t) => (await window.pfSupabase.from("site_plan_overlays").select("id,doc_title").eq("doc_title", t).is("deleted_at", null).maybeSingle()).data, title);
        if (row) inserted.push(row);
        else console.log(`upload diag — no overlay row for "${title}"; panel: ${(await page.evaluate(() => document.body.innerText.replace(/\s+/g, " ").slice(0, 400)))}`);
      }
      const last = inserted[inserted.length - 1];
      if (last) await q(page, async ([id, pid]) => { await window.pfSupabase.from("site_plan_overlays").update({ project_id: pid }).eq("id", id); }, [last.id, PROJECT]);
    };
    const ovRow = (id) => q(page, async (id) => (await window.pfSupabase.from("site_plan_overlays").select("id,raster_key,version,center_lat,center_lon,doc_title,project_id").eq("id", id).single()).data, id);
    if (ARMS.includes("D")) {
      // D1 — the attach PATCH answered 500 → notice, raster_key stays null
      const attachFail = failRoute(page, /\/rest\/v1\/site_plan_overlays\?/, { status: 500, body: '{"message":"forced by verify-silent-writes-live"}', once: true }); // the FIRST PATCH after the insert is the attach
      await upload(`${TAG} plan D1`);
      overlayId = inserted[0] && inserted[0].id;
      if (overlayId) made.overlays.push(overlayId);
      ok("D1 known-good arm: the overlay row was inserted", !!overlayId, JSON.stringify(inserted.map((r) => r.id)));
      ok("D1 refused attach: the panel says 'Uploaded the image but couldn't attach it'", await bodyHas(page, "Uploaded the image but couldn't attach it"), `route hits ${attachFail.hits}`);
      overlayRow = overlayId && await ovRow(overlayId);
      ok("D1 refused attach: raster_key is null in the database (nothing pretended to attach)", !!overlayRow && overlayRow.raster_key === null, JSON.stringify(overlayRow));
      await attachFail.off();
      // D2 — a conflict mid-flight: bump the row's version while the raster is uploading → attach retries with the fresh version and WINS
      let bumped = false;
      const bumpHandler = async (route) => {
        if (!bumped && route.request().method() === "POST") { bumped = true; await q(page, async (id) => { const c = window.pfSupabase; const cur = (await c.from("site_plan_overlays").select("version").eq("id", id).single()).data; await c.from("site_plan_overlays").update({ version: (cur.version || 1) + 1, doc_title: "bumped by a concurrent edit" }).eq("id", id); }, inserted[inserted.length - 1].id); }
        return route.continue();
      };
      await page.route(/\/storage\/v1\/object\/doc-review-files\//, bumpHandler);
      await upload(`${TAG} plan D2`);
      await page.unroute(/\/storage\/v1\/object\/doc-review-files\//, bumpHandler);
      const o2 = inserted[inserted.length - 1] && inserted[inserted.length - 1].id;
      if (o2 && o2 !== overlayId) made.overlays.push(o2);
      const r2 = o2 && await ovRow(o2);
      ok("D2 conflict arm really raced (the storage upload was intercepted and the row bumped)", bumped);
      ok("D2 conflict: the attach was retried at the fresh version and the image IS attached", !!r2 && !!r2.raster_key && r2.version >= 3, JSON.stringify(r2));
      ok("D2 conflict: the panel shows no attach failure", !(await bodyHas(page, "Uploaded the image but couldn't attach it")));
      overlayId = o2 || overlayId; overlayRow = r2 || overlayRow;
    }
    if (ARMS.includes("E")) {
      if (!overlayId) { await upload(`${TAG} plan E`); overlayId = inserted[inserted.length - 1] && inserted[inserted.length - 1].id; if (overlayId) made.overlays.push(overlayId); overlayRow = overlayId && await ovRow(overlayId); }
      ok("E known-good arm: a placed throwaway plan exists", !!overlayRow && Number.isFinite(overlayRow.center_lat), JSON.stringify(overlayRow));
      if (!overlayRow) return;
      const cid = await q(page, async ([uid, pid, title, lat, lon]) => { const r = await window.pfSupabase.from("comps").insert({ user_id: uid, comp_type: "land", comp_date: "2026-10-20", title, project_id: pid, anchor_kind: "pin", lat, lon }).select("id").single(); return r.error ? "ERR " + r.error.message : r.data.id; }, [uid, PROJECT, `${TAG} comp`, overlayRow.center_lat + 0.0004, overlayRow.center_lon + 0.0004]);
      ok("E known-good arm: a throwaway comp exists near the plan", typeof cid === "string" && !cid.startsWith("ERR"), String(cid));
      made.comps.push(cid);
      await page.reload({ waitUntil: "load" }); await settle(page, 4000);
      await page.getByRole("tab", { name: /^Records/ }).first().click(); await settle(page, 2000);
      await page.locator('[data-testid="comp-row"]').filter({ hasText: `${TAG} comp` }).first().click(); await settle(page, 2500);
      const docRow = page.locator('[data-testid="comp-record-document"]').first();
      const listed = (await docRow.count()) >= 1;
      ok("E the comp's record lists the throwaway plan", listed);
      if (!listed) console.log("E diag — rail text:", (await page.evaluate(() => (document.querySelector('[data-testid="comp-record-docs-slot"]')?.parentElement?.innerText || document.body.innerText).replace(/\s+/g, " ").slice(0, 900))));
      const repin = async () => {
        // a site plan is gated off the map below SITE_PLAN_MIN_ZOOM — fly to it first (the row's own Zoom link),
        // then arm the pin and click the map's centre, which IS the plan's centre after that flyTo
        const shot = async (n) => { if (process.env.SW_SHOTS) await page.screenshot({ path: `${process.env.SW_SHOTS}/e-${n}.png` }).catch(() => {}); };
        await docRow.locator('[data-testid="comp-record-zoom-to"]').click(); await settle(page, 2500); await shot("1-zoomed");
        await docRow.getByLabel("More actions").click(); await settle(page, 800); await shot("2-menu");
        const pinItem = page.getByText("Pin comp here").first();
        ok("E known-good arm: the ⋯ menu offers 'Pin comp here'", (await pinItem.count()) === 1);
        await pinItem.click(); await settle(page, 1500); await shot("3-armed");
        const map = page.locator(".leaflet-container").first();
        const b = await map.boundingBox();
        const before = patches.length;
        // The plan fills the view after the flyTo, but other sites' markers (sweep debris) can sit anywhere on
        // it — a click on one NAVIGATES AWAY. Probe candidate points and click the first whose element under
        // the pointer is the plan's own <img> (the armed, clickable raster), never a marker path.
        const spots = [[0.5, 0.5], [0.38, 0.42], [0.62, 0.58], [0.42, 0.64], [0.6, 0.36], [0.3, 0.7], [0.7, 0.3]];
        let target = null;
        for (const [fx, fy] of spots) {
          const x = b.x + b.width * fx, y = b.y + b.height * fy;
          // a site MARKER is an <img class="leaflet-marker-icon"> too — a click on one opens that site (navigates away)
          const hit = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el ? { tag: el.tagName, marker: el.classList.contains("leaflet-marker-icon"), pane: !!el.closest(".leaflet-marker-pane") } : { tag: "none" }; }, [x, y]);
          if (hit.tag === "IMG" && !hit.marker && !hit.pane) { target = [x, y]; break; }
        }
        ok("E known-good arm: a point on the plan's own image was found to click", !!target);
        if (!target) return;
        await page.mouse.click(target[0], target[1]); await shot("4-clicked");
        // the click resolves the pin's county (a GIS identify) BEFORE the comps PATCH goes out — wait for that PATCH
        for (let i = 0; i < 50 && patches.length === before; i++) await settle(page, 500);
        await settle(page, 2500);
        ok("E known-good arm: the map click reached the comp write (a comps PATCH went out)", patches.length > before, `patches ${patches.length}; rail: ${(await page.evaluate(() => (document.querySelector('[data-testid="comp-record-docs-slot"]')?.parentElement?.innerText || "").replace(/\s+/g, " ").slice(0, 160)))}`);
      };
      const patches = [];
      page.on("request", (r) => { if (r.method() === "PATCH" && /\/rest\/v1\/comps\?/.test(r.url())) patches.push(r.url()); });
      const compRow = () => q(page, async (id) => (await window.pfSupabase.from("comps").select("anchor_kind,site_plan_overlay_id,lat,lon").eq("id", id).single()).data, cid);
      const pinFail = failRoute(page, /\/rest\/v1\/comps\?/, { status: 500, body: '{"message":"forced by verify-silent-writes-live"}' });
      await repin();
      ok("E refused re-pin: the record says 'Pin not moved'", (await page.locator('[data-testid="comp-pin-notice"]').count()) === 1, `route hits ${pinFail.hits}`);
      const c1 = await compRow();
      ok("E refused re-pin: the comp's anchor is unchanged in the database", !!c1 && c1.anchor_kind === "pin" && !c1.site_plan_overlay_id, JSON.stringify(c1));
      await pinFail.off();
      await repin();
      ok("E real re-pin: the notice is gone", (await page.locator('[data-testid="comp-pin-notice"]').count()) === 0);
      const c2 = await compRow();
      ok("E real re-pin: the comp is now pinned on the plan (anchor_kind site_plan)", !!c2 && c2.anchor_kind === "site_plan" && c2.site_plan_overlay_id === overlayId, JSON.stringify(c2));
      await page.reload({ waitUntil: "load" }); await settle(page, 3000);
      const c3 = await compRow();
      ok("E real re-pin persists across a reload", !!c3 && c3.anchor_kind === "site_plan", JSON.stringify(c3));
    }
  });
} catch (e) {
  ok("harness ran to the end", false, String(e && e.stack || e));
} finally {
  // ── cleanup (owner rule 15): everything this run made, then PROVE it is gone ──────────────
  // the arm may have navigated off the app (a stray marker click lands in the planner): come back to a page that holds the client
  if (!(await page.evaluate(() => !!window.pfSupabase).catch(() => false))) { await page.goto(`${BASE}/#/library`, { waitUntil: "load" }).catch(() => {}); await settle(page, 3000); }
  const left = await q(page, async ([m, base]) => {
    const c = window.pfSupabase, errors = [], tok = (await c.auth.getSession()).data.session.access_token;
    // SWEEP: every row carrying THIS harness's own prefix (an earlier run that navigated away could not clean itself)
    const P = "zz-livechk-sw-";
    const ids = async (t, col) => ((await c.from(t).select("id").like(col, `${P}%`)).data || []).map((r) => r.id);
    for (const id of await ids("comps", "title")) if (!m.comps.includes(id)) m.comps.push(id);
    for (const id of await ids("site_plan_overlays", "doc_title")) if (!m.overlays.includes(id)) m.overlays.push(id);
    for (const id of await ids("doc_reviews", "title")) if (!m.reviews.includes(id)) m.reviews.push(id);
    for (const id of await ids("org_model_sheets", "name")) if (!m.workbooks.includes(id)) m.workbooks.push(id);
    const stalePlans = (await ids("sites", "id")).filter((id) => id !== m.plan);
    for (const pid of stalePlans) {
      await c.from("project_folders").delete().eq("project_id", pid);
      await c.from("site_elements").delete().eq("site_id", pid);
      await c.from("sites").update({ deleted_at: new Date().toISOString() }).eq("id", pid);
      await c.from("sites").delete().eq("id", pid);
    }
    const run = async (label, p) => { const r = await p; if (r && r.error) errors.push(label + ": " + r.error.message); return r; };
    for (const id of m.comps) await run("comps", c.from("comps").delete().eq("id", id));
    for (const id of m.overlays) {
      const o = (await c.from("site_plan_overlays").select("raster_key,review_id").eq("id", id).single()).data;
      if (o && o.raster_key) await run("raster", c.storage.from("doc-review-files").remove([o.raster_key]));
      await run("overlay trash", c.from("site_plan_overlays").update({ deleted_at: new Date().toISOString() }).eq("id", id));
      await run("overlay", c.from("site_plan_overlays").delete().eq("id", id));
      if (o && o.review_id) m.reviews.push(o.review_id);
    }
    for (const id of m.reviews) {
      const rec = (await c.from("doc_reviews").select("data").eq("id", id).maybeSingle()).data;
      for (const src of ((rec && rec.data && rec.data.sources) || [])) {
        if (src.driveKey) { try { await fetch(`/api/files?key=${encodeURIComponent(src.driveKey)}`, { method: "DELETE", headers: { authorization: `Bearer ${tok}` } }); } catch (e) { errors.push("drive: " + e.message); } }
        if (src.storageKey) await run("bytes", c.storage.from("doc-review-files").remove([src.storageKey]));
      }
      await run("facts", c.from("file_facts").delete().or(`id.eq.${id},review_id.eq.${id}`));
      await run("review", c.from("doc_reviews").delete().eq("id", id));
    }
    for (const id of m.workbooks) await run("workbook", c.from("org_model_sheets").delete().eq("id", id));
    if (m.plan) await run("folders", c.from("project_folders").delete().eq("project_id", m.plan));
    const count = async (t, col, ids) => ids.length ? ((await c.from(t).select("id").in(col, ids)).data || []).length : 0;
    const stale = ((await c.from("sites").select("id").like("id", `${P}%`)).data || []).filter((r) => r.id !== m.plan).length;
    return { errors, stalePlans: stale, reviews: await count("doc_reviews", "id", m.reviews), overlays: await count("site_plan_overlays", "id", m.overlays), comps: await count("comps", "id", m.comps), workbooks: await count("org_model_sheets", "id", m.workbooks), folders: m.plan ? await count("project_folders", "project_id", [m.plan]) : 0 };
  }, [made, BASE]).catch((e) => ({ errors: [String(e)] }));
  let planLeft = null;
  if (made.plan) { const r = await cleanupLive(page, { planId: made.plan }).catch((e) => ({ errors: [String(e)], left: { site: "?" } })); planLeft = r.left; if (r.errors.length) left.errors.push(...r.errors); }
  const gone = !left.errors.length && !left.stalePlans && !left.reviews && !left.overlays && !left.comps && !left.workbooks && !left.folders && (!made.plan || planLeft.site === 0);
  ok("cleanup: every throwaway row is gone (delete-must-verify)", gone, JSON.stringify({ ...left, plan: planLeft }));
  await s.close();
}
process.exit(failures ? 1 : 0);
