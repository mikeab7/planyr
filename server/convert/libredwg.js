/* Primary DWG→DXF engine — LibreDWG's `dwg2dxf` (B238).
 *
 * dwg2dxf is a native binary baked into the container image (free, GPL; see Dockerfile).
 * We write the uploaded DWG to a temp file, run `dwg2dxf -y -o out.dxf in.dwg`, and read
 * the DXF back. The whole thing returns a result object ({ ok, ... } / { ok:false, error })
 * and NEVER throws and NEVER reports a failed conversion as success — the same
 * no-silent-failure contract the storage adapter uses (shared result.js). A silent success
 * here would hand the caller an empty/garbage DXF, which is treated as a crash.
 *
 * `runner` is injectable so the orchestration + service can be unit-tested without the
 * native binary present (the binary only exists inside the image).
 */
import { spawn } from "node:child_process";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok, fail } from "../storage/result.js";

// LibreDWG returns an error BITMASK, not a simple 0/1: low bits are non-fatal warnings
// (a slightly lossy but usable DXF still gets written), the high bit is a hard failure.
// So "produced a non-empty DXF AND not a critical code" is the real success signal, not
// "exit code == 0" (which would reject the many real drawings that convert with warnings).
const DWG_ERR_CRITICAL = 128; // mirrors LibreDWG's dwg.h DWG_ERR_CRITICAL

// Run a child process to completion, capturing stderr. Resolves (never rejects) to
// { code, stderr, spawnError?, timedOut? } so the caller can branch on it explicitly.
function runProcess(bin, args, { timeoutMs }) {
  return new Promise((resolve) => {
    let proc;
    try {
      proc = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    } catch (e) {
      resolve({ code: -1, stderr: String((e && e.message) || e), spawnError: true });
      return;
    }
    let stderr = "";
    const timer = setTimeout(() => {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
      resolve({ code: -1, stderr: `timed out after ${timeoutMs}ms`, timedOut: true });
    }, timeoutMs);
    proc.stderr.on("data", (d) => { if (stderr.length < 8192) stderr += d.toString(); });
    proc.on("error", (e) => { clearTimeout(timer); resolve({ code: -1, stderr: String((e && e.message) || e), spawnError: true }); });
    proc.on("close", (code) => { clearTimeout(timer); resolve({ code: code == null ? -1 : code, stderr }); });
  });
}

export async function convertWithLibreDwg(dwgBytes, { bin = "dwg2dxf", timeoutMs = 120_000, runner = runProcess } = {}) {
  if (!dwgBytes || !dwgBytes.length) return fail("No DWG bytes to convert.", { engine: "libredwg" });

  let dir;
  try {
    dir = await mkdtemp(join(tmpdir(), "dwg2dxf-"));
    const inPath = join(dir, "in.dwg");
    const outPath = join(dir, "out.dxf");
    await writeFile(inPath, dwgBytes);

    const r = await runner(bin, ["-y", "-o", outPath, inPath], { timeoutMs });

    if (r.spawnError) {
      return fail(`LibreDWG binary "${bin}" could not be started (${r.stderr}). Is it installed in the image?`, { engine: "libredwg", spawnError: true });
    }
    if (r.timedOut) return fail(`LibreDWG ${r.stderr}.`, { engine: "libredwg", timedOut: true });
    if (r.code >= DWG_ERR_CRITICAL) {
      return fail(`LibreDWG could not read the drawing (critical error ${r.code}): ${r.stderr || "no detail"}`, { engine: "libredwg", code: r.code });
    }

    let dxf;
    try { dxf = await readFile(outPath); } catch { dxf = null; }
    if (!dxf || !dxf.length) {
      return fail(`LibreDWG produced no DXF (code ${r.code}): ${r.stderr || "no detail"}`, { engine: "libredwg", code: r.code });
    }

    // Non-empty DXF with a non-critical code = success; surface any non-zero code as a
    // warning so the caller knows the drawing converted with recoverable issues.
    return ok({ dxf, engine: "libredwg", warning: r.code ? `LibreDWG warnings (code ${r.code}): ${r.stderr || ""}`.trim() : null });
  } catch (e) {
    return fail(`LibreDWG conversion error: ${(e && e.message) || e}`, { engine: "libredwg" });
  } finally {
    if (dir) { try { await rm(dir, { recursive: true, force: true }); } catch { /* best-effort cleanup */ } }
  }
}
