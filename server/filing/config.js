/* Auto-filing service config (B297) — the ONE place the filing service reads its env.
 *
 * Every value comes from server-side env only — never a VITE_ var, never committed, never
 * on the public Cloudflare Pages deploy (same isolation rule as the convert/APS/Drive
 * secrets). The title-block reader calls the Claude API with ANTHROPIC_API_KEY, which is
 * exactly why this is the /server compute layer and not the browser: the key must never
 * reach the frontend bundle (KEY DECISIONS rule). Kept tiny + side-effect-free so importing
 * it never crashes when nothing is set — a missing key surfaces as an honest "not
 * configured" at call time, never a silent success.
 */
export function filingConfig(env = (typeof process !== "undefined" ? process.env : {}) || {}) {
  return {
    // Cloud Run injects PORT (defaults to 8080); the server must listen on it.
    port: Number(env.PORT) || 8080,

    // Hard caps so a runaway/huge file can't wedge a scale-to-zero instance. The Claude
    // PDF document API caps a single request at 32 MB, so default the upload cap to match.
    maxUploadBytes: Number(env.FILING_MAX_UPLOAD_BYTES) || 32 * 1024 * 1024, // 32 MB

    anthropic: {
      // Server-side secret ONLY. Absent = the reader returns an explicit "not configured"
      // failure (never a throw, never a fabricated read) — same dormant-until-provisioned
      // contract as the APS fallback.
      apiKey: env.ANTHROPIC_API_KEY || null,
      // Default to the latest capable model, matching the client-side titleReader.js.
      model: env.FILING_MODEL || "claude-opus-4-8",
      baseUrl: env.ANTHROPIC_BASE_URL || "https://api.anthropic.com",
      version: env.ANTHROPIC_VERSION || "2023-06-01",
      // Output ceiling for the structured read (a compact JSON of fields + flags).
      maxTokens: Number(env.FILING_MAX_TOKENS) || 8000,
      // Per-read timeout so one bad document can't hold an instance open.
      timeoutMs: Number(env.FILING_TIMEOUT_MS) || 120_000,
    },

    // Matcher thresholds (see matcher.js). A title-block read only auto-routes when it is
    // confidently a single project; everything else goes to "needs filing" (no auto-guess).
    match: {
      minConfidence: Number(env.FILING_MIN_CONFIDENCE) || 0.6,
      minMargin: Number(env.FILING_MIN_MARGIN) || 0.15,
    },
  };
}
