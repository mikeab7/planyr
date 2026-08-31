# 📋 Michael's open to-dos (things only the owner can do)

> **For any Claude session:** when Michael asks "what's left / what do I still need to do," SURFACE this list
> in plain English. Keep it current — add an item the moment something needs his decision, input, or a manual
> step; tick/remove it once he's done it. This is the **owner's** plate only. Browser click-throughs and
> signed-in spot-checks are the Claude cohort's job (`VERIFICATION.md`), **never** Michael's — do NOT list those here.

_Last updated: 2026-08-31._

## 🔐 One small GitHub setting still open, and a closed hunt for another (B825232–B825234)

> **Not urgent, and nothing is broken while it waits — it just removes one spot where a Claude
> session has to do by hand what a setting would let happen automatically.**

- [ ] **Authorize `mikeab7/planyr` for the Cowork session type**, so the Cowork thread (the one that
      drives your actual signed-in browser to check things a sandbox can't reach — sign-in-required
      checks, live map data, and so on) can push its own results straight into the project instead of
      relaying them through a chat message that a different session then has to type in by hand. Right
      now its connection to GitHub refuses to let it save anything to this project directly, so every
      one of those checks has to be handed off and re-entered — which is exactly how **79 of those
      checks piled up waiting** before this was noticed. **Soon, not urgent.**
