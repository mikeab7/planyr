/* NumInput — the planner's edit-on-commit number field, extracted from SitePlanner.jsx (B1064 step 1) so the panels
 * moved out of it (YieldDrainagePanels.jsx) and the planner component share ONE definition. @planner-extract */
import { useState, useRef, useEffect, useId } from "react";
import NumberBox, { NUMBOX_INPUT_STYLE } from "../../../shared/ui/NumberBox.jsx";
import { BORDER_1, SURF_RAISED } from "../lib/plannerShared.js";

// A numeric input you can edit freely (clear it, type partial values) — it only
// commits (parse + clamp) on Enter or blur, never live on each keystroke.
// `ariaLabel` names the input for a screen reader (and for a headless check) when it does NOT sit
// behind a visible <Field> label — e.g. the Custom width… entry inside the Road flyout.
/* `boxed` (Building panel v3, NEW-2) draws the field as the shared NumberBox: ONE bordered box holding the value,
 * `unit` and a stacked ▲▼ (when `step` is set). Same commit/clamp/"Using N" logic — only the chrome changes. */
export function NumInput({ value, onCommit, min, max, style, placeholder, step, coarse, ariaLabel, allowClear = false, forceCommit = false, boxed = false, unit: boxUnit, boxWidth, testid, seed, muted = false, syncExternal = false, fill = false }) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  /* The one-line note shown when a commit did not take the number as typed (rounded / clamped).
   * Cleared by the next keystroke — it reports THIS commit, never a stale one. */
  const [altered, setAltered] = useState(null);
  const msgId = useId();
  const editing = useRef(false);
  /* What we last handed to `onCommit`, so the effect below can notice the caller handing back
   * something different. Cleared once compared — it is about ONE commit, never a standing state. */
  const committedRef = useRef(null);
  /* B783280 — `forceCommit` is for a caller whose `value` prop is not true committed model state but
   * a computed DEFAULT shown when nothing has been set yet (the road Properties panel's "Right-of-way
   * (ft)" field defaults to the section's own band total). Without it, typing the exact digits already
   * shown — the realistic case whenever the ROW is meant to equal the modeled section — hits `v !==
   * value` below as false and `onCommit` never fires: a LOUD-FAILURE violation, since the field reads
   * identically either way. `dirtyRef` tracks a real keystroke so an untouched blur still costs
   * nothing; every other caller (whose `value` IS the persisted model value) keeps the old
   * equality-suppression, matching `BandWidthInput`'s identical fix in RoadCrossSectionDialog.jsx. */
  const dirtyRef = useRef(false);
  const fmtNum = (n) => String(Math.round(n * 1000) / 1000);
  /* `syncExternal` (dock-layer Auto fields): after an Enter the box stays focused (`editing` stays true), so a value that then
   * changes from OUTSIDE — the Auto pill handing back the computed number — would never reach the box. A change we did not
   * just commit ourselves (`committedRef` is set only by our own commit) is authoritative and replaces the draft. */
  useEffect(() => { if (!editing.current || (syncExternal && committedRef.current == null)) { setDraft(value == null ? "" : String(value)); dirtyRef.current = false; } }, [value]);
  // Clamp a candidate value the same way for a typed commit AND a stepper nudge: floor at min,
  // ceil at max (default 1e7 bounds the absurd). Reject NaN AND ±Infinity here — parseFloat("1e999")
  // is NOT NaN and Math.max(min, Infinity) stays Infinity, so a min-clamp alone can't catch it; a
  // non-finite value poisons geometry to NaN and persists as null (JSON.stringify(Infinity) === null).
  const clampNum = (n) => {
    if (!Number.isFinite(n)) return null;
    let v = n;
    if (min != null) v = Math.max(min, v);
    return Math.min(max != null ? max : 1e7, v);
  };
  const commit = () => {
    editing.current = false;
    setAltered(null);
    // B901 — an intentionally EMPTIED field is a CLEAR, not a typo: for a field whose caller
    // opted in (allowClear — every call site already null-coalesces its own onCommit), commit
    // null so the value actually clears. Without this branch an empty draft fell into the
    // "unparseable" case below, which SILENTLY REVERTS to the last committed value and never
    // calls onCommit at all — so a field could be typed-into but never cleared via keyboard
    // (backspace / select-all-delete / Delete all did nothing). Every OTHER field (allowClear
    // unset) keeps the exact old revert-on-empty behavior — required geometry fields must never
    // silently go null.
    if (allowClear && draft.trim() === "") {
      setDraft("");
      dirtyRef.current = false;
      if (value != null) onCommit(null);
      return;
    }
    const v = clampNum(parseFloat(draft));
    if (v == null) { setDraft(value == null ? "" : String(value)); return; }
    const wasDirty = dirtyRef.current;
    dirtyRef.current = false;
    /* ⛔ B464051 / LOUD-FAILURE — IF WE CHANGED HIS NUMBER, SAY SO, IN THE MOMENT. Measured on
     * the real inspector before this line existed: type `613.7` into Depth and the field commits
     * 613.7, then re-renders showing **614** — because every dimension call site passes
     * `value={Math.round(...)}`, so the round-trip silently rounds. Type `200000` and `clampNum`
     * silently returns MAX_DIM (100,000). Neither said anything. Silently swapping a developer's
     * dimension for a different one is exactly what LOUD-FAILURE exists to stop, and it is the
     * honest half of the owner's "it's not letting me": sometimes it genuinely was not taking
     * what he typed, it was taking something near it.
     *
     * Reported, never prevented — the clamp and the round are both correct behaviour. */
    const typed = parseFloat(draft);
    const shown = Math.abs(v - typed) > 1e-9 ? v : null;
    setAltered(shown != null ? `Using ${fmtNum(v)}` : null);
    setDraft(String(v));
    committedRef.current = v;
    if (v !== value || (forceCommit && wasDirty)) onCommit(v);
  };
  /* ⛔ B464051, THE OTHER HALF — AND THE FIRST GUESS ABOUT IT WAS WRONG, which is why it is worth
   * writing down. It looked like these fields silently ROUND: every dimension call site passes
   * `value={Math.round(...)}`, so type `613.7` into Depth and 614 is what you see afterwards. The
   * browser measurement says otherwise — the MODEL stores 613.7 exactly; nothing alters the number
   * the user committed. What is rounded is the DISPLAY, so the figure on screen stops being the
   * figure in the drawing, silently. That is a smaller problem than a swapped dimension and a real
   * one all the same, and it deserves the true words rather than the dramatic ones.
   *
   * Detected by watching what the CALLER hands back: we know what we committed, so a `value` that
   * returns different is the display disagreeing with the model, whatever caused it. No call site
   * had to be changed and no rounding was removed — the rounding is deliberate. */
  useEffect(() => {
    if (committedRef.current == null || value == null) return;
    const sent = committedRef.current;
    committedRef.current = null;
    if (Math.abs(value - sent) > 1e-9) setAltered(`Showing ${fmtNum(value)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // B618 — stepper / arrow-key nudge (opt-in via `step`). Nudges about the COMMITTED value
  // (falls back to the current draft when the prop isn't yet a number) so repeated presses never
  // drift, rounds to kill float dust (0.1+0.2 → 0.30000000000000004), and commits immediately.
  const nudge = (d) => {
    if (step == null) return;
    // `seed`: where a stepper starts from when the field is BLANK (e.g. an undesignated right-of-way steps from the section's own width, not from 0).
    const base = Number.isFinite(value) ? value : (parseFloat(draft) || (Number.isFinite(seed) ? seed : 0));
    const v = clampNum(Math.round((base + d) * 1000) / 1000);
    if (v == null) return;
    editing.current = false;
    setAltered(null); // a stepper's own clamp is self-evident; never leave a stale note behind it
    setDraft(String(v));
    if (v !== value) onCommit(v);
  };
  const coarseStep = coarse != null ? coarse : (step != null ? step * 5 : 0);

  /* NEW-1 — IS WHAT IS TYPED ACTUALLY REJECTED? Until now nothing in this control could answer that,
   * and that is half of the owner's report. He said the Depth box "wasn't letting" him enter a value
   * and sent a frame of it outlined in red; driven every way it can be driven — select-all-and-type,
   * clear-with-Backspace-and-type, type-a-partial-and-Tab, type-and-click-away — the field took the
   * value every single time. What he was looking at was the FOCUS ring, which was the app's accent
   * and sat ~14 ΔE00 from its own error colour. So the focus ring moved to blue (src/index.css), and
   * this is the state --danger is now reserved for: a value the control genuinely will not take.
   *
   * ⛔ AN EMPTY FIELD IS NOT AN ERROR. Clearing it is the first half of retyping it, and flagging
   * that instant would recreate the very "it's rejecting me" impression this exists to remove. An
   * empty draft still reverts on blur exactly as before (or clears, for an `allowClear` caller). */
  const parsed = draft.trim() === "" ? null : Number(draft.trim());
  const invalidReason = (() => {
    if (draft.trim() === "") return null;
    if (!Number.isFinite(parsed)) return "Not a number";
    if (min != null && parsed < min) return `Smallest allowed is ${min}`;
    if (max != null && parsed > max) return `Largest allowed is ${max}`;
    return null;
  })();

  /* The one message this control shows: what is WRONG with the value, or what we DID to it.
   * They are mutually exclusive by construction — a rejected draft never commits, so it can never
   * also have been rounded. */
  const note = invalidReason || altered;
  const input = (
    <input style={boxed ? (muted ? { ...NUMBOX_INPUT_STYLE, color: "var(--text-secondary)" } : NUMBOX_INPUT_STYLE) : style} data-numbox-input={boxed ? "1" : undefined} data-muted={muted ? "1" : undefined} data-testid={testid} value={draft} placeholder={placeholder} inputMode="decimal" aria-label={ariaLabel}
      aria-invalid={invalidReason ? "true" : undefined}
      /* ⛔ `aria-describedby`, not `aria-errormessage`: it is universally supported, and it also
       * carries the non-error "Using 614" note, which is not an error message at all. */
      aria-describedby={note ? msgId : undefined}
      onFocus={() => { editing.current = true; }}
      onChange={(e) => { setAltered(null); setDraft(e.target.value); dirtyRef.current = true; }}
      onBlur={commit}
      onKeyDown={(e) => {
        /* NEW-1 — ENTER COMMITS IN PLACE AND KEEPS THE CARET. It used to `blur()`, which is the
         * root of the owner's data loss: focus landed on <body>, the building stayed selected, and
         * his next Backspace deleted it and its eight bonded elements. The keyboard latch refuses
         * that key now whatever happens here, but a field that ejects you on Enter is wrong on its
         * own terms — every spreadsheet and CAD input in the world commits and stays put, and being
         * silently thrown out of the box is half of "it's not letting me input the depth".
         *
         * The value is selected after the commit, so the next digits RETYPE it (you never have to
         * clear it first) and the commit is visible: the number you get back is the one the app
         * took, highlighted. */
        if (e.key === "Enter" || e.key === "Escape") {
          e.preventDefault();
          if (e.key === "Enter") commit(); else setDraft(value == null ? "" : String(value));
          /* Still focused, so we are still editing — `commit()` clears this flag for the blur
           * path, and leaving it cleared would let an incoming `value` change overwrite what the
           * user types next. */
          editing.current = true;
          const el = e.currentTarget;
          requestAnimationFrame(() => { try { el.select(); } catch (_) {} });
        }
        else if (step != null && e.key === "ArrowUp") { e.preventDefault(); nudge(e.shiftKey ? coarseStep : step); }
        else if (step != null && e.key === "ArrowDown") { e.preventDefault(); nudge(-(e.shiftKey ? coarseStep : step)); }
      }}
    />
  );
  /* ⛔ COLOUR IS NEVER THE ONLY CUE — WCAG 1.4.1 (Use of Color), and it is not satisfied by a
   * coloured border, nor by an icon on its own: the user has to be able to tell WHICH field is
   * wrong and WHAT is wrong with it. Before this, Planyr had no invalid state whatsoever, so an
   * unusable value was reported by nothing at all — an accessibility failure independent of the
   * bug that surfaced it. Four signals now, and the colour is the last of them:
   *   1  a short TEXT MESSAGE naming the problem
   *   2  `aria-describedby` tying that message to the input, so a screen reader reads it
   *   3  an icon beside the field (⚠ for a refusal, ✎ for "we adjusted it")
   *   4  the border — heavier AND red, so it differs from focus in weight as well as hue
   * The FOCUS ring is untouched and stays the brand accent: a bare ring with no message means you
   * are simply typing, which is unambiguous once every real error carries words. */
  const glyph = note ? (
    <span data-testid={invalidReason ? "numinput-invalid" : "numinput-altered"} aria-hidden="true"
      style={{ fontSize: 11, lineHeight: 1, color: invalidReason ? "var(--danger-text)" : "var(--text-secondary)", userSelect: "none" }}>
      {invalidReason ? "⚠" : "✎"}
    </span>
  ) : null;

  /* PANEL-BREVITY: ONE short line, and only while there is something to say — the default view of
   * every panel that uses this control is byte-identical to before. */
  const noteLine = note ? (
    <span id={msgId} data-testid="numinput-note" role={invalidReason ? "alert" : "status"}
      style={{ fontSize: 10.5, lineHeight: 1.25, textAlign: "right", maxWidth: 168,
        color: invalidReason ? "var(--danger-text)" : "var(--text-secondary)" }}>
      {glyph} {note}
    </span>
  ) : null;

  /* ⛔ THE WRAPPER IS UNCONDITIONAL, AND THAT IS LOAD-BEARING. The first cut returned the bare row
   * when there was nothing to say and a wrapped column when there was — so the moment a message
   * appeared, React saw a different tree shape at that position, REMOUNTED the <input>, and the
   * field lost focus mid-keystroke. Typing `-5` left `-` in the box and dropped the `5`: a control
   * that genuinely stops accepting input the instant it has something to tell you, which is a
   * crueller version of the very complaint this work started from. Caught by the browser harness,
   * invisible to every unit test. Same family as MODULE-SCOPE-COMPONENTS: keep the tree stable and
   * let the CONTENT change. */
  const stack = (row) => (
    <span data-field-group="1" style={{ display: fill ? "flex" : "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: noteLine ? 3 : 0, ...(fill ? { width: "100%", minWidth: 0 } : null) }}>
      {row}{noteLine}
    </span>
  );

  if (boxed) {
    return stack(
      <NumberBox unit={boxUnit} width={fill ? "100%" : boxWidth} onUp={step != null ? (e) => nudge(e && e.shiftKey ? coarseStep : step) : undefined} onDown={step != null ? (e) => nudge(-(e && e.shiftKey ? coarseStep : step)) : undefined}
        upTitle="Increase (↑ · Shift for a larger step)" downTitle="Decrease (↓ · Shift for a larger step)">
        {input}
      </NumberBox>
    );
  }
  if (step == null) return stack(input);
  // preventDefault on mousedown keeps the input focused so a click nudges rather than firing a
  // blur-commit on a half-typed draft first (same trick as RotationStepper's spinner).
  const spinBtn = {
    width: 18, height: 12, padding: 0, display: "grid", placeItems: "center", fontSize: 9,
    lineHeight: 1, border: BORDER_1, borderRadius: 4,
    background: SURF_RAISED, color: "var(--text-secondary)", cursor: "pointer", fontFamily: "inherit",
  };
  return stack(
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      {input}
      {/* B1215682/NEW-4 (owner iPhone review) — `data-num-stepper` is a plain marker, invisible
          outside the phone sheet: the touch-floor rule above (`min-height`/`min-width:
          var(--control-h-touch)`) bumps EVERY button uniformly, so this 18×12 desktop pair became
          two stacked 44×44 boxes — taller than the 44px input beside them and read as two loose
          buttons rather than a spinner attached to the field. The scoped stylesheet re-lays this
          one marked span into a side-by-side pair sized to the input's own height instead. */}
      <span data-num-stepper="1" style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <button type="button" style={spinBtn} aria-label="Increase" title="Increase (↑ · Shift for a larger step)"
          onMouseDown={(e) => e.preventDefault()} onClick={() => nudge(step)}>▲</button>
        <button type="button" style={spinBtn} aria-label="Decrease" title="Decrease (↓ · Shift for a larger step)"
          onMouseDown={(e) => e.preventDefault()} onClick={() => nudge(-step)}>▼</button>
      </span>
    </span>
  );
}
