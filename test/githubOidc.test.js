/* NEW-1 (2026-11-02) — the alarm route trusts ONLY a GitHub Actions OIDC token for the signin-health workflow on main.
 * A key pair is generated here; the fake JWKS publishes its public half, so the real WebCrypto verification path runs. */
import { describe, it, expect, beforeEach } from "vitest";
import { generateKeyPairSync, createSign } from "node:crypto";
import { verifyGithubOidc, _resetJwksCacheForTest, GITHUB_OIDC_ISSUER } from "../functions/api/lib/githubOidc.js";

const kp = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwkOf = (pub, kid) => ({ ...pub.export({ format: "jwk" }), kid, alg: "RS256", use: "sig" });
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const NOW = 1_800_000_000_000;
const goodClaims = () => ({
  iss: GITHUB_OIDC_ISSUER, aud: "https://planyr.io", exp: NOW / 1000 + 300, nbf: NOW / 1000 - 30, repository: "mikeab7/planyr", ref: "refs/heads/main",
  job_workflow_ref: "mikeab7/planyr/.github/workflows/signin-health.yml@refs/heads/main",
});
function sign(claims, { key = kp.privateKey, kid = "k1", alg = "RS256" } = {}) {
  const head = b64({ alg, typ: "JWT", kid }), body = b64(claims);
  const s = createSign("RSA-SHA256"); s.update(`${head}.${body}`);
  return `${head}.${body}.${s.sign(key).toString("base64url")}`;
}
let fetches;
const fetchJwks = (keys = [jwkOf(kp.publicKey, "k1")]) => async () => { fetches++; return new Response(JSON.stringify({ keys }), { status: 200 }); };
const verify = (token, f = fetchJwks()) => verifyGithubOidc({ token, fetchImpl: f, nowMs: NOW });
beforeEach(() => { _resetJwksCacheForTest(); fetches = 0; });

describe("verifyGithubOidc", () => {
  it("accepts a genuine token for the pinned workflow on main", async () => {
    const r = await verify(sign(goodClaims()));
    expect(r.ok).toBe(true); expect(r.claims.repository).toBe("mikeab7/planyr");
  });
  it("refuses a token signed by a different key (a forgery)", async () => {
    expect((await verify(sign(goodClaims(), { key: other.privateKey }))).error).toBe("bad signature");
  });
  it("refuses every wrong claim: repository, ref (a PR branch), workflow (another file), audience, issuer, expiry", async () => {
    const cases = [
      [{ repository: "evil/planyr" }, "wrong repository"],
      [{ ref: "refs/heads/feature" }, "wrong ref"],
      [{ ref: "refs/pull/1/merge" }, "wrong ref"],
      [{ job_workflow_ref: "mikeab7/planyr/.github/workflows/build.yml@refs/heads/main" }, "wrong workflow"],
      [{ job_workflow_ref: "evil/planyr/.github/workflows/signin-health.yml@refs/heads/main" }, "wrong workflow"],
      [{ aud: "https://evil.example" }, "wrong audience"],
      [{ iss: "https://evil.example" }, "wrong issuer"],
      [{ exp: NOW / 1000 - 600 }, "expired"],
      [{ nbf: NOW / 1000 + 600 }, "not yet valid"],
    ];
    for (const [patch, error] of cases) expect((await verify(sign({ ...goodClaims(), ...patch }))).error, JSON.stringify(patch)).toBe(error);
  });
  it("refuses garbage, a non-RS256 header, a missing kid and an unknown kid", async () => {
    expect((await verify("")).ok).toBe(false);
    expect((await verify("a.b")).ok).toBe(false);
    expect((await verify("not.a.jwt")).ok).toBe(false);
    expect((await verify(sign(goodClaims(), { alg: "none" }))).error).toBe("unsupported token header");
    expect((await verify(sign(goodClaims(), { kid: "nope" }))).error).toBe("unknown signing key");
  });
  it("re-fetches the key set once when the kid is new (a key rotation), then caches", async () => {
    const f = fetchJwks();
    expect((await verifyGithubOidc({ token: sign(goodClaims(), { kid: "k1" }), fetchImpl: f, nowMs: NOW })).ok).toBe(true);
    expect((await verifyGithubOidc({ token: sign(goodClaims(), { kid: "k1" }), fetchImpl: f, nowMs: NOW })).ok).toBe(true);
    expect(fetches).toBe(1);
  });
  it("a JWKS outage is a refusal, never a pass and never a throw", async () => {
    const r = await verifyGithubOidc({ token: sign(goodClaims()), fetchImpl: async () => new Response("no", { status: 503 }), nowMs: NOW });
    expect(r.ok).toBe(false);
  });
});
