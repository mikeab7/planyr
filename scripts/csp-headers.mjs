/* Appends the Content-Security-Policy to dist/_headers at build time (pen-test 2026-11-24).
 * WHY AT BUILD TIME: index.html carries inline <script> blocks (boot guard, theme flash guard). Cloudflare Pages cannot mint a per-request
 * nonce, so each inline script is allowed by its SHA-256 hash instead — computed here from the built HTML, so an edit to a script can never
 * ship a stale hash and a script an attacker injects (a different hash) is refused.
 * MODE: the full policy ships REPORT-ONLY (violations go to /api/csp-report, nothing is blocked) until a clean soak; `object-src 'none'` and
 * `base-uri 'self'` are ENFORCED now (nothing legitimate uses <object>/<embed> or a <base> tag). To enforce the full policy set CSP_ENFORCE=1. */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";

export function inlineScriptHashes(html) {
  const out = [];
  const re = /<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html))) {
    if (/type\s*=\s*["']?(?!module|text\/javascript)/i.test(m[1]) && /type\s*=/i.test(m[1])) continue; // JSON / template blocks are not executed
    if (!m[2].trim()) continue;
    out.push(`'sha256-${createHash("sha256").update(m[2]).digest("base64")}'`);
  }
  return [...new Set(out)];
}

export function buildPolicy(hashes) {
  return [
    "default-src 'self'",
    `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(" ")} https://challenges.cloudflare.com blob:`.replace(/\s+/g, " "),
    "worker-src 'self' blob:",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https: wss: blob: data:",
    "frame-src 'self' https://challenges.cloudflare.com blob: data:",
    "media-src 'self' blob: data:",
    "object-src 'none'",
    "base-uri 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export function headersBlock(policy, enforce = false) {
  const name = enforce ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
  const lines = [];
  for (const path of ["/", "/index.html"]) {
    lines.push(path);
    lines.push(`  ${name}: ${policy}; report-uri /api/csp-report`);
    if (!enforce) lines.push("  Content-Security-Policy: object-src 'none'; base-uri 'self'");
  }
  return "\n# Content-Security-Policy (scripts/csp-headers.mjs, generated at build)\n" + lines.join("\n") + "\n";
}

if (process.argv[1] && process.argv[1].endsWith("csp-headers.mjs")) {
  const dir = process.argv[2] || "dist";
  if (!existsSync(`${dir}/index.html`) || !existsSync(`${dir}/_headers`)) { console.error(`csp-headers: ${dir}/index.html or _headers missing`); process.exit(1); }
  const hashes = inlineScriptHashes(readFileSync(`${dir}/index.html`, "utf8"));
  if (!hashes.length) { console.error("csp-headers: found no inline scripts: refusing to write a policy that would block the boot guard"); process.exit(1); }
  const prev = readFileSync(`${dir}/_headers`, "utf8").replace(/\n# Content-Security-Policy \(scripts\/csp-headers\.mjs[\s\S]*$/, "");
  writeFileSync(`${dir}/_headers`, prev + headersBlock(buildPolicy(hashes), process.env.CSP_ENFORCE === "1"));
  console.log(`csp-headers: ${hashes.length} inline-script hashes, ${process.env.CSP_ENFORCE === "1" ? "ENFORCING" : "report-only"}`);
}
