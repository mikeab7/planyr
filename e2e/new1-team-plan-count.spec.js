/* NEW-1 — team-shared project plan-count repro.
 *
 * Reported symptom: a non-owner teammate on a shared team project ("Goose Creek") sees only
 * ONE plan in the "Plans in this site" switcher (SitePlanner.jsx's Plan crumb, ~line 17849,
 * gated on `plansHere.length > 1`), when the project actually has FIVE plans and a
 * rolled-back-transaction SELECT run as that user's real role + JWT confirms the database
 * correctly returns all five rows.
 *
 * Prior static analysis + unit tests (this session's predecessor) exonerated the entire pure
 * read/merge/list pipeline for this exact scenario. This spec drives the REAL app in a REAL
 * browser as a fake signed-in non-owner teammate — the one thing pure-function tests cannot
 * see — by intercepting every request to the configured Supabase origin with page.route() and
 * pre-seeding localStorage with a Supabase-shaped session, so no real network / real auth is
 * needed (the sandbox's proxy CORS-blocks real Supabase sign-in — a known, permanent
 * constraint; see CLAUDE.md).
 *
 * Two scenarios:
 *   A. "clean" — five Goose Creek rows with five DISTINCT ids (exactly what the prior
 *      session's Supabase read confirmed: all 5 rows share team_id/group_id but were never
 *      checked for `data->>'id'` collisions). If the pipeline is genuinely correct end to end,
 *      this must show 5.
 *   B. "id-collision" — five Goose Creek rows that are five DISTINCT physical PostgREST rows
 *      (as the DB read proved) but two of them carry the SAME internal `data.id` (the jsonb
 *      field the client actually keys everything on — `cloudList` doesn't even SELECT the
 *      row's real primary key). This is a plausible, previously-unchecked class of data
 *      anomaly that reproduces the EXACT reported shape: not zero plans, not a random count —
 *      exactly one fewer than five per collision, because `mergePulledSites` keys its map by
 *      `n.id` (siteModel.createSiteModel's `id: p.id`) and a later row with a colliding id
 *      silently overwrites an earlier one with no error, warning, or trace anywhere.
 *
 * Uses BASE_URL / local webServer per playwright.config.js. Requires the build to be
 * configured with a (fake, fully-mocked) VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY — set these
 * env vars before `npx playwright test` (see the repo's CLAUDE.md for why the client is a no-op
 * with neither set).
 */
import { test, expect } from "@playwright/test";

const SUPABASE_HOST = "plnrtestteam123456.supabase.co";
const SUPABASE_URL = `https://${SUPABASE_HOST}`;
const SUPABASE_REF = SUPABASE_HOST.split(".")[0];
const STORAGE_KEY = `sb-${SUPABASE_REF}-auth-token`;

// Real ids from the owner's live repro (kept for realism / cross-reference — nothing here talks
// to the real Supabase project; every request to SUPABASE_HOST is answered by page.route()).
const HIP_TEAM = "454aa114-1318-462d-8f78-ffad6ac01cac";
const BRYNDAN_UID = "74515a27-4157-4696-9c30-3f11c1bc7d16";
const BRYNDAN_EMAIL = "bryndan.nerren@hillwood.com";
const OWNER_UID = "b0a9f100-1111-4a2b-8c3d-000000000099"; // the HIP Houston member who owns/shared Goose Creek
const GOOSE_GROUP = "smqfy48tlk9j";
const GOOSE_SITE_NAME = "Goose Creek Industrial";

function authSession() {
  const now = Math.floor(Date.now() / 1000);
  const iso = new Date().toISOString();
  return {
    access_token: "test-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: now + 3600, // far from expiry → GoTrueClient's _recoverAndRefresh needs no network call
    refresh_token: "test-refresh-token",
    user: {
      id: BRYNDAN_UID, aud: "authenticated", role: "authenticated", email: BRYNDAN_EMAIL,
      email_confirmed_at: iso, phone: "", confirmed_at: iso, last_sign_in_at: iso,
      app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {},
      identities: [], created_at: iso, updated_at: iso,
    },
  };
}

