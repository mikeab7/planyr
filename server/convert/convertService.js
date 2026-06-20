/* DWG→DXF orchestration (B228) — the engine policy in one place.
 *
 * Policy: try LibreDWG (free, local, primary). If it fails:
 *   - APS fallback ON  → try Autodesk APS Model Derivative; if that also fails, return a
 *     combined explicit error.
 *   - APS fallback OFF → return an explicit error naming the LibreDWG failure (NEVER a
 *     silent success — a silent failure is treated as a crash).
 *
 * Both engines are injectable so this pure policy can be unit-tested without the native
 * binary or any network. Everything is result-shaped ({ ok } / { ok:false, error }).
 */
import { ok, fail } from "../storage/result.js";
import { convertWithLibreDwg } from "./libredwg.js";
import { convertWithAps } from "./aps.js";

export async function convertDwgToDxf(dwgBytes, cfg, { libre = convertWithLibreDwg, aps = convertWithAps } = {}) {
  if (!dwgBytes || !dwgBytes.length) return fail("No DWG file in the request body.", { engine: "none" });

  // Primary: LibreDWG.
  const primary = await libre(dwgBytes, { bin: cfg.libreDwgBin, timeoutMs: cfg.convertTimeoutMs });
  if (primary.ok) return ok({ dxf: primary.dxf, engine: "libredwg", warning: primary.warning || null });

  const apsCfg = cfg.aps || {};

  // Fallback: APS — only when explicitly enabled (default off / dormant).
  if (apsCfg.enabled) {
    const fb = await aps(dwgBytes, apsCfg);
    if (fb.ok) return ok({ dxf: fb.dxf, engine: "aps", primaryError: primary.error });
    return fail(
      `DWG→DXF conversion failed. LibreDWG: ${primary.error} | APS fallback: ${fb.error}`,
      { engine: "none", libredwgError: primary.error, apsError: fb.error },
    );
  }

  // APS dormant: explicit failure, never a silent success.
  return fail(
    `DWG→DXF conversion failed in LibreDWG and the APS fallback is disabled (APS_ENABLED is off): ${primary.error}`,
    { engine: "none", libredwgError: primary.error, apsEnabled: false },
  );
}
