/* verify-signed-in-project-delete — DOES DELETING A PROJECT ACTUALLY ASK THE DATABASE TO DELETE IT?
 *
 * ⛔ WHY THIS EXISTS, AND WHY EVERY EARLIER PROJECT-DELETE HARNESS COULD NOT HAVE CAUGHT THE BUG
 * IT WAS BUILT FOR (WRONG-CASE). `verify-b439-b440-project-manage.mjs` seeds
 * `planarfit:sites:v1` — the LOGGED-OUT store — and asserts the project leaves localStorage.
 * The owner's case is SIGNED IN, where the only thing that matters is a write to
 * `rest/v1/sites` setting `deleted_at`: the local half can succeed, the surrounding code can
 * report success, the app can navigate home, and the row can sit untouched in Postgres. That is
 * exactly what was measured on production (notes index rewritten, zero PATCH/POST to
 * rest/v1/sites, `deleted_at` still null). A logged-out harness cannot see any of it.
 *
 * The instrument: build with a STUB Supabase host, seed a real supabase-js session into
 * localStorage so the app is genuinely signed in (the sandbox proxy CORS-blocks a real sign-in —
 * the standing `Blocker: auth`), and intercept every request to that host. Then drive each
 * delete surface and assert a soft-delete write actually goes out.
 *
 * KNOWN-GOOD ARM (DRIVER-SCROLL-IS-NOT-APP-SCROLL §6): the run FAILS if the harness never sees
 * the app's ordinary signed-in traffic (a GET of `sites`), because a probe that cannot see the
 * app talking to the database at all cannot report that one particular write is missing.
 */
import pw from "/opt/node22/lib/node_modules/playwright/index.js";
import { assertMeasurable } from "./lib/tabTiming.mjs";
import { installStubSupabase } from "./lib/stubSupabase.mjs";
const { chromium } = pw;

const BASE = process.env.BASE_URL || "http://localhost:4173/";
const EXEC = process.env.PW_CHROME || "/opt/pw-browsers/chromium-1228/chrome-linux64/chrome";
const UID = "b147d90d-b610-423d-af65-7e004f0ad72f";

// Two projects, each with two plans, mirroring the owner's rows (a LIVE anchor: group_id === id).
const plan = (id, groupId, site, name, ts) => ({
  id, groupId, site, name, origin: null, county: null, parcels: [], els: [], measures: [],
  callouts: [], markups: [], settings: {}, underlay: null, updatedAt: ts,
});
const now = Date.now();
const localSites = {
  "zzdel-a": plan("zzdel-a", "zzdel-a", "ZZ Delete Me", "Concept A", now),
  "zzdel-a2": plan("zzdel-a2", "zzdel-a", "ZZ Delete Me", "Concept B", now - 500),
  "zzdel-b": plan("zzdel-b", "zzdel-b", "ZZ Keep Me", "Concept A", now - 1000),
  "zzdel-c": plan("zzdel-c", "zzdel-c", "ZZ Rename Me", "Concept A", now - 1500),
};
// A third project that exists ONLY in the cloud — this device never cached a plan for it.
const cloudOnly = { id: "zzghost", group_id: "zzghost", site: "ZZ Ghost", name: "Concept A" };

