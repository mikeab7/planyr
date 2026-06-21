/* Auto-filing client provider (B299) — the seam the title-block backend plugs into.
 *
 * This is the real `createIndexProvider` (shared/files/fileFacts.js) implementation: it sends
 * a dropped drawing to the same-origin /api/file proxy (functions/api/file.js → the Cloud Run
 * server/filing/ service), which reads the title block with the Claude API and returns a
 * filing decision + placement facts. The browser NEVER holds the API key (KEY DECISIONS) — it
 * only ever talks to the proxy.
 *
 * ONE read, TWO payoffs: `autofile` (drop → file itself) and `capturePlacementFacts`
 * (deliverable #4 — placement-readiness for "Place on map") come from the SAME server read.
 *
 * Gated like the Drive backend: enabled only when VITE_AUTOFILE_ENABLED is set. When off (the
 * default until the Cloud Run service + ANTHROPIC_API_KEY are provisioned), `backendReady` is
 * false and `autofile` gracefully SKIPS — the drawer files manually, exactly as before. No
 * silent failure, no regression: a 404/503 from the not-yet-deployed proxy is a skip, not an
 * error mistaken for a real read.
 */
import { createIndexProvider } from "../../../shared/files/fileFacts.js";
import { emptyPlacementFacts, mergePlacementFacts } from "../../../shared/placement/placementFacts.js";
import { supabase } from "../../site-planner/lib/supabase.js";
import { localTitleBlockRead } from "./localRead.js";

const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? "").trim());
const ENV = (typeof import.meta !== "undefined" && import.meta.env) || {};
export const AUTOFILE_ENABLED = truthy(ENV.VITE_AUTOFILE_ENABLED);
const DEFAULT_ENDPOINT = ENV.VITE_AUTOFILE_URL || "/api/file";

// base64 of UTF-8 JSON, browser- and Node-safe (via globalThis so there's no bare `Buffer`).
function b64utf8(s) {
  const G = typeof globalThis !== "undefined" ? globalThis : {};
  if (G.Buffer) return G.Buffer.from(s, "utf-8").toString("base64");
  const bytes = new TextEncoder().encode(s);
  let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
  return G.btoa(bin);
}

// Pack the projects into the X-Planyr-Projects header (base64 JSON), trimmed to the fields the
// matcher uses (id / name / aliases) so the header stays small.
export function encodeProjects(projects = []) {
  const slim = projects.filter((p) => p && p.id).map((p) => ({ id: p.id, name: p.name, aliases: p.aliases }));
  return b64utf8(JSON.stringify(slim));
}

/* Interpret the proxy response. 404/503 (backend not deployed/enabled) is a graceful SKIP, not
 * an error — the drawer falls back to manual filing, exactly like the Drive path. A real read
 * is { ok:true, decision, placement, facts }; any other non-2xx is a visible error. */
export function interpretResponse(status, body) {
  if (status === 404 || status === 503) return { ok: false, skipped: true, error: (body && body.error) || "Auto-filing isn't enabled yet." };
  if (status >= 200 && status < 300 && body && body.ok) return { ok: true, decision: body.decision, placement: body.placement, facts: body.facts };
  return { ok: false, skipped: false, error: (body && body.error) || `Auto-filing failed (HTTP ${status}).` };
}

async function sessionToken() {
  try { const { data } = await supabase.auth.getSession(); return (data && data.session && data.session.access_token) || null; } catch (_) { return null; }
}

/* File one drawing — PLAIN CODE FIRST, AI only as fallback (B312, owner direction).
 *   Tier 1 (free, instant, no tokens): read the PDF's embedded text in the browser and match a
 *     project deterministically. Works for any drawing with a text layer (most CAD PDFs).
 *   Tier 2 (AI): only when Tier 1 finds NO text (scanned/image-only sheet) AND the backend is
 *     enabled — POST to the server reader. So tokens are spent only on the hard minority.
 * Returns { ok, decision, placement, facts } on a real read, else { ok:false, skipped, error }.
 * `localRead` is injectable for tests (so the tiering is testable without pdf.js). Never throws. */
export async function autofile(file, projects = [], { endpoint = DEFAULT_ENDPOINT, fetchImpl = fetch, getToken = sessionToken, localRead = localTitleBlockRead, serverEnabled = AUTOFILE_ENABLED, forceServer = false } = {}) {
  if (!file) return { ok: false, skipped: true, error: "No file." };

  // Tier 1 — free local read. A confident match OR a "needs filing" result are both real
  // outcomes (no tokens); only "no text" / "couldn't open" falls through to the AI.
  // (forceServer skips Tier 1 — used for placement-fact capture, which is AI/CV-only.)
  if (!forceServer) {
    let local;
    try { local = await localRead(file, projects); } catch (_) { local = null; }
    if (local && local.ok && local.hasText) return { ok: true, decision: local.decision, placement: null, facts: local.facts, source: "local" };
  }

  // Tier 2 — AI fallback (scanned sheet with no text layer). Only when the backend is on.
  if (!serverEnabled) return { ok: false, skipped: true, source: "local-no-text", error: "Scanned sheet (no embedded text); AI fallback isn't enabled." };
  const token = await getToken();
  if (!token) return { ok: false, skipped: true, error: "Sign in to auto-file." };
  let resp;
  try {
    resp = await fetchImpl(endpoint, {
      method: "POST",
      headers: { "content-type": "application/pdf", authorization: `Bearer ${token}`, "x-planyr-projects": encodeProjects(projects) },
      body: file,
    });
  } catch (e) { return { ok: false, skipped: true, error: (e && e.message) || "Network error." }; }
  let body = {};
  try { body = await resp.json(); } catch (_) { /* non-JSON */ }
  return interpretResponse(resp.status, body);
}

/* The real index provider.
 *  - `autofileReady` is TRUE by default: the Tier-1 plain-code read works in the browser with no
 *    key, no cloud, no cost — so the drawer auto-files dropped drawings out of the box.
 *  - `backendReady` is true only when the AI fallback is enabled (the honest signal for "AI can
 *    read scanned sheets too" + placement capture).
 *  `autofile` always runs (local-first); it only reaches the AI when a sheet has no text AND the
 *  backend is on. */
export function createAutofilingProvider({ enabled = AUTOFILE_ENABLED, endpoint = DEFAULT_ENDPOINT, fetchImpl, getToken, localRead } = {}) {
  const io = { endpoint, serverEnabled: enabled };
  if (fetchImpl) io.fetchImpl = fetchImpl;
  if (getToken) io.getToken = getToken;
  if (localRead) io.localRead = localRead;

  const impl = {};
  if (enabled) {
    // capturePlacementFacts rides the AI read (placement is the AI/CV step, not Tier-1) →
    // forceServer skips the local fast-path so we actually get the scale/north-arrow facts.
    impl.capturePlacementFacts = async (file) => {
      const r = await autofile(file, [], { ...io, forceServer: true });
      return r.ok && r.placement ? mergePlacementFacts(emptyPlacementFacts(), r.placement) : emptyPlacementFacts();
    };
  }
  const provider = createIndexProvider(impl); // backendReady = !!capturePlacementFacts = enabled
  provider.enabled = enabled;
  provider.autofileReady = true; // the free local path is always available in the browser
  provider.autofile = (file, projects) => autofile(file, projects, io);
  return provider;
}

export const autofilingProvider = createAutofilingProvider();
