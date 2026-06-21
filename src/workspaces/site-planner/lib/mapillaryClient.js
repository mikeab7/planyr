/* Mapillary request shaping (B308) — leaflet-free so it unit-tests in node.
 *
 * Default path: the same-origin proxy `/api/mapillary/map_features` (the Cloudflare Pages
 * Function injects the token server-side), so NO token rides in the client URL or bundle.
 * Optional override: if the user pasted their OWN token (power-user / local dev), call the
 * Mapillary Graph API directly with it — their token, their choice, their browser only.
 */
export const MLY_FIELDS = "id,object_value,geometry";
export const MLY_PROXY_PATH = "/api/mapillary/map_features";
export const MLY_LIMIT = 500;

/* Build the request URL for a {w,s,e,n} bbox. With no token → the same-origin proxy (no
 * access_token param). With a token → direct to graph.mapillary.com using that token. Pure. */
export function mapillaryRequestUrl(bounds, token) {
  const bbox = `${bounds.w},${bounds.s},${bounds.e},${bounds.n}`;
  const q = `fields=${MLY_FIELDS}&bbox=${bbox}&limit=${MLY_LIMIT}`;
  return token
    ? `https://graph.mapillary.com/map_features?access_token=${encodeURIComponent(token)}&${q}`
    : `${MLY_PROXY_PATH}?${q}`;
}

/* Keep only pole / fire-hydrant detections from a Graph `data` array. Pure. */
export function pickDetections(data) {
  return (data || []).filter((d) => /pole|fire.?hydrant/i.test((d && d.object_value) || ""));
}
