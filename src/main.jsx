import React from "react";
import { createRoot } from "react-dom/client";
import Shell from "./app/Shell.jsx";
import { installChunkReloadGuard } from "./app/chunkReload.js";
import "./index.css";

// Recover from "stale chunk after deploy" failures (B221): when a new build ships
// while this tab is open, switching to a not-yet-loaded workspace would otherwise
// fail to fetch its now-replaced hashed chunk. Reload once to pick up the fresh
// build. Registered before render so it covers every lazy workspace.
installChunkReloadGuard();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <Shell />
  </React.StrictMode>
);
