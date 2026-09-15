/* authRemount — DRIVE THE SIGNED-IN `loadEpoch` REMOUNT FROM A SANDBOX WITH NO CREDENTIALS.
 *
 * ⛔ WHY THIS EXISTS, AND IT IS NOT A CONVENIENCE. It is requirement #1 of the three
 * docs/incidents/B1594320-CANVAS-VISIBILITY-OUTAGE.md sets for re-attempting the hide-until-ready
 * gate, recorded verbatim there as something nobody had built:
 *
 *     "A way to actually exercise the signed-in `loadEpoch` remount from a sandbox with no live
 *      Supabase access. Route-interception of the specific GoTrue/PostgREST calls `applyUser` makes
 *      (fake INITIAL_SESSION + a separately-timed fake SIGNED_IN broadcast, exactly reproducing the
 *      two-event race above) would let a sandbox exercise this without real credentials. Nobody has
 *      built this yet; ui-audit/lib/planFixture.mjs seeds LOCAL storage only, never the auth layer."
 *
 * That gap is the whole reason B1574432 shipped with its riskiest path unverified. The flash it was
 * fixing rides a REMOUNT that only happens on a signed-in boot — `SitePlannerApp` keys the planner
 * `${activeSiteId}:${loadEpoch}` and `applyUser` bumps `loadEpoch` when the cloud pull settles — and
 * the authoring session could not sign in, so it substituted a route-change remount as a structural
 * proxy and parked the real path as `Verify: live, Blocker: auth`. A proxy for the one path that can
 * fail is the path that fails.
 *
 * ── HOW IT WORKS, AND WHY THE RACE IS NOT SIMULATED ─────────────────────────────────────────────
 * The incident doc proposes faking the two broadcasts. It turns out not to be necessary, and not
 * faking them is strictly better evidence: supabase-js produces the pair ITSELF from a resumed
 * session, so all this has to do is make one resumable. Read straight out of the installed
 * @supabase/auth-js's GoTrueClient:
 *
 *   · `_emitInitialSession(id)` fires `INITIAL_SESSION` to a NEW subscriber the instant it calls
 *     `onAuthStateChange`, with whatever session is in memory at that moment.
 *   · `_recoverAndRefresh()` — called once from `_initialize()` — separately reads the PERSISTED
 *     session and, when it is not near expiry, calls `_notifyAllSubscribers('SIGNED_IN', session)`,
 *     a broadcast to every subscriber registered by then.
 *
 * So a plausible non-expired session in the storage key the client reads produces the real
 * `INITIAL_SESSION` + `SIGNED_IN` sequence, from the real client, with the real timing — the very
 * thing the incident investigation could only reason about. Everything the resumed boot then calls
 * (`claimInvites`, `pullCloud`, `refreshSites` — PostgREST and RPC) is answered by a route handler
 * with empty, well-formed results, so the pull SETTLES, which is what bumps `loadEpoch`.
 *
 * ⛔ IT TOUCHES NO REAL ACCOUNT AND NO REAL DATA. The token is a locally-minted, unsigned JWT for a
 * made-up uid in a throwaway browser context; every request to the fake host is answered by the
 * harness itself and nothing leaves the process. The build it runs against must carry SOME Supabase
 * config (any dummy will do — `detectSupabase` reads whichever host the bundle was built with): with
 * none, `supabaseConfigured()` is false, `onAuthChange` is a no-op, and there is no auth path at all.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** The made-up identity this harness signs in as. Never a real account. */
export const AUTH_FIXTURE = {
  uid: "00000000-0000-4000-8000-00000000b00f",
  email: "boot-framing@example.invalid",
  /** What to build with when a bundle carries no Supabase config at all. Matches the convention
   *  `ui-audit/visual-regression.mjs` documents: any truthy value, never a real project. */
  suggestedUrl: "https://bootauth.supabase.co",
  suggestedKey: "boot-framing-auth-dummy-key",
};