// A slim cloud header — matches what cloudSync.slimForCloud actually stores (element
// collections empty + elementsInRows:true; teamId/ownerId/shareLocked are NEVER in the jsonb,
// only on the DB row's own team_id/user_id/share_locked columns, overlaid by cloudList).
function bareModel({ id, groupId, site, name, updatedAt }) {
  return {
    id, groupId, site, name, updatedAt,
    county: "harris", status: "active",
    origin: { lat: 29.7355, lon: -94.9774 },
    parcels: [], els: [], markups: [], measures: [], callouts: [], deletedIds: [],
    sheetOverlays: [], parcelDrawings: [], settings: {}, elementsInRows: true,
  };
}
// `rowId` = the row's real PostgREST primary key — ALWAYS distinct, exactly as it is for real
// (Postgres enforces `id` as the sites table's PK; two physical rows can never share it). `id` =
// the id embedded in the row's own jsonb `data` — normally identical to rowId (siteRowFor writes
// `row.id = m.id` on every save), but scenario B deliberately drifts it to model the anomaly
// under test. cloudList (fixed) selects+trusts rowId; the pre-fix client never even fetched it.
function siteRow({ rowId, id, groupId, site, name, updatedAt, teamId, ownerId, version }) {
  return { id: rowId, data: bareModel({ id, groupId, site, name, updatedAt }), version, team_id: teamId || null, user_id: ownerId || null, share_locked: false };
}

// Five Goose Creek plans, all sharing the group + team, all owned by the same (non-Bryndan)
// user — exactly the shape the owner's Supabase read confirmed. `idOverride` lets scenario B
// force a collision on the JSONB id while every row keeps its own distinct real PK (rowId).
function gooseCreekRows({ idOverride } = {}) {
  const names = ["Concept A", "Concept B", "Concept C", "Concept D", "Concept E"];
  return names.map((name, i) => {
    const naturalId = i === 0 ? GOOSE_GROUP : `${GOOSE_GROUP}p${i + 1}`;
    const jsonId = (idOverride && idOverride(i, naturalId)) || naturalId;
    return siteRow({
      rowId: naturalId, id: jsonId,
      groupId: GOOSE_GROUP, site: GOOSE_SITE_NAME, name,
      updatedAt: Date.now() - i * 60_000, teamId: HIP_TEAM, ownerId: OWNER_UID, version: 100 + i,
    });
  });
}

// Five more groups / seven more plans, so the account totals "12 rows across 6 projects" like
// the owner's real portfolio — not load-bearing for the assertion, just realistic surrounding data.
function otherRows() {
  const groups = [
    { id: "sother0001", site: "Baytown Crossing", plans: 1 },
    { id: "sother0002", site: "Cedar Port Tract", plans: 1 },
    { id: "sother0003", site: "La Porte Yard", plans: 1 },
    { id: "sother0004", site: "Channelview Site", plans: 1 },
    { id: "sother0005", site: "Highlands Reserve", plans: 3 },
  ];
  const rows = []; let v = 1;
  for (const g of groups) {
    for (let i = 0; i < g.plans; i++) {
      const rid = i === 0 ? g.id : `${g.id}p${i + 1}`;
      rows.push(siteRow({
        rowId: rid, id: rid, groupId: g.id, site: g.site,
        name: i === 0 ? "Layout 1" : `Layout ${i + 1}`,
        updatedAt: Date.now() - (100 + v) * 60_000, teamId: null, ownerId: BRYNDAN_UID, version: v,
      }));
      v++;
    }
  }
  return rows;
}

// Intercept every request. Same-origin (the local preview server) passes through untouched;
// everything to SUPABASE_HOST is answered from the fixture; every other external host (aerial
// tiles, GIS services, fonts) is aborted so the run is deterministic and fully offline.
async function mockSupabase(page, allRows) {
  await page.addInitScript(([key, session]) => {
    try { window.localStorage.setItem(key, JSON.stringify(session)); } catch (_) {}
  }, [STORAGE_KEY, authSession()]);

  // No realtime backend to talk to — close any websocket attempt immediately rather than
  // letting it hang or retry against a non-resolving host.
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });

  await page.route("**/*", async (route) => {
    const req = route.request();
    let u;
    try { u = new URL(req.url()); } catch (_) { return route.continue(); }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname !== SUPABASE_HOST) return route.abort(); // aerial tiles / GIS / fonts — block, deterministic + offline

    const path = u.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/auth/v1/health") return json({ date: new Date().toISOString() });
    if (path === "/auth/v1/user") return json({ user: authSession().user });
    if (path.startsWith("/auth/v1/")) return json({}); // any other stray auth call — harmless default

    if (path === "/rest/v1/sites" && req.method() === "GET") {
      const select = u.searchParams.get("select") || "";
      // cloudList's real select is "(id,) data,version,team_id,user_id,share_locked" —
      // distinguish from cloudDeletedRows' "id,group_id,site,name,county,updated_at,deleted_at"
      // by the presence of "version", which only the former selects. `allRows` always carries
      // the row's real `id` (its PostgREST primary key) alongside `data` regardless of whether
      // the select param asked for it — harmless before the fix (unread), load-bearing after.
      if (select.includes("version")) return json(allRows);
      return json([]); // cloudDeletedRows — nothing soft-deleted in this fixture
    }
    if (path.startsWith("/rest/v1/rpc/claim_team_invites")) return json(0);
    if (path.startsWith("/rest/v1/rpc/")) return json([]);
    if (path.startsWith("/rest/v1/")) return json([]); // site_elements, teams, team_members, profiles, …

    return json({});
  });
}

