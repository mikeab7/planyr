# Key decision: No dialog-box

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **No dialog-box edits — inline editors only (owner rule, 2026-06-17).** NEVER edit a value
  with `window.prompt`/`confirm`/`alert` (owner: "that is horrible UI"). Editing a number/text
  on the canvas must use an **inline editor in place** — e.g. the shared `numEdit` inline
  `<input>` overlay in `SitePlanner.jsx` (road width, per-edge setback, overlay trace length) or
  the callout `foreignObject` `<textarea>`. Commit on Enter / click-away, cancel on Esc. Applies
  to any new editing affordance.
