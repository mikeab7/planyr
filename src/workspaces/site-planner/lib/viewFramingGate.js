/* viewFramingGate — ⛔ THE VIEW BELONGS TO WHOEVER TOUCHED IT LAST, AND THE APP NEVER TAKES IT BACK.
 *
 * ═══ THE RULE, stated as the owner stated it (2026-09-05) ═══════════════════════════════════════
 *   "No programmatic view change ever executes without a user action somewhere in its chain, at ANY
 *    point in the session — not just during boot. If some late-arriving thing legitimately needs to
 *    fit the view, it must never do so after the user has moved the view themselves, no matter how
 *    long ago that was."
 *
 * ═══ WHY A MODULE RATHER THAN ANOTHER `if` ══════════════════════════════════════════════════════
 * The previous guard (B1448) was a single `useRef(false)` consulted at exactly ONE call site — the
 * 120 ms "this workspace became active, frame it" timer. That was the right fix for the report it
 * had: on a cold start the timer routinely fires LATE under real main-thread load and lands on top
 * of a gesture the user has already begun. It shipped, and the owner confirmed the cold start got
 * better.
 *
 * It could not cover what he reported next, and the reason is structural rather than a missed case:
 *
 *   1. **IT WAS PER-CALL-SITE.** A guard written into one `if` protects one `if`. Any framing path
 *      added later — a fit after a slow parcel lookup returns, a reframe when a reference image
 *      finally decodes, a future "recenter on the thing that just synced" — starts life UNGUARDED,
 *      and nothing anywhere says it should not. The invariant above is a property of the VIEW, so it
 *      belongs to the view, not to one of its callers.
 *   2. **IT ONLY ASKED "HAS THE USER EVER MOVED?"** — a question with no answer for the genuinely
 *      hard case, which is a framing that was legitimately ASKED FOR by the user and then arrives
 *      LATE. A parcel lookup fits the view when its fetch returns; if that fetch takes eight seconds
 *      on a phone and he pinches at second three, the fit is both user-authorised AND an unwanted
 *      overwrite of his gesture. Neither "always allow" nor "never allow" is right.
 *
 * ⛔ AND A SCOPE MISTAKE THIS MODULE DELIBERATELY DOES **NOT** MAKE, recorded because it was written
 * and then caught, and it would have shipped a worse bug than the one being fixed. The obvious
 * "improvement" is to hold ownership in MODULE state keyed by plan, so it survives a remount of
 * `SitePlanner` — that reads as strictly safer, and it is wrong. The planner's `view` is component
 * state with no persisted copy (`useState({ ppf: 0.35, offX: 60, offY: 60 })`), so a remount RESETS
 * THE VIEW TOO. The automatic reframe is the only thing that makes a re-opened plan look like
 * anything; suppress it because the user panned that plan ten minutes and one remount ago and he
 * lands on a default view of nothing instead. **A remount is a new view session, and a new view
 * session has to be framed.** Ownership is therefore scoped to the LIFETIME OF THE VIEW IT IS ABOUT
 * — one gate per mounted planner — and the day the view is persisted across mounts is the day this
 * decision should be revisited, together.
 *
 *   3. **IT ONLY ASKED "HAS THE USER EVER MOVED?"** — a question with no answer for the genuinely
 *      hard case, which is a framing that was legitimately ASKED FOR by the user and then arrives
 *      LATE. A parcel lookup fits the view when its fetch returns; if that fetch takes eight seconds
 *      on a phone and he pinches at second three, the fit is both user-authorised AND an unwanted
 *      overwrite of his gesture. Neither "always allow" nor "never allow" is right.
 *
 * ═══ THE MODEL: A TICKET, TAKEN WHEN THE FRAMING IS REQUESTED ═══════════════════════════════════
 * One rule covers all three cases. Every framing takes a TICKET at the moment it is REQUESTED, and
 * is allowed to execute only if the user has not moved the view since:
 *
 *   · the BOOT reframe takes its ticket at mount            → any user move at all cancels it;
 *   · a "Fit view" click takes its ticket at the click      → nothing can have intervened, allowed;
 *   · a lookup's fit takes its ticket when the LOOKUP STARTS → a pinch during the fetch cancels it.
 *
 * ⛔ It counts MOVES, not a boolean, deliberately: a boolean cannot distinguish "the user moved
 * before this was requested" (irrelevant — the request is newer and wins) from "the user moved after
 * it was requested" (the whole bug). A `Fit view` click must still work on a plan the user has
 * already panned around, and under a boolean it would not.
 *
 * ⛔ WHAT COUNTS AS A USER MOVE is deliberately narrow: a wheel notch, a pinch move, a drag-pan that
 * has armed past its dead zone. NOT a click, a tap, a selection, or a panel toggle — none of those
 * express an opinion about where the view should be, and treating them as ownership would break the
 * legitimate boot framing on a plan the user merely clicked.
 *
 * Pure: no React, no DOM, no timers. The plan key is passed in, so two plans cannot share ownership
 * and a test needs no browser (test/viewFramingGate.test.js).
 *
 * ═══ B1234400 — A SECOND REASON A FRAMING MAY NOT COMMIT, ORTHOGONAL TO OWNERSHIP ═════════════════
 * The rule above answers "has the user taken the view?". It has no opinion on a different question
 * that turned out to matter just as much: CAN THE VIEW BE MEASURED RIGHT NOW? The owner reported the
 * planner zooming itself on a cold start, and the app's own diagnostic recorder (viewChangeRecorder,
 * armed with `?planyrDiag=1`) caught it live: a `setView` from inside a React commit, 3,978 ms after
 * load, `gesture: null`, `visibility: "hidden"` — the boot-time auto-frame ran and committed a
 * garbage zoom while the document itself was backgrounded and the map container had never been laid
 * out. `mayFrame`'s move-count check correctly said "nothing intervened" (nothing had — the tab was
 * never seen), which is exactly why THIS check has to be a second, independent gate rather than a
 * refinement of the first one: a framing can be perfectly OWNED by nobody's contested gesture and
 * still be computed from numbers that do not describe reality.
 *
 * `mayFrame`'s second argument is a `readiness` object, `{ visible, measured }`, supplied by the
 * caller (SitePlanner.jsx has `document` and the container ref; this module deliberately does not,
 * staying pure). Both default to `true` so every existing call site — and every existing test —
 * that only cares about ownership is unaffected. `visible` is `document.visibilityState === "visible"`
 * at the moment of the verdict; `measured` is whether the caller has a genuine, visible-tab
 * measurement of the container (never "has SOME number arrived" — a ResizeObserver's mandatory first
 * callback fires even for a page that was never laid out, and the app's own `Math.max(320, …)` floor
 * turns that degenerate box into a plausible-looking 320×360 that must NOT be trusted).
 *
 * Checked BEFORE the move count on purpose: an unmeasurable view has nothing sensible to say about
 * ownership either, and naming the more fundamental reason first is what a caller building a retry
 * loop actually wants back (see SitePlanner.jsx's fitReq effect, which retries a `document-hidden` /
 * `container-unmeasured` verdict against the SAME ticket rather than dropping it — a suppression for
 * either of these two reasons is a "not yet", not a "no").
 */