- **Un-drafting PRs automatically — closed, nothing left to check or flip.** Both repo settings
  ("Workflow permissions: Read and write" and "Allow GitHub Actions to create and approve pull
  requests") were switched on and live re-tested on real PRs (#1246, #1255) — both still came back the
  identical FORBIDDEN error. You then declined a PAT / GitHub App credential a second time, and the
  automation that needed one (`pr-auto-ready.yml`) is now deleted outright, not just silenced. Sessions
  mark their own PRs ready and arm auto-merge by hand now, permanently — full record in
  `BACKLOG-DONE.md` (B793696, B934400–B934402). Don't re-open this hunt.
- [ ] **Check whether `main` has a branch-protection rule set** (`github.com/mikeab7/planyr/settings/branches`)
      — a SEPARATE question from the note above (that one is about un-drafting a PR; this is about arming
      auto-merge on one that's already ready). Found 2026-08-31 (`B897440`) while shipping PR #1245: even
      after the Workflow-permissions flip and un-drafting the PR by hand, GitHub still refused to arm
      auto-merge — first "Protected branch rules not configured for this branch," then (once the checks
      themselves went green) "Pull request in unstable status." GitHub's auto-merge needs a protection rule
      (at minimum, a required status check) on `main` before it will queue anything, so either there isn't
      one, or it exists but doesn't name `build` as required. If there's no rule: add one requiring the
      `build` check to pass before merging. **Nothing is broken while this waits** — a session just has to
      merge each green PR by hand instead of it happening on its own, same as before this automation existed.
- [ ] **Three stale throwaway probe branches need deleting** — `claude/verify-pr-auto-ready-throwaway`,
      `claude/verify-pr-auto-ready-20260831-001137`, and `claude/verify-pr-auto-ready-20260831-015902`.
      All three are closed PRs' leftover branches from testing the item above; no session's git credentials
      can delete a remote branch here (`HTTP 403`), and there's no GitHub tool for it either. Harmless
      clutter, delete whenever convenient from the GitHub branches page.

## 👀 One thing only you can check: does the app actually TELL you when it has stopped saving? (V273520 / B484337)

**Why this one is yours, when browser checks never are.** It needs a signed-in account and two real
tabs racing each other on one real plan. I cannot sign in from where I run — the connection to the
database is blocked — so no test I can write will ever see this. It is the single item on this list
of that kind.

**What I found, and why it matters more than the feature it came out of.** There was a state where
the app **quietly stopped saving your work and kept showing a green "synced" badge**. Not an error
message, not a spinner — a confident, wrong answer. Two separate things were swallowing the warning:
the message that says *"reload to keep saving"* was built correctly and then thrown away one step
before it reached the screen, and the little save indicator had no setting for "given up" at all, so
it fell through to the resting green one. **Both are fixed and live.** What I cannot prove from here
is that the fixed message actually *paints* on your machine — only that it is wired to.

**⛔ DO THIS ON A DUPLICATE PLAN.** Steps 4–6 move a building from two tabs at once, and the whole
point is that one of those moves does *not* get saved. Open the plan menu → **Duplicate plan**, work
in the copy, delete it when you're done. Steps 1–3 and 8–9 change nothing.

Use a copy of a plan with a building on it — Bain / "Concept - Original" is fine. Signed in, on
planyr.io, **two tabs of the same browser**.

| # | Do exactly this | What you should see | Changes anything? |
|---|---|---|---|
| 1 | Open the duplicate in **tab A**, let the drawing settle | the save badge in its normal green state | no |
| 2 | Open the **same plan** in **tab B** | both tabs showing the same drawing | no |
| 3 | Screenshot tab A's save badge | your before-picture | no |
| 4 | In **tab B**, drag one building a short way. Do it 5 or 6 times, about a second apart | tab B saving normally | **yes** |
| 5 | Switch to **tab A** and drag the **same building** repeatedly the other way | tab A looks like it's accepting the drags | **yes** |
| 6 | Alternate — 2 drags in B, 2 in A, 2 in B, 2 in A — for about **30 seconds** | — | **yes** |
| 7 | Stop, and **watch tab A for 15 seconds** | **BOTH:** a message saying *"This tab is out of date — your recent changes here can't be saved. Reload the page to catch up."* **and** the save badge turning to its error look with *"This tab is out of date — reload to keep saving"* | no |
| 8 | Reload tab A | badge back to normal, saving works again | no |
| 9 | Delete the duplicate plan | — | **yes** (deletes the copy) |

**What a failure looks like:** step 7 shows a green "synced" badge, or nothing at all, while tab A's
edits have stopped reaching the cloud. That is exactly the bug that was fixed — so if you see it,
the fix did not land and I need to know.

**If nothing happens after a full minute**, the race probably never bit — tab A's edits kept winning.
Try again with tab B dragging continuously rather than in bursts. Tell me *"couldn't force it"*
rather than *"it passed"*; those are different answers and I'd rather have the honest one.

**One thing that is NOT a failure:** a single hiccup is meant to be silent — it fixes itself, and a
pop-up every time two tabs brush past each other would just be noise. Only the case where the app
has genuinely given up shows the message.

## ❓ One question about the schedule jumping while you edit (B463922)

You told me the schedule sometimes throws you halfway down while you're editing cells. I went after it
and found two things worth telling you plainly.

**The reproduction we thought we had was our own test tool's fault, not the app's.** The tool was
clicking a fold-away triangle that was sitting just off the top of the screen, and to reach it the
tool scrolled the list itself — then blamed the app for the movement. A person can't click something
they can't see, so that path was never real. I proved that three different ways before writing it off.

**But two real things came out of it, and both are fixed and live.** Folding a group used to quietly
steal your place — the cell you were typing in stopped being the selected one, so the next keystroke
went somewhere else. And now, when you fold a group above the row you're working on, that row stays
exactly where it is on screen instead of sliding out from under your cursor.

**What I need from you — two things, and the second one matters most.** Next time it throws you:
(1) what had you *just* done — typed in a cell, pressed Enter, folded or unfolded a group, pressed
undo, or nothing at all; and (2) **did it go up or down?** Up means toward the start of the
schedule, down toward the end. That direction alone rules out half the possible causes. Nothing I
can run here has ever seen this happen, so those two facts are worth more than another week of me
guessing — and until I have them I'm leaving it open rather than calling it fixed.

## ✂️ Two calls on splitting a parcel — the tool now takes real cuts, these are the last two choices (B455360)

Splitting is fixed. You can now cut a parcel along a line with as many bends as you like — following a
creek, a road centreline, an easement, an old property line — and the cut no longer has to run neatly
between two opposite sides. If the cut leaves the lot and comes back, you get all the pieces it really
makes, not two. Acreage is preserved exactly: on your Goose Creek tract a zig-zag cut produced four
pieces that add back up to the full 95.37 acres, and I checked that by reading the acreage tags off the
drawing, not off the code.

Two things I deliberately did **not** decide for you, because they're product calls, not engineering ones:

**1. When a cut makes three or more pieces, what should happen?** Right now it keeps **all of them** and
tells you how many it made. That's the only choice that can't quietly lose you acreage, so it's the safe
hold — but it may not be what you want. The alternatives: keep the two biggest and throw the scraps away,
or have it stop and ask you at the moment of the cut.

**2. How should the pieces be named?** Right now they come out **unnamed** — same as before this change,
so nothing got worse. The options: number them off the original (Parcel 1A, 1B, 1C…), or leave the
original name on the biggest piece and name the others after it.

Answer either one in a sentence and I'll wire it. Nothing is blocked on you in the meantime — the tool
works as it stands.

## ✅ ANSWERED AND SHIPPED — both split decisions are live, nothing on your end (B455360 / B520560)

You answered both, and both are in.

**Keep every piece.** That is what it does. One thing genuinely changed: it used to quietly drop a
scrap too small to be worth a lot and tell you it had. It doesn't any more — you get the scrap as a
parcel, with its acreage, exactly as you said. On your Bain tract that's the difference between three
pieces plus a small loss and five pieces with nothing lost. It still tells you when a piece is too
small to see on screen, so you can delete it if you want to — but that's a heads-up, not a deletion.

**Numbered off the original.** Cut Parcel 1 and you get Parcel 1A, 1B, 1C — on the drawing, not just
in the list. Cut 1A again and you get 1A1 and 1A2, which is the same way your appraisal districts
write a tract number. Past 26 pieces it carries on AA, AB — nothing ever wraps around onto a name
already in use. If you've given a parcel your own name, the pieces extend YOUR name — "Creek Tract"
becomes "Creek Tract A" — rather than falling back to a number.

Two things I found while wiring that up, both of which were live and neither of which you'd reported:
the drawing was showing the bare word "Parcel" on every lot even though the numbering already existed
underneath, and a tract with a street address gave all its pieces the identical name. Both fixed.

## 📄 One Baytown document I can't download — it's the last piece of the Baytown flood answer (B393170)

> Your two Baytown-area sites — **Grand Port** and **Goose Creek** — now name the right city and the right
> kind of city limit. What they still can't tell you is **how high Baytown makes you build the floors**.

- [x] ~~**Send me Baytown's flood damage prevention ordinance.**~~ **Done — you sent it, and it's in.** Baytown's
      rule turned out to be *looser* than Harris County's wherever the 500-year level sits well above the
      base flood, so **no pad on Goose Creek moves**.
- [x] ~~**Whether that rule applies inside a *limited-purpose* annexation area.**~~ **Answered, and the answer
      is "the ordinance doesn't say."** It reads *"within the jurisdiction of the city"* and never mentions
      limited-purpose or extraterritorial areas. Recorded as *doesn't say* — not as a yes and not as a no.

### 🆕 The Grand Port piece you told me about — one document, and no rush

- [ ] **When you get a chance, send me the development agreement between the MUD and Baytown** (the one you
      described as covering the couple-hundred-acre tract Grand Port was carved out of — you mentioned LBA as
      the other side of it). **Nothing is waiting on this** and you said you don't care about it right now, so
      it's parked here purely so it isn't lost.
- **Why it's worth having eventually, in one sentence:** you told me Grand Port is bound to the city's
      **drainage** requirements by that agreement. That's an authority arriving through a *contract*, and the
      app decides who governs a site purely by *where the site is on the map* — so there is no map anywhere
      that could ever tell it. It has to be typed in as a fact about that site, and the agreement is the thing
      that says what to type.
- **⛔ And I have deliberately NOT stretched it.** You said drainage. Baytown's drainage rules and Baytown's
      flood chapter (the finished-floor rule) are potentially two different documents, so I have **not**
      concluded that the floor rule binds Grand Port just because drainage does. That stays an open question
      until someone reads the agreement.

## ❓ One question on team sharing I deliberately did NOT answer for you (B326416)

> Your new projects are now shared with your team automatically — **new ones only**, nothing you already
> have moved, and that is enforced by the database rather than by the app being careful. Teammates can
> edit a shared plan fully, and you can lock any one plan to view-only from the plan menu. Notes,
> Library, Review and Schedule stay yours, as you asked.
>
> **The one thing you said nothing about, so I left it alone:** when a teammate opens a project you
> shared, what should they see in those four private modules?
>
> I checked how it is built, and today the answer is already **(a) they get their own, empty Notes /
> Library / Review / Schedule for that project** — those four are stored per-person, so this needs no
> work at all and is what ships. The alternative, **(b) hide or lock those tabs entirely for anyone who
> isn't the owner**, is a real change and I did not make it.
>
> My read is that (a) is the better default anyway — your teammate can keep their own notes on your
> project without you seeing them, which is usually what people want. But it is a taste call, not a
> technical one, so it is yours. **Nothing is broken either way; say the word if you'd rather have (b).**
>
> **One heads-up while this is waiting to go live:** I applied the database side already (that is what
> let me prove nothing existing can leak). Until this merges and deploys, the *old* "Share with team"
> button on the live site will refuse with a message instead of working. It affects one project and it
> fails loudly rather than silently — but if you go to share something today and it complains, that is
> why, and merging fixes it.

## 🔎 One note of yours is sitting in the cloud with nothing pointing at it — say the word and I'll put it back (B315716)

> While building the duplicate check you asked for, I found a **different** problem in your account, and it is
> the one I'd want you to know about: there is a note with real content in it — channel improvements to slow
> down conveyance, Willow Point MUD providing water and sanitary, the feasibility study in progress, the
> pricing note about single-family developers offering $3–4 a foot against hoping for $10, and Hilcorp's
> blanket easement — and **it does not appear anywhere in your notes list.** Not in a project, not in the bin.
> It has been unreachable for days.
>
> **What went wrong:** the app tidies up leftover scraps every time you open Notes. This note lost the entry
> that says where it lives, so the tidy-up treated it as a scrap and deleted the local copy — and then the next
> sync downloaded it again, forever, with you never able to see it. That loop is now closed: the tidy-up will
> **never** delete something that still has words in it, and when it finds one it says so and offers to put it
> back.
>
> **What I need from you: nothing, unless you want it back sooner.** Next time you open Notes signed in, a line
> at the top will say one note is filed in no project, with a **Put it back** button. It goes to "Not in a
> project" — I deliberately do not guess which project it belonged to, because that guess is the whole bug we
> just fixed. If you'd rather I restore it for you directly, say so and I'll do it.

## ✅ CLOSED — both jurisdiction fixes are LIVE, nothing on your end (B209502–B209509)

> **Both of the things you sent today were the same underlying mistake: the app deciding which
> authority governs a site by what's NEARBY rather than by what the site is actually INSIDE — and then
> stating it with confidence.**
>
> **The county half.** Pearland is in Brazoria; the app called it Harris — and then showed you Harris
> County flood-control data as if that backed it up. It did the same at Sugar Land, Conroe and Texas
> City. That matters because the county is what picks your drainage authority, your detention rules,
> your setbacks and who reviews the plans. It now works out the county from the real county SHAPE
> instead of a rectangle drawn around it, so all six of the places you sent come out right. I also
> added the five missing Houston-area counties — Montgomery, Brazoria, Galveston, Liberty and Austin —
> so a click there now finds a real property.
>
> **The Katy half, on Bain.** The header said "City of Katy". Katy only clips the very edge of that
> parcel; the site itself sits in no city at all, and the authority that actually reaches it is
> Houston's extraterritorial area. The header now leads with what governs and mentions a bare touch as
> a footnote. This one wasn't only a label: because Houston was missing from the picture, the finished
> floor was being set off the county's easier rule and printed as settled. Where that answer isn't
> complete, the panel now says so instead of stating a floor height — which at Bain was worth a foot or
> two of finished floor on a two-pond site.
>
> **Nothing on your end — this went live late on 2026-08-06.** Every check passed, and I drove both
> fixes in a real browser against the live county and city services before it merged.
> → merged as https://github.com/mikeab7/planyr/pull/928
>
> *(For the record, since an earlier version of this note asked you to merge it by hand: GitHub's own
> build service was down for most of that afternoon, so the tick that has to go green before anything
> can merge simply never appeared. It came back that evening and this merged on its own.)*

## 📄 The one thing I need from you: paste a short line into your browser (B209568 / B209569)

> **You were right that nobody had ever measured Bain, and I've now fixed that as far as I can from here.** I built
> a stand-in Bain — the same 53 pieces in the same mix you counted, the same five parcels, and crucially **both of
> your big background drawings at exactly the sizes and see-through settings you measured** — and ran the whole
> battery on it against Goose Creek.
>
> **What I still don't have is your real Bain plan itself.** The stand-in has the right *ingredients* but I had to
> invent *where* each building sits, because that part lives in your signed-in browser and I can't reach it. That
> matters for one of the two findings: the background drawing's cost I can now state confidently, but the larger
> share of the difference comes from Bain's own layout, and I measured that on a layout I made up.
>
> **Your part is one paste and it takes about ten seconds.** I've sent you a small text file. Open planyr.io while
> you're signed in, open the browser console (F12, then the "Console" tab), paste the whole thing in, press Enter.
> It saves one small file per plan straight to your computer — send those back and I'll re-run everything on the
> real thing.
>
> **It does not take your drawings' pictures.** It measures them — how big, how see-through, where they sit — and
> throws the actual image away. Nothing is uploaded anywhere; it only reads your own browser and saves files. Each
> file should be tens of kilobytes. If one comes out huge, don't send it — tell me, because that would mean
> something leaked and I'd want to fix it first.
>
> **The two I most want are Bain (Concept A) and Sylvestri (Concept D)**, but it will grab all of them at once, so
> just send whatever it saves.


## ✅ CLOSED — the flood-and-drainage check now only runs when you ask for it (B1349 → B1442)

> **You already decided this one and it hadn't been carried through. That's on us, not you.** Your words:
> *"i thought we talked about doing this only manually … seems like it only needs it once after relevant elements
> are moved, and so maybe we just only do it manually, leave it green while elements are in the same spot, once
> they're moved turn it red so we know to recheck."*
>
> **Done, exactly that.** Opening a plan now fetches nothing at all — no waiting, no county servers, no terrain
> machinery. Next to where it used to say how old the flood data was, there is now a small **green dot** while the
> answer on screen still describes what you've drawn, and it turns **red** the moment you move something that
> genuinely changes the answer — a pond, or fill. Hovering it tells you why. Moving a car park or a road leaves it
> green on purpose: a light that goes red for everything is a light you'd learn to ignore.
> The re-check itself is also faster — three flood-data lookups that used to happen one after another now happen
> at the same time.
>
> **Nothing left on your end.** The old question below is answered and closed.

## 🎨 One call, worth 424 pieces of drawing: how strict should "I can't see the difference" be? (B1350)

> **Background in one line: you told me to stop measuring whether the picture's FILE changed and start measuring
> whether YOU can see it.** I built that — a real perceptual test, not a vibe — and the very first thing I pointed
> it at was the dock doors you mentioned.
>
> **The result was honest and it went against us.** Collapsing the dock doors would take 424 pieces out of the
> drawing (they're the ones that never change unless you change the building, exactly as you said). Measured
> against the new test, at every zoom you'd actually work at, it comes in **just over** the line — not wildly over,
> but over.
>
> **Here's the thing, and it's the reason this is yours and not mine.** The test has one dial in it: how far the
> eye blurs things together before it decides two pictures differ. There are two defensible settings for that dial,
> both standard. I picked the **stricter** one — and I picked it *before* I ran the measurement, on purpose, so I
> couldn't be accused of choosing whichever setting gave me the answer I wanted. On the looser setting, which is
> just as defensible, the dock doors comfortably pass.
>
> **So: do you want me to move the dial one notch looser?**
> - **Yes** → the dock doors ship, you get 424 fewer pieces on the drawing, and a whole class of similar wins
>   becomes available. The risk: the test becomes slightly more forgiving for every future change too.
> - **No** → we keep the strict setting and the dock doors stay as they are. Nothing breaks; we just leave that on
>   the table for a third time.
>
> I genuinely don't have a strong view. I'd probably say yes — but the reason I'm asking rather than deciding is
> that I already set this line once this week, and moving it right after it gave me an answer I didn't like is
> exactly the move I shouldn't make on my own.

## ✅ ANSWERED — nothing more from you on smooth zoom (was: B1449)

> You said: *"i think smooth zoom makes sense, unless theres something im not considering."* That's the call, it's
> taken, and the question below is closed — I've left it in place only so the reasoning is on the record.
>
> **Where it stands: not built yet, and I want to be straight about why.** It isn't waiting on you any more, and it
> isn't a small job. Making the zoom smooth means the drawing briefly holds its old size while a single stretch is
> applied on top — and *everything* on the canvas that decides how big to be (line thicknesses, text, the rules about
> what detail shows at what zoom) has to be told to use the held size rather than the live one. Miss one and the
> drawing looks wrong for the split second your wheel is moving — doubled-up text, wrong line weights. The awkward
> part is that **none of my existing checks can see that**, because at rest the two sizes are the same number, so
> everything passes whether it's right or wrong. So the first piece of work is a check that can watch a frame while
> the wheel is still turning — and only then the change itself. That's the next session on this, and when it's done
> you'll get the before-and-after recording of the same wheel spin you asked for, plus a switch to turn it off.

## 🐟 One export that would let me measure the Bain slowdown properly (B221760 / V23408)

> **Why I'm asking.** You said the Bain site got fast and then a detention pond made it slow again. I built a probe
> that adds a pond and measures the exact same drag before and after, and I found a real cost — the pond's name label
> was re-solving where it fits inside the basin on *every single frame* of a drag, which I've now fixed (it's about
> twice as cheap per pond). But on the plan I have to test with, one pond isn't enough to feel: I had to put sixteen
> ponds on it before the cost was bigger than the measurement noise.
>
> **The gap is that I don't have your Bain plan.** There's no copy of it in the code — only a few of its pond
> outlines, saved for a different test years ago. Everything I measured is a floor, not a match.
>
> **What would close it:** open Bain / Concept A while signed in and send me a full export of the plan. I need the
> whole thing — the buildings, the property lines, the settings and where it sits on the map — not just the shapes.
> One file, one time, and then I can measure the site you're actually complaining about instead of a stand-in.

## 🔍 (CLOSED — see above) One sentence to answer, and it unblocks the smooth-zoom work (B1449)

> **The background in two lines.** Dragging the plan around is already fixed — it went from redrawing the whole
> drawing on every twitch to just sliding what's already there, and it got about forty-six times cheaper. The same
> move for **zooming** is the last big piece, and it's been sitting waiting on one call that's yours, not mine.
>
> **Here's the whole question.** While you're still spinning the wheel, the drawing can either *stretch what's
> already on screen* (which is what makes it perfectly smooth) or *rebuild itself properly at every notch* (which is
> what makes it choppy). If it stretches, then for the split second your wheel is still moving, fine detail — parking
> stripes, dock doors, the little dimension labels — shows at the level of detail you started from, and snaps to the
> right level the instant you stop.
>
> **So: while the wheel is still turning, is it fine for the drawing to briefly show the detail from where you
> started, and catch up the moment you stop — in exchange for the zoom itself being completely smooth?**
>
> - **Yes** → I build it. Roughly a session or two, and zooming stops being the thing that lags.
> - **No, it must always be exactly right** → I leave zooming as it is and spend that time on the layers and panels
>   instead, which are the next two biggest things making your gestures expensive.
>
> Either answer is fine and neither is wrong — I just can't pick it for you, because it's about how your drawing is
> allowed to look, not about how it's built.

## 📏 Two small facts about your monitor, whenever you're near it (B1441)

> The "can he see it?" test needs to know how big a pixel physically is on your screen and roughly how far you sit
> from it. I've assumed a 27-inch 2K panel at about two feet. **If that's wrong, tell me and I'll re-run every
> measurement** — it's a one-line change and it moves the answers. If it's roughly right, ignore this.

## 🌊 One call to make: should the flood-and-drainage check run by itself the moment a plan opens? (B1349)

> **Short version: when you open a plan whose flood and drainage facts haven't been pulled yet, the app goes and
> gets them on its own, a moment after the page appears.** That is deliberate — it's why the stormwater numbers are
> usually just *there* when you go looking for them instead of making you press a button. But it isn't free: it
> fetches real data from the county and state services and pulls in the terrain machinery to do it, and it was
> starting while the page was still busy becoming usable.
>
> **What I've already done, and it needed no decision from you:** it now waits until the app is genuinely idle
> before it starts, with a hard limit so it always runs in the end. So it no longer competes with the moment
> you're trying to start work. That part is shipped.
>
> **What's genuinely yours to decide:** whether it should run automatically at all. Two honest options, and I'd
> take either:
> - **Leave it automatic** (what happens today). Opening an unchecked plan costs you a slightly heavier first few
>   seconds, and the drainage answers are waiting for you when you look.
> - **Make it a button.** Opening a plan is as light as it can be, and the stormwater panel says "not checked yet —
>   ↻ Re-check" until you ask. Nothing is lost, but you'd press it once per new plan.
>
> **NEW — I've now MEASURED what it costs you, so this isn't a taste call in the dark (2026-08-06).** I built a
> stopwatch that breaks the whole "open a plan → able to drag it" wait into named pieces, and ran it twelve times
> with this check switched on and off, alternating, so a slow patch on the machine couldn't favour either side.
> **Turning it off buys you about half a second of a roughly seven-second wait** — real, but small, and the two
> sets of runs overlap. It is NOT the thing making a reload feel slow: with it switched off completely, opening a
> plan still takes essentially as long, and looks the same at every step.
>
> So the choice is genuinely just taste now: half a second sooner, versus the drainage answers being there without
> you asking. There is no wrong answer and nothing breaks either way.
- [ ] **Tell me: leave the drainage check automatic, or turn it into a button?** One word either way and I'll do it.


## ✏️ Rename one plan — it's called your seller's head office by mistake (B1196)

> **Short version: your Colorado plan is named "2221 E LAMAR BLVD STE 790", which is Forestar's corporate address
> in Arlington, Texas — not the property.** When you searched "4050 County Road 50", the parcel card picked the
> owner's *mailing* address out of the county's record instead of the property's own address, and the card's title
> is what names the plan. It's fixed now: from here on a plan searched that way gets named after the land, and if
> the county doesn't publish a property address at all it falls back to what you typed rather than the owner's.
>
> **What I deliberately did not do:** rename your existing plan for you. Quietly rewriting the name on a saved
> project is the kind of thing you should never come back to and find already done. It's one click on your side.
- [ ] **Rename the Weld County plan** (currently `2221 E LAMAR BLVD STE 790 / Concept A`) to whatever you want it
      called — `4050 CR 50, Johnstown` is what the county has for the property. Nothing else needs touching.

## ✉️ Decide how Planyr sends its sign-up emails — right now most people can't sign up at all (B1167)

> **Short version: your confirmation emails go out through Supabase's free built-in mailer, and that mailer only
> delivers to people already on your Supabase team.** Everyone else — a colleague, a broker, anyone you show the
> app to — gets nothing. The app tells them to check their email, and no email is ever coming. It's also capped at
> a handful of messages an hour for the whole project, and Supabase says outright it isn't meant for real use.
>
> **What I changed today, and what I couldn't.** The sign-up and password-reset messages now name the sender, so
> whoever does get an email knows what to look for and to check junk. That's a real improvement but it doesn't fix
> delivery — nothing in the app can. Wiring a proper email service needs an account and a password, which is yours
> to create, not mine.
>
> **What I'd do:** sign up for a sending service — **Resend**, **Postmark** or **Amazon SES** are the usual three,
> all with a free or near-free tier at your volume — and paste its username and password into Supabase's email
> settings. Then your emails come **from planyr.io** instead of from a Supabase address, which also means they
> look like they're from your company and are far less likely to land in junk. It's a settings-page job, roughly
> fifteen minutes, and I'll switch the app's wording to the new address in one small change afterwards.
- [ ] **Pick a sending service and set it up in Supabase** (Authentication → Emails → SMTP settings), sending from
      a planyr.io address. Then tell a Claude session the exact "from" address and I'll update the wording to match.
- [ ] **Or tell me you're happy leaving it as-is for now** — that's a fine answer while it's only you and Hillwood
      using it, and I'll stop raising it. Just know that anyone outside your Supabase team currently cannot sign up.

## 📄 Four PDFs I can't download — they're the last piece of Colorado detention sizing (B1105)

> **Short version: Colorado detention now works for the six Denver-area counties, except it can't yet give you a
> number.** Everything around the number is built and live — it names the two separate volumes Denver-area
> reviewers require, tells you which one depends on what, checks your design against Colorado's water-rights
> drawdown law, and points you at the flood district's own sizing workbook. What's missing is the district's
> **lookup tables** — the actual numbers that turn "how paved is this site" into "this many acre-feet."
>
> **Why I couldn't get them.** This build environment can't reach the flood district's website at all — every
> attempt is refused before it even connects, and the same happens for every other site hosting a copy. I tried
> a web search instead; it can *describe* the documents but not hand me their text, and when I asked twice about
> the same document I got **two different sets of numbers back**. That's exactly the situation where I refuse to
> guess: a made-up detention volume is a number you might buy land on. So I built the whole engine and left the
> tables blank, with each one saying which document it's waiting for.
>
> **What I need from you: download four PDFs in your browser and hand them to a Claude session.** Takes about
> two minutes. Any ordinary browser can open all four — it's only this sandbox that's walled off. Once I have
> them, filling in the numbers is a small, safe change (they slot into a table; no new code), and Colorado
> detention starts giving real volumes.
- [ ] **1. The water-quality volume tables** (the "WQCV" piece — this is the one I need most):
      https://www.mhfd.org/files/bfea52e86/Chapter-3-Calculating-the-WQCV-and-Volume-Reduction.pdf
- [ ] **2. The flood-volume memo** (the "EURV" piece — the one where two searches disagreed, so I need the real thing):
      https://www.mhfd.org/files/2cf25e4fe/UDFCD_EURV_Determination_Memorandum.pdf
- [ ] **3. The storage chapter** (allowable release rates + how the outlet has to be built):
      https://www.mhfd.org/files/473699ead/12_Storage.pdf
- [ ] **4. Denver's own manual** — only if you care about Denver proper. Denver publishes its own version on top
      of the district's, and right now the app correctly says "the city may have stricter rules, confirm it"
      rather than pretending to know:
      https://denvergov.org/files/assets/public/v/2/doti/documents/permits/sspr-stormsanitary/urban-storm-drainage-manual.pdf

**Nothing is broken while these are missing.** A Denver-area site shows the method, the two volumes by name, the
drawdown check and where to size it — and shows no volume, rather than a wrong one. And **Fort Collins, Greeley
and Colorado Springs are untouched on purpose** — they're outside this flood district and each has its own
separate rulebook, so they still say plainly that Planyr doesn't cover them yet.

## 🤝 Project sharing (the new "share a project, viewer-only" feature) — two things from you before it can go live
> This is the big one from your last message (items 2 and 3). The right-click-menu fix (item 1) is **done and
> live** — nothing needed from you there. The sharing feature itself is built up to the point where it's safe
> to hand you the rest, because the one thing it absolutely must get right — **"when I take someone's access
> away, are they REALLY locked out the same instant?"** — can only be proven with a second, separate login,
> and this testing sandbox has neither a second login nor a way to reach the login service. Shipping that kind
> of "who can see whose projects" change without watching it actually lock someone out would be reckless, so
> I've stopped exactly there rather than guess.
- [ ] **Give me a second test login.** You already made one throwaway test account (`e2e@planyr.test`) —
      sharing needs a SECOND one so we can watch account A share a project TO account B, then take it back and
      confirm B instantly loses it. Any spare email works; just tell a Claude session the two so it (or the
      GitHub robot) can run the check.
- [ ] **Run one database file when you're ready.** I've written the database setup for sharing as a single
      file and will hand it to you directly. It is deliberately **not switched on yet** — running it just
      *creates* the sharing plumbing without changing anything you'd notice (every existing project stays
      exactly as private as it is today). We flip it on together, one module at a time, while watching the
      lock-out test above pass. **Don't run it blind before then.** (File: `db/project_shares.sql`.)

_(Everything about how it'll look and work — the Share button on every project, the viewer-only mode, the
"shared with you" tag — is fully written up and waiting; it just can't be finished-and-proven until those two
are in hand. Details for the next Claude session: BACKLOG.md B916/B917, VERIFICATION.md V387/V388.)_


## 🔑 One 2-minute paste finishes the TEST LOGIN you already made — turns on automatic signed-in testing forever
- [x] ~~Create a throwaway test account~~ — **DONE 2026-07-18.** You made `e2e@planyr.test` and shared it in
      chat. Thank you — this is exactly the account the project's testing already expects (it even has a
      name for it: "the B280 seeded account").
