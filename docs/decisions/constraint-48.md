# Owner product constraint #48

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

48. **(2026-10-29) A road connected to a parking field or truck court FOLLOWS it on a small move and LETS GO on a big one.** Michael, verbatim: "The road should move with the parking, like, slightly, though. Like, if I move the building 200 feet, then you can forget the road. But if I move the building and the parking, you know, 50 feet, then, yeah, keep it attached." Whatever moves the field (the load-time heal, dragging it or its building, a nudge, rotate / resize, a re-laid row) carries the road's connected END by the same offset — only its last control point; past `DRIVE_FOLLOW_MAX_FT` (100 ft) the road stays as drawn and its connection is cleared; it also lets go where following would fold the last leg back or leave it shorter than the road is wide. A locked road never follows. The live drag shows both, and one undo reverses move and follow together. Do not add a "keep attached" prompt, a toggle, or a second follow path. Rule + seams: `lib/driveFollow.js`, `SitePlanner.jsx` `setEls`; guards repo-root `test/` **driveFollow**, **driveParkingRealPlans**; e2e **drive-follows-parking**. (B2498961.)
