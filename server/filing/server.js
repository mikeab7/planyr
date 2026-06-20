/* Auto-filing HTTP service (B297) — the Cloud Run entrypoint.
 *
 * A tiny, dependency-free Node HTTP server (built-ins only — the title-block read uses raw
 * fetch, no SDK), mirroring server/convert/server.js. Routes:
 *   GET  /health   → readiness probe (Cloud Run pings this; reports whether the key is set).
 *   POST /file     → body = PDF bytes; the named projects ride in the X-Planyr-Projects
 *                    header (base64 of a JSON array) so the body stays raw bytes. Returns the
 *                    filing decision (matched project + name, or "needs filing" + reason) +
 *                    the placement facts. An unreadable drawing is an honest 4xx/5xx, never a
 *                    200 with a junk decision (a silent failure is treated as a crash).
 *
 * Scales to zero on Cloud Run. All config (incl. the ANTHROPIC_API_KEY the read needs) comes
 * from server env via config.js — never the frontend bundle.
 */
import http from "node:http";
import { pathToFileURL } from "node:url";
import { filingConfig } from "./config.js";
import { fileDocument } from "./filingService.js";

const sendJson = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
};

// Buffer the request body with a hard size cap so a huge upload can't wedge an instance.
function readBody(req, maxBytes) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0, done = false;
    req.on("data", (c) => {
      if (done) return;
      size += c.length;
      if (size > maxBytes) { done = true; chunks.length = 0; req.resume(); resolve({ tooLarge: true }); return; }
      chunks.push(c);
    });
    req.on("end", () => { if (!done) { done = true; resolve({ bytes: Buffer.concat(chunks) }); } });
    req.on("error", () => { if (!done) { done = true; resolve({ error: true }); } });
  });
}

// Decode the X-Planyr-Projects header (base64 JSON) into the matcher's project list. A bad/
// absent header is treated as "no projects" — the read still runs and lands in needs-filing.
function parseProjects(header) {
  if (!header) return [];
  try {
    const json = Buffer.from(String(header), "base64").toString("utf-8");
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

export function createFilingServer(cfg = filingConfig(), { fileDoc = fileDocument } = {}) {
  return http.createServer(async (req, res) => {
    let path = req.url || "/";
    const q = path.indexOf("?"); if (q >= 0) path = path.slice(0, q);

    if (req.method === "GET" && (path === "/health" || path === "/healthz")) {
      return sendJson(res, 200, { ok: true, service: "doc-filing", model: cfg.anthropic && cfg.anthropic.model, configured: !!(cfg.anthropic && cfg.anthropic.apiKey) });
    }
    if (req.method === "GET" && path === "/") {
      return sendJson(res, 200, { ok: true, service: "doc-filing", endpoints: { health: "GET /health", file: "POST /file (PDF bytes; X-Planyr-Projects: base64 JSON) → filing decision" } });
    }

    if (path === "/file") {
      if (req.method !== "POST") { res.setHeader("allow", "POST"); return sendJson(res, 405, { ok: false, error: "Use POST /file with the PDF as the request body." }); }
      const body = await readBody(req, cfg.maxUploadBytes);
      if (body.tooLarge) return sendJson(res, 413, { ok: false, error: `PDF exceeds the ${cfg.maxUploadBytes}-byte limit.` });
      if (body.error || !body.bytes) return sendJson(res, 400, { ok: false, error: "Could not read the request body." });
      if (!body.bytes.length) return sendJson(res, 400, { ok: false, error: "Empty request body — POST the PDF bytes." });

      const projects = parseProjects(req.headers["x-planyr-projects"]);
      const result = await fileDoc(body.bytes, { projects }, cfg, {});
      if (result.ok) return sendJson(res, 200, { ok: true, decision: result.decision, placement: result.placement, facts: result.facts });
      // Not configured (no key) → 503 infra fault; anything else (unreadable / API error) → 422.
      const status = result.configured === false ? 503 : 422;
      return sendJson(res, status, { ok: false, error: result.error });
    }

    return sendJson(res, 404, { ok: false, error: `No route for ${req.method} ${path}.` });
  });
}

export function start(cfg = filingConfig()) {
  const server = createFilingServer(cfg);
  server.listen(cfg.port, () => {
    console.log(`[doc-filing] listening on :${cfg.port} (read ${cfg.anthropic && cfg.anthropic.apiKey ? "configured" : "NOT configured — set ANTHROPIC_API_KEY"})`);
  });
  return server;
}

// Start only when run directly (node server/filing/server.js). Importing for tests must NOT
// bind a port.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}