- [ ] **One step left, and it's better than what was originally asked for.** A Claude session tried signing
      in with it directly today and hit a wall: **this particular sandbox's internet connection is deliberately
      locked down and refuses to even reach Supabase (the account-login service) at all** — confirmed directly,
      not just assumed (the connection attempt came back "blocked by policy," immediately, every time). So this
      session personally can't use the account to click through the site.
      **But there's a better fix than loosening any sandbox's rules: the project already has a small robot
      (in GitHub, the code-hosting site — "GitHub Actions") that runs the signed-in checks automatically,
      on its own ordinary computer with a normal internet connection, no sandbox involved.** It already knew
      how to use exactly this kind of test account — it was just missing the two settings that hold the
      username and password (I also fixed a small gap today so it now points at your real live site,
      planyr.io, by default — one less setting for you to worry about). Once you add the two, it starts
      running the FULL signed-in checklist automatically every weekday afternoon (and any time on demand),
      and if anything's ever broken it opens a note for Claude to fix — all without needing a person, or
      even a Claude chat, to sit down and click through it.
      **Your part (2 minutes, in GitHub):** open this repo on github.com → **Settings → Secrets and variables
      → Actions → New repository secret**, and add two: `E2E_EMAIL` (the email you gave me) and
      `E2E_PASSWORD` (the password you gave me). That's it — nothing else to configure. (If you'd rather
      paste them straight into a Claude chat that has access to your GitHub settings, that works too — just
      don't paste them anywhere in this repo's files or a commit, since anyone who can read the code could
      then read it back.)

