/* verify-project-purge — the account bin's "Delete forever" on a whole binned project (NEW-1).
 * Drives the REAL button against a stub database, three arms:
 *   normal — KNOWN-GOOD ARM: the DELETE removes the row; row leaves the list, folders torn down.
 *   zero   — the DELETE matches nothing (a policy refusal reads exactly like this): the row STAYS
 *            listed, a toast names why, and NO folder teardown runs. Red on the code before NEW-1
 *            (silent success + teardown of a project that still existed).
 * MODE=normal|zero. Exits 1 on any failed expectation. */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { installStubSupabase } from "./lib/stubSupabase.mjs";
const { chromium } = pw;
const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium";
const MODE = process.env.MODE || "normal"; // normal | zero | error
const UID = "b147d90d-b610-423d-af65-7e004f0ad72f";
const jwt = (p) => { const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url"); return `${b({ alg: "HS256", typ: "JWT" })}.${b(p)}.sig`; };
const session = { access_token: jwt({ sub: UID, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" }), refresh_token: "x", expires_at: Math.floor(Date.now() / 1000) + 3600, expires_in: 3600, token_type: "bearer", user: { id: UID, aud: "authenticated", role: "authenticated", email: "o@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } };
const live = { id: "zzlive", groupId: "zzlive", site: "ZZ Live", name: "Concept A", origin: null, county: null, parcels: [], els: [], measures: [], callouts: [], markups: [], settings: {}, underlay: null, updatedAt: Date.now() };
const row = (id, site, del) => ({ id, group_id: id, site, name: "Concept A", user_id: UID, team_id: null, share_locked: false, deleted_at: del, version: 1, updated_at: new Date(Date.now() - 86400000).toISOString(), data: { id, groupId: id }, origin: null, county: null, parcels: [], els: [], measures: [], settings: {} });
const tables = { sites: [row("zzlive", "ZZ Live", null), row("zzbin", "Untitled site", new Date(Date.now() - 3600000).toISOString())], comps: [], site_elements: [], notes_trees: [], client_errors: [], doc_reviews: [], file_facts: [], upload_sessions: [], project_folders: [] };
const wire = []; const control = {};
const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await installStubSupabase(ctx, { tables, session, wire, control });
if (MODE === "zero") await ctx.route("**/rest/v1/sites?*id=eq.zzbin*", async (r) => { if (r.request().method() === "DELETE") { wire.push({ method: "DELETE(zero)", table: "sites", url: r.request().url() }); return r.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: "[]" }); } return r.fallback(); });
await ctx.addInitScript(`(() => { try { localStorage.setItem('sb-stub-auth-token', ${JSON.stringify(JSON.stringify(session))}); localStorage.setItem('planarfit:sites:cloud:${UID}', ${JSON.stringify(JSON.stringify({ zzlive: live }))}); localStorage.setItem('planarfit:current-site','zzlive'); } catch (e) {} })();`);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-project-purge");
page.on("pageerror", (e) => console.log("[pageerror]", String(e).slice(0, 200)));
await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
await page.waitForSelector('[data-testid="project-crumb"]', { timeout: 20000 });
await page.waitForTimeout(2500);
await page.click('[data-testid="project-crumb"]');
await page.waitForSelector('[data-testid="project-bin-toggle"]', { timeout: 8000 });
await page.click('[data-testid="project-bin-toggle"]');
await page.waitForSelector('[data-testid="project-restore-zzbin"]', { timeout: 8000 });
console.log("bin lists zzbin: yes");
const mark = wire.length;
await page.click('button[aria-label^="Permanently delete"]');
await page.click('[data-testid="project-purge-confirm-zzbin"]');
await page.waitForTimeout(3500);
const after = await page.$('[data-testid="project-restore-zzbin"]');
const toast = await page.$eval('[data-testid="project-at-risk-toast"]', (e) => e.innerText).catch(() => null);
console.log("row still listed after purge:", !!after, "| toast:", toast);
console.log("db still holds zzbin:", tables.sites.some((r) => r.id === "zzbin"));
const sent = wire.slice(mark);
const folderDelete = sent.some((w) => w.method === "DELETE" && w.table === "project_folders");
let bad = 0; const ex = (n, c) => { console.log((c ? "PASS" : "FAIL") + " — " + n); if (!c) bad++; };
if (MODE === "normal") {
  ex("KNOWN-GOOD: the row leaves the bin", !after);
  ex("KNOWN-GOOD: the database no longer holds it", !tables.sites.some((r) => r.id === "zzbin"));
  ex("KNOWN-GOOD: its folders are torn down", folderDelete);
} else {
  ex("the row STAYS listed (nothing was deleted)", !!after);
  ex("a toast says it didn't work and why", !!toast && /couldn't be permanently deleted/.test(toast) && /still in your account/.test(toast));
  ex("NO folder teardown ran against the surviving project", !folderDelete);
}
for (const w of sent) console.log(" ", w.method, w.table, (w.url || "").replace(/^https:\/\/stub.supabase.co\/rest\/v1\//, "").slice(0, 110));
await browser.close();
process.exit(bad ? 1 : 0);
