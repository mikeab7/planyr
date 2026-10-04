/* Pure geometry for the my-location marker. */
export const DOT_RADIUS_PX = 9; // core dot + white ring, roughly Apple Maps' on a phone

// Ground metres one screen pixel spans at a latitude/zoom (Web Mercator, 256px tiles).
export function metersPerPixel(latDeg, zoom) {
  return (40075016.686 * Math.cos((latDeg * Math.PI) / 180)) / (256 * Math.pow(2, zoom));
}

// Hide the accuracy circle once it would hug the dot (a circle barely wider than the dot adds noise).
export function accuracyCircleVisible(accuracyM, latDeg, zoom, dotPx = DOT_RADIUS_PX) {
  if (!Number.isFinite(accuracyM) || accuracyM <= 0) return false;
  return accuracyM / metersPerPixel(latDeg, zoom) > dotPx * 1.5;
}