/* One gate per mounted planner (see the scope note above). No module state: two planners, or one
 * planner remounted, are genuinely different view sessions and must not share ownership. */
export function createViewFramingGate() {
  let moves = 0;

  /** Record that the user moved the view themselves — a wheel notch, a pinch move, or a drag-pan
   *  that has armed past its dead zone. Deliberately NOT a click, tap, selection or panel toggle:
   *  none of those express an opinion about where the view should be, and treating them as
   *  ownership would break the legitimate framing of a plan the user merely clicked on. */
  const noteUserViewMove = () => { moves += 1; return moves; };

  /** How many view-moving gestures the user has made in this view session. */
  const userMoveCount = () => moves;

  /** Take a ticket at the moment a framing is REQUESTED. Hand it back to `mayFrame` when it runs. */
  const framingTicket = () => ({ at: moves });

  /** May this framing execute? Checks, in order: the ticket is real; the document is visible; the
   *  container has been genuinely measured; the user has not moved the view since the ticket was
   *  taken. `readiness` defaults to `{ visible: true, measured: true }` so a caller that has nothing
   *  to say about measurability (every existing test, and any future caller with no DOM access) gets
   *  exactly the old ownership-only behaviour. Returns a reason either way, so a caller can log it
   *  and a harness can assert on it. */
  const mayFrame = (ticket, readiness = {}) => {
    if (!ticket || !Number.isFinite(ticket.at)) return { ok: false, why: "no-ticket" };
    const { visible = true, measured = true } = readiness;
    if (!visible) return { ok: false, why: "document-hidden" };
    if (!measured) return { ok: false, why: "container-unmeasured" };
    if (moves > ticket.at) return { ok: false, why: "user-moved-since-request", moves: moves - ticket.at };
    return { ok: true, why: "no-user-move-since-request" };
  };

  return { noteUserViewMove, userMoveCount, framingTicket, mayFrame };
}
