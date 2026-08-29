# Notes — what a fresh session needs to know

> **⛔ READ THIS BEFORE TOUCHING `src/workspaces/notes/`.** It exists to make starting a NEW
> session the CHEAP option. **Default to a new session per task, on Sonnet;** continue an existing
> one only when it holds a rig this file cannot replace (a live reproduction, a measurement bench,
> a half-built harness). A warm container is not a reason.
>
> **⛔ WHY IT EXISTS, stated plainly because the failure is the point.** The project rule is one
> task per session, then archive. It was ignored for a week: everything went into one session,
> which ended up re-reading roughly **half a million tokens of history on every dispatch**. The
> justification each time was that a fresh session would have to rediscover too much — and that
> was TRUE, because everything a fresh session needed lived only in the old one's memory. Writing
> it down somewhere a session does not read is the same mistake wearing a different hat. So it
> lives HERE, in the repo, and `CLAUDE.md` points at it.
>
> **⛔ KEEP IT CURRENT.** A new instrument trap or bug family gets added to this file **in the same
> commit that discovers it** — never left in a session's memory. That is the whole mechanism.

---

## 1 · Instrument traps — these produced FOUR false findings. Check them before reporting anything.

Every one of these made a harness confidently report something untrue about working code. The
general form is the repo's named rule **DRIVER-SCROLL-IS-NOT-APP-SCROLL clause 6**: *point a probe
at a case whose answer is already known, and require it to report that known answer, before
trusting it on the unknown case.*

1. **Container scroll shifts every client rect.** *"The block crawls while you type"* was the page
   scrolling. Scroll the container to top before comparing rendered geometry, or compare against
   the container rather than the viewport.
2. **Synthetic events do not move the native caret.** A simulated click cannot judge
   caret-follows-click.
3. **A gesture needs a REAL press** — `pointerdown` + `mousedown`, a short hold, then `pointerup`.
   `element.click()` does not drive the place/drag paths. A truncated sequence leaves the commit
   un-fired and looks exactly like *"resize does not save"*; that cost two rounds. Use
   `ui-audit/lib/pressFeature.mjs`.
4. **Never trust a synthetic keystroke.** Drive real key input (`page.keyboard.press`, CDP
   `Input.dispatchKeyEvent`) or press the control that does the job, and **a command call must
   never stand in for a keystroke** — that proves the command, not the binding.
   > **⛔ CORRECTED HERE against the repo's own measurement.** The carry-forward this file was
   > written from said *"keyboard events do not register at all in this app."* That is overstated,
   > and the precise version matters because it names what to do instead. Measured (see
   > **SYNTHETIC-KEYS-DONT-EDIT** in `CLAUDE.md` for the full table): the handler is bound to
   > `window`, and `new KeyboardEvent(…)` defaults to **`bubbles: false`**, which a real key event
   > never does — so a synthetic event dispatched on `document` or `document.body` never reaches
   > it, while the same event with `{ bubbles: true }`, or dispatched on `window`, works fine. The
   > app never checks `isTrusted`. It is one missing option, and it fails in **total silence**.
   > Two further gates swallow the key by design: a **focused field**, and an **inactive planner**.
5. **A selection must be a real `Range` inside the editor.** `execCommand("selectAll")` then
   clicking a toolbar button applies nothing.
6. **Read the STORED document, not the screen.** Resize looked perfect on screen while saving
   nothing (B434417 — *rendered 300, stored 180, 180 after a reload*). Persistence claims are read
   from storage, then **re-read after a reload**.

