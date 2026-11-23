# Owner product constraint #6

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

6. **(2026-09-02) On the cloud-write failure banner, the ✕ means "I have dealt with it" and
   forgets the durable log; Retry does not.** Keep those two actions distinct — never collapse
   them into one dismissal. (See B1037952, B1048400.)
