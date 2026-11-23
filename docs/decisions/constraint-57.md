# Owner product constraint #57

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

57. **(2026-11-15) Notes boxes the person PLACES may overlap, like PowerPoint — nothing moves out of the way for a drop, a resize, a nudge or a pasted box; only growth from a box's OWN WORDS pushes the box below clear.** Michael, verbatim, overruling the part of PR #2952 he had not asked for: "We don't need to move the boxes out the way… I want it to function slightly like PowerPoint, where you can post stuff over each other." What he DID ask #2952 for stands: pasting or typing text into a box that makes it grow must not draw over the box below ("atrocious") — that unintended overlap still pushes. "Placed by hand" is decided by the stored placement (x, y, width, height) changing in a user edit (`notesBoxClearPlugin.js` `placedBetween`), never guessed from the picture. Do not bring back a push-aside for a drop or a narrow, and do not add a snap, nudge or warning for a placed overlap. Ctrl+Z undoes both. Guards: repo-root `test/` **notesBoxClear**; **verify-notes-no-overlap** (placement scenarios, red on the pre-change plugin); (B2671289.)
