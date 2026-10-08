// Trailer parking rows — the pure rules the canvas label, the Properties fields and the draw tool share.
//
// (NEW-1/NEW-2/NEW-3, owner chat block 2026-10-06.) Three things about one object:
//
//  1. THE LABEL. Every row carries its own "<depth>′ Trailer Parking / <n> trailers" label, and the count
//     is the point of it — so the count is the line the label keeps when a row is too shallow for two.
//  2. HIDING IT. `labelHidden` is a per-row, label-only flag — the element twin of a parcel's `chipHidden`
//     ("Hide acreage label"). It is NOT `noLabel`: that is a bond ROLE tag (bondRemap's HOST_ROLE_TAGS) which
//     the copy and heal paths strip when a host goes missing, so a user's choice stored there would quietly
//     come back. Hiding a label never touches the row's geometry, its count, or any yield number.
//  3. THE STALL SPEC. A free-drawn row used to take the plan-wide stall depth (53′) with no way to change it
//     per row, so a 50′-deep row held no stall at all and read as "the tool won't let me draw 50′". The
//     depth / width / drive lane are now per-row overrides in `el.cfg` (resolved over Standards by cfgOf),
//     and a row drawn shallower than the standard stall adopts the drawn depth as its stall depth.
//
// Pure — no React, no DOM — so each rule is unit-tested in Node.

/* A sanity floor, deliberately far below any real trailer stall (a 20′ box trailer is the shortest thing
 * anyone parks): it exists to stop a typo (0, 1) from producing a thousand stalls, never to enforce 53′.
 * The plan-wide Standards fields already accept any value from 1 up and are left as they are. */
export const TRAILER_FIELD_MIN = { trailerL: 8, trailerW: 6, trailerAisle: 0 };

const num = (v) => (typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN);

/* The two-line label and which line survives a shallow strip. Line 0 is the stall depth + name, line 1 the
 * count; `keepLine: 1` tells the label engine the count is the last line it may drop. */
export function trailerRowLabel({ depthFt, count, est = false, name = "Trailer Parking" } = {}) {
  const f0 = (n) => Math.round(n).toLocaleString(); // the same rounding SitePlanner's own f0 uses
  return {
    lines: [`${f0(depthFt)}′ ${name}`, `${f0(count)} trailers${est ? " (est)" : ""}`],
    keepLine: 1,
  };
}

/* Is this element's label switched off — by the structural role tag or by the user's own choice? */
export const elementLabelHidden = (el) => !!(el && (el.noLabel || el.labelHidden));

/* The patch that flips the user's choice. `null` clears the key so an untouched row stays byte-identical. */
export const labelHiddenPatch = (el) => ({ labelHidden: elementLabelHidden({ labelHidden: el && el.labelHidden }) ? null : true });

/* Merge one stall-spec value into a row's `cfg`. Returns the new cfg, or `null` when the value is not a
 * finite number at or above that field's sanity floor (the caller leaves the row alone and says why). */
export function trailerCfgPatch(cfg, key, value) {
  const min = TRAILER_FIELD_MIN[key];
  const n = num(value);
  if (min == null || !Number.isFinite(n) || n < min) return null;
  return { ...(cfg || {}), [key]: n };
}

/* When a row is DRAWN shallower than the plan's standard stall depth it could never hold a stall (a 50′ row
 * at a 53′ standard counted zero), so it adopts the drawn depth as its stall depth — recorded on the row,
 * visible and editable in Properties. Returns a cfg to stamp, or null to leave the row on Standards. */
export function drawnTrailerCfg({ depthFt, standardDepthFt }) {
  const d = num(depthFt), std = num(standardDepthFt);
  if (!Number.isFinite(d) || !Number.isFinite(std)) return null;
  if (d >= std || d < TRAILER_FIELD_MIN.trailerL) return null;
  return { trailerL: Math.round(d * 100) / 100 };
}
