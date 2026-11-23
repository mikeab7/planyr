# UI work: read docs/DESIGN.md

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**🎨 ADDING OR CHANGING ANY UI? READ `docs/DESIGN.md` FIRST — before writing the first line of
markup.** It's the design bible: the real color tokens, the radius/spacing/type scales, and the
`Button`/`ToggleChip`/`IconButton`/`Field`/`Section`/`MenuItem` primitives in
`src/shared/ui/controls.jsx`, plus the two hard rules (components consume tokens and primitives;
a new control is never invented at the call site — the primitive set is extended instead). A raw
hex, a raw `borderRadius`, or a raw `fontSize` in a component is a defect, not a style choice, and
`ui-audit/design-drift-audit.mjs` fails CI on new instances of it. Preview every primitive live at
the `#/design` gallery route before drawing a new one.
