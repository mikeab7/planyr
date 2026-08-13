# B463922 — the Schedule grid throws the edited row off screen. Handoff.

> ## ⛔⛔ REFUTED 2026-08-13 — READ THIS BEFORE ANYTHING BELOW IT.
>
> **The +477 px jump this document reports is the instrument's own scroll.** Everything below was
> written in good faith and the numbers are reproducible to the pixel — but they measure Playwright,
> not the product, and the whole document should be read as the record of a wrong turn.
>
> **The mechanism.** `diagnose-grid-view-anchor.mjs` clicks `[title="Collapse"]` on the FIRST
> rendered row of a **virtualised** grid. A virtualiser renders a buffer of rows **above** the
> viewport, so that toggle sat **75 px off screen**. Every browser driver scrolls a target into view
> before clicking it, through CDP — where a patched `scrollTop` setter cannot see it. So
> **"programmatic scroll writes: 0" was the TELL, not the corroboration.**
>
> | how the SAME collapse was driven | Δ row on screen | ΔscrollTop |
> |---|---|---|
> | this document's click, toggle 75 px **above** the view | **+477 px, off screen** | −501 |
> | `.click()` in page JS on that identical toggle | **−24 px** | 0 |
> | a click on a toggle **inside** the view | **−48 px** | 0 |
>
> A toggle **below** the viewport moved it the other way (+459). Magnitude and sign both follow where
> the target sat. **In a virtualised list, "the first rendered row" is not "a row on screen."**
>
> **Scroll anchoring (§5's best hypothesis) is CLEARED three ways, so do not spend a session on it:**
> `overflow-anchor:none` on the container and every descendant (computed style verified) — unchanged;
> Chromium launched with `--disable-blink-features=ScrollAnchoring` — unchanged; and the positive
> control that makes those mean something — inserting **500 px** above the viewport moved `scrollTop`
> by **exactly 0**, because these rows are absolutely positioned and an out-of-flow box is never an
> anchor candidate. The container was never anchoring, so it could not have lost an anchor.
>
> **§3's conclusion is REVERSED.** The keep-the-selected-row-visible effect is still innocent, but
> "any fix must make that effect ACT on this path" followed from a jump that was not real.
>
> **§7's list of five lies takes a SIXTH, and it is the one that produced this document:** a browser
> driver scrolls to reach an off-screen target, invisibly to every JS-level scroll probe.
>
> **What replaced this:** `ui-audit/verify-grid-row-hold.mjs` (rendered position, ±2 px, every click
> through `lib/visibleClick.mjs`, a model witness AND a selection witness, and a self-test that
> re-proves the gate every run) — plus the two real fixes it found: the collapse triangle no longer
> steals the selection from the cell you are editing, and the row you are working on now holds its
> place on screen when the list re-lays out. See **B463922** in `BACKLOG.md` and **V275056**.
>
> **The owner's own symptom is still unobserved.** Nothing here has ever seen it. It is not closed.


**Status: reproduced and localised; mechanism NOT established; no fix shipped.**
Written so a fresh session can start cold. Read this before touching `GridView`'s scroll behaviour.

---

## 1. The reproduction, exact

**Seed data** (the scheduler's baked fallback — no sign-in needed, this reproduces logged out).

1. Open `public/sequence/` and let the grid boot.
2. Scroll to the middle of the list (`scrollTop ≈ 3351` of `scrollHeight ≈ 6738`).
3. Click the **Task name** cell of a mid-viewport leaf row to select it. In the recorded run this was
   **row 158**, sitting **447 px** below the top of the scroll container.
4. Click the **▾ collapse toggle of the first group above it** (`span[title="Collapse"]`, the first one
   in the DOM).

**Measured result:** the selected row moves to **924 px** — `ΔanchorTop = +477 px` — in a grid whose
visible height is ~900 px, so **the row the user is editing leaves the viewport entirely**.
`scrollTop` moves `3351 → 2850` (−501). **Programmatic scroll writes: zero.**

That is the owner's report — *"sometimes if I am editing cells I will just jump halfway down the
schedule"* — on the quantity his eye actually tracks.

---

## 2. How to run the instrument

```
node ui-audit/diagnose-grid-view-anchor.mjs
```

Vendors the CDN libraries automatically (`ui-audit/lib/vendorCdn.mjs`); no env vars needed.

It measures **the selected row's `getBoundingClientRect().top` relative to the scroll container**,
keyed on the row's **identity** (`data-task-row`), before and after each action.

**Reading the output:**

| line | meaning |
|---|---|
| `*** OFF-SCREEN ***` / `*** JUMPED ***` | a real failure — the row moved on screen |
| `*** LOST FROM VIEW ***` | the row is no longer rendered at all (virtualisation) — also a failure |
| `steady` **with no warning** | a genuine pass: the witness confirms the step changed the model |
| `steady` **+ `⚠ NOTHING CHANGED`** | **worthless** — the step did nothing, so its calm proves nothing |

**A vacuous pass looks exactly like a real one without the witness.** That is why the witness exists.

---

## 3. ⛔ The suspect that is CLEARED, and the measurement that clears it

**Do not re-suspect this.** It cost hours to name and clear, and it is the single most losable fact here.

`GridView`'s keep-the-selected-row-visible effect:

```js
useEffect(() => {
  if (selectedId === null) return;
  const idx = tasks.findIndex(t => t.id === selectedId);
  const rowTop = idx * ROW_H, rowBottom = rowTop + ROW_H;
  const visTop = el.scrollTop + TL_H, visBottom = el.scrollTop + el.clientHeight;
  if (rowTop < visTop)            el.scrollTop = rowTop - TL_H;
  else if (rowBottom > visBottom) el.scrollTop = rowBottom - el.clientHeight;
  …
}, [selectedId, selectedColIdx, tasks]);
```

It was the prime suspect on a good theory: it re-runs on **every** change to `tasks` and chases the
row's **index**, so a re-sort could send the view to an index the row no longer occupies. It is also
the source of the `scrollTop = -6` write seen at the top of the list (the maths goes negative there
and is clamped).

**It made ZERO scroll writes on the path that actually jumps.** It is not scrolling to the wrong
place — it is not scrolling at all. The row is not dragged away by the app; it is **abandoned**.

**Consequence for any fix:** this effect must be made to **act** on this path. A fix written against
the original theory would have *suppressed* it, which is the wrong direction.

---

## 4. The arithmetic that points at the mechanism

`ΔscreenTop = ΔdocumentTop − ΔscrollTop`. Measured: `+477 = ΔdocumentTop − (−501)`, so

> **ΔdocumentTop ≈ −24 px** — the row's own position in the document moved up by about **one row**,
> while the browser scrolled up by **501 px**.

So the collapse removed only ~24 px of content **above** the selected row, yet the view moved 501 px.
The scroll movement is **twenty times larger than the layout change that provoked it.**

---

## 5. The open question, and the best hypothesis — stated AS a hypothesis

**What can move a row 477 px on screen with no programmatic scroll write?** Candidates considered:
virtualisation recycling · a height recalculation · the container re-rendering at a different offset ·
scroll anchoring defeated by a removed anchor node.

**Best candidate, and it is a hypothesis, not a finding: scroll anchoring lost its anchor.**
Chrome picks an anchor node near the top of the viewport and adjusts `scrollTop` to keep it put.
Collapsing a group **removes the very nodes it was anchored to**. It must then re-anchor, and the
re-anchor is what produces a correction wildly out of proportion to the 24 px of content that
actually left above the row. That fits every number: zero app writes, a 501 px scroll against a 24 px
layout change, and only the *collapse* path affected while date and duration edits are clean.

**Test this FIRST, and it is a cheap decisive test:** set `overflow-anchor: none` on the grid's scroll
container and re-run the instrument. If the jump vanishes, anchoring is the cause and the fix is to
own the adjustment explicitly — record the selected row's screen offset before the layout change and
restore it after, in a layout effect, keyed on identity. If the jump **survives**, anchoring is
cleared too and the next candidate is virtualisation recycling: check whether the row's absolute
`top` style and the spacer height are recomputed consistently across a collapse.

---

## 6. What was driven, and what was NOT

**Driven and genuinely clean** (witness confirms the model changed): start-date edit · the same edit
driven far the other way · duration edit. All held the row at **+0 px**.

**Driven and it jumps:** collapse a group above the selected row.

**NOT actually driven — these no-opped and prove nothing** (they need the row re-selected after the
grid re-renders; the harness re-anchors but selection is lost): insert a row · undo the insert ·
indent · outdent · mark complete · Enter · Tab across columns.

**Never attempted at all:** apply/clear a column filter · the re-derive-on-open banner · a second tab
editing the same schedule · undo/redo of a *re-sorting* edit (the undo/redo runs above were vacuous).

---

## 7. ⛔ How the instruments lied — five times, all in the safe-looking direction

Every one of these produced a **confident clean result** that was false. A fresh session inheriting
these harnesses needs the list, because the failure mode is never a crash.

1. **`body > div` only.** The overlay scan missed the successor prompt entirely — it renders inside
   the React tree, not as a body child. Produced a "no bug" on a reproducible bug.
2. **`.slice(0, 60)`.** The prompt detector truncated the text *before* searching it, cutting off the
   very phrase it was looking for. Reported `0 prompts raised` across three routes.
3. **A width filter.** `width > 40` hid a 36 px-wide menu from the overlay enumeration.
4. **Virtualisation.** An off-screen row is removed from the DOM, so "row not found" read as *deleted*
   when it meant *scrolled away* — and it silently poisoned every later step in the run.
5. **Re-anchoring without re-selecting.** After scrolling a lost row back, the harness measured happily
   while every keyboard action no-opped: **7 of 14 paths green by doing nothing.**

Related, same family, elsewhere in the session: a paste test that set `.value` directly and so
bypassed the selection it was meant to test (passed on the broken build), and a `close:[0,0]` route
that passed by never raising a single prompt.

**The rule this yields:** every harness needs a **witness** — an independent check that the action it
just performed actually changed something — or a green result means nothing.

---

## 8. Related, already shipped

- **B443536** — the Owner cell ate the character that opened it (`verify-owner-first-char.mjs`).
- **B456208** — the Owner field now asks before creating a contact (`verify-contact-confirm.mjs`).
- **B463920 / B463921** — the re-opening status menu and the leaked drag-select
  (`verify-grid-overlay-input.mjs`). Both touch `GridView` input handling; neither touches scrolling.
