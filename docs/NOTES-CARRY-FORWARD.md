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
4. **A SIBLING'S HEIGHT CHANGE SHIFTS CONTENT UNDER AN IN-PROGRESS GESTURE (B649376).** The
   Table toolbar group only renders `{inTable && (...)}`, so the instant the caret enters a
   table the toolbar wraps to an extra row and the sheet below it — the table included — is
   pushed down by that exact delta, mid-drag, under a pointer that has not moved. Measured as
   his *"it just jumps and flashes"*: the native selection never extended across cells at all,
   it stayed collapsed and hopped between wrong text nodes as the content slid out from under
   the drag. **Any conditionally-rendered CHROME sitting above a draggable/scrollable surface
   is a suspect** — grep for `{inX && (` near a toolbar/rail before assuming a drag bug is in
   the drag code itself. Fixed with a `ResizeObserver` folding the measured delta into the
   surface's own `transform` (VIEWPORT-STABLE) — **not `scrollTop`**, which silently no-ops on
   a note too short to have scroll slack (exactly this fixture).
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

---

## 6 · Where the rest lives

- `src/workspaces/notes/CLAUDE.md` — the module pointer: every file, and the decision behind it.
  Auto-loads when you work in that folder.
- `CLAUDE.md` → **Engineering rules** — the named rules invoked by name in briefs.
- `ui-audit/` — the harnesses. The systematic one is `sweep-notes.mjs`; **a sweep that reports
  nothing is a failed sweep** and says so in its own output.