const jwt = (payload) => {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${b({ alg: "HS256", typ: "JWT" })}.${b(payload)}.sig`;
};
const session = {
  access_token: jwt({ sub: UID, role: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600, aud: "authenticated" }),
  refresh_token: "stub-refresh",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  expires_in: 3600,
  token_type: "bearer",
  user: { id: UID, aud: "authenticated", role: "authenticated", email: "owner@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
};

const seed = `(() => { try {
  localStorage.setItem('sb-stub-auth-token', ${JSON.stringify(JSON.stringify(session))});
  localStorage.setItem('planarfit:sites:cloud:${UID}', ${JSON.stringify(JSON.stringify(localSites))});
  localStorage.setItem('planarfit:current-site', 'zzdel-a');
} catch (e) {} })();`;

const results = [];
const ok = (name, cond, extra = "") => {
  results.push({ name, pass: !!cond, extra });
  console.log(`${cond ? "PASS" : "FAIL"} — ${name}${extra ? "  ::  " + extra : ""}`);
};

/* Every request the app makes to the stub Supabase host, in order. */
const wire = [];
const siteRow = (s) => ({ id: s.id, group_id: s.groupId, site: s.site, name: s.name, user_id: UID, team_id: null,
  share_locked: false, deleted_at: null, version: 1, updated_at: new Date(s.updatedAt).toISOString(),
  origin: null, county: null, parcels: [], els: [], measures: [], settings: {} });
const tables = {
  sites: [...Object.values(localSites).map(siteRow), { ...cloudOnly, user_id: UID, team_id: null, share_locked: false,
    deleted_at: null, version: 1, updated_at: new Date().toISOString(), origin: null, county: null, parcels: [], els: [], measures: [], settings: {} }],
  comps: [], site_elements: [], notes_trees: [], client_errors: [], doc_reviews: [], file_facts: [], upload_sessions: [],
};
const rowById = (id) => tables.sites.find((r) => r.id === id) || null;

const browser = await chromium.launch({ executablePath: EXEC, args: ["--no-sandbox", "--ignore-certificate-errors"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
const control = { failWrites: false };
await installStubSupabase(ctx, { tables, session, wire, control });
await ctx.addInitScript(seed);
const page = await ctx.newPage();
await assertMeasurable(page, "verify-signed-in-project-delete");
page.on("pageerror", (e) => console.log("  [pageerror]", String(e).slice(0, 200)));

const sitesWrites = () => wire.filter((w) => w.table === "sites" && w.method !== "GET" && w.method !== "HEAD");
const sitesReads = () => wire.filter((w) => w.table === "sites" && w.method === "GET");
const softDeletes = () => sitesWrites().filter((w) => w.method === "PATCH" && (w.body || "").includes("deleted_at"));

const openPicker = async () => {
  if (await page.$('input[placeholder="Search projects"]')) return;
  await page.click('[data-testid="project-crumb"]');
  await page.waitForSelector('input[placeholder="Search projects"]', { timeout: 8000 });
  await page.waitForTimeout(400);
};
const closePicker = async () => { await page.keyboard.press("Escape").catch(() => {}); await page.waitForTimeout(250); };

/* One delete attempt against one row, reported as a table line. */
async function attemptDelete(target, label, { moveNotes = false } = {}) {
  const before = softDeletes().length;
  await openPicker();
  const row = await page.$(`[data-testid="project-row-${target}"]`);
  ok(`the picker lists ${label}`, !!row, target);
  if (!row) { await closePicker(); return { label, wrote: 0, dialog: "", listed: false }; }
  await page.click(`[data-testid="project-row-${target}"]`, { button: "right" });
  await page.waitForSelector('[data-testid="project-delete"]', { timeout: 5000 });
  await page.click('[data-testid="project-delete"]');
  await page.waitForSelector('[data-testid="project-delete-confirm"]', { timeout: 5000 });
  await page.waitForTimeout(400);
  const dialog = await page.evaluate(() => {
    const b = document.querySelector('[data-testid="project-delete-confirm"]');
    const box = b && b.closest('[data-testid="project-manage-menu"]');
    return box ? box.innerText.replace(/\s+/g, " ").trim() : "";
  });
  const btn = moveNotes ? '[data-testid="project-delete-move-notes"]' : '[data-testid="project-delete-confirm"]';
  const has = await page.$(btn);
  if (!has) { await closePicker(); return { label, wrote: 0, dialog, listed: true, missingButton: true }; }
  await page.click(btn);
  await page.waitForTimeout(2500);
  const wrote = softDeletes().length - before;
  const rowNow = rowById(target);
  await closePicker();
  return { label, wrote, dialog, listed: true, dbDeletedAt: rowNow ? rowNow.deleted_at : "(row gone)" };
}

const table = [];
try {
  await page.goto(BASE + "#/site", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-testid="project-crumb"]', { timeout: 20000 });
  await page.waitForTimeout(2500);

  // KNOWN-GOOD ARM — a probe that cannot see the app talking to `sites` at all cannot report
  // that one particular write is missing. Refuse to score a vacuous run.
  const reads = sitesReads().length;
  ok("KNOWN-GOOD ARM: the signed-in app really does read rest/v1/sites (the probe can see the wire)", reads > 0, `${reads} GET(s)`);
  if (!reads) throw new Error("VACUOUS RUN — no sites traffic observed; the session seed did not take.");

  /* RENAME — same menu, same root cause (NEW-3). The inline editor used to be wiped in the same
   * batch that closed the dropdown, so Rename opened nothing at all. */
  {
    await openPicker();
    const row = await page.$('[data-testid="project-row-zzdel-c"]');
    if (row) {
      await page.click('[data-testid="project-row-zzdel-c"]', { button: "right" });
      await page.waitForSelector('[data-testid="project-rename"]', { timeout: 5000 });
      await page.click('[data-testid="project-rename"]');
      await page.waitForTimeout(600);
      const editor = await page.$('[data-testid="project-row-zzdel-c"] input');
      ok("Rename opens its inline editor (it used to open nothing at all)", !!editor);
    } else {
      ok("Rename opens its inline editor (it used to open nothing at all)", false, "row not listed");
    }
    await closePicker();
  }

  // CANCEL writes nothing — the control that proves the harness isn't just counting any traffic.
  {
    const before = softDeletes().length;
    await openPicker();
    await page.click('[data-testid="project-row-zzdel-b"]', { button: "right" });
    await page.waitForSelector('[data-testid="project-delete"]', { timeout: 5000 });
    await page.click('[data-testid="project-delete"]');
    await page.waitForSelector('[data-testid="project-delete-confirm"]', { timeout: 5000 });
    await page.click('text=Cancel');
    await page.waitForTimeout(800);
    ok("CONTROL: Cancel writes nothing", softDeletes().length === before, `${softDeletes().length - before} write(s)`);
    // ...and the dropdown is still open behind the row menu — the property the whole bug turned on.
    ok("the parent dropdown survives a press inside its own per-row menu", !!(await page.$('input[placeholder="Search projects"]')));
    await closePicker();
  }

  for (const [id, label] of [["zzdel-b", "a project that is NOT the current one"], ["zzdel-a", "the CURRENT project (a group with TWO plans)"]]) {
    const r = await attemptDelete(id, label);
    table.push({ id, ...r });
    ok(`the confirmation NAMES ${label}`, /ZZ /.test(r.dialog), r.dialog.slice(0, 110));
    ok(`deleting ${label} sets deleted_at in the database`, r.wrote > 0 && r.dbDeletedAt, `soft-delete writes: ${r.wrote}; row.deleted_at now: ${r.dbDeletedAt}`);
  }
  // Every plan in a multi-plan group is binned, not just the anchor row.
  ok("both plans of the two-plan project are soft-deleted (not just the anchor row)",
    !!(tables.sites.find((r) => r.id === "zzdel-a")?.deleted_at) && !!(tables.sites.find((r) => r.id === "zzdel-a2")?.deleted_at));

  /* ⛔ A REJECTED DELETE (B1361683) — and an honest note about what this harness CANNOT prove.
   *
   * The property is that a delete the server refuses must leave the project in the local list. This
   * harness can drive the refusal (`control.failWrites`) and confirm the row survives server-side,
   * and it does so below. It CANNOT discriminate the two orderings through the UI, and that was
   * measured, not assumed: with the old, broken ordering deliberately restored, every arm here —
   * including "is it still in the picker" and "is it still there after a reload" — reads GREEN,
   * because opening the picker runs `reconcileProjects()`, which re-pulls from the (still-serving)
   * database and restores whatever the local erasure had just dropped. A check that passes on the
   * defect is worse than no check, so it is not written here.
   *
   * Where the property IS observable, and mutation-proven in both directions, is
   * `test/deleteConfirmedBeforeLocal.test.js` — including the leg that makes the real-world case
   * dangerous: a rejected delete must leave NO durable tombstone, because a tombstone is exactly
   * what stops that healing re-pull and turns "vanished" into "vanished for good". */
  {
    control.failWrites = true;
    const r = await attemptDelete("zzdel-c", "a project whose cloud delete is REJECTED");
    table.push({ id: "zzdel-c", ...r });
    const rowAfter = tables.sites.find((x) => x.id === "zzdel-c");
    ok("a REJECTED delete leaves the row alive in the database", !!rowAfter && !rowAfter.deleted_at);
    control.failWrites = false;
  }

  console.log("\n--- per-case table ---");
  for (const r of table) console.log(`  ${r.id.padEnd(9)} ${String(r.wrote).padStart(2)} soft-delete write(s) · deleted_at=${r.dbDeletedAt} · "${(r.dialog || "").slice(0, 60)}"`);
  console.log("\n--- sites writes on the wire ---");
  for (const w of sitesWrites()) console.log(`  ${w.method} ${w.url.replace(/^https:\/\/stub\.supabase\.co/, "")} ${w.body ? "body=" + w.body.slice(0, 100) : ""}`);
} finally {
  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  await browser.close();
  if (failed.length) process.exitCode = 1;
}
