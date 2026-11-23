# Owner product constraint #25

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

25. **(2026-10-16) The grading layer is OWNER-ONLY until he says otherwise.** Michael, verbatim: "add it in, but only for me to use for now." Everything in "Grading model" below renders only when `is_admin()` is true, through the ONE selector `lib/gradingGate.js` (`gradingEnabled()` / `useGradingEnabled()`); no URL flag, env var, localStorage switch or second gate, and nobody is added to `admin_users`. For every other account the Site Planner is byte-for-byte unchanged. Guard: `test/gradingGate.test.js`. (B2312464–B2312466.)
