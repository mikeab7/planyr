# Owner product constraint #43

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

43. **(2026-10-29) Map layers show their information ONLY ON CLICK — no hover popups on any overlay layer.** Michael, hovering a zoning polygon: nothing should appear until he clicks. Applies to every overlay layer on both surfaces (the planner canvas and the Map view): zoning, utilities lines, parcels' layers, PSC service areas, planning layers, FEMA / raster layers, Texas layers. This REVERSES the earlier hover-identify requests (B1131 "hovering an electric line must say what it is", NEW-2 hover readout). Permanent LABELS printed on features (pipe size, zone code) are not popups and stay; site/comp pins keep their name tooltip (not an overlay layer); the cursor's ground-elevation chip is a status readout, not a layer tooltip, and stays. (B2507061.)
