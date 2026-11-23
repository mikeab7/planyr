# Key decision: Screening

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **Screening fetches: recompute is free, re-fetch is user-action-driven — never map-view-driven
  (B860, chat NEW-1; amends the "explicit request only" fetch rule).** The drainage/floodplain
  "facts pass" has two halves and they behave differently. **Recompute (no network)** — the
  detention / mitigation / pond-split / buildability math over already-held geometry and inputs —
  runs **automatically and live** on every edit off the cached context; pure math never goes stale
  by a click's worth, so there is no "numbers reflect the old boundary" banner and no manual
  re-check for it (changed verdicts flash instead). **Re-fetch (network)** — GIS geometry (flood
  zones, reviewing authority, WSE rasters, 3DEP) — stays **stale-while-revalidate**: serve the
  cached pull instantly, background-refresh only when a **user action** (a boundary/element edit)
  makes the drawn footprint outgrow the fetched envelope (or the cached snapshot ages past its
  TTL), and **always display the data's age** ("flood data 16h ago"). The deliberate amendment:
  fetches remain **user-action-driven** — a boundary edit is a user action — and are **never
  triggered by panning/zooming the map** (map-view-driven fetching stays banned; `mapillary` /
  `evidenceLayers` remain the only view-driven vectors). The pure decision layer is
  `lib/factRevalidation.js` (`revalidationNeed` / `fetchStaleForEdit`); the manual ↻ Re-check is a
  force-refresh of the fetch half only.
