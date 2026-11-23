/* /mg/<server>/<COUNTY>/FeatureServer/0[/query] — an ArcGIS-REST-shaped front for Flagship GIS's Autodesk MapGuide parcel layers
 * (B2302785). Alabama's 26 Flagship counties publish parcels ONLY through MapGuide; every Planyr consumer speaks ArcGIS REST, so this
 * route answers `?f=json` layer metadata and `/query` in the ArcGIS shape and the county is wired with a plain `layerUrl`.
 * All translation is the pure `src/shared/gis/mapguideAdapter.js`; this file only does the HTTP.
 *
 * ACCESS (the rule that must not move): the upstream call is the county's own PUBLIC viewer search endpoint
 * (`…/rest/library/<COUNTY>/3_LAYERS/Parcels.LayerDefinition/features.geojson`) with NO key, session, cookie or token — exactly what an
 * anonymous visitor's browser sends. A 401/403 is reported as an error; nothing here fabricates, replays or bypasses a credential.
 * The server is chosen from a fixed list (MG_SERVERS) and the county is validated to ^[A-Z]{3,20}$, so this is not an open relay. */
import {
  parseMgPath, arcQueryToMg, mgFeaturesUrl, mgToArcQuery, layerMetadata, arcError, MG_SERVERS,
} from "../../src/shared/gis/mapguideAdapter.js";
import { makeArcProxy } from "../api/lib/arcProxyShell.js";


/* Only what is MapGuide-specific lives here; the HTTP shell is functions/api/lib/arcProxyShell.js (audit batch I7). */
export const onRequest = makeArcProxy({
  arcError,
  timeoutMs: 20000,
  parsePath: parseMgPath,
  metadata: (parsed) => layerMetadata(parsed.county),
  translate: (params) => arcQueryToMg(params),
  upstreamUrl: (parsed, q) => `${mgFeaturesUrl(parsed.server, parsed.county)}?${new URLSearchParams(q.params).toString()}`,
  toArc: (gj, q) => mgToArcQuery(gj, q),
  messages: {
    status: (parsed, res) => `The county MapGuide server answered ${res.status}.`,
    unreadable: () => "The county MapGuide server returned an unreadable answer.",
    failed: (parsed) => `Upstream MapGuide request to ${MG_SERVERS.includes(parsed.server) ? "fgis-map-" + parsed.server : "the county"} failed or timed out.`,
  },
});
