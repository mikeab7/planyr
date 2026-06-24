import React from "react";
import { createRoot } from "react-dom/client";
import Shell from "./app/Shell.jsx";
import { ThemeProvider } from "./shared/theme/ThemeProvider.jsx";
import { installChunkReloadGuard } from "./app/chunkReload.js";
import { installClientErrorTelemetry } from "./shared/telemetry/clientErrors.js";
import { retireGisSw } from "./workspaces/site-planner/lib/registerGisSw.js";
import "./index.css";

// Self-report runtime errors (B279): global error / unhandledrejection / preloadError
// handlers record each crash to Supabase so silent production failures become visible.
// Installed first (before the chunk guard and render) so it can catch the earliest boot
// errors too. Fail-safe — never throws into the app.
installClientErrorTelemetry();

// Recover from "stale chunk after deploy" failures (B221): when a new build ships
// while this tab is open, switching to a not-yet-loaded workspace would otherwise
// fail to fetch its now-replaced hashed chunk. Reload once to pick up the fresh
// build. Registered before render so it covers every lazy workspace.
installChunkReloadGuard();

// County/agency map IMAGERY is now cached server-side (durable copy in Google Drive, served via
// /api/gis-cache/*, B439) instead of in the browser — cross-device, survives a server outage, and
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
