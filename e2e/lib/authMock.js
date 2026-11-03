/* Shared mock for the sign-in panel specs (NEW-1, follow-up to B2619760): Supabase's auth endpoints
 * AND Cloudflare's Turnstile script, both faked, so a spec drives the REAL built app. Needs a build
 * with dummy config baked in (see the header of auth-dead-ends.spec.js).
 *
 * The fake GoTrue behaves like the real one with captcha ON: a password grant, a recover and a
 * signup need a token and a token is SINGLE USE (a spent or missing one → 400 captcha_failed with the
 * raw words). A refresh-token grant needs none. `cfg.respond(u, body, req)` lets a test override any
 * answer: return `{ status, json }`, the string "abort" (a network failure), or undefined for default.
 *
 * The fake Turnstile issues a NEW token on render and on every reset(); `window.__tsNoToken` stops it
 * issuing; `window.__tsInteractive()` shows a visible challenge (tall host, before-interactive
 * callback); `window.__tsTimeout()` fires Cloudflare's own timeout-callback; `window.__ts.renders`
 * records how it was rendered (appearance, size, sitekey). */

export const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "";
export const HOST = SUPABASE_URL ? new URL(SUPABASE_URL).hostname : "";
export const SITE_KEY = process.env.VITE_TURNSTILE_SITE_KEY || "";
export const STORAGE_KEY = `sb-${HOST.split(".")[0]}-auth-token`;
export const RAW_CAPTCHA = "captcha protection: request disallowed (no captcha_token found)";
export const USER = { id: "00000000-0000-4000-8000-000000000002", aud: "authenticated", role: "authenticated", email: "a@example.com", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() };

export const FAKE_TURNSTILE = `
  (function () {
    var n = 0, widgets = {}, gateOpen = true, waiting = [];
    var last = null, lastEl = null;
    window.__ts = { renders: [], resets: 0, removes: 0 };
    window.__tsDeliver = function (t) { if (last) last.callback(t); };
    window.__tsHold = function () { gateOpen = false; };
    window.__tsRelease = function () { gateOpen = true; var w = waiting; waiting = []; w.forEach(function (f) { f(); }); };
    window.__tsInteractive = function () {
      if (lastEl) { lastEl.style.height = "65px"; lastEl.style.minWidth = "300px"; lastEl.setAttribute("data-fake-challenge", "1"); }
      if (last) last["before-interactive-callback"]();
    };
    window.__tsTimeout = function () { if (last) last["timeout-callback"](); };
    function issue(id) {
      var go = function () { var w = widgets[id]; if (w) w.callback("tok-" + (++n)); };
      if (gateOpen) setTimeout(go, 30); else waiting.push(go);
    }
    window.turnstile = {
      render: function (el, o) {
        var id = "w" + (++n);
        widgets[id] = o; last = o; lastEl = el;
        window.__ts.renders.push({ appearance: o.appearance, size: o.size, sitekey: o.sitekey, refresh: o["refresh-expired"] });
        if (!window.__tsNoToken) issue(id);
        return id;
      },
      reset: function (id) { window.__ts.resets++; if (widgets[id] && !window.__tsNoToken) issue(id); },
      remove: function (id) { window.__ts.removes++; delete widgets[id]; },
    };
  })();
`;

export function sessionFor(user = USER, { expiresAt = Math.floor(Date.now() / 1000) + 3600, refresh = "ref" } = {}) {
  return { access_token: "tok", token_type: "bearer", expires_in: 3600, expires_at: expiresAt, refresh_token: refresh, user };
}

/** Installs the mock. Returns { calls, rest, cfg } — `calls` is every gated auth POST, `rest` every /rest/v1 request. */
export async function mockAuth(page, { rawOnly = false, scriptOk = true, cfg: extra = {} } = {}) {
  const calls = [];
  const rest = [];
  const cfg = { respond: null, refreshOk: true, ...extra };
  const seen = new Set();
  await page.routeWebSocket(/.*/, (ws) => { try { ws.close(); } catch (_) {} });
  await page.route("**/*", async (route) => {
    let u; try { u = new URL(route.request().url()); } catch (_) { return route.continue(); }
    if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return route.continue();
    if (u.hostname === "challenges.cloudflare.com") {
      if (!scriptOk) return route.abort();
      return route.fulfill({ status: 200, contentType: "application/javascript", body: FAKE_TURNSTILE });
    }
    if (u.hostname !== HOST) return route.abort();
    const json = (b, s = 200) => route.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(b) });
    const body = (() => { try { return JSON.parse(route.request().postData() || "{}"); } catch (_) { return {}; } })();
    const grant = u.searchParams.get("grant_type");
    const over = cfg.respond ? cfg.respond(u, body, route.request(), calls.length) : undefined;
    if (over === "abort") return route.abort();
    if (over && typeof over === "object") { if (u.pathname.startsWith("/rest/")) rest.push(u.pathname); else if (/^\/auth\/v1\/(token|recover|signup)$/.test(u.pathname)) calls.push({ path: u.pathname, grant, tok: body.gotrue_meta_security && body.gotrue_meta_security.captcha_token, body, answered: over.status }); return json(over.json, over.status || 200); }
    const tok = body.gotrue_meta_security && body.gotrue_meta_security.captcha_token;
    const refresh = u.pathname === "/auth/v1/token" && grant === "refresh_token";
    const gated = !refresh && (u.pathname === "/auth/v1/token" || u.pathname === "/auth/v1/recover" || u.pathname === "/auth/v1/signup");
    if (gated) {
      calls.push({ path: u.pathname, grant, tok, body });
      if (rawOnly || !tok || seen.has(tok)) return json({ code: 400, error_code: "captcha_failed", msg: RAW_CAPTCHA }, 400);
      seen.add(tok);
    }
    if (refresh) {
      calls.push({ path: u.pathname, grant, refresh: true });
      if (!cfg.refreshOk) return route.abort();
      return json(sessionFor());
    }
    if (u.pathname === "/auth/v1/token") {
      if (body.password !== "right-password") return json({ code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" }, 400);
      return json(sessionFor());
    }
    if (u.pathname === "/auth/v1/recover") return json({});
    if (u.pathname === "/auth/v1/signup") return json(USER);
    if (u.pathname === "/auth/v1/user") return json(USER);
    if (u.pathname === "/auth/v1/logout") return route.fulfill({ status: 204, body: "" });
    if (u.pathname.startsWith("/rest/v1/")) {
      rest.push(u.pathname);
      // `cfg.sites` = the cloud rows the signed-in account owns (a real project for the route gate / the planner to open).
      return json(u.pathname === "/rest/v1/sites" && route.request().method() === "GET" ? (cfg.sites || []) : []);
    }
    return json({});
  });
  return { calls, rest, cfg };
}

export const dlg = (page) => page.getByRole("dialog");
export const submit = (page) => page.getByTestId("auth-submit");
export async function fillSignIn(page, pw, email = "a@example.com") {
  await dlg(page).getByLabel("Email").fill(email);
  await dlg(page).getByLabel("Password").fill(pw);
}

/** A minimal cloud `sites` row for a project the signed-in test account owns. */
export function siteRow({ id = "smtestplan01", group = "smtestgroup01", site = "Test Project", name = "Concept A" } = {}) {
  const updatedAt = Date.now();
  return { id, group_id: group, site, name, county: null, team_id: null, owner_id: USER.id, version: 1, deleted_at: null, updated_at: new Date(updatedAt).toISOString(), created_at: new Date(updatedAt).toISOString(), data: { id, groupId: group, site, name, updatedAt } };
}
