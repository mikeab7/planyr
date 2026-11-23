# The verification ledger

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**🔍 The VERIFICATION ledger (`ledger/verification/` on the `ledger` branch) = the live-browser test checklist — KEEP IT LEAN too.** Every run, scan it
(`npm run ledger -- list pending --v`) and **verify any ⏳/due items yourself in a headless browser** (Chromium/Playwright is in the
environment — see "🤖 Self-verification" there), then record the result. **The moment an item fully passes with nothing
pending, MOVE it: `npm run ledger -- move V<id> done --file <text-with-the-dated-PASS>`** (same discipline as the backlog; no PR, no build). The session that
ships a UI change drives the live app itself rather than defer it. **Michael does NOT self-test — never wait
on him or hand him a test to-do.**
