/* Parse a human-typed real-world length into FEET, for manual Calibrate.
 *
 * Accepts the forms a drawing reviewer actually types:
 *   • plain feet, optional marker      120 | 120.5 | 120' | 120ft | 120 feet
 *   • explicit fractional feet         1/2 ft | 12 1/2 ft | 3/4'
 *   • feet-and-inches                  38'-7" | 38' 7 3/4" | 38' | 7" | 7 3/4"
 *
 * REJECTS (never silently coerces — this is the whole point, B304):
 *   • scale ratios                     1:240 | 1/4"=1'
 *   • bare fractions (ambiguous)       1/8        ← used to parseFloat to 1
 *   • non-numeric junk                 abc
 *   • zero / negative
 *
 * `parseFloat` stops at the first non-numeric char, so "1/8" → 1 and "1:240" → 1,
 * silently mis-calibrating the whole sheet. This validates the ENTIRE string and
 * returns a typed result so the caller can show a clear inline message.
 *
 * Returns { ok:true, ft } | { ok:false, empty:true } | { ok:false, message }.
 */
export function parseFeet(raw) {
  const s = String(raw == null ? "" : raw).trim();
  if (!s) return { ok: false, empty: true };

  // A scale ratio / equation is NOT a length — reject loudly so it can't read as feet.
  if (s.includes(":") || s.includes("=")) {
    return { ok: false, message: "That looks like a scale ratio, not a length. Enter the real length in feet, e.g. 120 or 38'-7\"." };
  }

  const bad = { ok: false, message: "Enter a length in feet — e.g. 120, 120.5, or 38'-7\"." };
  const ok = (ft) => (Number.isFinite(ft) && ft > 0 ? { ok: true, ft } : bad);

  // 1) Plain decimal feet, optional ft/' marker:  120 | 120.5 | 120' | 120 ft
  let m = s.match(/^(\d+(?:\.\d+)?)\s*(?:'|′|ft|feet)?$/i);
  if (m) return ok(parseFloat(m[1]));

  // 2) Explicit fractional feet (unit REQUIRED so a bare "1/8" can't sneak in):
  //    1/2 ft | 12 1/2 ft | 3/4'
  m = s.match(/^(?:(\d+)\s+)?(\d+)\/(\d+)\s*(?:'|′|ft|feet)$/i);
  if (m) {
    const den = +m[3];
    if (!den) return bad;
    return ok((m[1] ? +m[1] : 0) + (+m[2]) / den);
  }

  // 3) Feet-and-inches:  38'-7" | 38' 7 3/4" | 38' | 7" | 7 3/4"
  //    Feet part (number + '/ft) optional; inches part (number, optional fraction,
  //    + "/in) optional — but at least one must be present, and each part carries its
  //    own unit marker so a unitless "38 7" can't slip through as a number.
  m = s.match(/^(?:(\d+(?:\.\d+)?)\s*(?:'|′|ft|feet))?\s*[-,]?\s*(?:(\d+)(?:\s+(\d+)\/(\d+))?\s*(?:"|″|in|inch|inches))?$/i);
  if (m && (m[1] != null || m[2] != null)) {
    const ft = m[1] != null ? parseFloat(m[1]) : 0;
    let inch = 0;
    if (m[2] != null) {
      inch = +m[2];
      if (m[3] != null && m[4] != null) {
        const den = +m[4];
        if (!den) return bad;
        inch += (+m[3]) / den;
      }
    }
    return ok(ft + inch / 12);
  }

  return bad;
}
