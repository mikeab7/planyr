/* /okparcels/FeatureServer/0[/query] — an ArcGIS-REST-shaped front for the State of Oklahoma's statewide parcel mosaic (B2497472).
 * The state publishes it as the WMS layer `ogi_wms:Statewide_Parcels` on okmaps.org; its GetFeatureInfo answers "what is at this point"
 * with the lot's polygon and attributes. Every Planyr consumer speaks ArcGIS REST, so this route answers `?f=json` layer metadata and
 * `/query` in the ArcGIS shape and a county is wired with a plain `layerUrl` + `scopeWhere` (county='Mayes').
 * All translation is the pure `src/shared/gis/okParcelsAdapter.js`; this file only does the HTTP.
 *
 * ACCESS (the rule that must not move): the one upstream call is the public WMS GetFeatureInfo on the one public layer, with NO key,
 * session, cookie or token — what an anonymous visitor's map client sends. A 401/403 is reported as an error; nothing here fabricates,
 * replays or bypasses a credential, and the `ogi_secure` workspaces on the same server are never named. Host, layer and operation are
 * constants in the adapter, so this is not an open relay.
 *
 * RELIABILITY (measured 2026-10-29): the server answered 502/522/525 for ~40 minutes, and again for minutes at a time later, and
 * returns an occasional 502 under a heavy window. One retry after a short pause covers the blips; a longer outage is reported as a 502
 * with a plain message — LOUD-FAILURE: never an empty list that would read as "no such parcel". */
import { parseOkPath, arcQueryToOk, okUpstreamUrl, okToArcQuery, layerMetadata, arcError } from "../../src/shared/gis/okParcelsAdapter.js";
import { makeArcProxy } from "../api/lib/arcProxyShell.js";


/* Only what is Oklahoma-specific lives here; the HTTP shell (timeout, the one retry, 502s) is functions/api/lib/arcProxyShell.js (audit batch I7). */
export const onRequest = makeArcProxy({
  arcError,
  timeoutMs: 22000,
  retry: { pauseMs: 700 },
  parsePath: parseOkPath,
  metadata: () => layerMetadata(),
  translate: (params) => arcQueryToOk(params),
  upstreamUrl: (parsed, q) => okUpstreamUrl(q),
  validate: (gj) => !!(gj && Array.isArray(gj.features)),
  toArc: (gj, q) => okToArcQuery(gj, q),
  messages: {
    status: (parsed, res) => `The Oklahoma statewide parcel server answered ${res ? res.status : "no response"}.`,
    unreadable: () => "The Oklahoma statewide parcel server returned an unreadable answer.",
    unexpected: () => "The Oklahoma statewide parcel server returned an unexpected answer.",
    failed: () => "The request to the Oklahoma statewide parcel server failed or timed out.",
  },
});
