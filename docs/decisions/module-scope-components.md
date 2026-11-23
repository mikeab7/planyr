# Named rule MODULE-SCOPE-COMPONENTS

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **MODULE-SCOPE-COMPONENTS** — Define React components at module scope, **never inside another
  component's render body**. An inner-defined component is a brand-new type every render → React
  remounts it → focus loss, lost input state, thrashing. (The remount / focus-loss regression class.)