## ✅ ANSWERED — nothing for you to do (was: the county flood-study question, B1057 / B1074)

**This is closed.** I asked you to check with Waller County whether their floodplain ordinance carries the
"50 lots or 5 acres" requirement. That question has since been answered by reading the county's **own adopted
ordinance** — the Waller County Flood Damage Prevention Ordinance, in force since February 2013 — so nothing
is needed from you.

**What it says, and it is stricter than the federal minimum I'd flagged.** For a development bigger than
50 lots or 5 acres — whichever is smaller — Waller requires the flood elevation to be **generated and submitted
with the proposal**, using the national rainfall data set called Atlas 14, and it requires the **500-year** level
too, not just the 100-year one. It applies wherever no elevation is already published, which is exactly
Tsakiris. So on Tsakiris this is a **submittal requirement**, not a nice-to-have: budget and schedule the
engineer's flood study at the front of the project.

**What changed in the app.** It now says so on the flood panel, in one line with the citation behind the ⓘ,
and it says **required** rather than the old hedged wording — because this is the county's own document, read
directly. Anywhere the county's ordinance has *not* been read, the app still says "likely required" and names
itself as unconfirmed, so the two can never be mistaken for each other. The app also now works out its own
screening flood level (both the 100-year and the 500-year) from real rainfall, soil and ground-elevation data —
a look-ahead at what that study will produce, clearly labelled as screening and never a substitute for it.

