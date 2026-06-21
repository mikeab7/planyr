/* DWG→DXF conversion service config (B238).
 *
 * The ONE place the conversion service reads its environment. Every value comes from
 * server-side env only — never a VITE_ var, never committed, never on the public
 * Cloudflare Pages deploy (same isolation rule as the Drive/APS secrets). Kept tiny and
 * side-effect-free so importing it never crashes when nothing is set.
 *
 * The APS fallback is DORMANT by default: APS_ENABLED is off until the Autodesk account
 * is provisioned, so a LibreDWG failure surfaces as an explicit error rather than silently
 * reaching out to a paid, unconfigured service.
 */
const truthy = (v) => /^(1|true|yes|on)$/i.test(String(v ?? "").trim());

export function convertConfig(env = (typeof process !== "undefined" ? process.env : {}) || {}) {
  return {
    // Cloud Run injects PORT (defaults to 8080); the server must listen on it.
    port: Number(env.PORT) || 8080,
    // LibreDWG's dwg2dxf — bundled into the container image (see Dockerfile). An absolute
    // path can override the PATH lookup (e.g. for local dev against a self-built binary).
    libreDwgBin: env.LIBREDWG_BIN || "dwg2dxf",
    // Hard caps so a runaway/huge file can't wedge a scale-to-zero instance.
    convertTimeoutMs: Number(env.CONVERT_TIMEOUT_MS) || 120_000,
    maxUploadBytes: Number(env.MAX_UPLOAD_BYTES) || 200 * 1024 * 1024, // 200 MB

    aps: {
      // DEFAULT OFF. The fallback stays dormant until the Autodesk account exists and this
      // is explicitly flipped on. While off, a LibreDWG failure is a visible error.
      enabled: truthy(env.APS_ENABLED),
      clientId: env.APS_CLIENT_ID || null,         // server-side secret only
      clientSecret: env.APS_CLIENT_SECRET || null, // server-side secret only
      baseUrl: env.APS_BASE_URL || "https://developer.api.autodesk.com",
      // Output release LibreDWG/APS should target (DXF version). Screening tool default.
      dxfVersion: env.CONVERT_DXF_VERSION || "r2013",
    },
  };
}
