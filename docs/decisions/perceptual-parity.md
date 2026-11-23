# Named rule PERCEPTUAL-PARITY

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **PERCEPTUAL-PARITY** — **The bar a change to the PICTURE has to clear is that the owner cannot SEE it at
  working zoom — not that the file is unchanged.** (Owner amendment, 2026-08-06, verbatim: *"imperceptible at
  working zoom assuming that one makes the most sense"*, and *"I've got a 2K display, so I'm not gonna see
  certain levels of detail."*) **This SUPERSEDES the B1345 bar — byte-identical, or one unit of 255 on one
  channel — for every LOD-class change.** B1345's bar measured the FILE, and it cost real work twice: B1350's
  dock-door leaves were refused at 12–23/255 and 424 DOM nodes stayed on the table, the second time for a
  cause that turned out to be that Chromium does not rasterise a `<rect>` and a rectangular `<path>` to the
  same antialiased edge at any zoom — so no gate could ever have saved it.
  1. **THE METRIC IS CIEDE2000 (ΔE00) ON AN ACUITY-FILTERED PAIR**, not a channel delta — 10/255 in a dark
     blue and 10/255 in a light yellow are nothing alike to a viewer. Both renders are low-pass filtered
     first, at **two scales**, because a raw diff cannot tell *the same ink moved a sub-pixel* (invisible)
     from *a line of ink removed* (a downgrade) — both read ~23/255, and refusing both is what byte-identity
     did. Engine: `ui-audit/lib/perceptualDiff.mjs`, driven by `ui-audit/verify-perceptual-parity.mjs`. The
     **measurement did not go away** — the pixel-diff harness and its dependency-free PNG decoder are the
     same ones; the threshold and the metric changed.
  2. **THE BAR, three magnitudes, all pinned by unit test** (`test/perceptualParity.test.js`, whose CIEDE2000
     is checked against Sharma/Wu/Dalal's published vectors): **detail ΔE00 ≤ 6.0** near acuity (what stops a
     fine texture being replaced by its own local average) · **perceived ΔE00 ≤ 1.0** — the classical JND —
     and **perceived frame-mean ΔE00 ≤ 0.10** (what stops a thousand invisible differences adding up).
     Coverage is REPORTED but does not gate: for an antialiasing-class change the pixels touched scale with
     total edge length, i.e. with how much is drawn, not with how much changed.
  3. **THE VIEWING GEOMETRY IS STATED, NOT ASSUMED, and it is a parameter.** 20/20 acuity (1 arcmin), 600 mm
     viewing distance, 0.50 mm per CSS pixel (a 27″ 2560-wide panel at the owner's measured dpr ~2.15) → one
     CSS pixel subtends ~2.9 arcmin. The two numbers this repo cannot measure — his panel's physical width
     and how far he sits from it — are on `OWNER-TODO.md`, and every run prints the geometry it used.
  4. **⛔ THE THRESHOLD IS CHOSEN BEFORE THE MEASUREMENT, NEVER AFTER.** Picking a bar to suit a result you
     have already seen is not a measurement. Moving one of the three numbers is a product decision about
     drawing quality: argue it on the item, name the price, never nudge it to make a run pass. The first real
     use of this bar REJECTED the change it was introduced for (B1350's fold: perceived ΔE00 1.20–2.19), and
     the bar was left alone — that is the standard.
  5. **EVERY change that alters the picture records a before/after crop in the PR**, so the owner sees what
     he approved. `--shots` writes them.
  6. **The old bar is not gone, it is DEMOTED**: byte-identical is still the right claim to make when a change
     genuinely is byte-identical (B1437's dock-plan cache), and saying so is stronger than a ΔE00 of 0.
