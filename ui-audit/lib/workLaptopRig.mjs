/* workLaptopRig — ONE shared reproduction rig for Michael's WORK LAPTOP window (NEW-1/2/3, 2026-10-22).
 * Measured from his own perf capture: viewport 1913x641, deviceScaleFactor 2.68, 16 threads, 32 GB, Chrome 156 / Windows.
 * Signed in as the test account through the one shared helper (never a second sign-in). Callers that assert on geometry
 * must still call assertMeasurable(page, name) — this rig does not skip FOREGROUND-OR-VOID. */
import { openSignedIn } from "./signedInSession.mjs";

export const LAPTOP = Object.freeze({ width: 1913, height: 641, deviceScaleFactor: 2.68 });
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
