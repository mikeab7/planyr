// B688864 — the References panel's "Aerial backdrop" row draws its picture through TWO
// independent techniques that the owner cannot tell apart on screen: the captured/uploaded
// `underlay` image, and the LIVE Leaflet basemap tile layer (`basemapOn`/`basemapSrc`), which
// takes over whenever a plan is georeferenced (`origin`) — true for every plan created from the
// Map picker (`underlay.fromMap`). The row's Hide (eye) and Remove (✕) controls only ever touched
// the captured-image half. On a georeferenced plan the live tiles are what the owner actually
// sees, so Hide changed nothing on screen (the SVG image was already suppressed in favour of the
// tiles) and Remove cleared the archived snapshot while the identical-looking live aerial stayed
// on screen — read by the owner as "clicking it does nothing" / "deleting it does nothing".
// Compounding it, the old `showAerial` flag was a bare `useState`, never written to the saved
// plan, so even the one thing it DID control (the static image, when the live basemap is off)
// reset to shown on every reload.
//
// The fix makes ONE persisted, sparse fact — `settings.aerialHidden` (absent = shown, matching
// the `settings.hidden` content-visibility convention) — the single source of truth for "is the
// aerial backdrop visible", and gates BOTH rendering techniques on it. Pulled out as a pure module
// so the decision is independently unit-tested rather than inlined and unverifiable in the render body.

// Whether the References panel's aerial row is currently shown. Sparse: an untouched plan has
// no `aerialHidden` key at all and reads as visible.
export function isAerialVisible(settings) {
  return !(settings && settings.aerialHidden);
}

// Applies a want (true = show, false = hide) to `settings`, staying sparse — hiding adds the
// key, showing removes it entirely, and a no-op returns the SAME object (so a React state
// setter can bail out without a redundant render/save, matching the rest of this codebase's
// identity-stable settings patches). Never mutates the input.
export function withAerialVisible(settings, want) {
  const s = settings || {};
  const cur = isAerialVisible(s);
  if (want === cur) return s;
  if (want) {
    const { aerialHidden: _aerialHidden, ...rest } = s;
    return rest;
  }
  return { ...s, aerialHidden: true };
}

// THE core fix: which basemap source (if any) the live Leaflet tile layer should actually
// render. Previously this ignored the References panel's Hide/Remove state entirely
// (`basemapOn ? basemapSrc : null`), so on a georeferenced plan the live aerial stayed on
// screen no matter what the panel's eye/✕ controls did. Aerial visibility now gates the tile
// layer exactly like it gates the static `underlay` image.
export function isAerialTileActive(basemapOn, aerialVisible) {
  return !!(basemapOn && aerialVisible);
}

export function wantBasemapSrc(basemapOn, aerialVisible, basemapSrc) {
  return isAerialTileActive(basemapOn, aerialVisible) ? basemapSrc : null;
}
