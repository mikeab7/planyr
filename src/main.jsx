import React from "react";
import { createRoot } from "react-dom/client";
import Shell from "./app/Shell.jsx";
import { ThemeProvider } from "./shared/theme/ThemeProvider.jsx";
import { installChunkReloadGuard } from "./app/chunkReload.js";
import { installClientErrorTelemetry, TAB_ID } from "./shared/telemetry/clientErrors.js";
import { isEnrolled } from "./shared/telemetry/perfSampling.js";
import { retireGisSw } from "./workspaces/site-planner/lib/registerGisSw.js";
import "./index.css";

// Self-report runtime errors (B279): global error / unhandledrejection / preloadError
// handlers record each crash to Supabase so silent production failures become visible.
// Installed first (before the chunk guard and render) so it can catch the earliest boot
// errors too. Fail-safe — never throws into the app.
installClientErrorTelemetry();

/* Self-report SPEED, not just crashes (NEW-4). Long tasks, INP, and a periodic sample of the
 * scene — elements drawn, layers on, panels open, edits since load, seconds since load — so the
 * amplification hypothesis can be tested against the machine that actually has the symptom
 * instead of against a sandbox reference plan. Enrols a quarter of page loads and sends at most
 * six rows on one of them, deliberately far under the ceiling error reports draw on. Fail-safe —
 * never throws into the app.
 *
 * ⛔ DYNAMIC IMPORT, GATED ON ENROLMENT, AND DEFERRED TO IDLE — all three deliberately. `main.jsx`
 * is on the critical path of EVERY route, so a static edge charged the Notes, Library and Review
 * routes for a diagnostic they never use and breached the Notes bundle budget by 2.5 KB. Only the
 * tiny enrolment/counter module (`perfSampling.js`) is always loaded; an UNENROLLED tab never
 * downloads the instrument at all, and an enrolled one fetches it in an idle gap after boot — the
 * one window this must never compete with is the four seconds B1431 attributed. */
if (isEnrolled(TAB_ID)) {
  const armPerf = () => import("./shared/telemetry/perfInstrument.js")
    .then((m) => m.installPerfInstrument(window, { tabId: TAB_ID }))
    .catch(() => {});
  if (typeof requestIdleCallback === "function") requestIdleCallback(armPerf, { timeout: 8000 });
  else setTimeout(armPerf, 4000);
}

// Recover from "stale chunk after deploy" failures (B221): when a new build ships
// while this tab is open, switching to a not-yet-loaded workspace would otherwise
// fail to fetch its now-replaced hashed chunk. Reload once to pick up the fresh
// build. Registered before render so it covers every lazy workspace.
installChunkReloadGuard();

// County/agency map IMAGERY is now cached server-side (durable copy in Google Drive, served via
// /api/gis-cache/*, B445) instead of in the browser — cross-device, survives a server outage, and
// off the user's machine. This retires the old browser-side service-worker cache (B438) so a
// returning visitor stops using it. Fail-safe, after load.
retireGisSw();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <Shell />
    </ThemeProvider>
  </React.StrictMode>
);
