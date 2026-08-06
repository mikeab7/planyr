# B1439, SECOND ATTEMPT — the plan-switch leak is REAL, UNBOUNDED, and half-named

**2026-08-06.** B1439 was filed as *"a reproducible signature with no mechanism"* and deliberately not
fixed, under B1434's rule: **do not ship a fix against a signal you cannot explain.** That rule still
stands and **no fix for B1439 is shipped here.** What this attempt adds is evidence.

Instrument: `ui-audit/diagnose-plan-switch.mjs`, built on `ui-audit/lib/heapSnapshot.mjs` (edge index,
retainer index, holder search — 21 unit tests in `test/heapSnapshot.test.js`).

---

## 1. IT IS NOT MY INSTRUMENT — the control that had to exist

Every performance harness in this repo sets `window.__PLANYR_E2E`, which arms four
`window.__planner*` self-audit hooks inside `SitePlanner`. **Those four were never nulled on
unmount**, and each closes over the live render — so they were a genuine candidate for the whole
signature. A measurement that cannot tell the instrument from the product is worth nothing.

`--no-e2e` runs the identical cycle with the hooks absent (the route switch is a plain
`location.hash` write and needs none of them).

| ×3 cycles | hooks ARMED | hooks ABSENT (`--no-e2e`) |
|---|---:|---:|
| detached DOM nodes | 7,026 | **7,026** |
| detached bytes | 1,173.4 KB | **1,173.4 KB** |
| `rendererNodes` | +326.2% | **+326.2%** |
| `jsEventListeners` | +55.1% | **+55.1%** |
| JS heap | +37.1% | +37.4% |

> **Identical. B1439 is a product bug, not an instrument artifact.**

*(The four hooks are nevertheless nulled on unmount now — see §5. That is a correctness fix to
dev-gated code, and it is explicitly **not** a fix for B1439.)*

---

## 2. THE DETACHED DOM IS REAL, AND B1433'S ZERO DOES NOT COVER THIS

B1439's honest counter-evidence was **B1433's zero detached nodes**, read from V8's own
`detachedness` flag. That measurement was taken across **interaction on one plan** — never across a
plan **switch**, which is a different lifecycle entirely. Measured across the switch, from the same
flag:

| A → B → A | before | after |
|---|---:|---:|
| detached DOM nodes | **0** | **2,342** |
| detached bytes | 0 | **391.1 KB** |

Every attached counter returns exactly, as B1439 reported: `documentNodes` 1,805 → 1,805 ·
`canvasNodes` 976 → 976 · `elementsDrawn` 66 → 66 · `layoutObjects` 1,605 → 1,605 ·
`leafletTiles` 36 → 36 · `leafletContainers` 2 → 2.

---

## 3. IT COMPOUNDS. THIS IS AN UNBOUNDED LEAK, NOT A ONE-TREE RESIDUE

B1439 named this as the version of the question that matters and could not answer it:

| cycles (A→B→A) | detached nodes | detached bytes | `rendererNodes` | `jsEventListeners` | heap |
|---:|---:|---:|---:|---:|---:|
| 1 | **2,342** | 391.1 KB | +108.7% | +18.3% (578 → 684) | +16.9% |
| 3 | **7,026** | 1,173.4 KB | +326.2% | +55.1% (577 → 895) | +37.1% |

**Linear: ~2,342 nodes, ~391 KB and ~106 listeners per round trip, released never.** Nothing
plateaus, so this is not "the previous plan is held until the next switch replaces it" — every plan
the owner has ever opened in a session is still there.

**And that is the shape of his symptom.** Plan and revision switching rises through a session and
resets on reload — *"reload and it's quick; a while later it's lagging again."* This is the only
thing measured anywhere in the speed program that grows without bound inside one session.

---

## 4. WHAT IS HELD, AND BY WHAT — half-named, and the half that is named is new

**What is held is the WHOLE previous `SitePlanner` tree, not just its canvas.** The heaviest detached
classes on one cycle: 1,187 `SVGRectElement` · 179 `SVGGElement` · 101 `SVGPathElement` ·
92 `SVGLineElement` · **78 `SVGSVGElement`** · 88 `<span>` · and named chrome including
`<button title="Standards" data-rail-tab="standards">` and `<button title="References">`. Seventy-eight
detached `<svg>` roots is the rail's inline icons — this is the app's furniture as much as its plan.

