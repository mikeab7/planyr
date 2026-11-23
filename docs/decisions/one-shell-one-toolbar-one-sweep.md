# Named rule ONE SHELL, ONE TOOLBAR, ONE SWEEP

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **ONE SHELL, ONE TOOLBAR, ONE SWEEP (owner rule, 2026-10-05, B2090336–B2090338: "I want the frame to always work
  regardless of the size of computer or screen")** — browser zoom and OS display scaling SHRINK the CSS viewport, so
  "big monitor" never means "wide viewport". (1) **Any new header, tab-row or toolbar control goes through the shared
  shell/toolbar**: the header rows live in `AppHeader` (never wrap; Row 2 is `nowrap`, every zone is handed a budget
  measured on the row's own box), and every action row is a `PriorityToolbar` (`src/shared/ui/PriorityToolbar.jsx`, pure
  rules in `toolbarPlan.js`) — labels drop to icons, then the lowest-priority items fold into a More menu; never a
  second row, never clipped, never sideways scroll on desktop. Declare each item's `priority`; do not write a
  per-module media query or a hard-coded chrome width. Use a ResizeObserver / container query on the element's own
  box for chrome inside a resizable region, never window width. (2) **The width sweep is a required CI gate**
  (`ui-audit/verify-width-sweep.mjs`, verdict in `ui-audit/lib/widthSweep.mjs`): a NEW MODULE ROUTE MUST BE ADDED to its
  `ROUTES` list in the same commit, and a strip that scrolls on purpose must say why with `data-sweep-exempt="<reason>"`.
  A control that owns a shared ref or a portaled menu must honour `render({ measuring })` (the hidden measuring copies must
  not steal it). Phone `narrow` behaviour is unchanged by this rule.
