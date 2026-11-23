# Id minting (history)

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**🔢 MINTING (history, one line so a stale memory does not resurrect it).** Ids used to be minted by hand from `max+1`, then from
per-branch reserved blocks with a peer scan and a push-time gate (B779); with the ledger on its own branch nothing is minted in a
PR — the compare-and-swap push does it, and `check-mint` and the hooks are gone. `scripts/idBlocks.mjs` survives only because
`next-id.mjs`'s legacy path imports it. `test/ledger-data/idUniqueness.test.js` still fails the ledger-health run on two active items sharing an id.
