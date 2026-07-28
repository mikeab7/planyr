/* NEW-3 — the two short controls that sit under a Standards field.
 *
 * Standards used to be one-way: it seeded NEW objects and nothing else. Two separate axes were
 * missing, and they are genuinely different questions:
 *   · Apply  — push this value onto what's ALREADY drawn, right now (retroactive, undoable).
 *   · Scope  — where the DEFAULT for new objects lives: this plan, or every plan on this account.
 *
 * Deliberately chips, not prose: the whole point of the request was that the panel not grow a
 * paragraph per setting. Every explanation lives in the tooltip, never on screen.
 *
 * MODULE-SCOPE-COMPONENTS: real module-scope components, never redefined inside a render body.
 */

const chipBase = {
  fontFamily: "inherit", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.02em",
  padding: "2px 8px", borderRadius: 999, cursor: "pointer", lineHeight: 1.5,
  border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-secondary)",
};

/** One segmented scope chip. `on` = this scope is the one currently in force. */
function ScopeChip({ label, on, title, onClick, disabled }) {
  return (
    <button type="button" title={title} aria-pressed={on} disabled={disabled} onClick={onClick}
      style={{
        ...chipBase,
        borderRadius: 0,
        // Selected state reads through weight + a filled accent, never a faded label (theme rule).
        background: on ? "var(--accent)" : "transparent",
        color: on ? "var(--on-accent)" : "var(--text-secondary)",
        borderColor: on ? "var(--accent)" : "var(--border-default)",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.55 : 1,
      }}>{label}</button>
  );
}

/**
 * @param scope       "project" | "all" | "builtin" — where this standard's value comes from now
 * @param onScope     (next) => void  — "project" or "all"
 * @param applyCount  how many existing objects an Apply would change (0 → chip disabled)
 * @param onApply     () => void
 * @param noun        what Apply acts on, for the tooltip ("parcel", "building")
 * @param cloudReady  false when the account store isn't reachable (signed out) — "All" then says so
 */
export default function StandardScope({ scope, onScope, applyCount = 0, onApply, noun = "item", cloudReady = true, disabled = false }) {
  const canApply = applyCount > 0 && !disabled;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", margin: "1px 2px 9px" }}>
      <button type="button" disabled={!canApply} onClick={canApply ? onApply : undefined}
        title={applyCount
          ? `Apply this to the ${applyCount} ${noun}${applyCount === 1 ? "" : "s"} already on this plan (undoable)`
          : `Nothing to change — every ${noun} already matches`}
        style={{
          ...chipBase,
          color: canApply ? "var(--accent)" : "var(--text-tertiary)",
          borderColor: canApply ? "var(--accent)" : "var(--border-default)",
          cursor: canApply ? "pointer" : "default",
        }}>
        Apply{applyCount ? ` ${applyCount}` : ""}
      </button>
      <span style={{ display: "inline-flex", borderRadius: 999, overflow: "hidden", border: "1px solid var(--border-default)" }}>
        <ScopeChip label="Project" on={scope === "project"} disabled={disabled}
          title="New ones on THIS plan start with this value" onClick={() => onScope("project")} />
        <ScopeChip label="All" on={scope === "all"} disabled={disabled}
          title={cloudReady
            ? "New ones on EVERY plan on your account start with this value — follows you between computers"
            : "Sign in to make this a default across your account — right now it would only be saved on this computer"}
          onClick={() => onScope("all")} />
      </span>
    </div>
  );
}
