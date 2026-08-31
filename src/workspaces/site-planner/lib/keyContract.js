/* keyContract — THE PLANNER'S DECLARED KEYBOARD SHORTCUTS, and what each is allowed to do from
 * where (NEW-1).
 *
 * ⛔ WHY A TABLE AND NOT A COMMENT. `SitePlanner.jsx`'s keydown listener is ~75 lines of ordered
 * `if (e.key === …)` branches bound to `window`. Ordering matters there and this file does not
 * touch it — what it adds is the ONE question the handler never asked before running any of them:
 * *does the surface the user is addressing get to fire this key at all?* Every branch is declared
 * here with its scope, and `test/keyContract.test.js` SWEEPS the real handler source and fails the
 * build if a branch tests a key this table does not declare. That is the same shape as
 * `e2e/elementCapabilities.table.js` (a new element type cannot ship without answering every
 * capability) and for the same reason: the reported defect was not one wrong branch, it was a
 * whole class nobody had enumerated.
 *
 * The scope model, the measurement that produced it, and why `<body>` is not an answer are in
 * `shared/keyboard/keyScope.js`. Read that first.
 *
 * ── HOW A SCOPE IS CHOSEN FOR AN ENTRY ──────────────────────────────────────────────────────────
 *   scope: "canvas"  — the drawing must own the keyboard. EVERYTHING that mutates the plan, moves
 *                      a selection, or changes the active tool. This is the default and the safe
 *                      answer; an entry only leaves it with a reason written down.
 *   scope: "app"     — the key means the same thing wherever you are, and firing it from panel
 *                      chrome is what a user expects: Escape (B1125's guaranteed escape hatch),
 *                      undo/redo, and the shortcuts overlay. None of these can destroy work that
 *                      undo cannot return — which is the line, and the reason Delete is not here.
 *
 * ⛔ `mutates: true` IS NOT DECORATION — the refusal hint fires off it, so an entry that mutates
 * the plan and does not say so refuses SILENTLY, which is the failure mode LOUD-FAILURE exists to
 * stop. `test/keyContract.test.js` requires every canvas-scope entry to declare it.
 */
import { SCOPE, focusScope } from "../../../shared/keyboard/keyScope.js";

export { SCOPE, focusScope };

const M = { NONE: "none", MOD: "mod", SHIFT: "shift", ALT: "alt" }; // "mod" = Ctrl on Windows/Linux, ⌘ on Mac

/**
 * Every shortcut the planner's window keydown handler acts on.
 *
 * `keys` are `e.key` values, `codes` are `e.code` values (used where Shift rewrites the character —
 * "]"→"}" — or where a layout emits a dead char, which is why the Arrange chords and Alt+Z match on
 * code). An entry lists whichever its branch actually tests, and the source sweep checks both.
 */
