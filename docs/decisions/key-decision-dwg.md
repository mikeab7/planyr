# Key decision: DWG

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **DWG handling (Document Review):** Michael normally receives DWG (and PDF) and will
  not ask consultants for DXF. The tool auto-converts DWG → DXF on the backend. Start
  with free **LibreDWG** + a hard-failure fallback to **Autodesk APS Model Derivative**
  (~$0.30/file, pay-as-you-go). Optional later verification layer (proxy-object
  pre-screen, header/extents sanity checks, embedded-preview diff) decides when to
  pay. Reserve **ODA** (~$6k first yr / $3.6k/yr) or **Apryse** (~$10k+/yr) only for
  high volume or to keep files off third-party clouds. (Pricing mid-2026 — re-verify.)
