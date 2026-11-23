# Key decision: Project-status

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **Project-status palette + map markers (owner rules, B433/B434; the single source is
  `src/shared/ui/statusTokens.js`, mirrored to the `--status-*` CSS vars in `index.css`).** Three
  standing rules govern how a deal stage looks, everywhere (map pins, left-rail chips, list markers,
  section headers, the status menu):
  1. **Map markers are always solid-filled with a white keyline — never a transparent/hollow primary
     marker on the aerial** (a thin hollow ring vanishes over green imagery). The zoomed-out marker is
     the **precision pin** (`sitePinIcon`, B434): a color **bulb** on a short **stalk** seated over a
     **ground ring**, the ring center being the anchor (it sits exactly on the site coordinate). Progress
     (derived from status until a real `progress_pct` lands — B161/B163) folds into the ground-ring
     **sweep** (pursuit 10 · active 60 · onhold 30 · complete 100 · dead 0).
  2. **Status salience is MONOTONIC, Pursuit loudest → Dead quietest** — size + opacity track importance;
     settled stages (Complete, Dead) are smaller + dimmed. Never invert this.
  3. **RED is reserved for genuine alert/error** (the `--danger` CSS token — cloud-off badge, a failed
     layer dot, a destructive ×), **never an inert state.** Dead is therefore neutral **gray** (✕ +
     strike), the same gray as Complete (distinguished by glyph + strike, not hue). Active is **blue**
     (not green — green blends into green imagery and coral+green is the red-green-colorblind confusion
     pair); Pursuit is **coral**. Pursuit/Active are glyphless solid discs; the colorblind-safe glyph
     (‖/✓/✕) rides only on the settled stages.
