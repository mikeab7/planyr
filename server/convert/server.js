/* DWG→DXF conversion HTTP service (B228) — the Cloud Run entrypoint.
 *
 * A tiny, dependency-free Node HTTP server (built-ins only, so the container needs no npm
 * install). Two routes:
 *   GET  /health          → readiness probe (Cloud Run pings this).
 *   POST /convert         → body = DWG bytes; success returns the DXF bytes, failure returns
 *                           a JSON error with an honest status code (never a 200 with a junk
 *                           body — a silent failure is treated as a crash, B228).
 *
 * Scales to zero on Cloud Run: idle instances cost nothing, a request spins one up. All
 * config (incl. whether the APS fallback is armed) comes from server env via config.js.
 */
import http from "node:http";
import { pathToFileURL } from "node:url";
import { convertConfig } from "./config.js";
import { convertDwgToDxf } from "./convertService.js";

const sendJson = (res, status, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(body) });
  res.end(body);
};

// Buffer the request body with a hard size cap so a huge upload can't wedge an instance.
function readBody(req, maxBytes) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on("data", (c) => {
      if (done) return;
      size += c.length;
      if (size > maxBytes) { done = true; chunks.length = 0; req.resume(); resolve({ tooLarge: true }); return; } // drain, don't kill the socket (so the 413 flushes)
      chunks.push(c);
    });
    req.on("end", () => { if (!done) { done = true; resolve({ bytes: Buffer.concat(chunks) }); } });
    req.on("error", () => { if (!done) { done = true; resolve({ error: true }); } });
  });
}

export function createConvertServer(cfg = convertConfig(), { convert = convertDwgToDxf } = {}) {
  return http.createServer(async (req, res) => {
    let path = req.url || "/";
    const q = path.indexOf("?"); if (q >= 0) path = path.slice(0, q);

    if (req.method === "GET" && (path === "/health" || path === "/healthz")) {
      return sendJson(res, 200, { ok: true, service: "dwg-convert", engine: "libredwg", apsFallback: !!(cfg.aps && cfg.aps.enabled) });
    }
    if (req.method === "GET" && path === "/") {
      return sendJson(res, 200, { ok: true, service: "dwg-convert", endpoints: { health: "GET /health", convert: "POST /convert (DWG bytes) → DXF" } });
    }

    if (path === "/convert") {
      if (req.method !== "POST") { res.setHeader("allow", "POST"); return sendJson(res, 405, { ok: false, error: "Use POST /convert with the DWG file as the request body." }); }
      const body = await readBody(req, cfg.maxUploadBytes);
      if (body.tooLarge) return sendJson(res, 413, { ok: false, error: `DWG exceeds the ${cfg.maxUploadBytes}-byte limit.` });
      if (body.error || !body.bytes) return sendJson(res, 400, { ok: false, error: "Could not read the request body." });
      if (!body.bytes.length) return sendJson(res, 400, { ok: false, error: "Empty request body — POST the DWG file bytes." });

      const result = await convert(body.bytes, cfg);
      if (result.ok) {
        const headers = { "content-type": "application/dxf", "content-length": result.dxf.length, "x-convert-engine": result.engine || "libredwg" };
        if (result.warning) headers["x-convert-warning"] = String(result.warning).replace(/[\r\n]+/g, " ").slice(0, 300);
        res.writeHead(200, headers);
        return res.end(result.dxf);
      }
      // Infra fault (binary missing) → 503; an unreadable drawing → 422 Unprocessable.
      const status = /could not be started|not installed|is it installed/i.test(result.error || "") ? 503 : 422;
      return sendJson(res, status, { ok: false, error: result.error, engine: result.engine || "none", apsEnabled: result.apsEnabled });
    }

    return sendJson(res, 404, { ok: false, error: `No route for ${req.method} ${path}.` });
  });
}

export function start(cfg = convertConfig()) {
  const server = createConvertServer(cfg);
  server.listen(cfg.port, () => {
    console.log(`[dwg-convert] listening on :${cfg.port} (APS fallback ${cfg.aps && cfg.aps.enabled ? "ON" : "off"})`);
  });
  return server;
}

// Start only when run directly (node server/convert/server.js). Importing for tests must
// NOT bind a port.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  start();
}
