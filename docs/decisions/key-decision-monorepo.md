# Key decision: Monorepo

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

- **Monorepo, one repo, folder per workspace.** The `/server` folder's secrets and
  deploy pipeline are walled off from the public GitHub Pages deploy, so no
  credential can ride along to a live URL.
