/* ONE Apply + ONE scope for the whole Standards panel (owner rule, this round).
 *
 * What this replaces: a `StandardScope` row rendered under EVERY field — its own Apply chip plus
 * its own Project / All pair, per setting. The owner's words: "I meant to apply all the settings
 * at once, not each individual setting. It's taking up way too much space as is." That stack was
 * most of the panel's height; this is one bar for the whole panel.
 *
 * It lives in a STICKY FOOTER so it stays reachable while the settings list scrolls — you never
 * have to scroll back to find Apply.
 *
 *  · Scope  — where SUBSEQUENT changes are stored: this plan, or every plan on the account. It
 *             does NOT move what is already stored (see derivedPanelScope).
 *  · Apply  — pushes every standard onto what's ALREADY drawn, in ONE undo frame, counted in
 *             distinct objects.
 *
 * Deliberately chips, not prose: every explanation lives in a tooltip, never on screen.
 *
 * MODULE-SCOPE-COMPONENTS: real module-scope components, never redefined inside a render body.
 */

const chipBase = {
  fontFamily: "inherit", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.02em",
  padding: "3px 9px", borderRadius: 999, cursor: "pointer", lineHeight: 1.5,
  border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)",
};

/** One segmented scope chip. `on` = this scope is the one currently in force. */
function ScopeChip({ label, on, title, onClick }) {
  return (
    <button type="button" title={title} aria-pressed={on} onClick={onClick}
      style={{
        ...chipBase,
        borderRadius: 0,
        // Selected state reads through weight + a filled accent, never a faded label (theme rule).
        background: on ? "var(--accent)" : "transparent",
        color: on ? "var(--on-accent)" : "var(--text-secondary)",
        borderColor: on ? "var(--accent)" : "var(--border-default)",
      }}>{label}</button>
  );
}

/**
 * @param scope       "project" | "all" — where a SUBSEQUENT change to any standard is stored
 * @param onScope     (next) => void
 * @param applyCount  how many objects already on the plan an Apply would change (0 → disabled)
 * @param onApply     () => void
 * @param cloudReady  false when the account store isn't reachable (signed out) — "All" then says so
 */
export default function StandardsBar({ scope, onScope, applyCount = 0, onApply, cloudReady = true }) {
  const canApply = applyCount > 0;
  return (
    <div data-testid="standards-bar"
      style={{
        position: "sticky", bottom: 0, zIndex: 2,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
        margin: "10px -13px -24px", padding: "9px 13px 11px",
        background: "var(--surface-raised)", borderTop: "1px solid var(--border-default)",
      }}>
      <span style={{ display: "inline-flex", borderRadius: 999, overflow: "hidden", border: "1px solid var(--border-default)" }}>
        <ScopeChip label="Project" on={scope === "project"}
          title="New objects on THIS plan start from these values" onClick={() => onScope("project")} />
        <ScopeChip label="All" on={scope === "all"}
          title={cloudReady
            ? "New objects on EVERY plan on your account start from these values — follows you between computers"
            : "Sign in to make these defaults across your account — right now they'd only be saved on this computer"}
          onClick={() => onScope("all")} />
      </span>
      <button type="button" data-testid="standards-apply" disabled={!canApply} onClick={canApply ? onApply : undefined}
        title={canApply
          ? `Push every standard onto the ${applyCount} object${applyCount === 1 ? "" : "s"} already on this plan (one undo)`
          : "Nothing to change — everything already matches these standards"}
        style={{
          ...chipBase,
          fontSize: 11.5, padding: "5px 13px",
          color: canApply ? "var(--on-accent)" : "var(--text-tertiary)",
          background: canApply ? "var(--accent)" : "transparent",
          borderColor: canApply ? "var(--accent)" : "var(--border-default)",
          cursor: canApply ? "pointer" : "default",
        }}>
        Apply{applyCount ? ` ${applyCount}` : ""}
      </button>
    </div>
  );
}