// Open the "Your sites" left-rail row for the given project name (MapFinder.jsx siteRow —
// a plain clickable div, title="Open site …", no search-panel/tile dependency) and wait for
// the planner to mount on one of its plans.
async function openProjectFromMap(page, siteName) {
  const row = page.locator('[title^="Open site"]').filter({ hasText: siteName }).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.click();
  await expect(page.getByTestId("planner-canvas")).toBeVisible({ timeout: 20_000 });
}

// Open the Plan ▾ crumb and return how many "Plans in this site" rows are showing, read off
// the per-row Delete button's aria-label ("Delete plan <name>") — present exactly once per row
// in `plansHere`, and ONLY when plansHere.length > 1 (NEW-3/B385042: a single-plan site shows
// no switcher list at all, by design — so a collapse to 1 plan reads as ZERO rows here, not one).
async function planSwitcherNames(page) {
  await page.getByTestId("plan-crumb").click();
  // Let the AnchoredMenu portal place itself.
  await page.waitForTimeout(150);
  const deleteButtons = page.locator('button[aria-label^="Delete plan "]');
  const n = await deleteButtons.count();
  const names = [];
  for (let i = 0; i < n; i++) names.push((await deleteButtons.nth(i).getAttribute("aria-label")).replace(/^Delete plan /, ""));
  return names;
}

test.describe("NEW-1 — team plan-count switcher", () => {
  test("A: clean data (5 distinct plan ids) — the switcher shows all 5", async ({ page }) => {
    test.setTimeout(90_000);
    const rows = [...gooseCreekRows(), ...otherRows()];
    await mockSupabase(page, rows);
    await page.goto("/", { waitUntil: "load" });

    await openProjectFromMap(page, GOOSE_SITE_NAME);
    const names = await planSwitcherNames(page);
    expect(names.sort(), "clean 5-distinct-id data must show all 5 plans").toEqual(
      ["Concept A", "Concept B", "Concept C", "Concept D", "Concept E"].sort()
    );
  });

  test("B: a jsonb id collision across two rows must not collapse the switcher (regression)", async ({ page }) => {
    test.setTimeout(90_000);
    // Two DISTINCT physical rows (five distinct real primary keys / versions / content) share
    // ONE `data.id` — a data anomaly the owner's prior DB check never ruled out (it checked the
    // `id` PRIMARY KEY column and `data->>'groupId'`, never `data->>'id'`, which is the only
    // field the PRE-FIX client keyed its merge on — cloudList didn't even SELECT the row's real
    // PK to catch the drift). Reproduced red against the pre-fix code (git stash the fix, rerun:
    // the switcher shows 4, "Concept B" missing — storage.js's mergePulledSites map[n.id] = ...
    // silently kept only ONE of the two colliding rows, zero error anywhere).
    // Fixed: cloudList now selects the row's own id and corrects a drifted jsonb id to match it
    // before the merge ever sees it, so five distinct rows stay five distinct plans regardless.
    const rows = [
      ...gooseCreekRows({ idOverride: (i, naturalId) => (i === 1 ? GOOSE_GROUP : naturalId) }), // "Concept B"'s jsonb claims "Concept A"'s id
      ...otherRows(),
    ];
    await mockSupabase(page, rows);
    await page.goto("/", { waitUntil: "load" });

    await openProjectFromMap(page, GOOSE_SITE_NAME);
    const names = await planSwitcherNames(page);
    expect(names.sort(), "a jsonb id collision must not silently drop a plan from the switcher").toEqual(
      ["Concept A", "Concept B", "Concept C", "Concept D", "Concept E"].sort()
    );
  });
});
