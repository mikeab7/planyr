/* NEW-1 (design-token RADIUS collision hardening) — a dev-mode guard for the token "scale"
 * objects (RADIUS, SPACE, FONT_SIZE, CONTROL_H, …): a flat map of named numbers with no other
 * shape. A miss on one of these keys — the wrong module's scale, a retired key, a typo —
 * evaluates to `undefined`; React silently DROPS `undefined` from a style object, so the control
 * ships with a flat 0 (or the browser default) instead of a visible failure. That is exactly how
 * every ribbon button in the Model module shipped with square corners: `Ribbon.jsx` asked
 * `radius.js`'s `RADIUS` (keys `pill`/`sm`/`md`/`lg`) for `RADIUS.control`, a key that belongs to
 * a DIFFERENT module's same-named scale (`controls.jsx`'s own, now renamed `CONTROL_RADIUS`) —
 * fixed by using `RADIUS.sm`, but nothing would have caught a recurrence of the same miss.
 *
 * `strictScale(name, scale)` wraps a plain token object in a Proxy that THROWS on an unknown key
 * access, naming the bad key and listing the real ones — DEV BUILDS ONLY (`import.meta.env.DEV`,
 * the same gate `controls.jsx`'s `warnLockedOverride` already uses). Production gets the bare
 * object back, completely unchanged, so this costs nothing once shipped. A valid key — including
 * an inherited one like `toString` — passes straight through untouched.
 */
export function strictScale(name, scale) {
  if (typeof import.meta === "undefined" || !import.meta.env || !import.meta.env.DEV) return scale;
  const keys = Object.keys(scale);
  return new Proxy(scale, {
    get(target, prop, receiver) {
      if (typeof prop === "symbol" || prop in target) return Reflect.get(target, prop, receiver);
      throw new Error(`${name}.${String(prop)} is not a valid key — valid keys are: ${keys.join(", ")}`);
    },
  });
}
