# Named rule CHROME-NEVER-EATS-A-PRESS

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **CHROME-NEVER-EATS-A-PRESS** — **Anything that paints ABOVE the content and stops propagation must either be
  GATED on its own object being selected, or FORWARD the press to `isDoubleTap` keyed on the UNDERLYING
  feature.** In SVG, paint order IS hit-test order, so a late-painted node with `pointerEvents` on wins every
  press inside it — and a handler that stops propagation without calling `setSel` or `isDoubleTap` makes that
  press *invisible*: nothing selects, no double-tap can pair, and an undo frame is often burnt for nothing.
  Three corollaries, each learned the hard way:
  1. **A private double-tap key on chrome that sits over its own object is a POISON.** `isDoubleTap` keeps ONE
     tap record, so `eldim:${id}` / `${id}:label` over a footprint both dissolved the pair AND clobbered the
     record, so a third press had nothing left to pair with. **One key per feature**; branch the ACTION on
     which surface took the press, never the key.
  2. **Chrome that only EXISTS once selected is the worst case, because it is invisible to a static reading.**
     The dimension grab band renders `if (dimSel)`, so press 2 of a real double-click lands on a layer press 1
     just created — dead by construction, and no source scan can see it.
  3. **A guard that names one component protects one component.** Assert it STRUCTURALLY, on the real render:
     with nothing selected, every element's own centre must answer to that element via `elementFromPoint`.
  4. **⛔ CHROME MOUNTED BY THE FIRST PRESS IS INVISIBLE TO ANY CHECK THAT READS THE DOM BEFORE THE INTERACTION
     (B233153) — so the probe shape is the TWO-PRESS INVARIANT: press once, RE-ASK what a double-click at that
     point now addresses, and require the same feature.** Corollary 2 said chrome that only exists once selected
     is the worst case; B233153 is that case at its worst, because the chrome was the feature's OWN vertex
     handle — pressing the pond mounted the 18px hit square that then ate press 2, at the point the pointer had
     not moved from. **And the variable that hid it was not the SHAPE but VERTEX COUNT against handle size at
     the probe point:** six realistic four-vertex sandbox ponds all passed, because their grips sit at four
     distant corners while a surveyed ring peppers its own basin edge. Two things make this observable rather
     than lucky: the app exposes its own resolution read-only (`window.__plannerHitTarget`, E2E-gated — a
     harness re-implementing the rule tests its own copy), and a harness must deliver a **native** `dblclick`
     (`clickCount: 1` then `2`; two bare down/up pairs leave the counter at 1 and Chromium synthesises nothing,
     so the whole root-resolver path goes unexercised while every row reads green).
  5. **The fix belongs at the RESOLVER, not on the object that was reported.** A handle is chrome belonging to
     the selected feature, so it is TRANSPARENT to "which feature was double-clicked" — one rule closes every
     element type that renders grips at once. Identification only: grips keep their own pointer events and
     their own `onPointerDown`, and **a vertex must still drag** — assert that in the same commit, counting how
     many vertices moved (a press falling THROUGH an inert grip moves the whole object, which passes any
     "the geometry changed" check).
  6. **⛔ AND THE FIFTH INSTANCE'S CLAUSE — WHEN THE FEATURE IS SMALLER THAN ITS OWN CHROME, "WHAT IS
     BENEATH THIS GRIP" AND "WHAT IS THIS GESTURE ABOUT" STOP BEING THE SAME QUESTION.** Clause 5 fixed
     identification at the resolver by looking THROUGH the handle layer, which answers the first
     question. It does not answer the second, and those coincide only while the feature is bigger than
     the chrome it summons. Captured live on the owner's Bain plan: a road stub whose whole rendered
     body is **6×12 CSS px**, wearing a 12 px endpoint handle inside a 15×22 px handle box. Press 1
     selected it; press 2, at the same point, addressed **a different, larger road**, and the panel
     open after press 1 was gone after press 2. **The control matters as much as the capture** — on a
     LARGE road, a point where press 1 mounts an endpoint handle directly over the press point still
     resolves to the road and still opens Properties, so looking through the handle layer works and the
     endpoint handle is not the differentiator. **The SIZE RATIO is.** The rule: **while a double-click
     is in flight, the feature press 1 selected WINS the hit test at that point** — anchored on the
     native double-click's own time and distance budgets, so one press outside them is not a gesture and
     resolves off the stack exactly as before (`featureTarget.gestureAnchorTarget`). Two corollaries:
     **(a)** a "prefer it on a tie" rule is not enough — it still loses to whatever the stack puts on
     top, which is the failure; **(b)** the same size ratio makes REVIEW chrome dangerous, not just
     grips — the min-radius flag's 7 px corner dot is wider than that stub, and it swallowed the press
     entirely AND ran the corner fix on press 2, **silently re-cutting the alignment**. Chrome that
     paints ON its feature's body identifies AS that feature and forwards the press; chrome offset into
     clear space keeps its own action and does NOT claim to be the feature. **A gesture whose contract
     is "open Properties" must never edit the plan, and never CLOSE a panel that was already open** —
     both are now asserted for every feature by `audit-doubleclick-properties`.
  7. **⛔ THE SIXTH INSTANCE — CHROME ARMED BY THE CURSOR MERELY *RESTING* ON IT (B280402), and it is
     the one clause 4 cannot reach.** Clause 4 says chrome mounted by the FIRST PRESS is invisible to
     any check that reads the DOM before the interaction. This is worse: the parcel acreage badge
     becomes a hit target on HOVER (B1327/NEW-4 moved the gate from selection to hover so the badge
     could be dragged at all), and **a cursor resting on a point is exactly what a cursor does between
     the two presses of a double-click**. Measured on the owner's plan and reproduced: at one point,
     nothing selected, the stack reads `["el:<stub>"]` after touching another feature and
     `["parcel:<lot>", "el:<stub>"]` after resting on it — **the parcel does not move above the
     element, IT ENTERS**, and the element is still there, second, unchanged. It is not paint order and
     not a pointer-events flip on the element (both proven identical across the two states). **So the
     probe shape is: park the cursor, let it arm whatever it arms, and RE-ASK** — every other check in
     this repo reads after a click, never after a plain hover. Fix shape: chrome that is a manipulation
     affordance is IDENTITY-TRANSPARENT wherever it lives — `data-chrome` joins `data-handle-layer` in
     the resolver — while keeping its own press, so the badge still drags.
  Precedents: **B1174** (measurement chips), **B1327** (the parcel acreage badge — the third instance, and the
  reason this is a named rule; regressed by B1186 moving the badge anchor to `polylabel`), and **B50010** (an
  element's own DIMENSION NUMBER — a road's is anchored to the centreline midpoint, so it is painted ON the
  pavement and a double-click aimed at the road cannot miss it; the general fix is that chrome sitting over
  its own object's BODY forwards the press to the body, asked once for every type rather than special-cased), and
  **B233153** (a detention pond's OWN vertex handle — the fourth instance, and the one that produced clauses 4 and 5
  above; captured live on the owner's Bain plan after six realistic sandbox reproductions all came back green), and
  **B806082** (a callout's own leader re-aim grips — the tip and elbow handles paint exactly where a right-click
  naturally lands, and neither carried an `onContextMenu`, so the press fell through in total silence to the
  empty-canvas map menu instead of the leader's own "Delete Leader" row; fixed by forwarding both grips' right-click
  to the same handler their leader body already uses).
  **⛔ AND THE COROLLARY B50008/B50009 ADD: A GESTURE CAN DIE WITH NOTHING EATING IT.** This rule is about
  chrome swallowing a press, and reading every failure through it is how two other causes survived for
  months — the pair being measured on a WALL CLOCK read inside the handler (so a busy plan spends the whole
  budget on queueing delay), and the native `dblclick` retargeting to the root because press 1 re-rendered
  the node the browser was holding. When a double-click "does nothing", check the CLOCK and the TARGET
  before hunting for what covered it. The deliberate
  EXCEPTION is user-placed content the user opted into putting on top — a promoted reference (B1198), a markup
  with `behindEls: false` — which is selectable, lockable and demotable in one click from the menu that put it
  there. Guard: the e2e spec **chrome-swallows-press** (mutation-checked both ways).
