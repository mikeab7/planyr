# Key decision: Theming

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **Theming: light / dark / system + the text-hierarchy rule (owner rule, 2026-06-21).** The app
  has three themes — **Light / Dark / System** — driven by `data-theme` on `<html>` + CSS tokens
  in `src/index.css`, mirrored to JS for the SVG canvas in `src/shared/theme/palette.js` (var()
  can't be used in SVG attributes / canvas export — keep the two in sync). **Chrome themes WITH
  the app** (light theme = light chrome) — never a permanently-dark bar over a light app (the
  constant pupil readjustment is the worst case for eye strain). **Build text hierarchy through
  weight, size, and uppercase letter-spacing — NEVER by fading text toward the background.**
  Low-contrast gray body/label text is **disallowed** (eye strain in bright offices); subtle grays
  are correct ONLY for borders, the drafting grid, and the semantic "Complete" status badge. New UI
  must reference **theme tokens, never raw hex**, and clear **WCAG AA (≥ 4.5:1)** for body text on
  its surface in **both** themes. This is now **machine-enforced**: `ui-audit/contrast-audit.mjs`
  (parses the real `index.css`) + `test/contrast.test.js` fail CI if any defined token pair drops
  below its floor — so a palette edit can't silently re-introduce a low-contrast pair. Text/icon ON
  the global accent fill uses **`--on-accent`** (white in light, near-black in dark — the dark accent
  is too light for white); saving/unsaved/offline labels use **`--warn-text`** (AA amber). The common
  trap (the B341 regression): a chrome-region component that **hardcodes a color instead of a token**
  reads fine until the chrome flips theme — always repoint to tokens. **The Light/Dark/System picker
  lives in the row-1 Settings gear (⚙) popover** (`AppHeader`), reachable signed-out; the "System"
  live OS listener is in `ThemeProvider`, independent of where the control mounts. (B316–B320, B341, B342)
