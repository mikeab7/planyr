/* workLaptopRig — ONE shared reproduction rig for Michael's WORK LAPTOP window (NEW-1/2/3, 2026-10-22).
 * Measured from his own perf capture: viewport 1913x641, deviceScaleFactor 2.68, 16 threads, 32 GB, Chrome 156 / Windows.
 * Signed in as the test account through the one shared helper (never a second sign-in). Callers that assert on geometry
 * must still call assertMeasurable(page, name) — this rig does not skip FOREGROUND-OR-VOID. */
import { openSignedIn } from "./signedInSession.mjs";

/* MEASURED on the laptop (chrome://gpu export, 2026-10-22): TWO external monitors at Windows scale 2.975 (~300%), Chrome zoom 90% →
 * dpr 2.975 × 0.9 = 2.6775; the Planyr tab is ~5100×1700 device px on an integrated Intel Arc 140T (hardware accelerated, ANGLE D3D11,
 * msaa_is_slow). `LAPTOP` is the 90%-zoom window on the smaller monitor, `MONITOR_BIG` the larger monitor at 100% zoom. */
export const LAPTOP = Object.freeze({ width: 1913, height: 641, deviceScaleFactor: 2.6775 });
export const MONITOR_BIG = Object.freeze({ width: 1722, height: 727, deviceScaleFactor: 2.975 });
/* GPU-pressure launch flags. NOTE (honest limit): this sandbox has NO GPU — Chromium runs on SwiftShader — so these exercise the
 * flag's code path and the app's own canvas/tile budgets, they cannot reproduce an Intel iGPU compositing two 5K desktops. */
export const GPU_PRESSURE_ARGS = Object.freeze(["--force-gpu-mem-available-mb=256"]);
export const SHORT_DESKTOP = Object.freeze({ width: 1600, height: 521, deviceScaleFactor: 2.15 });

export async function openLaptop({ base = "https://planyr.io", size = LAPTOP, retries = 6, ...rest } = {}) {
  let last;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await openSignedIn({
        base,
        viewport: { width: size.width, height: size.height },
        contextOptions: { deviceScaleFactor: size.deviceScaleFactor },
        initScripts: [[() => { window.__PLANYR_E2E = true; }, null]],
        ...rest,
      });
    } catch (e) {
      last = e;
      if (!/answered 50\d/.test(String(e.message)) || attempt === retries) throw e;
      await new Promise((r) => setTimeout(r, 20000));
    }
  }
  throw last;
}
