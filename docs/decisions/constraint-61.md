# Owner product constraint #61

61. **(2026-11-24) An UNFILLED, UNHATCHED shape is clickable ONLY on its visible outline.** Michael: "If something has no fill or hatch I shouldn't be able to click on it where fill / hatch would be, only on its visible part."

- Applies to closed markups (polygon, rect, ellipse, cloud) and area measurements; hover and right-click share the same hit area (the declarative `pointerEvents`).
- Any visible fill (even very low opacity) or a hatch keeps the whole interior clickable.
- Lock no longer matters. This supersedes the 2026-09-07 owner report that made every UNLOCKED unfilled shape grab by interior (B920/NEW-1); the earlier fix had said locked-only.
- Already outline-only before this change: parcels (B420), setbacks (grab band). Always filled (interior stays clickable): site elements (fill opacity floor), easements/encumbrances (hatch pattern). Text boxes and callouts keep B142 (whole box).
- The Review module's shared picker (`src/shared/markup/hitTest.js`) was NOT changed; this constraint was given for the Site Planner canvas.
- Code: `grabsWholeBody` in `markupPick.js`, `measureGrabsInterior` in `measureHit.js`, `closedHitPE` in `SitePlanner.jsx`.