/**
 * ⛔ THE SUPABASE HOST IS READ OUT OF THE BUILT BUNDLE, NEVER HARDCODED HERE.
 *
 * The first cut of this harness pinned its own dummy host, and the consequence appeared the first
 * time it met a build it had not made itself: `npm run ci-parity` builds with the visual-regression
 * harness's dummy values, so the precondition tripped and the whole run refused to score. It refused
 * CORRECTLY — a bundle pointing somewhere else is one this harness cannot drive — but requiring one
 * specific host makes for a poor guard, because the build it most needs to judge is the one CI
 * actually produced, not one built for its own convenience.
 *
 * Reading the host from the bundle stays hermetic even against a build carrying REAL secrets: every
 * request to whatever host is found is answered by the route handler below, so nothing leaves the
 * process either way, and no real project is contacted.
 *
 * Returns `{ url, ref }` — `ref` being the project ref supabase-js builds its storage key from
 * (`sb-<ref>-auth-token`) — or `null` when the bundle carries no Supabase config at all.
 */
export function detectSupabase(distDir) {
  const assets = join(distDir, "assets");
  if (!existsSync(assets)) return null;
  for (const f of readdirSync(assets)) {
    if (!f.endsWith(".js")) continue;
    const m = readFileSync(join(assets, f), "utf8").match(/https:\/\/([a-z0-9][a-z0-9-]*)\.supabase\.co/i);
    if (m) return { url: m[0], ref: m[1] };
  }
  return null;
}

/** A real-SHAPED unsigned JWT. Nothing verifies the signature client-side; the parts that matter are
 *  that it splits into three and that the payload decodes, because supabase-js reads `exp`/`sub`. */
