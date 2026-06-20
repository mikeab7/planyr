/* Fallback DWG→DXF engine — Autodesk APS Model Derivative (B228). DORMANT BY DEFAULT.
 *
 * This is the hard-failure fallback for when free LibreDWG can't read a drawing. It is
 * gated behind APS_ENABLED (default OFF) and stays dormant until the Autodesk account is
 * provisioned — the credentials don't exist yet. While dormant, every call returns a clear
 * { ok:false } (never a throw, never a false success), exactly like the Drive backend's
 * "not connected yet" contract.
 *
 * Secrets (APS client id/secret) come from server env ONLY — never a VITE_ var, never the
 * frontend bundle, never the public Cloudflare Pages deploy, never committed.
 *
 * The full Model Derivative pipeline is documented + scaffolded below so lighting it up is
 * a fill-in, not a rebuild: 2-legged auth → put the DWG in a transient OSS bucket → start a
 * translation job → poll the manifest → download the derivative. The exact translate output
 * descriptor and derivative download specifics MUST be re-verified against live APS when the
 * account is provisioned (pricing/endpoints move — see CLAUDE.md); they can't be exercised
 * from here. `fetchImpl` is injectable so the guard logic + auth shape are unit-tested
 * without hitting Autodesk.
 */
import { ok, fail } from "../storage/result.js";

const NOT_ENABLED = "APS fallback is disabled (APS_ENABLED is off).";
const NOT_CONFIGURED = "APS is enabled but not configured — set APS_CLIENT_ID / APS_CLIENT_SECRET (server-side env only).";

// 2-legged (client-credentials) auth → a short-lived access token. Real call; result-shaped.
export async function apsAuthenticate({ clientId, clientSecret, baseUrl, fetchImpl = fetch } = {}) {
  if (!clientId || !clientSecret) return fail(NOT_CONFIGURED);
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  let res;
  try {
    res = await fetchImpl(`${baseUrl}/authentication/v2/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", authorization: `Basic ${basic}` },
      body: new URLSearchParams({ grant_type: "client_credentials", scope: "data:read data:write data:create bucket:create bucket:read" }).toString(),
    });
  } catch (e) {
    return fail(`APS auth request failed: ${(e && e.message) || e}`);
  }
  let data = {};
  try { data = await res.json(); } catch { /* non-JSON error body */ }
  if (!res.ok) return fail(data.error_description || data.error || `APS auth ${res.status}`);
  if (!data.access_token) return fail("APS auth returned no access token.");
  return ok({ accessToken: data.access_token, expiresIn: data.expires_in || 0 });
}

export async function convertWithAps(dwgBytes, apsCfg = {}, { fetchImpl = fetch } = {}) {
  if (!apsCfg.enabled) return fail(NOT_ENABLED);
  if (!apsCfg.clientId || !apsCfg.clientSecret) return fail(NOT_CONFIGURED);
  if (!dwgBytes || !dwgBytes.length) return fail("No DWG bytes to convert.");

  const auth = await apsAuthenticate({ ...apsCfg, fetchImpl });
  if (!auth.ok) return auth;

  // ── PROVISIONING FILL-IN (not exercised until the Autodesk account exists) ───────────
  // With `auth.accessToken` the remaining Model Derivative steps are:
  //   1. PUT the DWG into a transient OSS bucket (signed-S3 upload) → objectId.
  //   2. urn = base64url(objectId).
  //   3. POST {baseUrl}/modelderivative/v2/designdata/job  { input:{ urn },
  //        output:{ formats:[{ type:"dxf", advanced:{ exportFileStructure:"single" } }] } }
  //      (the DXF output descriptor + version must be confirmed against live APS).
  //   4. Poll GET …/designdata/{urn}/manifest until status==="success".
  //   5. Download the DXF derivative bytes → return ok({ dxf, engine:"aps" }).
  // Until then, fail VISIBLY rather than pretend — no silent success.
  return fail("APS Model Derivative translation is not provisioned yet (account pending). The credentials authenticated, but the translate pipeline must be enabled + verified once the Autodesk account is live.", { engine: "aps", authenticated: true });
}
