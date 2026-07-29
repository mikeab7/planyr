/* The Standards panel footer: THREE named actions, no scope toggle (NEW-2).
 *
 * What this replaces, and why. The first cut paired a `Project | All` segmented control with an
 * `Apply` chip. They look like one axis and are two: the toggle chose WHERE THE VALUE IS STORED,
 * Apply PUSHED IT ONTO OBJECTS ALREADY DRAWN. Read left to right it parsed as "apply to this
 * project or apply to all" — which it never could be, since nothing can retroactively restyle a
 * plan you have not opened. So the toggle is gone and each action says what it does:
 *
 *   · Apply to this plan (N)   — commits the pending edits as this plan's defaults AND pushes
 *                                every standard onto the N objects already drawn, in ONE undo
 *                                frame. The primary action, and the only one that touches
 *                                geometry — so it is the only one with an Undo.
 *   · Save for this plan       — stores the pending edits as this plan's defaults. Nothing drawn
 *                                changes.
 *   · Save for all projects    — stores them as the account defaults, for every plan on every
 *                                computer. Needs a signed-in account; nothing drawn changes.
 *
 * Because "Save for this plan" is explicit, a field edit can no longer silently commit — edits
 * are a pending DRAFT (lib/standardsApply.js). That is a trap unless the draft is visible and
 * reversible, so the footer carries a quiet "Unsaved changes" marker with a Discard beside it.
 *
 * Hierarchy: the primary action is filled; the two Saves are quiet outlined secondaries. (The
 * previous bar had this inverted — the scope chip shouted and Apply was faint grey.)
 *
 * PLACEMENT: this is rendered as a real footer BELOW the panel's scrolling body — a sibling of
 * the scroll container, not a sticky element inside it. The sticky version floated over the
 * settings list and sliced whatever row happened to sit at the bottom of the scrollport in half.
 * As a sibling it spans the panel's full width, reserves its own space, and no row can ever be
 * hidden underneath it at ANY scroll position. The hairline rule + upward shadow are what make
 * it read as chrome rather than a card floating in the list.
 *
 * MODULE-SCOPE-COMPONENTS: real module-scope components, never redefined inside a render body.
 */

const btnBase = {
  fontFamily: "inherit", fontSize: 11, fontWeight: 700, letterSpacing: "0.01em",
  padding: "6px 10px", borderRadius: 999, lineHeight: 1.45, whiteSpace: "nowrap",
  border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)",
  // Each action grows to share its row, so a wrapped row reads as a deliberate button bar
  // rather than a ragged right-aligned stack. The panel is user-resizable, so any width happens.
  flex: "1 1 auto", textAlign: "center",
};

/** A quiet outlined secondary — the two Save actions. */
function SecondaryAction({ label, title, disabled, onClick, testId }) {
  return (
    <button type="button" data-testid={testId} title={title} disabled={disabled}
      onClick={disabled ? undefined : onClick}
      style={{
        ...btnBase,
        color: disabled ? "var(--text-tertiary)" : "var(--text-secondary)",
        cursor: disabled ? "default" : "pointer",
      }}>{label}</button>
  );
}

/**
 * @param dirty       true while the panel holds uncommitted edits
 * @param onDiscard   () => void — throw the pending edits away, back to the stored values
 * @param applyCount  how many objects already on the plan an Apply would change (0 → disabled)
 * @param onApply     () => void — commit the plan defaults AND push them onto what is drawn
 * @param onSavePlan  () => void — store the pending edits as this plan's defaults
 * @param onSaveAll   () => void — store them as the account defaults (every plan)
 * @param cloudReady  false when the account store isn't reachable (signed out) — Save for all
 *                    projects then says so instead of passing a per-computer value off as one
 */
export default function StandardsBar({
  dirty = false, onDiscard, applyCount = 0, onApply, onSavePlan, onSaveAll, cloudReady = true,
}) {
  const canApply = applyCount > 0;
  return (
    <div data-testid="standards-bar"
      style={{
        flex: "none", zIndex: 2,
        display: "flex", flexDirection: "column", alignItems: "stretch", gap: 7,
        padding: "8px 13px 10px",
        background: "var(--surface-raised)",
        borderTop: "1px solid var(--border-default)",
        boxShadow: "0 -6px 14px -10px rgba(0,0,0,0.45)",
      }}>
      {/* The dirty marker gets its own line above the actions, so it never competes with them for
          width. Quiet but never faint — --warn-text is the AA amber this app uses for every
          saving / unsaved / offline label (theme rule). */}
      {dirty && (
      <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span data-testid="standards-dirty" style={{ fontSize: 11, fontWeight: 700, color: "var(--warn-text)", whiteSpace: "nowrap", flex: 1 }}
          title="These edits are not stored yet — choose one of the actions to keep them">● Unsaved changes</span>
        <button type="button" data-testid="standards-discard" onClick={onDiscard}
          title="Throw the pending edits away and go back to the stored values"
          style={{ ...btnBase, flex: "none", fontWeight: 600, padding: "3px 10px", cursor: "pointer" }}>Discard</button>
      </span>
      )}

      {/* The three actions, named outright. They share a row when they fit and wrap onto further
          rows when the panel is narrow — never overflowing or clipping. */}
      <span style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
        <button type="button" data-testid="standards-apply" disabled={!canApply} onClick={canApply ? onApply : undefined}
          title={canApply
            ? `Keep these as this plan's defaults AND restyle the ${applyCount} object${applyCount === 1 ? "" : "s"} already drawn (one undo)`
            : "Nothing already drawn would change — everything matches these standards"}
          style={{
            ...btnBase,
            fontSize: 11.5, padding: "7px 12px",
            color: canApply ? "var(--on-accent)" : "var(--text-tertiary)",
            background: canApply ? "var(--accent)" : "transparent",
            borderColor: canApply ? "var(--accent)" : "var(--border-default)",
            cursor: canApply ? "pointer" : "default",
          }}>
          Apply to this plan{applyCount ? ` (${applyCount})` : ""}
        </button>
        <SecondaryAction testId="standards-save-plan" label="Save for this plan" disabled={!dirty} onClick={onSavePlan}
          title={dirty
            ? "Keep these as the starting values for new objects on THIS plan. Nothing already drawn changes."
            : "Nothing to save — these are already this plan's defaults"} />
        <SecondaryAction testId="standards-save-all" label="Save for all projects" disabled={!cloudReady} onClick={onSaveAll}
          title={cloudReady
            ? "Keep these as the starting values on EVERY plan on your account — follows you between computers. Nothing already drawn changes."
            : "Sign in to make these defaults across your account — right now they'd only be saved on this computer"} />
      </span>
    </div>
  );
}