**Six more of the same species came from our own harnesses**, not from the app: reads landing
before the 600 ms save debounce; comparing against the wrong baseline (hand-authored seed bytes
rather than the editor's own serialisation); a fixture that already contained the thing asserted
absent; and **twice** picking the option that means *do nothing* — choosing `Lines: Single` when
single was already the default, and a colour swatch that was `Default`, i.e. remove.

Two more found since, each worth its own line because each returned a confident wrong verdict:

7. **Polling misses a state the app restores within a frame.** The drag-narrows defect was invisible
   to five reads 60 ms apart and obvious to a `requestAnimationFrame` sampler. A transient reflow
   is still a reflow. See `ui-audit/measure-notes-drag-width.mjs`.
8. **A driver option that is silently ignored is indistinguishable from a broken feature.**
   `page.mouse.click` accepts `button`/`clickCount`/`delay` and **drops `modifiers`** (that option
   belongs to `locator.click`), so every Shift+click replaced the selection instead of extending
   it and the harness reported *"the group drag moves only one box"* about working code.
9. **A BOX'S TOP-LEFT CORNER IS THE DRAG GRIP, NOT ITS CONTENT (2026-08-28).** A harness that
   clicks `boxEl.x + 10, boxEl.y + 10` to "enter" an anchored box is aiming at
   `.planyr-anchor-grip` (`left: 3px; top: 5px; width: 9px; height: 14px` in `NoteEditor.jsx`'s
   `EditorStyles`), which has its OWN mousedown handling for dragging the box and never reaches
   `focusFromMat` at all. This produced a completely convincing false positive: a caret that
   looked permanently stuck on "click a different row inside an already-entered box", an
   every-other-click toggle in the trace, and a plausible-sounding root cause in the app's own
   selection-vs-editing state machine — all from one bad pair of coordinates. The tell was an
   `elementFromPoint` check at the intended click coordinate (which correctly resolved inside
   the box's content) not matching what a mousedown-capture trace on `window` actually saw
   (nothing, for the corner clicks). **Click the box's actual visible content** (the center of a
   real cell/word), never a fixed offset from the box's own bounding rect corner.

See also `ui-audit/TRAPS.md`, and the named rules **FOREGROUND-OR-VOID** (a background tab cannot
be measured — not its clock, not its pixels) and **COUNT-EVERY-KIND**.

---

## 2 · The fixture that finds real bugs

Michael's Richfield **"Utilities"** outline. **Simplifying it hides the defects** — that is not a
caution, it is measured: all 17 existing Tab/Shift+Tab cases passed before AND after the B519680
fix, because every one used a FLAT list where an item has no indentable ancestor.

```
MUD 377                                              (1)
  Active                                             (2)
  Engineer - Pape Dawson                             (2)
    Dustin O'Neal                                    (3)  ← SMALLER FONT than its siblings
      P: 713-428-2400                                (4)
      doneal@pape-dawson.com                         (4)  ← autolinked
  MUD ATTORNEY: BRIAN YATES                          (2)
Water Authority: Northwest Regional Water Authority  (1)
Sanitary:                                            (1)
  Discharge Permit may be 18 months                  (2)
```

The Shift+Tab bug only appears with an **uneven sibling subtree** like this: the branch that moved
sat BESIDE the pressed line, not under it. Live copy: `ui-audit/diagnose-notes-outdent.mjs`.

---

## 3 · Data facts

**Local keys** — `planyr:notes:tree:v1:<uid>` · `planyr:notes:page:v1:<uid>:<pageId>` ·
`planyr:notes:sync:v1:<uid>` (`<uid>` is the user id, or `local` when signed out).
**Cloud** — `notes_trees` (ONE row, `data` jsonb) · `notes_pages` · `notes_images`.

The tree carries **`pages`**, **`trash`**, and **`tombs`** (deletion receipts). A purged id in
`tombs` is correct; **a purged id in `pages` is the resurrection bug** (B357011 / B364016).

**Standing health check — `live_but_purged` must always be 0:**

```sql
with live as (
  select p->>'id' id from public.notes_trees, jsonb_array_elements(data->'pages') p
)
select (select rev from public.notes_trees)                     as rev,
       (select count(*) from live)                              as live_count,
       (select count(*) from live
          join public.notes_pages np on np.id = live.id
         where np.purged_at is not null)                        as live_but_purged,
       (select jsonb_array_length(data->'trash') from public.notes_trees) as trash;
```

**Scratch-page hygiene on his account:** create one, use it, **bin AND purge it**, restore his
counts, **never purge one of his rows**, and match a bin row **by its preview text rather than its
position**.

---

## 4 · The verification bar that actually held

- **Measure, do not eyeball** — numbers in the reply, not adjectives.
- Ask **"could this check pass while the feature is still broken?"** The resize bug is the
  canonical shape: it rendered correctly and stored nothing.
- **An audit that finds nothing is a FAILED audit**, not a clean bill of health.
- **Adversarial passes earn their keep.** Attacking our own selection fix found two defects a
  confirming test sailed past: the ring lost on re-render, and Escape handled twice so one press
  did both stages.
- **Prove a new guard goes RED before trusting it green** — preferably by pointing it at untouched
  code, which is stronger than planting a synthetic defect.

---

## 5 · The recurring bug families — suspect these first

1. **A GLOBAL KEY BINDING LEAKING INTO TEXT.** Escape handled twice (B434418); the arrow-nudge
   swallowed arrows while typing (B519681). The guard is a **PROPERTY** — every globally-bound key
   is inert when the caret is in editable text — asserted by a source sweep in
   `test/notesKeyScope.test.js`, **not one test per key**. Verify it still exists as a property.
   `Escape` is a named exemption (`UNGATED_KEYS`), and that is a rule rather than a hole.
2. **A CLAMP WITH NO FLOOR.** *"Do not slide the box, narrow it to fit"* crushed boxes to a sliver
   at the right edge (B539648) **and** — the same clamp, in the one path that item did not touch —
   narrowed a box while it was being dragged (B583008). **The rule: a minimum size, and past it the
   canvas EXTENDS AND SCROLLS**, exactly as it already does downward. When you find one instance,
   grep for every other caller of the same clamp before closing it.
3. **HOUSEKEEPING UNDOING THE EDIT.** `deriveBlockSizes` runs on every transaction; it saw a
   brand-new empty block, decided its runs disagreed, and nulled the size — which is why Enter
   stopped carrying formatting (B583010). **Anything that "corrects" the document on every
   transaction is a suspect**, and an `appendTransaction` is the first place to look.
4. **A SIBLING'S HEIGHT CHANGE SHIFTS CONTENT UNDER AN IN-PROGRESS GESTURE (B649376, reopened
   2026-08-28).** The Table toolbar group only renders `{inTable && (...)}`, so the instant the
   caret enters a table the toolbar wraps to an extra row (measured: **38.9px → 74.8px**, a
   35.9px delta on the real Silvestri note) and the sheet below it — the table included — is
   pushed down by that exact delta, mid-drag, under a pointer that has not moved. Measured as
   his *"it just jumps and flashes"*: the native selection never extended across cells at all,
   it stayed collapsed and hopped between wrong text nodes as the content slid out from under
   the drag. **Any conditionally-rendered CHROME sitting above a draggable/scrollable surface
   is a suspect** — grep for `{inX && (` near a toolbar/rail before assuming a drag bug is in
   the drag code itself. Fixed with a `ResizeObserver` folding the measured delta into the
   surface's own `transform` (VIEWPORT-STABLE) — **not `scrollTop`**, which silently no-ops on
   a note too short to have scroll slack (exactly this fixture).
   ⛔ **AND THAT FIX SHIPPED, PASSED ITS OWN GUARD, AND STILL REACHED PRODUCTION BROKEN — because
   a `ResizeObserver` alone is a PASSIVE, AFTER-THE-FACT mechanism, not the synchronous
   `useLayoutEffect` VIEWPORT-STABLE actually calls for.** A `requestAnimationFrame` sampler
   (the shipped guard only ever sampled every ~45ms, 2–3 frames apart, and never caught this)
   found a real one-frame gap on the very build that had "fixed" it: the frame where the toolbar
   first measures its taller height still has the mat's `transform` empty and the content already
   down by the full delta, and only the NEXT frame corrects it. One visible frame is exactly
   *"it just jumps and flashes"*; under load, mid-drag, or however the owner's real machine
   scheduled the ResizeObserver notification, that gap can stretch far past one frame. **The
   fix that held:** compute `inTable` inline (the same boolean `NoteToolbar` uses) and measure +
   compensate in a `useLayoutEffect` keyed on it — a layout effect runs after the DOM mutation
   commits but before paint, in the SAME render as the toolbar's extra row, so there is no frame
   in which one is true and the other is not. The `ResizeObserver` stays only as a fallback for
   OTHER causes of the same resize (a window resize changing button wrap, a webfont loading),
   sharing one height baseline so the two paths never double-count.
   ⛔ **AND SCROLL SLACK CHANGES NOTHING ABOUT WHETHER THIS WORKS, WHICH IS WORTH PROVING
   EXPLICITLY RATHER THAN ASSUMING** (an owner correction after the frame-race fix landed,
   pointing out his own report had the scroller pinned at maximum scroll — no slack left, the
   exact condition B649376's ORIGINAL `scrollTop` attempt failed under). Measured: pin
   `note-mat.scrollTop = note-mat.scrollHeight` before the gesture (on this fixture that pins it
   at 0, since the note is too short to scroll at all) and run the SAME frame sampler both
   entering (toolbar grows) and — the mirror case, which moves content the OTHER way —
   leaving (toolbar shrinks). Both hold at zero race frames with the `transform`-based fix; both
   show exactly 1/60 race frames on the pre-fix `ResizeObserver`-only build. The `transform`
   approach was never scroll-dependent (unlike the very first `scrollTop` attempt this item
   already rejected), but a claim like that is only worth as much as the harness that checks it —
   see `verify-notes-table-select.mjs` sections 5–6.
   ⛔ **AND A "COMPENSATED" CHECK THAT PARSES THE `transform` STRING IS ITS OWN TRAP.** The first
   version of the max-scroll check called a frame "uncompensated" whenever `mat.style.transform`
   read `""` — correct for the GROWING direction (an empty transform there really is no
   compensation) but WRONG for the SHRINKING direction, whose correct SETTLED state is net-zero,
   i.e. an EMPTY transform. That version reported the shrink case red on the FIXED build (a false
   failure). The fix: compare the visible position (`tableTop`/a paragraph's `getBoundingClientRect
   ().top`) against its OWN settled value at the end of the sampling window, never against what a
   specific CSS property happens to read — VIEWPORT-STABLE is about the picture staying put, not
   about which mechanism does it.
   ⛔ **REOPENED A THIRD TIME (B831600 ×3, 2026-08-28/29) — STILL OPEN. Read this before touching
   this code again; the mechanism is measured on production, not reproduced anywhere this repo can
   check it, and that gap is itself the finding.**
   **THE MECHANISM, AS MEASURED ON PRODUCTION** (owner's own instrumented `pointerdown`/
   `pointermove`/`pointerup`/`click` listeners plus a whole-ancestor-chain transform walk, same
   build, same session, minutes apart): **the GROW is uncompensated and the SHRINK is compensated
   — the opposite of what a sandbox rebuild of the same commit shows.** Fresh page load, table
   never touched: `transform` chain reads `none` throughout. Click into a cell: toolbar 38.924 →
   74.775px, content moves the full 35.851px down, chain STILL `none` — the compensation never
   fires on entry at all. Click back out to a plain paragraph: toolbar returns to 38.924px, and
   `translateY(35.8503px)` NOW appears on the mat, holding the content at its shifted position —
   the shrink is fully (over-)compensated, and the note settles PERMANENTLY about one toolbar row
   lower than where it opened. Repeated table entries after the first behave correctly (this
   matches round 2's own fix working "from the second interaction onward"), so the defect is
   specifically about the very first grow of a freshly mounted note.
   **WHAT WAS RULED OUT, each with the evidence, so a future session does not re-walk the same
   ground:**
   - **Nesting depth** — the owner's own original theory, explicitly retracted after further
     production instrumentation on a fresh top-level scratch table showed the SAME failure
     (uncompensated grow) once the table had never been touched in that page session. His words:
     *"I WAS WRONG ABOUT THE NESTING... It is not [the variable]."* A prior draft of this file said
     otherwise; that framing is superseded by this entry.
   - **His exact document structure** — rebuilt field-by-field from the real stored ProseMirror
     JSON he pulled off his own page (node types, `attrs`, the `bulletList > listItem > bulletList
     > listItem > table` chain, no `attrs` object on the table, 4 rows × 1 col) and driven with a
     real drag: zero drift in this sandbox, every time.
   - **Block `fontSize` attrs + `textStyle` marks** — his cells carry a block-level `fontSize` (10
     for the header row, 9 for the rest) AND a per-run `textStyle` mark storing the size as a
     STRING WITH A UNIT (`'10pt'`/`'9pt'`) — Outlook's own paste unit. Theorized to interact with
     `deriveBlockSizes`'s `appendTransaction` (family 3 below) firing mid-gesture and staling the
     compensation. Ruled out on two independent grounds: (a) `deriveBlockSizes`'s `appendTransaction`
     is gated on `trs.some(t => t.docChanged)`, and a `MutationObserver` on the table's whole
     subtree during a real drag recorded exactly 4 mutations, all `class="selectedCell"` — no
     style, no attribute, no childList change anywhere; (b) `notesSpacing.js`'s `num()` is a bare
     `parseFloat`, which strips the `pt` suffix WITHOUT unit conversion, so `num('10pt')` reduces to
     the same `10` the block attr already stores — the two values agree numerically even though the
     conversion itself is wrong (filed separately as **B839841**, a real but unrelated defect — a
     point size renders as if it were a pixel size, everywhere, independent of this bug).
   - **Fractional `devicePixelRatio`** — the owner's actual production numbers (38.924, 35.8503,
     …) carry fractional residue; his panel measures `devicePixelRatio ≈ 2.15` under Windows
     display scaling at ~215%. Setting Playwright's `deviceScaleFactor` to the exact same value
     (2.1500000953674316) and matching his viewport (1600×465, later duplicated at other sizes)
     reproduces the CORRECT `devicePixelRatio` reading but NOT fractional CSS layout metrics —
     `getBoundingClientRect().height` still reads clean integers (39, 75, exactly) in this sandbox.
     `deviceScaleFactor` changes rasterisation resolution, not the OS text/layout stack that
     actually produces sub-pixel metrics; Linux Chromium's FreeType-based layout is a different
     code path from Windows' DirectWrite/ClearType one, and no CDP setting bridges that gap. This
     is a genuine CEILING ON THE INSTRUMENT, not a refutation of the theory — it could not be
     properly tested here at all.
   - **Mount timing** (a React-effect-deps theory raised and tested THIS session, not the owner's):
     that the toolbar element doesn't exist on `NoteEditor`'s first render (`editor` is `null` until
     Tiptap's async init completes), and if `inTable` doesn't change value across that transition,
     the `useLayoutEffect` keyed on `[inTable]` never gets a first chance to measure a "short"
     baseline before the user's first click. Directly instrumented (`applyToolbarDelta`'s own call
     log, timestamped): in this sandbox the baseline is reliably established by the
     `ResizeObserver`'s spec-guaranteed initial callback at ~280–330ms into page life — always
     before a table cell can even exist to be clicked. Raced deliberately (poll every 5ms for the
     cell, fire the drag on the next tick, zero settle) and still never beat it. Ruled out as THIS
     sandbox's mechanism; not provably ruled out on production, where `ResizeObserver` callback
     timing is a browser/OS scheduling detail this sandbox cannot control for.
   - **Gesture type** — tested both a real multi-step drag and a single plain click-in/click-out
     (the owner's own later methodology), full-content documents, scrolled and unscrolled: both
     compensate correctly in this sandbox, both directions, every time.
   - **Baseline/branch mismatch** — the owner's own hypothesis, checked and refuted: the "fully
     symmetric" sandbox result was verified BYTE-IDENTICAL to `49729aa` (the actual PR #1214 merge
     commit — note `c0214d1` is PR #1210/round 1, a DIFFERENT, superseded commit; that SHA got
     conflated with #1214 in several messages this session and is corrected here so it is not
     re-conflated), diffed directly against the round-3 working tree to confirm none of that
     session's accumulator-hardening code was present. The symmetric result was genuinely
     current-production code, not contamination from an in-progress fix.
   **THE STANDING FACT, recorded rather than left implicit: a Linux Chromium sandbox on this exact
   commit shows fully symmetric, fully compensated behaviour (grow AND shrink both correct, every
   variation tried) — full stop. The differentiator is real and lives somewhere this sandbox
   cannot reach: most plausibly the Windows text/layout stack (ClearType/DirectWrite vs FreeType)
   under fractional OS display scaling, though that is inference, not proof — or something not yet
   isolated at all.** Do not re-attempt reproduction here without a genuinely new variable; the list
   above is not partial.
   **INSTRUMENT NOTE: an outside-the-page `ResizeObserver` is NOT a usable diagnostic tool for this
   class of bug.** The owner attached his own `ResizeObserver` to the toolbar from outside (devtools)
   to test whether production's own RO ever fires on the grow, and got total silence — including its
   spec-guaranteed initial callback. Before trusting that as a finding, he ran the identical probe on
   an unrelated page in the same browser and got the same silence: `ResizeObserver` simply does not
   deliver callbacks in whatever context that instrument runs in (devtools console, cross-origin
   isolation, or similar) — an INSTRUMENT LIMITATION, not evidence that production's internal RO is
   silent. Route this class of question through an IN-PAGE hook instead (see below), never an
   attached-from-outside observer.
   **THE ONE THING THAT CAN STILL ANSWER THIS: `lib/notesToolbarDiag.js`** (shipped as its own small,
   flag-off-by-default, behaviour-unchanged PR, deliberately separate from any fix) — records every
   `applyToolbarDelta` call (which of the two mechanisms fired, the heights it saw, whether it
   bailed and why, what it actually applied) to `window.__PLANYR_TOOLBAR_DIAG` when armed via
   `?toolbarDiag=1` on the URL (latches into `sessionStorage`, so the reload the repro itself needs
   does not lose the arming) or `window.__PLANYR_TOOLBAR_DIAG_ARM = true` from the console for an
   already-open tab. Arm it, reproduce the owner's exact Case A (fresh load, caret in a plain
   paragraph, table never touched, one click or drag into it), and read the array back — that
   answers "does the handler never run on grow, or does it run and compute zero" directly, which is
   the one thing neither side's inference has been able to settle.
   **B831600 stays Open, unresolved, nothing about the fix shipped** — see `BACKLOG.md`. Do not mark
   it Done off a sandbox pass; every round so far has been reopened by the owner's own production
   observation after passing every sandbox guard this repo had.
5. **A CUSTOM TIPTAP COMMAND THAT BUILDS ITS OWN `state.tr` INSTEAD OF USING THE ONE HANDED IN
   REPORTS SUCCESS AND DOES NOTHING (B649377).** `editor.commands.x()` (a single, un-chained
   call — what a menu row's `onClick` uses) always dispatches the ONE `tr` it built before
   calling your function; the `dispatch` prop it hands you is a no-op. Destructure `tr` from
   the command's own props and mutate THAT — `state.tr` is a getter that returns a **fresh**
   Transaction every read, so mutating a locally-made one is invisible. Caught it by adding
   `window.__noteEditor.runCommand(name, ...args)` (gated behind `__PLANYR_E2E`, same as every
   other diagnostic hook) and comparing the command's own return value against the stored
   document — a wrong-but-confident `true` is worse than a thrown error.
6. **A RIGHT-CLICK'S CARET PLACEMENT IS ASYNC; READING SELECTION IN THE SAME EVENT SEES THE OLD
   ONE (B649377).** Measured on a plain paragraph, no table involved: the native DOM selection
   moved correctly on `mousedown`, but ProseMirror's own `state.selection` only catches up
   through a `selectionchange` listener that fires **~20 ms after `contextmenu` has already
   run** — so any right-click menu that reads `editor.state.selection`/`isActive(...)` to decide
   what to show (is the caret in a table? in a link?) sees wherever the caret was BEFORE this
   click. Left-click is unaffected (`focusFromMat` places it directly) — this is invisible until
   something that needs to be RIGHT on a right-click actually ships. Fix: resolve the click with
   `editor.view.posAtCoords` and call `setTextSelection` by hand in `onContextMenu`, before
   building the menu — unless the click landed inside the CURRENT selection (Cut/Copy on an
   already-selected phrase must not collapse it).
7. **"NO BODY ON THIS DEVICE" IS NOT PROOF SOMETHING WAS DESTROYED (NEW-2, reopened 2026-08-28).**
   `collectBinFacts`'s `gone` flag (the "permanently deleted and cannot be brought back" copy)
   used to fire on `!anyStored` alone — true both for a page whose body was genuinely purged
   AND for a page created and binned so fast its first autosave never ran, which have NOTHING in
   common except that neither has a body right now. The discriminator is on the TREE, not the
   body: `updatedAt` moves off `createdAt` ONLY through `touchPage`, which (per `Notes.jsx`'s
   `handleSaved`) fires only after a write has actually landed — never on a keystroke. So
   `updatedAt !== createdAt` for at least one page in the cascade is the honest "a write really
   happened here at some point" signal; without it, "empty" is the true state, not "gone". Any
   hand-built test tree that wants to simulate a REAL purge must call `touchPage` itself — a tree
   built only through `addPage`/`writePage` never touches the tree's own timestamps, and reads as
   "never written" under this rule (which is correct: that IS what makes a body absent honest to
   call "empty" rather than "gone").

---

## 6 · Where the rest lives

- `src/workspaces/notes/CLAUDE.md` — the module pointer: every file, and the decision behind it.
  Auto-loads when you work in that folder.
- `CLAUDE.md` → **Engineering rules** — the named rules invoked by name in briefs.
- `ui-audit/` — the harnesses. The systematic one is `sweep-notes.mjs`; **a sweep that reports
  nothing is a failed sweep** and says so in its own output.
