# Owner product constraint #10

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

10. **(2026-09-19) Site elements stack in CREATION ORDER, newest on top — Bluebeam-style — and this
    REVERSES the 2026-08-09 type-layer default recorded in `planStyle.js` (entry retired below,
    kept as history, not deleted). Michael, verbatim, asking for it:** "I mean I feel like whatever
    I draw should be at the top so I can never lose anything when I draw it, I'm assuming that's
    how bluebeam works." **He was told plainly, in chat, the exact consequence — that newest-on-top
    means a parking field drawn after a building paints over the building, and a road drawn last
    puts pavement over everything — and chose it anyway, verbatim:** "Selection should lift and I'm
    good with bluebeams order with new items on top, you can disregard my previous rule." Two
    things travel with this reversal: **(a) a selected element always lifts above every other
    element while selected**, dropping back to its normal creation-order position the moment it is
    deselected; **(b)** he was told, and accepted, that **every existing plan re-stacks** the first
    time it opens under this rule — an element's position in the new stack is no longer decided by
    its type (road under paving under pond under parking under building) but by when it was drawn,
    so a plan's on-screen layering can visibly change on its next open even though nothing on it was
    edited. Do not relitigate either half and do not ask him again. See B1788912 (site-planner
    `lib/planStyle.js` `zOrder`/`byZ`, `SitePlanner.jsx`'s element render pass) for the
    implementation and the road-network composite's own stated ordering rule.
    **EXCEPTION, ORDERED BY THE OWNER 2026-11-05 (NEW-1): TRAILER PARKING ALWAYS DRAWS ABOVE ROADS.** Michael, verbatim: "showing
    trailer parking above the roads" and "I'm trying to fix the visual." (Academy › Concept A: a road drawn after the building covered
    the outer edge of a trailer row while the buffer beyond it, added later, stayed on top — the buffer looked detached with a sliver of
    road between.) He knows the overlap is a layout conflict and will move the road himself: this is purely how it DRAWS — no warning,
    snap, nudge or geometry change. It is a RENDER-ORDER rule only (`lib/trailerOverRoads.js` `liftTrailersOverRoads`, applied in
    `SitePlanner.jsx` `elPaintItems`, `planThumbnail.js`, `kmzExport.js`; the print clone, editable-PDF annotation order and hit-test all
    follow the canvas DOM): a trailer row paints just above the highest road / road cluster that painted above it, whatever their z;
    nothing is written to a saved element, the selection lift still lifts a selected road above everything while selected, and Arrange's
    Bring to Front on a road / Send to Back on a trailer still reorders against everything else but says plainly that it can't change
    this pair. **Do not widen it to any other type pair** — paving, parking, buffers, sidewalks and the dock court keep plain creation
    order — and do not undo it as a violation of this constraint. One stated trade-off: an item drawn after the trailer but before the
    road ends up under the trailer (the trailer is the only thing that moves; roads never change their place against anything).
    Guard: repo-root `test/` **trailerOverRoads**; e2e **trailer-over-roads**; live V2035648.