export const KEY_CONTRACT = Object.freeze([
  // ── app-wide ──────────────────────────────────────────────────────────────────────────────────
  { id: "undo", label: "Undo", keys: ["z", "Z"], mod: M.MOD, scope: "app", mutates: true,
    why: "B746/V258 — a range slider has no native browser undo to consume, so this one chord is live there too. It is no longer a special case: CONTROL_CONSUMES below says a slider takes arrows and nothing else, so this falls out of the rule." },
  { id: "redo", label: "Redo", keys: ["y", "Y"], mod: M.MOD, scope: "app", mutates: true,
    why: "Same as undo." },
  { id: "escape", label: "Cancel / close the inspector", keys: ["Escape"], mod: M.NONE, scope: "app", mutates: false, guaranteed: true,
    why: "B1125 — Escape is the GUARANTEED escape hatch; a panel you can get stuck in is the bug it closes. NEW-1 — `guaranteed` makes that literal: FIELD scope (and the TOUCH.FIELD latch, which the owner's Parcels-panel report showed OUTLIVES the control's focus) used to refuse Escape exactly like a typed character. Escape types no character, so refusing it to protect typing buys nothing, and it is the one key a stuck user reaches for — see keyScopeVerdict's `entry.guaranteed` check." },
  { id: "shortcuts", label: "Shortcuts overlay", keys: ["?", "/"], mod: M.NONE, scope: "app", mutates: false,
    why: "A help surface. Reaches nothing." },

  // ── canvas: clipboard & structure ─────────────────────────────────────────────────────────────
  { id: "copy", label: "Copy selection", keys: ["c", "C"], mod: M.MOD, scope: "canvas", mutates: false },
  { id: "cut", label: "Cut selection", keys: ["x", "X"], mod: M.MOD, scope: "canvas", mutates: true },
  { id: "paste", label: "Paste", keys: ["v", "V"], mod: M.MOD, scope: "canvas", mutates: true },
  { id: "duplicate", label: "Duplicate", keys: ["d", "D"], mod: M.MOD, scope: "canvas", mutates: true },
  { id: "group", label: "Group / Ungroup", keys: ["g", "G"], mod: M.MOD, scope: "canvas", mutates: true },
  { id: "arrange", label: "Bring forward / send backward", keys: [], codes: ["BracketRight", "BracketLeft"], mod: M.MOD, scope: "canvas", mutates: true },

  // ── canvas: tools ─────────────────────────────────────────────────────────────────────────────
  { id: "tool-select", label: "Select tool", keys: ["v", "V"], mod: M.NONE, scope: "canvas", mutates: false },
  { id: "tool-marquee", label: "Box-select tool", keys: ["m", "M"], mod: M.NONE, scope: "canvas", mutates: false },
  { id: "toggle-snap", label: "Toggle snap", keys: ["s", "S"], mod: M.NONE, scope: "canvas", mutates: false },
  { id: "tool-callout", label: "Callout tool", keys: ["q", "Q"], mod: M.NONE, scope: "canvas", mutates: false },
  { id: "tool-text", label: "Text tool", keys: ["t", "T"], mod: M.NONE, scope: "canvas", mutates: false },
  { id: "tool-mline", label: "Markup line", keys: ["l", "L"], mod: M.NONE, scope: "canvas", mutates: false },
  { id: "tool-mrect", label: "Markup rectangle", keys: ["r", "R"], mod: M.NONE, scope: "canvas", mutates: false },
  { id: "tool-mellipse", label: "Markup ellipse", keys: ["e", "E"], mod: M.NONE, scope: "canvas", mutates: false },
  { id: "tool-mpolygon", label: "Markup polygon", keys: ["p", "P"], mod: M.SHIFT, scope: "canvas", mutates: false },
  { id: "tool-mpolyline", label: "Markup polyline", keys: ["n", "N"], mod: M.SHIFT, scope: "canvas", mutates: false },
  /* ⛔ NEW-1 — THE ENTRY THIS BUG WAS ABOUT. Every other bare-letter tool shortcut (v/h/m/s/q/t/l/r/e,
   * ⇧P, ⇧N) was declared here; this one was not, and `resolveKeyEntry` returns null for anything the
   * table doesn't know about — which `keyScopeVerdict` then ALWAYS allows through (`if (!entry) return
   * { allow: true, … }`), FIELD scope included. So typing a bare "c" into any text field (a callout,
   * an inline number editor, a plan/project rename box, a search field) never reached the arbitration
   * at all: it skipped straight past the typing guard and armed the Cloud tool mid-keystroke, eating
   * the "c" out of whatever was being typed. Declaring it here is the whole fix — the SitePlanner
   * branch that arms the tool is unchanged, only now `keyScopeVerdict` is asked first, exactly like
   * every other letter. */
  { id: "tool-mcloud", label: "Cloud tool", keys: ["c", "C"], mod: M.NONE, scope: "canvas", mutates: false },
  { id: "hand-pan", label: "Hold to pan", keys: [" "], codes: ["Space"], mod: M.NONE, scope: "canvas", mutates: false },

  // ── canvas: editing ───────────────────────────────────────────────────────────────────────────
  { id: "autosize-text", label: "Autosize text box", keys: [], codes: ["KeyZ"], mod: M.ALT, scope: "canvas", mutates: true },
  { id: "commit", label: "Finish drawing / merge / open inspector", keys: ["Enter"], mod: M.NONE, scope: "canvas", mutates: true },
  { id: "nudge", label: "Nudge selection", keys: ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"], mod: M.NONE, scope: "canvas", mutates: true },
  /* ⛔ THE ENTRY THIS WHOLE FILE IS ABOUT. Backspace is here beside Delete on purpose and must
   * stay: on a MacBook the key labelled "delete" IS Backspace, so dropping it would take the only
   * delete key half this product's users have. The fix is the SCOPE, never the key. */
  { id: "delete", label: "Delete selection", keys: ["Delete", "Backspace"], mod: M.NONE, scope: "canvas", mutates: true, destructive: true },
]);

const modOf = (e) => (e.ctrlKey || e.metaKey ? M.MOD : e.altKey ? M.ALT : e.shiftKey ? M.SHIFT : M.NONE);

/**
 * The entry a key event addresses, or null when the planner declares nothing for it.
 *
 * Order matters exactly as it does in the handler: the modified form of a letter is looked up
 * before its bare form, so ⌘V is "paste" and a bare V is the Select tool.
 */
export function resolveKeyEntry(e) {
  if (!e) return null;
  const mod = modOf(e);
  const hit = (want) => KEY_CONTRACT.find((k) => k.mod === want
    && ((k.keys || []).includes(e.key) || (k.codes || []).includes(e.code)));
  /* Shift is a modifier for two entries and a bare-key companion everywhere else (Shift+Arrow is
   * still a nudge, ⇧? is still the overlay), so a Shift press falls back to the unmodified table. */
  return hit(mod) || (mod === M.SHIFT ? hit(M.NONE) : null);
}

/** Why a refusal happened, in the words the hint and the telemetry both use. */
export const REFUSAL = Object.freeze({
  FIELD: "typing-guard",     // a text field has focus — the key is text
  SLIDER: "slider-guard",    // a range slider has focus and consumes the key itself
  PICKER: "picker-guard",    // a dropdown has focus and consumes the key itself
  CHROME: "panel-scope",     // the panel owns the keyboard; the drawing does not
});

/* ⛔ NEW-1 — WHAT A FOCUSED CONTROL ACTUALLY CONSUMES. A GUARD MAY ONLY REFUSE A KEY THE CONTROL
 * CAN REALLY USE; ANYTHING ELSE IS THE GUARD TAKING A KEY NOBODY WANTED.
 *
 * The owner could not delete a selected area measurement, and this table is the fix. Measured on his
 * own plan, with the measurement selected and its inspector open:
 *
 *     after touching…                       press   focus            result
 *     the Fill opacity SLIDER               Delete  INPUT[range]     ❌ refused ("belongs to the slider")
 *     the Line style DROPDOWN               Delete  SELECT           ❌ refused ("the box you're typing in")
 *     a value row's text box                Delete  INPUT[text]      ✓ correctly refused — you ARE typing
 *     nothing in the panel / a plain button Delete  BUTTON / BODY    ✓ deleted
 *
 * A range input does nothing at all with Delete or Backspace. Neither does a closed `<select>`. So
 * the keys went nowhere, the measurement stayed on the drawing, and the explanation named a text box
 * that did not exist. The old rule was an ALLOW-LIST of exceptions (`allowOnSlider`, added by
 * B746/V258 for undo/redo alone) bolted onto "refuse everything", which is the wrong default: every
 * key a control cannot use has to be added by hand, one bug report at a time.
 *
 * Inverted here. Each control scope declares the SHORT list it genuinely takes, and everything else
 * passes. B746/V258's undo/redo exception is not lost — it stops being an exception, because a
 * slider does not consume ⌘Z under this rule either.
 *
 * ⚠ FIELD IS DELIBERATELY ABSENT AND MUST STAY ABSENT. A text box owns the entire keyboard —
 * letters, arrows, Enter, and above all Delete and Backspace, which is what B464048's guard exists
 * for. Nothing in this change reaches it; the control row above is the proof, re-run every build.
 */
const PRINTABLE_KEY = (k) => typeof k === "string" && k.length === 1;

/** A `<select>` type-aheads on letters, so every bare printable shortcut is genuinely its key. */
const PICKER_TYPEAHEAD = KEY_CONTRACT.filter((k) => k.mod === M.NONE && (k.keys || []).some(PRINTABLE_KEY)).map((k) => k.id);

export const CONTROL_CONSUMES = Object.freeze({
  /* A range input: arrows move the thumb. Home/End/PageUp/PageDown do too, but the planner declares
   * no shortcut on any of them, so there is nothing to refuse. */
  [SCOPE.SLIDER]: Object.freeze(["nudge"]),
  /* A dropdown: arrows change the option, Enter commits it, Space opens it, Escape closes it, and a
   * letter jumps to the option starting with it. */
  [SCOPE.PICKER]: Object.freeze([...new Set(["nudge", "commit", "hand-pan", "escape", ...PICKER_TYPEAHEAD])]),
});

/**
 * May this key fire, given who owns the keyboard?
 *
 * An UNDECLARED key is always allowed through — the handler has no branch for it, so letting it
 * fall through costs nothing, and refusing it here would silently break any branch added before
 * this table learned about it. The build check is what stops that drifting: a branch the table
 * does not declare fails CI rather than failing quietly at runtime.
 */
export function keyScopeVerdict({ entry, scope, fieldEdit = false }) {
  if (!entry) return { allow: true, reason: null, entry: null };
  if (scope === SCOPE.CANVAS) return { allow: true, reason: null, entry };
  /* A focused CONTROL refuses only what it consumes (CONTROL_CONSUMES above) — never the rest. */
  if (scope === SCOPE.SLIDER || scope === SCOPE.PICKER) {
    const takes = CONTROL_CONSUMES[scope] || [];
    return takes.includes(entry.id)
      ? { allow: false, reason: scope === SCOPE.SLIDER ? REFUSAL.SLIDER : REFUSAL.PICKER, entry }
      : { allow: true, reason: null, entry };
  }
  /* ⛔ NEW-1 — A `guaranteed` ENTRY (escape, and ONLY escape) SURVIVES EVEN FIELD SCOPE.
   *
   * The owner: "escape doesnt work on getting out of this parcel editing tool, and theres no
   * clear way out." Reproduced live: the Parcels panel's checkbox/text controls latch
   * `TOUCH.FIELD` in `canvasTouchRef` (shared/keyboard/keyScope.js), and that latch OUTLIVES the
   * control's own focus by design (B1188) — so once he had touched anything in the panel, every
   * later key, Escape included, was judged against a field he may no longer even be looking at.
   * `keyScopeVerdict`'s job here is exactly what it always was — "a text box owns the whole
   * keyboard, you must be able to type" — but Escape types no character, so refusing it protects
   * nothing, and it is the one key a stuck user reaches for. This is NOT a blanket exception:
   * undo/redo/shortcuts stay refused out of FIELD (their scope:"app" alone is not enough, on
   * purpose — Ctrl+Z inside a real text box is that box's own native undo, and it must stay that
   * way), which is why the carve-out is its own declared property rather than `entry.scope ===
   * "app"`. SLIDER/PICKER are unaffected — a PICKER's own Escape-closes-the-dropdown consumption
   * (CONTROL_CONSUMES above) is a deliberate, different, self-resolving case, not a "stuck" one. */
  if (scope === SCOPE.FIELD) {
    if (entry.guaranteed) return { allow: true, reason: null, entry };
    return { allow: false, reason: REFUSAL.FIELD, entry };
  }
  /* CHROME — and the line here is MUTATION, not canvas-ness, which is a correction worth stating.
   *
   * The first cut refused every `scope: "canvas"` entry from chrome. That is over-broad and it
   * showed up immediately: `Shift+P` selects the markup-polygon tool, and a user who has just
   * clicked ANY toolbar button is in chrome scope — so tool letters stopped working until you
   * touched the drawing, for no safety gain at all. (This repo's own ctrl-z spec arms its tool
   * that way, which is how it was caught.)
   *
   * Arming a tool, toggling snap, copying, holding Space to pan: none of these change the plan,
   * none can lose work, and all of them were global before.
   *
   * ⛔ AND THE MUTATING KEYS ARE REFUSED ON `fieldEdit`, NOT ON CHROME-NESS — a second correction,
   * for the mirror-image over-reach. Refusing every mutating key from chrome also killed a
   * legitimate flow this repo has a test for: click the Properties ＋ to add dock zones, press
   * Escape to close the inspector, press Delete to remove the still-selected building. Nothing
   * there was ambiguous and nothing was being typed.
   *
   * `fieldEdit` is the state the owner was actually in: WORKING IN A VALUE ROW. Every arm that
   * destroyed his building began inside the Depth row — typing in it, committing with Enter,
   * abandoning with Escape, nudging with the ▲, tabbing onto that stepper — and it is precisely
   * there that Backspace means "fix this number" and can never mean "delete my building". */
  if (entry.scope === "app" || !entry.mutates) return { allow: true, reason: null, entry };
  return fieldEdit
    ? { allow: false, reason: REFUSAL.CHROME, entry }
    : { allow: true, reason: null, entry };
}

/* ── The refusal has to be AUDIBLE, or it is the old silence wearing a new name ─────────────────
 *
 * B1215's precedent: a Delete swallowed by a focused field used to be a silent no-op, and it read
 * as "delete is broken". A Delete swallowed by the PANEL SCOPE would read identically, so it gets
 * the same treatment — with one difference that matters. The old hint fired once per focused
 * FIELD; this one fires once per EPISODE (one uninterrupted stretch of the panel owning the
 * keyboard), because in chrome scope there may be no field to key it to at all, and a hint per
 * keypress is noise.
 */
export const SCOPE_GUARD_HINT = Object.freeze({
  /* ⛔ NEW-1/B754752 — UNREACHABLE BY CONSTRUCTION, and left that way deliberately (see
   * shouldHintRefusal below). Kept truthy only because SCOPE_GUARD_HINT is asserted complete over
   * every REFUSAL reason; if this ever DOES fire again it must not prescribe pressing Delete on the
   * plan as the remedy — that is a recipe for deleting the selection the user never meant to touch. */
  [REFUSAL.FIELD]: "⚠ Delete went to the box you're typing in — that's normal text editing.",
  [REFUSAL.SLIDER]: "⚠ That key belongs to the slider you're holding. Click the plan first.",
  [REFUSAL.PICKER]: "⚠ That key belongs to the dropdown. Click the plan first.",
  [REFUSAL.CHROME]: "⚠ The keyboard is still on the panel. Click the plan, then press Delete.",
});

/**
 * Should a refusal say something out loud?
 *
 * Only for a key that would have CHANGED the plan, only when there is something selected for it to
 * have changed, and only once per episode — the three conditions that keep this a explanation and
 * not a nag. A refused tool letter stays silent: nothing was lost and nothing looks broken.
 *
 * ⛔ NEW-1/B754752 — A FIELD REFUSAL IS NEVER HINTED, FULL STOP. A focused text field consuming
 * Delete/Backspace is CORRECT behaviour — the user is typing, the keystroke did exactly what it
 * should, and there is nothing to explain. Before this guard, `entry.destructive` (below) forced a
 * hint on EVERY press while typing in a number field, because clearing a value with Ctrl+A+Delete
 * (or Backspace) reads as "a selected element + a destructive key + a refusal" to the rest of this
 * function — which is true of every digit anyone clears before typing a new one. Reproduced live:
 * select a building, open Properties, click into a dimension field, press Delete or Backspace to
 * clear it — a toast fired on every keystroke, telling the user to "click the plan, then press
 * Delete", which is a recipe for deleting the very building they were editing.
 */
export function shouldHintRefusal({ entry, reason, hasSelection, episode, lastHintedEpisode } = {}) {
  if (!entry || !reason) return false;
  if (reason === REFUSAL.FIELD) return false;
  if (!entry.mutates) return false;
  if (!hasSelection) return false;
  /* ⛔ NEW-1 — A DESTRUCTIVE KEY EXPLAINS ITSELF ON *EVERY* PRESS, AND THE ONCE-PER-EPISODE RULE IS
   * EXACTLY WHAT MADE THE OWNER'S REPORT READ AS SILENCE.
   *
   * He said "I was pressing delete on it, and it was not deleting" — pressing, plural. Measured:
   * the FIRST refused Delete showed its hint, and every press after it in the same episode showed
   * NOTHING, because the episode had already been hinted. So the experience of a user who did not
   * catch the first toast is a key that does nothing, repeatedly, in silence — the LOUD-FAILURE
   * violation this hint was added to close, surviving inside the hint's own de-duplication.
   *
   * Repetition is not noise here, it is the signal that the explanation did not land. The
   * once-per-episode rule stays for everything else (a refused tool letter loses nothing and a hint
   * per keypress IS noise there); it is lifted only for the keys that destroy work. */
  if (entry.destructive) return true;
  return episode !== lastHintedEpisode;
}
