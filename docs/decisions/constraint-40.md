# Owner product constraint #40

_Backstory moved verbatim out of `/CLAUDE.md` (audit batch H, 2026-11-23). Nothing below was reworded, shortened or removed: the rule in force is still stated in `/CLAUDE.md`, and this file is the full text and history behind it._

---

40. **(2026-10-29) A county row that is a COPY someone else published is KEPT, and the parcel card SAYS so.** Michael, verbatim: "use the copy, but then just state that it's a copy and state the date that it came from. And then maybe we say something about, like, please contact X if you'd like Y." (He decided to keep them because the NY state layer holds zero parcels in Chenango and Herkimer — measured.) Every row whose publisher is neither the county nor the state (`lib/parcelCopies.js`) shows ONE plain, small, un-alarmed line under the parcel facts — publisher + the date of the data, "not the county's own" — and the existing "Email Michael to request it" button (subject names the county). Official county / statewide rows show nothing new. Do not drop a copy row to avoid the line, do not guess a date the service does not publish ("date not published"), and do not add a second mailto. Guard: `test/parcelCopies.test.js`. (B2487152.)
