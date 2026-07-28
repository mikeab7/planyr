/* Color control = the color wheel + a recently-used swatch row beside it (NEW-4).
 *
 * The wheel (the native `<input type="color">`) is unchanged and stays the way to reach ANY color.
 * What's new is the row next to it: the colors you used most recently, newest first, one click to
 * re-apply — the fast path that was missing, because re-finding a shade in the OS wheel every time
 * is how a plan ends up with four almost-identical blues.
 *
 * Two commit paths, deliberately different (B567):
 *  · the wheel keeps live picking — recolors as you move through the palette, ONE undo frame per
 *    picking session (the caller's `livePick`, spread in through `pick`);
 *  · a swatch is a discrete click — applies immediately and takes exactly ONE undo frame, like any
 *    other discrete commit (a dash change, a Reset). Clicking three swatches = three undos, which
 *    is what a click-per-decision should do.
 *
 * MODULE-SCOPE-COMPONENTS: defined here at module scope, never inside a render body.
 */
import { useEffect, useState } from "react";
import { getRecents, subscribeRecents, recentsWithSeed, normalizeHex } from "./colorRecents.js";

/** Live view of the shared recents list, padded with `seed` so the row is never empty. */
export function useColorRecents(seed, max) {
  const [list, setList] = useState(getRecents);
  useEffect(() => subscribeRecents(setList), []);
  return recentsWithSeed(list, seed, max);
}

const WHEEL = { width: 34, height: 26, padding: 0, border: "1px solid var(--border-default)", borderRadius: 6, background: "var(--surface-raised)", cursor: "pointer" };

/** Just the swatch row — for controls whose wheel is bespoke (the multi-select "Mixed" overlay). */
export function ColorRecentsRow({ seed = [], current = null, onPick, size = 14, disabled = false, "data-testid": testId }) {
  const list = useColorRecents(seed);
  if (!list.length) return null;
  return (
    <span data-testid={testId || "color-recents"} role="group" aria-label="Recently used colors"
      style={{ display: "flex", flexWrap: "wrap", gap: 3, minWidth: 0 }}>
      {list.map((c) => (
        <button key={c} type="button" title={c} aria-label={`Use ${c}`} aria-pressed={c === current} disabled={disabled}
          onClick={disabled ? undefined : () => onPick && onPick(c)}
          style={{
            width: size, height: size, padding: 0, borderRadius: 3, background: c,
            // The current color reads as chosen through a ring, not a fade — never low-contrast text.
            border: c === current ? "2px solid var(--text-primary)" : "1px solid var(--border-default)",
            cursor: disabled ? "default" : "pointer", flex: "0 0 auto",
          }} />
      ))}
    </span>
  );
}

export default function ColorField({
  value,               // current color (any CSS hex form)
  pick,                // spread from the caller's livePick(apply[, hist]) — drives the wheel
  onSwatch,            // (hex) => void — discrete apply for a swatch click (caller pushes history)
  seed = [],           // palette colors used to fill out the row on a fresh browser
  title,               // tooltip / accessible name for the wheel
  style,               // wheel style override (some panels use a smaller wheel)
  swatchSize = 14,
  disabled = false,
  "data-testid": testId,
}) {
  const cur = normalizeHex(value);
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flexWrap: "wrap" }}>
      <input type="color" value={value} title={title} aria-label={title} disabled={disabled}
        data-testid={testId} style={{ ...WHEEL, ...(style || {}) }} {...(pick || {})} />
      <ColorRecentsRow seed={seed} current={cur} onPick={onSwatch} size={swatchSize} disabled={disabled}
        data-testid={testId ? `${testId}-recents` : undefined} />
    </span>
  );
}
