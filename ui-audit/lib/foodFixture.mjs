/* foodFixture — a fully-mocked, signed-in /food session for browser harnesses. NOTHING here talks
 * to the real Supabase project or touches the owner's food list: every request to the fixture
 * Supabase origin is answered from the in-memory fixture below, and every write (POST/PATCH/DELETE
 * on food_visits) is RECORDED into `state.writes`, never sent anywhere. Build the app with
 *   VITE_SUPABASE_URL=https://plnrtestfood123456.supabase.co VITE_SUPABASE_ANON_KEY=fixture-anon
 * so the client points at the mocked origin (same pattern as e2e/new1-team-plan-count.spec.js).
 *
 * The fixture holds the shapes the owner's real phone walk hit (B2046224):
 *   · DAO'N       — saved as a MANUAL pin AND present in the place snapshot ~40 m away (the duplicate)
 *   · Dao'n-style spelling variants of the same pair (curly apostrophe / lower case) via `variant`
 *   · Fadi's Mediterranean Grill — a snapshot restaurant he has NEVER saved, ~9 km from the map's start
 *   · Torchy's Tacos ×2 — a real chain: two genuinely different branches, must stay two rows
 */
export const SUPABASE_HOST = "plnrtestfood123456.supabase.co";
export const STORAGE_KEY = `sb-${SUPABASE_HOST.split(".")[0]}-auth-token`;
export const FIXTURE_UID = "00000000-0000-4000-8000-00000000f00d";

export const START = { lat: 29.7604, lon: -95.3698 }; // downtown Houston (the map's default centre)
export const DAON_AT = { lat: 29.7380, lon: -95.5300 };

function authSession() {
  const now = Math.floor(Date.now() / 1000);
  const iso = new Date().toISOString();
  return {
    access_token: "fixture-access-token", token_type: "bearer", expires_in: 3600, expires_at: now + 3600,
    refresh_token: "fixture-refresh-token",
    user: { id: FIXTURE_UID, aud: "authenticated", role: "authenticated", email: "fixture@example.test",
      email_confirmed_at: iso, phone: "", confirmed_at: iso, last_sign_in_at: iso,
      app_metadata: { provider: "email", providers: ["email"] }, user_metadata: {}, identities: [], created_at: iso, updated_at: iso },
  };
}

/** variant: "plain" (DAO'N / DAO'N) · "case" (manual "dao'n" vs snapshot "DAO'N") · "curly" (manual "DAO’N"). */
export function makeFixture({ variant = "plain" } = {}) {
  const manualName = variant === "case" ? "dao'n" : variant === "curly" ? "DAO’N" : "DAO'N";
  const places = [
    { id: "fx-daon", name: "DAO'N", lat: DAON_AT.lat + 0.00035, lon: DAON_AT.lon, category: "restaurant", cuisine: "asian", address: "1 Fixture Way, Houston, TX 77077", brand: null, source: "fixture", source_licence: "x", metro: "houston", confidence: 0.95 },
    { id: "fx-fadis", name: "Fadi's Mediterranean Grill", lat: 29.6800, lon: -95.4600, category: "restaurant", cuisine: "mediterranean", address: "2 Fixture Way, Houston, TX 77036", brand: null, source: "fixture", source_licence: "x", metro: "houston", confidence: 0.97 },
    { id: "fx-torchys-a", name: "Torchy's Tacos", lat: 29.7400, lon: -95.4000, category: "restaurant", cuisine: "mexican", address: "3 Fixture Way, Houston, TX 77002", brand: "Torchy's", source: "fixture", source_licence: "x", metro: "houston", confidence: 0.97 },
    { id: "fx-torchys-b", name: "Torchy's Tacos", lat: 29.7700, lon: -95.4300, category: "restaurant", cuisine: "mexican", address: "4 Fixture Way, Houston, TX 77007", brand: "Torchy's", source: "fixture", source_licence: "x", metro: "houston", confidence: 0.97 },
  ];
  const visits = [{
    id: "00000000-0000-4000-8000-0000000000a1", user_id: FIXTURE_UID, place_id: null,
    custom_name: manualName, custom_lat: DAON_AT.lat, custom_lon: DAON_AT.lon,
    visited_on: "2026-09-01", rating: "8.5", rating_ambiance: null, cost: null, what_i_had: "noodles", what_was_good: null, notes: null,
    created_at: "2026-09-01T12:00:00Z", updated_at: "2026-09-01T12:00:00Z",
  }];
  return { places, visits, writes: [], manualName };
}

export async function installFixture(page, state, { e2e = true } = {}) {
  await page.addInitScript(([key, session, flag]) => {
    try { window.localStorage.setItem(key, JSON.stringify(session)); } catch (_) {}
    if (flag) window.__PLANYR_E2E = true; // exposes window.__foodMap (read-only camera reads)
  }, [STORAGE_KEY, authSession(), e2e]);
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    const req = route.request();
    let u; try { u = new URL(req.url()); } catch (_) { return route.continue(); }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname !== SUPABASE_HOST) return route.abort(); // tiles / GIS / fonts: blocked, deterministic
    const path = u.pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(body) });
    if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" } });
    if (path === "/auth/v1/user") return json(authSession().user);
    if (path.startsWith("/auth/v1/")) return json({});
    if (path === "/rest/v1/rpc/food_places_in_bounds_sampled") {
      const b = JSON.parse(req.postData() || "{}");
      const rows = state.places.filter((p) => p.lat >= b.p_south && p.lat <= b.p_north && p.lon >= b.p_west && p.lon <= b.p_east);
      return json(rows.map((p) => ({ ...p, total_matched: rows.length })));
    }
    if (path === "/rest/v1/rpc/food_places_search_by_name") {
      const b = JSON.parse(req.postData() || "{}");
      const q = (b.p_query || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const rows = state.places.filter((p) => p.name.toLowerCase().replace(/[^a-z0-9]/g, "").includes(q));
      return json(rows.map((p) => ({ ...p, sim: 1, distance_km: 1 })));
    }
    if (path === "/rest/v1/food_places") {
      const ids = (u.searchParams.get("id") || "").replace(/^in\.\(|\)$/g, "").split(",").map((s) => s.replace(/"/g, ""));
      return json(state.places.filter((p) => ids.includes(p.id)));
    }
    if (path === "/rest/v1/food_visits") {
      if (req.method() === "GET") return json(state.visits);
      if (req.method() === "POST") {
        const body = JSON.parse(req.postData() || "{}");
        state.writes.push({ method: "POST", table: "food_visits", body });
        const row = { id: `00000000-0000-4000-8000-${String(state.writes.length).padStart(12, "0")}`, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), ...body };
        state.visits = [row, ...state.visits];
        return json(row, 201);
      }
      state.writes.push({ method: req.method(), table: "food_visits", body: req.postData() });
      return json([]);
    }
    if (path.startsWith("/rest/v1/")) return json([]); // wishlist, dishes, dish wishlist: empty
    return json({});
  });
}
