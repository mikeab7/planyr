/* /gc/<key>/FeatureServer/0[/query] — an ArcGIS-REST-shaped front for the public GIS Cloud maps two Missouri counties (Clinton, Hickory) keep their
 * parcels on. All translation is the pure `src/shared/gis/giscloudAdapter.js`; this file only does the HTTP.
 *
 * ACCESS (the rule that must not move): the upstream call is GIS Cloud's own public REST API (`api.giscloud.com/1/layers/<id>/features.json`) with NO key,
 * session, cookie or token — exactly what an anonymous visitor to the county's public map gets. The layer is chosen from a fixed table (GC_MAPS), and only the
 * `where` shapes the adapter validates plus a bounding box ever reach GIS Cloud, so this is not an open relay and not a free-SQL pass-through. */
import {
  parseGcPath, arcQueryToGc, gcFeaturesUrl, gcToArcQuery, layerMetadata, arcError, GC_MAPS,
} from "../../src/shared/gis/giscloudAdapter.js";
import { makeArcProxy } from "../api/lib/arcProxyShell.js";


/* Only what is GIS Cloud-specific lives here; the HTTP shell is functions/api/lib/arcProxyShell.js (audit batch I7). */
export const onRequest = makeArcProxy({
  arcError,
  timeoutMs: 20000,
  parsePath: parseGcPath,
  metadata: (parsed) => layerMetadata(parsed.key),
  translate: (params, parsed) => arcQueryToGc(params, parsed.key),
  upstreamUrl: (parsed, q) => `${gcFeaturesUrl(parsed.key)}?${new URLSearchParams(q.params).toString()}`,
  toArc: (gj, q) => gcToArcQuery(gj, q),
  messages: {
    status: (parsed, res) => `The ${GC_MAPS[parsed.key].county} County map server answered ${res.status}.`,
    unreadable: () => "The county map server returned an unreadable answer.",
    failed: (parsed) => `Upstream GIS Cloud request for ${GC_MAPS[parsed.key].county} County failed or timed out.`,
  },
});
