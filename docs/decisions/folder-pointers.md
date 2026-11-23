# Keep per-folder pointers fresh

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

**🔄 Keep the per-folder pointers fresh.** Some module folders carry a short `CLAUDE.md`
pointer (what's here + key files) that auto-loads only when you work in that folder. **When
you rename, move, or delete a key file, update that folder's pointer in the SAME commit.**
This is machine-enforced: `node ui-audit/doc-pointer-audit.mjs` (in the `/improve` gate +
`test/docPointers.test.js`) fails CI if a pointer names a code file that no longer exists.
Keep pointers short — signposts, never duplicated detail — so they don't drift.
