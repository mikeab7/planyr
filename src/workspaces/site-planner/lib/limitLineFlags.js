/* A SITE THAT TOUCHES OR CROSSES A CITY-LIMITS / ETJ LINE SAYS SO (NEW-1, owner 2026-11-05: "when the open site touches or crosses a limits/ETJ line, flag it on the site, so the
 * header jurisdiction chip can't silently say one jurisdiction for a split tract"). Pure.
 *
 * The chip names what GOVERNS the site; it used to flag a straddle only for a split city (some lots in, some out) or two counties. A tract that crosses the edge of an ETJ — rest
 * of it unincorporated — or whose boundary merely touches a limits line read as one clean jurisdiction. This turns what the area pass ALREADY measured into a list of flags the chip
 * shows (the ⚑ and one tooltip sentence each):
 *   crosses — a real share of the site is on each side of the line (between `min` and `whole` of its area);
 *   touches — the line meets the site's edge but holds under `min` of it (the B793 sliver) — named, never governing.
 * Limits outrank ETJ (constraint #38): when a city's limits cross the site, that one line is the flag and the same city's ETJ is not flagged a second time. */
export function limitLineFlags({ partialCities = [], coreCities = [], edgeCities = [], etjRows = [], etjEdge = [], cityShareOf = () => null, min = 0.005, whole = 0.995 } = {}) {
  const flags = [], seen = new Set();
  const add = (f) => { const k = `${f.line}|${f.kind}|${String(f.name).toLowerCase()}`; if (!seen.has(k)) { seen.add(k); flags.push(f); } };
  for (const name of partialCities) add({ kind: "crosses", line: "city", name, share: cityShareOf(name) });
  for (const name of edgeCities) add({ kind: "touches", line: "city", name, share: null });
  if (!coreCities.length && !partialCities.length) {
    for (const r of etjRows) if (r && r.share != null && r.share >= min && r.share < whole) add({ kind: "crosses", line: "etj", name: r.name, share: r.share });
    for (const name of etjEdge) if (!etjRows.some((r) => r && String(r.name).toLowerCase() === String(name).toLowerCase() && r.share >= min)) add({ kind: "touches", line: "etj", name, share: null });
  }
  return flags;
}

const pct = (s) => `${Math.round(s * 100)}%`;
/* One plain sentence per flag. */
export function limitLineSentence(f) {
  const what = f.line === "etj" ? `the ${f.name} ETJ line` : `the City of ${f.name} limits line`;
  if (f.kind === "crosses") {
    return f.line === "etj"
      ? `The site crosses ${what}${f.share != null ? ` — ${pct(f.share)} of it by area is inside the ETJ, the rest is outside it` : ""}.`
      : `The site crosses ${what}${f.share != null ? ` — ${pct(f.share)} of it by area is inside the city, the rest is outside it` : ""}.`;
  }
  return `The site's edge touches ${what} (under half a percent of the site is across it).`;
}
export const limitLineNote = (flags) => (flags || []).map(limitLineSentence).join(" ");