### 4a. Two methodological corrections, because each produced a confident wrong answer first

1. **The shortest retaining path is the WRONG QUESTION for a detached node.** Every DOM wrapper is
   one edge from V8's handle table, so the shortest chain to *any* node — leaked or not — is
   `(GC roots) → (Traced handles) → the node`. The first run returned exactly that for every class:
   always true, and it never distinguishes a leak from a live element.
2. **A `native` node is not a holder either.** Blink hangs satellite objects off every element —
   `SVGAnimatedLength`, `CSSStyleDeclaration`, `Text`, `InternalNode` — and those are **not** flagged
   detached even when their owner is. So "the first non-detached retainer" cheerfully answered
   `SVGAnimatedLength → the detached <rect>`, which is the element's own width attribute naming the
   leaked node as its own holder.

`holderOf` now walks backwards out of the detached subtree, traversing *through* synthetic and native
retainers and reporting only a **JS-side** holder — and refusing to invent one, with a stated reason,
when every retainer is detached, native or a handle table.

### 4b. The two holders it names

```
HOLDER: native_bind [closure]   (2 retainers)
  └ shortcut:bound_argument_2 → <input type="file" accept="application/pdf,image/*,.dxf,.dwg">  [detached]
    └ … → <div> → <div> → <button data-rail-tab="standards"> → <button data-rail-tab="references">
      → <span> → SVGSVGElement → SVGRectElement  [all detached]

HOLDER: Array
  └ element:[1] → <div>  [detached]
    └ … → <div data-export="skip"> → SVGSVGElement → SVGGElement  [all detached]
```

- A **bound function** (`Function.prototype.bind`) holding the site-plan overlay's file `<input>` as
  its third bound argument. From that input the entire detached rail and panel tree is reachable by
  ordinary DOM edges.
- A plain **`Array`** holding a detached `<div>`, from which the previous plan's `<svg>` hangs.

### 4c. What is still NOT named, said plainly

**No source line.** There is no `.bind(` anywhere in `src/` that takes a DOM node as an argument
(the only match in the site-planner is `fetch.bind(globalThis)`), so the bound function is created
inside a dependency or by the engine, and the `Array` is unidentified. **B1434's rule applies and no
fix is shipped against this.**

---

## 5. WHAT THE SECOND ATTEMPT RULED OUT — so a third does not start from zero

1. **NOT the harness.** `--no-e2e` leaks identically (§1).
2. **NOT a listener left on a long-lived target.** `DOMDebugger.getEventListeners` on `window` and
   on `document`, before and after the cycle, with the registering script position on every row:
   **net +0 on both.** So the ~106 listeners per cycle are on the detached nodes themselves — a
   *consequence* of the retention, not its cause.
3. **NOT a missing `removeEventListener` / `disconnect()` / `clearInterval` in app code.** An
   exhaustive sweep of `src/workspaces/site-planner/**`, `src/shared/**` and `src/app/**` for all
   seven asymmetry classes found **zero** cases of: an `addEventListener` in an effect with no
   cleanup · a capture-flag mismatch · an add/remove identity mismatch · an observer without
   `disconnect()` · an uncleared timer/rAF/idle loop. Every module-level registry returns an
   unsubscribe and every consumer uses it. Both Leaflet maps end in `map.remove()`.
4. **NOT Leaflet.** `leafletContainers` and `leafletTiles` return exactly; `releaseLayer`'s teardown
   is intact.
5. **NOT `window.__planner*`** — although those four hooks *were* a real retention path (each closes
   over the live render; the neighbouring `window.__geoMap` has always nulled itself and these did
   not). **They are nulled on unmount now**, in this dispatch, as a correctness fix to dev-gated code
   that every harness here arms — so no future measurement is taken through them. §1 proves they are
   not B1439's cause.

**Where a third attempt should start:** the `Array` holder. It is a plain JS array with a detached
`<div>` at index 1 — the cheapest thing left to identify, and unlike the bound function it is
certainly ours or a dependency's rather than an engine artifact. The tool to do it with now exists.
