/* Verify a GitHub Actions OIDC token (NEW-1, 2026-11-02) — how the hourly sign-in check proves to the alarm route that it
 * IS this repo's workflow, with NO stored secret on either side.
 *
 * WHY NOT A SHARED SECRET. A shared key needs a human to paste it into Cloudflare AND GitHub, and until they do the
 * alarm is dead — an alarm that depends on a manual step to exist is the exact failure class this feature is for.
 * GitHub signs a short-lived token for every workflow run (`permissions: id-token: write`); this verifies that
 * signature against GitHub's published keys (JWKS) with WebCrypto and checks the claims below. Forging it needs
 * GitHub's private key; the claims pin it to ONE workflow file on the main branch of this repository, so a pull-request
 * branch, a fork, or another workflow in this repo is refused.
 *
 * Pure: the network (JWKS fetch) and the clock are injected so test/githubOidc.test.js drives it with a generated key. */

export const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
export const JWKS_URL = `${GITHUB_OIDC_ISSUER}/.well-known/jwks`;
export const EXPECTED_REPOSITORY = "mikeab7/planyr";
export const EXPECTED_WORKFLOW = ".github/workflows/signin-health.yml";
export const EXPECTED_REF = "refs/heads/main";
export const EXPECTED_AUDIENCE = "https://planyr.io";
const SKEW_S = 60;
const JWKS_TTL_MS = 60 * 60 * 1000;

let jwksCache = null; // { keys, at }

const b64urlToBytes = (s) => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(String(s).replace(/-/g, "+").replace(/_/g, "/") + pad);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};
const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function loadJwks(fetchImpl, nowMs, force) {
  if (!force && jwksCache && nowMs - jwksCache.at < JWKS_TTL_MS) return jwksCache.keys;
  const res = await fetchImpl(JWKS_URL, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`JWKS fetch answered ${res.status}`);
  const j = await res.json();
  if (!j || !Array.isArray(j.keys)) throw new Error("JWKS had no keys");
  jwksCache = { keys: j.keys, at: nowMs };
  return j.keys;
}
export const _resetJwksCacheForTest = () => { jwksCache = null; };

/**
 * → { ok:true, claims } | { ok:false, error }. Never throws.
 * `expected` overrides the pinned repository/workflow/ref/audience (tests only).
 */
export async function verifyGithubOidc({ token, fetchImpl = fetch, nowMs = Date.now(), expected = {} } = {}) {
  const want = {
    repository: expected.repository || EXPECTED_REPOSITORY,
    workflow: expected.workflow || EXPECTED_WORKFLOW,
    ref: expected.ref || EXPECTED_REF,
    audience: expected.audience || EXPECTED_AUDIENCE,
  };
  try {
    const parts = String(token || "").split(".");
    if (parts.length !== 3) return { ok: false, error: "malformed token" };
    const header = b64urlToJson(parts[0]);
    const claims = b64urlToJson(parts[1]);
    if (header.alg !== "RS256" || !header.kid) return { ok: false, error: "unsupported token header" };

    let keys = await loadJwks(fetchImpl, nowMs, false);
    let jwk = keys.find((k) => k.kid === header.kid);
    if (!jwk) { keys = await loadJwks(fetchImpl, nowMs, true); jwk = keys.find((k) => k.kid === header.kid); } // a rotated key
    if (!jwk) return { ok: false, error: "unknown signing key" };

    const key = await crypto.subtle.importKey("jwk", { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: "RS256", ext: true }, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const signed = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
    const okSig = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlToBytes(parts[2]), signed);
    if (!okSig) return { ok: false, error: "bad signature" };

    const nowS = Math.floor(nowMs / 1000);
    if (claims.iss !== GITHUB_OIDC_ISSUER) return { ok: false, error: "wrong issuer" };
    const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!aud.includes(want.audience)) return { ok: false, error: "wrong audience" };
    if (!(Number(claims.exp) > nowS - SKEW_S)) return { ok: false, error: "expired" };
    if (claims.nbf != null && Number(claims.nbf) > nowS + SKEW_S) return { ok: false, error: "not yet valid" };
    if (claims.repository !== want.repository) return { ok: false, error: "wrong repository" };
    if (claims.ref !== want.ref) return { ok: false, error: "wrong ref" };
    const wf = String(claims.job_workflow_ref || claims.workflow_ref || "");
    if (!wf.startsWith(`${want.repository}/${want.workflow}@`)) return { ok: false, error: "wrong workflow" };
    return { ok: true, claims };
  } catch (e) {
    return { ok: false, error: `verification failed: ${e && e.message ? e.message : e}` };
  }
}