function fakeJwt(uid, expSec, url) {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64({
    sub: uid, aud: "authenticated", role: "authenticated", iss: `${url}/auth/v1`,
    email: AUTH_FIXTURE.email, exp: expSec, iat: expSec - 3600,
  })}.bootframing-not-a-real-signature`;
}

/** The persisted session, exactly the shape `@supabase/auth-js` writes and reads back. */
export function fakeSession({ ttlSec = 3600, url = AUTH_FIXTURE.suggestedUrl } = {}) {
  const expires_at = Math.floor(Date.now() / 1000) + ttlSec;
  return {
    access_token: fakeJwt(AUTH_FIXTURE.uid, expires_at, url),
    refresh_token: "boot-framing-refresh",
    token_type: "bearer",
    expires_in: ttlSec,
    expires_at,
    user: {
      id: AUTH_FIXTURE.uid, aud: "authenticated", role: "authenticated", email: AUTH_FIXTURE.email,
      app_metadata: { provider: "email" }, user_metadata: {},
      created_at: new Date(Date.now() - 864e5).toISOString(),
      updated_at: new Date().toISOString(), email_confirmed_at: new Date(Date.now() - 864e5).toISOString(),
    },
  };
}

/**
 * `addInitScript` source that plants the resumable session before any app script runs.
 *
 * ⛔ TTL IS LOAD-BEARING. `_recoverAndRefresh` only broadcasts `SIGNED_IN` for a session that is NOT
 * close to expiry; a short-lived one takes the refresh branch instead, hits the network, and the
 * arm silently stops testing the two-event resume it claims to test.
 */
export function authSessionSeed({ ref, url, ...opts } = {}) {
  if (!ref) throw new Error("authSessionSeed: needs the project `ref` from detectSupabase()");
  return `(() => { try {
    localStorage.setItem(${JSON.stringify(`sb-${ref}-auth-token`)}, ${JSON.stringify(JSON.stringify(fakeSession({ ...opts, url })))});
  } catch (e) {} })();`;
}

/**
 * ⛔ A SIGNED-IN BOOT READS A DIFFERENT STORE, AND WITHOUT THIS THE ARM OPENS AN EMPTY APP.
 * `planFixture.fixtureSeed` writes `planarfit:sites:v1` — the logged-out/legacy store — but once
 * `activeUser` is set the working store is `planarfit:sites:cloud:<uid>` (see lib/activeUser.js).
 * Seeded only the legacy way, the resumed boot finds no such plan, never mounts a planner, and the
 * arm reports "nothing painted" for a reason that has nothing to do with framing.
 *
 * Copying the seeded plans across is also the FAITHFUL state, not a workaround: on the owner's cold
 * load the plan paints first from the DEVICE CACHE of his cloud store (that is the dimmed, correct
 * plan in his recording), and the cloud pull then settles on top of it. Install this AFTER the plan
 * seed — init scripts run in order, so it sees what that one wrote.
 */
export function cloudCacheSeed() {
  return `(() => { try {
    var raw = localStorage.getItem('planarfit:sites:v1');
    if (raw) localStorage.setItem('planarfit:sites:cloud:' + ${JSON.stringify(AUTH_FIXTURE.uid)}, raw);
  } catch (e) {} })();`;
}

/**
 * Answer every call the resumed boot makes, so the cloud pull SETTLES (an un-settled pull never
 * bumps `loadEpoch`, and the arm would then observe one mount and prove nothing).
 *
 * Returns a handler to install with `ctx.route("**", handler)`. Requests to the app's own origin are
 * passed to `onLocal`; everything that is not the fake Supabase host is aborted, exactly as the
 * other harnesses do, so the run stays hermetic.
 */
export function supabaseRouteHandler({ base, onLocal, liveSites = [], supabaseUrl }) {
  if (!supabaseUrl) throw new Error("supabaseRouteHandler: needs the `supabaseUrl` from detectSupabase()");
  const json = (route, body, status = 200) => route.fulfill({
    status, contentType: "application/json",
    headers: { "access-control-allow-origin": "*", "access-control-expose-headers": "content-range" },
    body: JSON.stringify(body),
  });
  return (route) => {
    const req = route.request();
    const url = req.url();
    if (url.startsWith(base)) return onLocal ? onLocal(route) : route.continue();
    if (!url.startsWith(supabaseUrl)) return route.abort();
    if (req.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: {
        "access-control-allow-origin": "*", "access-control-allow-methods": "*", "access-control-allow-headers": "*",
      }, body: "" });
    }
    /* GoTrue. `/user` is what a client asks to validate a resumed token; answering it keeps the
       session alive rather than letting the client sign itself out mid-boot. */
    if (url.includes("/auth/v1/user")) return json(route, fakeSession({ url: supabaseUrl }).user);
    if (url.includes("/auth/v1/token")) return json(route, fakeSession({ url: supabaseUrl }));
    if (url.includes("/auth/v1/logout")) return json(route, {});
    if (url.includes("/auth/v1/")) return json(route, {});
    /* ⛔ THE PROJECT MUST READ AS *LIVE*, or the route gate answers before a planner ever mounts.
       Signed in, Shell's route gate calls `checkProjectDeletionStatus` →
       `cloudSync.cloudCheckDeleted`, which asks `sites?select=id,group_id,site,name,deleted_at` by
       `id` and by `group_id`. With a blanket `[]` that reads "no rows found" → `exists: false`, and
       the app renders "This project doesn't exist" — no canvas, no mount, and every arm below
       reports a framing failure for a reason that has nothing to do with framing. (Measured: that
       is exactly what the first cut of this harness did.) So a FILTERED sites read answers with a
       live row for the seeded plan; the unfiltered pull still answers `[]`, which is the cheapest
       settling pull there is and leaves the never-synced local plan untouched (B124). */
    if (url.includes("/rest/v1/sites")) {
      const hit = liveSites.find((s) => url.includes(`eq.${encodeURIComponent(s.id)}`) || url.includes(`eq.${s.id}`));
      if (!hit) return json(route, []);
      return json(route, [{
        id: hit.id, group_id: hit.groupId || hit.id, site: hit.site || hit.name || hit.id,
        name: hit.name || hit.id, deleted_at: null, user_id: AUTH_FIXTURE.uid,
        updated_at: new Date().toISOString(),
      }]);
    }
    /* Everything else PostgREST. An empty collection is a complete, well-formed answer — the account
       has no other cloud rows — and it satisfies both a table read and every RPC this boot makes. */
    if (url.includes("/rest/v1/")) return json(route, []);
    return json(route, {});
  };
}
