/* dockLayerPanel — the pure half of the dock-layer Properties panel (truck court · trailer parking · buffer).
 * NEW-1 (owner-approved mockup 2026-10-19). One panel parameterised by layer kind: this module owns every
 * word and every decision (Auto vs typed, the band notice, what a removal takes with it); the render is
 * `DockLayerPanel` in SitePlanner.jsx and holds no rule of its own.
 *
 * Rules to keep:
 *  - Auto is a STATE, not a placeholder: the box always shows a number (the computed one, muted) and the pill
 *    says whether that number or a typed one is in force. Typing/stepping flips Auto off and keeps the value.
 *  - A slope outside the class band is KEPT and SAID (one line), never blocked.
 *  - Removing a layer takes every layer outward of it (they have nothing to sit against); the confirm card
 *    names exactly the layers that go, generated from the real chain — never a hard-coded "all three". */

const LAYER_TITLES = ["Truck court", "Trailer parking", "Buffer"];

export function dockLayerTitleWord(i) { return LAYER_TITLES[i] || "Dock layer"; }

/* "Dock layer 2 of 3" — the position in the default sequence, as the old paragraph said it. */
export function dockLayerPosition(i, total = 3) { return `Dock layer ${i + 1} of ${total}`; }

/* A layer's plain name for the Now/After rows, from the element itself (appended layers included). */
export function dockLayerName(el, typeLabel = "") {
  if (!el) return "layer";
  if (el.truckCourt) return "truck court";
  if (el.type === "trailer") return "trailer parking";
  if (el.buffer || el.forTrailer) return "buffer";
  return String(typeLabel || el.type || "layer").split(" / ")[0].toLowerCase();
}

const countWord = (n) => (n === 2 ? "both" : n === 3 ? "all three" : `all ${n}`);

/* What a removal does. `chain` = the wall's layers head → outward ([{id, el}] or elements), `idx` = the selected
 * layer's place in it, `wallLabel` = "W". Returns the confirm card's content and the Removed note. */
export function dockRemovalPlan({ chain, idx, wallLabel, nameOf = dockLayerName }) {
  const names = (chain || []).map((z) => nameOf(z));
  const going = names.slice(Math.max(0, idx));
  const staying = names.slice(0, Math.max(0, idx));
  const wall = `${wallLabel} wall`;
  const n = going.length;
  return {
    count: n,
    outerOnly: n <= 1,
    copy: n > 1 ? `${cap(going.slice(1).join(" and "))} ${going.length === 2 ? "sits" : "sit"} outside this ${going[0]}, so ${going.length === 2 ? "it goes" : "they go"} with it.` : null,
    now: `${wall} · ${names.join(" → ")}`,
    after: `${wall} · ${staying.length ? staying.join(" → ") : "no dock layers"}`,
    confirmLabel: n > 1 ? `Remove ${countWord(n)}` : "Remove",
    note: `Removed. ${wall} ${staying.length ? `now ends at the ${staying[staying.length - 1]}` : "has no dock layers"}.`,
  };
}
function cap(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

/* Auto / typed for a numeric field. `stored` null/undefined = Auto. `auto` = the computed value (may be null when
 * nothing can compute it — the box then shows an em dash, still not the word "auto"). */
export function autoField(stored, auto) {
  const isAuto = stored == null || !Number.isFinite(stored);
  return { isAuto, shown: isAuto ? (Number.isFinite(auto) ? auto : null) : stored };
}

/* The one amber line under Slope: only for a TYPED slope outside the class band. */
export function slopeBandNotice({ slopePct, band, label }) {
  if (slopePct == null || !Number.isFinite(slopePct) || !band) return null;
  const eps = 1e-9;
  if (slopePct >= band.min - eps && slopePct <= band.max + eps) return null;
  return `Outside the ${band.min.toFixed(1)}–${band.max.toFixed(1)}% ${label} band. Kept as typed.`;
}

/* Length state: is it the full wall (muted text) or shorter (a "Full wall" link)? */
export function lengthIsFull(len, full) { return Number.isFinite(len) && Number.isFinite(full) && Math.abs(len - full) < 0.5; }

/* Steps (owner spec): Depth 5 · Length 10 · Elevation 0.5 · Slope 0.1 · Weight 1 · Opacity 10. */
export const DOCK_STEPS = { depth: 5, length: 10, elevation: 0.5, slope: 0.1, weight: 1, opacity: 10 };

/* Every string the OLD panel carried that the redesign removed — the guard and the live check grep for these. */
export const REMOVED_COPY = [
  "Dock zone", "Or select the building to grow", "set independently of the other side",
  "Dock zone: auto prices", "Feeds the auto-graded surface", "never silently passes",
  "Pad elev.", "Footprint:", "Delete element", "(+ outer)",
];
