# Named rule PDF-PARITY

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **PDF-PARITY** — Any change to an on-screen render must be mirrored and verified in the export / print
  path, and vice-versa; the two must not drift. Scheduler `GanttView` ↔ `buildGanttSVG`
  (`public/sequence/index.html`); the Site Planner canvas ↔ its PDF / print export pipeline. A render fix
  that skips the export path is half-done. (This is a mandatory **LIVE-VERIFY** class.)
