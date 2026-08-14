# Harness traps — the ones that keep coming back

Read this before you write a harness, and again when one reports something surprising.

Every trap below has cost real time in this repo, more than once. They are not exotic. They all
share one shape: **the harness was wrong, and its output looked exactly like a product finding.**
That is what makes them expensive — a crash costs you ten minutes, a plausible wrong answer gets
written onto a backlog item and acted on.

The three the owner asked to have written down are marked ⭐. The rest are here because they are
the same species and you will meet them in the same afternoon.

---

## ⭐ 1. The read landed before the save

**The shape.** You press a key, you read the stored document, and it says nothing happened. It is
telling the truth about the moment you asked, and the moment you asked was too early.

**Why it is not obvious.** The screen updates immediately. The STORE does not — the notes editor
saves on a **600 ms debounce** (`SAVE_DEBOUNCE_MS`, `NoteEditor.jsx`), and the tree has had a
debounce of its own. So a harness that judges by the document — which is the right thing to judge
by — is reading a copy that is deliberately a beat behind the thing it just did.

**What it cost.** Sixteen false findings in one run of `audit-notes-formatting`, every one of them
reported as "the formatting did not stick". None of them were real.

**The fix.** Never read straight after an action. Either wait past the debounce with `pacedWait`
(see trap 4 — not `waitForTimeout`), or better, **poll until the value settles** — read, wait, read
again, and only accept the answer when two consecutive reads agree. `settle()` in
`audit-notes-formatting.mjs` is the pattern.

**The tell.** A whole class of checks failing together, all of them "nothing happened", while the
feature demonstrably works when you drive it by hand.

---

## ⭐ 2. Compared against the wrong baseline

**The shape.** You assert a property — "no bullet is empty", "there are no orphans", "the count is
zero" — and it fails. It was already failing before you pressed anything.

**Why it is not obvious.** The assertion reads like a statement about your change ("Tab must not
create an empty bullet") but is written as a statement about the world ("no bullet is empty"). Those
are the same sentence only if the world started clean, and a realistic fixture never does — this
repo's Tab fixture contains a deliberately empty nested bullet, because an empty item is one of the
contexts being tested.

**What it cost.** Twice in one session: eleven false findings in `audit-notes-formatting` (the
baseline was hand-authored seed bytes, not what the editor actually writes for that document), and
a working first-item indent measured as `NODE-INVENTED` on its first run.

**The fix.** **Read the baseline from the same instrument, immediately before the action, and diff.**
Not from a constant, not from a hand-written fixture, not from an absolute property. If the claim is
"this did not ADD one", the check is `count(after) === count(before)` — a comparison, never a
property.

**The tell.** The failure does not change when you undo the action.

---

## ⭐ 3. Picking the option that means "do nothing"

**The shape.** A verdict, a return value or a code path whose meaning is "nothing happened" is the
one thing that a broken harness, a swallowed key, a declining command and a correct no-op all
produce. It is the default answer to every question you asked badly, so it is the answer you get
most often and trust least.

**Why it is not obvious.** It has a name and a place in the table, so it reads like a measurement.
`nothing` looks like a finding. It is usually a shrug.

**What it cost.** `audit-notes-tab`'s first version could not tell "Tab did nothing" from "Tab moved
the caret" — three rows of `nothing` that were actually two different behaviours. And the property
probe added later reported `TAB-DID-NOTHING` for a caret that had never been placed in the list at
all, because it named a string the fixture does not contain and **threw away `placeCaret`'s return
value.**

**The fix, three parts.**
1. **Split the null verdict into its causes** before you pin it: could-not-place · did-nothing ·
   moved-the-caret · changed-the-screen-only. If the harness cannot distinguish them, it has not
   measured anything.
2. **Check the setup succeeded.** Every "place the caret / select the thing / open the panel" step
   returns something. If you ignore it, its failure is indistinguishable from the feature's.
3. **Prove the check can go red** — run it against a deliberately broken build and watch it fail.
   A guard nobody has seen fail is a guard that rots green.

**The tell.** A row reads `nothing` and you cannot say, in one sentence, what would have had to
happen for it to read anything else.

---

## 4. The tab was in the background

`FOREGROUND-OR-VOID` in `CLAUDE.md` has the full text and this is machine-enforced — every harness
that launches Chromium must call `assertMeasurable`. Short version: a hidden tab **clamps
`setTimeout`** (a gesture measured at 3,156 ms was really 138 ms) and **suspends `requestAnimationFrame`
entirely**, so DOM geometry read after a view change describes a frame the app already left, while
the app's own state attributes confirm the view you asked for. Use `pacedWait`, never
`waitForTimeout`, inside anything timed.

## 5. The synthetic key that mutates nothing

`SYNTHETIC-KEYS-DONT-EDIT` in `CLAUDE.md`. `new KeyboardEvent(...)` defaults `bubbles: false`, and
the planner's handler is bound to `window` — so a synthetic key dispatched on `document` is a silent
no-op. This has left objects on the owner's live plans **twice**. Drive real keys
(`page.keyboard.press`), and re-read until the thing is genuinely gone.

## 6. The chrome that only exists after the first press

`CHROME-NEVER-EATS-A-PRESS`, clauses 4 and 7. A handle, badge or grab band that is mounted by the
first press — or merely by the cursor **resting** on the element — is invisible to any check that
reads the DOM before the interaction. The probe shape is: do the first half of the gesture, then
**re-ask** what the point now resolves to.

## 7. The instrument that could not have seen the effect

A clean number from a harness that was structurally incapable of observing the thing is not evidence
of absence. Three separate times here: harnesses contaminated by an undisposed `ElementHandle`, a
fixture seeder that made the whole code path under test unreachable, and a growth harness whose
"plan B" was plan A truncated in half. When the instrument and the owner disagree, **the instrument
is the thing on trial** (STANDING RULE #2).

---

## The one habit that catches most of them

**Try to refute your own pass.** Ask, in one sentence: *could this check pass while the feature is
still broken?* If you cannot answer, you have not finished writing the check. The cheapest version
is a deliberate mutation — break the code on purpose and confirm the harness goes red — and it takes
about two minutes.
