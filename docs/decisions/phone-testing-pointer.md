# Phone testing: read docs/PHONE-TESTING.md

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**📱 TESTING ON A PHONE? READ `docs/PHONE-TESTING.md` FIRST — before saying "nobody here can test
an iPhone."** That claim is false as stated: WebKit (not a Chromium stand-in — see
`VERIFICATION.md`'s own "WEBKIT INSTALLS ON DEMAND HERE" note for the engine-level detail) runs
from a Claude Code session with normal network access via `npx playwright install webkit` +
`npx playwright install-deps webkit`, at real iPhone screen sizes in both orientations, against
real `planyr.io`. The harness is `ui-audit/verify-phone-orientations.mjs`. The doc names exactly
what this still cannot prove (the collapsing Mobile Safari toolbar, `env(safe-area-inset-*)`
resolving to zero with no override on WebKit, no real touch-drag primitive, no real finger on real
glass) — read it before either overclaiming or underclaiming what a run proved. Per house style:
say "WebKit," never "Safari" or "iPhone," when reporting what a run actually verified.
