# Owner product constraint #41a

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

41. **(2026-10-29) Every county sits in the state-plane zone its STATE'S STATUTE assigns — no legacy exceptions, in Texas or any other zone-split state.** Michael's decision on Montgomery County, TX ("SWITCH"): it is Texas Central (EPSG:2277) per Tex. Nat. Res. Code §21.074(c), not the South Central the app used to keep. Harris, Fort Bend, Waller and Chambers stay South Central, bit-for-bit. A `decided:true` zone row is allowed ONLY where the statute is genuinely silent (Broomfield, CO is the model) and its `decisionNote` must name the gap — never to preserve old app behaviour; where the statute and the EPSG-generated table disagree, the statute wins. A bare lat/lon resolves by the county it is in before any coarse box. Guard: `test/statePlaneStatute.test.js`. Status of the statute cross-check: `docs/incidents/STATE-PLANE-AUDIT.md` §10. (B2478961, B2494336, B2494337.)
