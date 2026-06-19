/* Storage subsystem assembly (B206–B209).
 *
 * The one place the concrete backend is chosen and credentials are read — SERVER-SIDE
 * ONLY. Nothing here is bundled into the frontend (the app talks to the adapter through
 * the /server API, never to a backend directly). Secrets come from server env and must
 * never be VITE_ vars, never committed, never on the public Cloudflare Pages deploy —
 * same isolation rule as the APS key.
 *
 * Today (no Drive credentials yet) this assembles the adapter over the in-memory stub, so
 * the seam exists and is exercised end-to-end. When Cowork provides the Workspace OAuth
 * setup, build the Drive `client` from env and pass `backend: "drive"` — no app changes.
 */
import { createStorageAdapter } from "./adapter.js";
import { createIdMap } from "./idMap.js";
import { createLinkProvider } from "./linkProvider.js";
import { memoryBackend } from "./backends/memoryBackend.js";
import { driveBackend } from "./backends/driveBackend.js";

// Read storage config from server env (node). Kept tiny + side-effect-free so importing
// this module never crashes when nothing is set yet.
export function storageConfig(env = (typeof process !== "undefined" ? process.env : {}) || {}) {
  return {
    backend: env.PLANYR_STORAGE_BACKEND || "memory", // "memory" until "drive" is wired
    drive: {
      clientId: env.GOOGLE_CLIENT_ID || null,
      clientSecret: env.GOOGLE_CLIENT_SECRET || null,
      refreshToken: env.GOOGLE_REFRESH_TOKEN || null,
      rootFolderId: env.PLANYR_DRIVE_ROOT_FOLDER || null,
    },
    linkKind: env.PLANYR_LINK_KIND || "drive",
  };
}

/* Build the storage adapter from config. `driveClientFactory` is injected so the actual
 * Google API client (and its dependency) only loads on the server when Drive is selected
 * — the scaffold stays dependency-free until then. */
export function buildStorageAdapter(cfg = storageConfig(), { driveClientFactory = null } = {}) {
  const idMap = createIdMap(); // swap for a Supabase-Postgres-backed store in production
  let backend;
  if (cfg.backend === "drive") {
    const client = driveClientFactory ? driveClientFactory(cfg.drive) : null; // null → backend reports "not connected"
    backend = driveBackend({ client });
  } else {
    backend = memoryBackend();
  }
  const linkProvider = createLinkProvider({ kind: cfg.linkKind, backend });
  return createStorageAdapter({ backend, idMap, linkProvider });
}
