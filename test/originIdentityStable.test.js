/* B519907 — `origin`'s IDENTITY MUST STAY STABLE WHILE ITS VALUE IS UNCHANGED.
 *
 * ⛔ THE DEFECT THIS PINS, measured on the owner's Richfield plan (B1121 ×4). `pushHistory`
 * snapshots the whole app state, so an undo restores `origin` as a FRESH OBJECT holding identical
 * numbers. Ten effects in `SitePlanner.jsx` key on it, and the worst is the Leaflet map-CREATION
 * effect whose cleanup is `map.remove()` — React runs a cleanup before re-running, so every Ctrl+Z
 * destroyed and rebuilt the entire basemap:
 *
 *     per action     click 0 · drag 0 · UNDO 272 destroyed + 272 recreated · pan 14 · Escape 0
 *     per 12 rounds  listeners +6 EVERY round (1544 → 1616) · retained heap +1.66 MB/round
 *     after the fix  undo 0/0 · listeners flat at 1656 for 11 consecutive rounds
 *
 * ⛔ WHY A SOURCE GUARD AND NOT A RENDER TEST, stated so nobody "upgrades" it into one. The bug is
 * not in a pure function — it is in WHICH VALUE a hook closes over, and the only faithful
 * behavioural check needs a real Leaflet map, a real undo and a real tile grid (that check exists:
 * `ui-audit/verify-undo-tile-churn.mjs`, which counts real `<img>` mutations and is the mutation
 * proof). What CI can cheaply guarantee is that the stabiliser still exists and that no effect has
 * gone back to keying on the raw state object. A green here plus a green there is the pair.
 *
 * ⚠ B1189 IS THE PRECEDENT AND THE REASON THIS IS NOT A PER-EFFECT FIX. That item hit this exact
 * class ("an effect that writes state must depend on VALUES, never on a state object's identity")
 * and fixed ONE effect by listing `origin.lat/lon` in its deps — leaving nine others, and every
 * future one, to remember. Stabilising the value closes all of them and cannot be forgotten.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOrigin } from "../src/workspaces/site-planner/lib/sitePlacement.js";

const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "src", "workspaces", "site-planner", "SitePlanner.jsx"),
  "utf8"
);

describe("origin identity is stabilised at the source", () => {
  it("the raw state is held under a different name, so nothing can close over it by accident", () => {
    expect(SRC).toMatch(/const \[originRaw, setOrigin\] = useState\(/);
    expect(SRC, "the raw origin state must not be named `origin`").not.toMatch(/const \[origin, setOrigin\] = useState\(/);
  });

  it("`origin` is derived through a memo keyed on the two SCALARS", () => {
    const m = /const origin = useMemo\(\s*\(\) => originRaw,[\s\S]{0,240}?\[originRaw \? originRaw\.lat : null, originRaw \? originRaw\.lon : null\]/.exec(SRC);
    expect(m, "origin must be a useMemo over originRaw keyed on lat/lon").toBeTruthy();
  });

  /* ⛔ A TOLERANCE HERE WOULD BE A DIFFERENT BUG. `sameOrigin` compares at 1e-12, which is right for
   * "is this the same site?" and wrong for this: it would pin a genuinely moved origin to its old
   * object and strand the basemap at the previous location. Exact scalar equality only. */
  it("does not stabilise through a tolerant comparison", () => {
    const memo = /const origin = useMemo\([\s\S]{0,400}?\);/.exec(SRC)?.[0] || "";
    expect(memo).not.toMatch(/sameOrigin|Math\.abs|1e-1[0-9]/);
  });

  it("the Leaflet map-creation effect no longer keys on a raw state object it can never compare", () => {
    /* The effect whose cleanup removes the map. It may depend on `origin` — that is now the STABLE
     * value — but the state it is fed must be the memoised one, which the guards above establish. */
    expect(SRC).toMatch(/map\.remove\(\)/);
    expect(SRC).toMatch(/\}, \[origin\]\);/);
  });

  it("normalizeOrigin still returns a bare lat/lon pair, which is what makes equal-valued interchangeable", () => {
    const a = normalizeOrigin({ lat: 29.98731176112534, lon: -95.77730343242138 });
    const b = normalizeOrigin({ lat: 29.98731176112534, lon: -95.77730343242138 });
    expect(a).toEqual(b);
    expect(Object.keys(a).sort()).toEqual(["lat", "lon"]);
    expect(a).not.toBe(b); // two calls really do allocate — which is the whole reason the memo is needed
  });
});
