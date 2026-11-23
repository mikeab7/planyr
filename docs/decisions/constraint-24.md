# Owner product constraint #24

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

24. **(2026-10-12) Overlay Lock blocks ONLY a direct drag/resize/rotate on the map itself.** Michael: typing a rotation must work on a
    locked overlay, and "anything typed or clicked in a panel works when locked, only direct map drags are blocked." Rotation (typed,
    ±1°, ±90°), Set scale / Trace a length / Match 2 points, Size to view, Align to parcel edge, Edit crop and Move & resize all work on a
    locked overlay, on BOTH overlay surfaces (Site-tab Overlays panel and Map/Comps "Adjust site plan"). This supersedes B1154369's old
    "locked rotation is read-only — do NOT undo" note. A new panel control must not be gated on `locked`; a direct-drag starter must.
    Guard: `test/overlayLockPanelControls.test.js`. (B2262864.)