## 🗓 Optional — one Scheduler date to sanity-check on Grand Port (B835)
- [ ] **Nothing broken; just a judgment call only you can make.** The task you flagged — Grand Port →
      Site Development → **"AHJ Review #1 - Civil Revisions"** (task 81) — is now correct: it starts the
      next working day after the AHJ approval before it (7/13/26), and the stray old date (8/3) and the
      pin that was hiding it are gone. The only open question is your intent: **did you want a gap of
      roughly three weeks between the AHJ approval and starting civil revisions?** If yes, tell a Claude
      session and it'll add that delay to the link. If not, it's already right — leave it. (The app now
      also pops up a yellow heads-up banner any time a saved date gets auto-corrected like this, so you'll
      never have to catch one by eye again — that's the B836 fix that shipped with this.)

## 🔐 Two 2-minute safety toggles in the Supabase dashboard (from the 2026-07-12 delete-safety audit)
> Both live in the dashboard for the main app project `lyeqzkuiwngunutlkkmi` — no SQL, no files, just switches.
- [ ] **Turn on leaked-password protection.** Supabase → Authentication → Sign In / Providers → Email →
      enable "Leaked password protection." What it does: when anyone sets a password, Supabase quietly checks
      it against the public list of passwords exposed in known data breaches and refuses ones that appear
      there. Free, one click, no downside.
- [ ] **Confirm database backups are on (and note the retention).** Supabase → Database → Backups. Free-tier
      projects get daily backups kept ~7 days; paid tiers keep more and can add point-in-time recovery (a
      rewind-to-any-minute safety net). Just confirm the page shows backups running and tell a Claude session
      what it says — this is the final backstop under all the in-app delete protections that shipped today.

## 🩹 Optional — restore the one missing overlay on Grand Port (B784)
- [ ] **Nothing required; the bug is fixed.** One overlay on your **Grand Port / Concept A** site (the
      "2026.06.23 GPL - Site Plan.pdf") had its cloud copy go missing, so the drawing used to hang on a
      spinning "Loading drawing…" forever. It now shows an honest **"Couldn't load … — click to re-add the
      file"** message instead. If you want that specific drawing back, open Grand Port and **click that
      message, then pick the PDF** — it re-uploads and drops back into its exact old spot/size/rotation. Only
      you have that file, so this one's optional and yours; everything else about the site is unchanged.

## 🧹 Optional 10-second cleanup — delete the "GREENHOUSE" test plan
- [ ] The live testing on 2026-07-11 used a throwaway plan called **"GREENHOUSE / Concept A"** in your
      account (a 14.66-acre Cypress-area parcel with a test pad elevation typed in). It's safe to delete
      whenever you notice it — or leave it; it hurts nothing. Nothing else was changed in your projects.

## 🧩 Turn on DWG uploads (deploy the converter — needs one cloud account)
- [ ] **Decide the host + do the account setup, then a Cowork session deploys it with you.** DWG files
      can't be read in the browser — a tiny converter has to run on a server. It's built and tested; what's
      left needs one of your cloud accounts (the converter runs under your billing, so I can't stand it up
      from here). **The design is cost-safe on purpose:** the converter is NOT put on the open internet —
      it hides behind planyr.io and only answers signed-in you, behind a secret, with a hard cap on how much
      it can ever run. So the "someone hacks it and runs up my bill" case can't happen, and real use is free.
      The full plan (what to build, the exact deploy commands, and your part) is written up for a Claude
      Cowork session in **`docs/DWG-DEPLOY-BRIEF.md`** (Claude handed you this file in chat 2026-07-12).
      **Your part:** pick the host (Google Cloud = cheapest but needs a card; or a no-card free host that's
      slightly slower on the first file of the day), then create the account/project and paste ~2 settings —
      Cowork drives the rest. Until this is done, dropping a DWG just says "export a DXF instead" (which works
      today), so nothing is broken by waiting.

## 🌐 Open your environment's network so I can load real Houston road data (thoroughfare epic)
- [x] ~~**Allow the GIS servers, then start a fresh session.**~~ **DONE — you opened `mycity2.houstontx.gov` +
      `www.houstontx.gov`, and this session loaded the real data (2026-07-11).** All **26,697** City of Houston major
      roads (freeways, thoroughfares, collectors, transit corridors) are now in Planyr with their official
      right-of-way widths (100 ft major thoroughfares, 80 ft major collectors, 60 ft minor collectors — read
      straight from the City's published table, not guessed). Nothing left on your plate here. (B721 / V274 closed.)
      **When we move on to the surrounding counties (B722), I'll need the network opened a bit wider** — `*.arcgis.com`
      plus the Harris / Fort Bend / Pearland / Montgomery / H-GAC GIS hosts — but there's nothing to do until then.

## 🩹 Optional — a few older sites lost their parcels before today's fix (B756)
- [ ] **Nothing required; read only if you want an older site back.** A bug (fixed + shipped 2026-07-10)
      made brand-new sites you created from the map **lose their parcel boundary** when signed in. Going
      forward this can't happen again. Four sites created since 2026-07-06 were hit — the **Katy "27211 Hoyt
      LN"** one you just made (re-create it in 10 seconds: open the map, select the parcels, click "Plan
      parcels"), plus **GREEN RIVER, HOLLISTER, WAYSIDE**. If any of those three held real work, open it on
      the **same computer/browser you first created it on** and check the planner's **version history (↺)** —
      the pre-loss copy may still be saved locally there and can be restored. If they were just quick
      attempts, ignore this.

## 🔌 Turn on the new Claude connector (B675 — ~5 minutes, copy-paste)
- [ ] **Add 3 settings in Cloudflare Pages, then add the connector in Claude.** Claude handed you the
      walkthrough file in chat (2026-07-06) with the exact values ready to paste: (1) in Cloudflare Pages →
      your planyr project → Settings → Environment variables (Production), add `PLANYR_MCP_TOKEN` (the random
      secret from the file), `PLANYR_MCP_OWNER_ID` (your account id, in the file), and
      `SUPABASE_SERVICE_ROLE_KEY` (copied from the Supabase dashboard — the file shows exactly where);
      (2) redeploy; (3) in claude.ai → Settings → Connectors → add the connector web address from the file.
      Until this is done the new endpoint stays invisible (it answers "Not found" to everyone) — nothing is
      exposed by waiting. After you add the settings, the Claude cohort runs the technical checks (V220).

## 🗓 Calendar note — old save-format safety copy expires ~Aug 6 (B674, no action until then)
- [ ] **Around 2026-08-06, tell a Claude session "drop the old blob backup" (or just ignore this — a
      session will re-raise it).** When the live-editing upgrade shipped (2026-07-06), the old
      one-big-file save format was frozen and kept as a safety copy (`sites.data_backup`) for ~30 days
      in case anything needed rolling back. Once a month passes with the new per-element saving working
      live, the copy is dead weight; a Claude session removes it with one command (plus the follow-ups
      noted in B674). **Nothing to do before then.** If saving ever looks wrong in the meantime, say so —
      the rollback (`db/site_elements_down.sql` + that backup) is exactly what the copy is for.

## Decisions only Michael can make
- [ ] **Which big feature to build next.** In progress: he picked **Team Workspaces** (find/fix bugs) on 2026-06-27.
      The other candidates still waiting: **Revision compare** (overlay/diff two drawing versions), **Named markup
      layers** (show/hide/lock groups of markups). Tell Claude which is next when Team Workspaces is in good shape.
- [ ] **Scheduler backend (B408, decision-gated).** Decide whether to consolidate the embedded Scheduler onto the
      main Supabase project (one backend) or keep it on its own. Claude can't proceed on this until he chooses.

### 🔧 Optional data confirmation (not blocking anything)
- [ ] **Confirm the detention rainfall table (B655).** The new per-pond "Required detention (screening)" card uses an
      area-representative NOAA Atlas-14 rainfall table for the Houston area. It's clearly labelled "screening — pending
      primary verification" and is fine to use as-is. If/when you want exact numbers for a specific site, you (or your
      engineer) can pull the official Atlas-14 values for that site's coordinates and Claude will drop them in. No rush —
      nothing breaks meanwhile.

### ❓ From the improve loop (2026-06-27)
- [ ] **Landscaping in the yield numbers (B553).** A deep audit of the yield/takeoff math (building SF, coverage %,
      parking ratios, acreage, impervious %, detention volume) came back **clean — no wrong calculations.** One
      judgment call surfaced: drawn **landscaping** (green buffer strips) currently counts as pervious "open/green"
      space and isn't broken out on its own line. Options: **(a, recommended)** add a "Landscaped SF" line to the
      breakdown but keep it pervious (impervious %, coverage, detention all unchanged); **(b)** leave as-is (lumped
      into open/green — numbers already correct); **(c)** count it as impervious (unusual — landscaping is normally
      pervious for stormwater, so this would raise impervious % and affect detention sizing). Default until he says:
      **(b) leave as-is** (the numbers are correct today). Claude implements (a) on request — it's a small additive change.
- [ ] **Loop direction.** ~27 fixes shipped across 8 hunt rounds + a clean yield audit; the easy-bug pool is thinning.
      Pick one: **(a)** keep the loop hunting (deeper/focused laps); **(b)** pivot to a roadmap feature (e.g. GIS layer
      caching — the documented Track-1 next item); **(c)** wind the loop down for now. Default until he says: **(a) keep
      hunting** at a focused, lower-cadence pace.

## Run this SQL (one-click in Supabase) — closes Team-sharing security gaps
> **All for the main app project `lyeqzkuiwngunutlkkmi`; safe + idempotent (just re-run the whole file). These
> matter ONLY once you actually start inviting teammates — no teams are live yet, so nothing is exposed today —
> but run them BEFORE you invite anyone.** Claude hands you the files.
- [x] ~~Run `doc-review/db/team_storage.sql`~~ — **DONE (SQL applied, live 2-account test PASSED 2026-07-01).**
      Cowork's signed-in run in the real browser confirmed the fix holds live: attacker A denied HTTP 400 / no bytes
      when trying to read victim B's private PDF via a fabricated `sources.storageKey`; legit team-share still
      returns 200 + real PDF. `can_read_shared_review_file(text)` on `lyeqzkuiwngunutlkkmi` carries the owner-path
      bind. Archived as V150 in `VERIFICATION-DONE.md`. (B491)
- [x] ~~Run `db/team_rehome_guard.sql`~~ — **DONE 2026-06-26.** Closed a gap where a teammate on two teams could
      move your shared project to their other team. (B486)
- [x] ~~**(2-min dashboard check) Confirm "Confirm email" is ON** in Supabase → Authentication → Providers → Email.~~ — **DONE (Cowork verified 2026-07-01).** Supabase Dashboard → Authentication → Sign In / Providers → Email shows **Confirm email: Enabled**. Email is the only enabled sign-in provider (Phone, SAML 2.0, Web3 Wallet, Apple, Azure, etc. all Disabled; no third-party OAuth or magic-link providers on). (B491 tail check.)

## Run this SQL (one-click in Supabase) — turns on the new project **Folders** feature (B650)
> **One file, for the main app project `lyeqzkuiwngunutlkkmi`; safe + idempotent (re-run the whole file
> anytime).**
- [x] ~~Run `project_folders.sql`.~~ — **DONE (owner ran it 2026-07-05; Claude verified the live schema in
      prod the same day: table + 4 RLS policies + sibling-unique index + drive_* guard trigger + SECURITY
      DEFINER RPC all present).** Every project now gets the standard 12-category folder tree in the
      unified **Library** view, mirrored one-way into Google Drive. The first live seed surfaced a 502 in
      the mirror sync — fixed same-day (B662, chunked sync). Nothing on Michael's plate; the live Drive
      click-through is the Claude cohort's job (`VERIFICATION.md` V208/V209/V214, not his).

## Run this SQL (one-click in Supabase) — syncs your Library **pins** across your devices (B676)
> **One file, for the main app project `lyeqzkuiwngunutlkkmi`; safe + idempotent (re-run the whole file
> anytime). Claude hands you the file.**
- [x] ~~Run `pins.sql`.~~ — **DONE (owner ran it 2026-07-06; Claude verified the live schema in prod the
      same day: `public.pins` table + all 7 columns + RLS enabled + all 4 own-row policies + the
      `pins_user_created_idx` index all present).** Your Library pins (the ☆ folders/files on the Library
      home) now **follow your account to any device you sign in on** — this computer's existing pins copy up
      automatically on your first signed-in visit (safe + non-destructive). Nothing left on your plate; the
      signed-in cross-device click-through is the Claude cohort's job (`VERIFICATION.md` V222), not yours.

## Things Claude needs FROM Michael to finish/verify
- [x] **Drainage-manual transcription (B636 tail) — DONE (Cowork pulled the PDFs itself 2026-07-05; nothing needed from you).**
      Cowork reached the signed manuals directly (the sandbox couldn't, but Cowork can), so you never had to drop them
      in. It replaced the placeholder "screening band" values with primary-sourced numbers for **City of Houston**,
      **Fort Bend**, **Montgomery**, and **Chambers**, and caught two real corrections the trade press had blurred:
      Houston's flat **0.8 ac-ft/ac applies to the paved/roofed (impervious) area, not the whole tract** — so required
      detention on a Houston site is meaningfully lower than the first build showed — and the single-family cutoff is
      **15,000 SF**, not 7,500. Fort Bend & Montgomery now give an exact number (not a range) once a test-fit sets
      impervious %. Shipped + verified. **Waller is now closed too (2026-07-05):** you supplied the full Waller PDF,
      so Cowork read Appendix E directly and confirmed Waller DOES publish rates — a 0.65 ac-ft/ac coefficient method
      for small sites and a 0.55 ac-ft/ac floor — so its range tightened from a wide guess to a correct **0.55–0.65**.
      All six authorities are now primary-sourced. Nothing left on your plate here.
- [ ] **Add the six drainage-authority websites to the periodic Cowork re-verification checklist.** Every
      detention rule record now carries a "verified on" date so staleness is visible; a recurring Cowork pass
      over hcfcd.org, houstonpermittingcenter.org, fortbendcountytx.gov, the Montgomery DCM page, the Chambers
      (Mont Belvieu-hosted) DCM, and Waller's subdivision regs is the refresh mechanism. (Houston already changed
      its rules once — June 2026 — between the owner's verification and this build; the engine caught it because
      records are versioned.)
- [x] **Turn on the parcel-cache builder (B629) — 3 GitHub Actions secrets — DONE (Cowork, 2026-07-04).** The
      `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REFRESH_TOKEN` Actions secrets are in place (fresh
      refresh token minted via OAuth Playground on a NEW client secret; Cloudflare untouched, original secret still
      Enabled). The Chambers/Waller data source has since been fixed too (B661, first labeled B650 — the state `/query` had gone dark;
      the builder now pulls the 2025 AGO StratMap layer). Nothing left for Michael here — Claude/Cowork triggers the
      first build + does the live click-through (V199).
- [x] **Reference drawings — DONE (2026-06-30, found in Google Drive, defaults validated).** Measured the
      **Grand Port** approved arch set (1,005,560 SF cross-dock, 40′ clear): the **56′** typical bay is the
      single dominant grid dimension (~130 callouts) and the slab plan literally labels a **60′ SPEED BAY** —
      so the column-grid defaults (**56′ along the docks · 60′ speed bay**) are confirmed against your real
      plans. Depth bays read **~45–50′** (my 50′ default sits at the top of that range). Pinnacle/Urban
      Logistics are small (~85k SF) and Goose Creek's set is 141 MB (too big for the text reader) — neither
      changes the conclusion. **One optional call for you:** the Grand Port depth bays run as tight as 45–48′,
      below the current 50–58′ flex band floor. Want me to drop the band floor to ~45′ so a building's *depth*
      can flex tighter to match? Default = leave it at 50–58′ (your stated range). Say the word and it's a one-liner.
- [x] ~~**A second test account**~~ — **DONE (confirmed 2026-07-08): `michael.butler@hillwood.com` exists and
      is an admin on team "HIP Houston" alongside your main account.** Your share attempt on Goose Creek
      surfaced a real bug — any autosave from your open tab silently reverted the share (B714, fixed +
      shipped 2026-07-08; the site was re-linked to the team for you). Nothing left on your plate here —
      the two-account click-throughs (V244 share round-trip + V230 named conflict notices) are the Claude
      cohort's job. **One habit that matters: after a Planyr update ships, reload your open Planyr tabs**
      (an old tab runs the old code until reloaded).
- [ ] **One real, heavy PDF** (a big construction set) — to profile the **PDF/map stutter (B484)** and pin exactly
      where it hangs. Without a profile from a real file, the fix would be a guess.
- [ ] **A >50 MB file** (optional) — to confirm the "50 MB per-file cloud limit" banner text. The automated
      tester's upload bridge caps at 10 MB, so this one needs a manual drop.

## One thing only Michael can unblock

- [ ] **Let Claude reach Municode (or hand over the Baytown flood ordinance).** Part of Goose Creek is inside
      the City of Baytown's limits and *all* of it is inside Baytown's ETJ, so Baytown's flood rules apply to
      it — but Claude cannot read Baytown's ordinance from its sandbox: `library.municode.com` and
      `baytown.org` are both blocked by the network allowlist. Michael's recollection is "about 2 ft above the
      500-year"; Claude deliberately did **not** encode that, because every other rule in the app cites the
      exact ordinance section it was read from, and a web-search summary is not an ordinance. Two ways to
      unblock: **send Claude the PDF or pages of Baytown's Flood Damage Prevention chapter (Ch. 122)** —
      the non-residential lowest-floor requirement is the part needed. ⚠ Just opening up the websites
      probably won't do it: Municode serves Baytown's code as a page that builds itself in the browser, so
      a plain fetch gets the index and no ordinance text, and Baytown's own site times out on the check
      crawlers do before reading. A second attempt confirmed both dead ends. **Worth knowing before spending effort:
      Harris County's rule (already in the app, verified) is 500-year + 2 ft — the SAME as the recollection —
      so if the recollection is right the pads do not move at all.** Meanwhile the app is NOT guessing and
      NOT blank: it uses the Harris County rule, says on screen that it is using it and that Baytown's
      rule is missing, and refuses to call the floor final. (B286305/B286309, 2026-08-09.)
- [ ] **Is Grand Port inside Baytown's city limits?** The two mapping sources disagree on every lot there:
      Baytown's own map says yes, the state's map says no city at all. At Goose Creek the two agree exactly,
      so this is specific to Grand Port — possibly an annexation the state layer hasn't picked up. If Baytown
      is right, Grand Port is an incorporated site and Baytown's rules govern it outright. Claude did not pick
      a winner. (B286308, 2026-08-09.)

## Quick housekeeping in his account
- [ ] **One concept in Silvestri is still labelled "Concept D - Sylvestri Retail"** (the old spelling). The
      PROJECT name is fixed everywhere — all five concepts now say Silvestri — but that one line is the plan's
      own label, which is his text, so Claude left it alone rather than rewriting it behind his back. Rename it
      from the plan switcher if he wants it to match. (B1417, 2026-08-04.)
- [ ] **Name or delete the stray "Untitled site" (~32.8 acres)** that's sitting in his Site list — it wasn't
      created by testing; Claude left it untouched. He may want to label it or remove it.
- [ ] **Reload planyr.io once** after a deploy to pick up the latest fixes (his open tab runs the old build until
      reloaded). Routine — only matters right after Claude ships something.

## Deferred / low-urgency (filed; no action needed unless he wants them sooner)
- **B364 (remaining half) — two optional server backends, only if/when wanted.** The scanned-drawing reading
      now runs FREE in the browser (shipped 2026-07-05 — scanned sets get real sheet labels + auto-filing with no
      server). Two already-built backends stay parked until Michael provisions accounts (Claude can't create these):
      **(a) DWG reading** — drop a `.dwg` straight in (today: export a PDF from CAD, which works fine). Needs a
      Google Cloud Run deploy of `server/convert/` (LibreDWG container). **(b) AI fallback read** for the rare scan
      the free path can't read — needs `server/filing/` on Cloud Run + an Anthropic API key (~pennies per file).
      When wanted, say so and Claude will hand over the exact one-page deploy steps + env vars.
- B479 — storage performance tweaks (invisible; deferred for stability).
- B483 — a 100%-full browser store can sign him out (self-heals; very unlikely now that big images moved to the
      large drawer).
- B484 — the PDF/map stutter above (needs the heavy PDF to profile).
