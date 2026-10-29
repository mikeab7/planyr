/* PartyNameField — a plain text input with a loose-match suggestion dropdown, for the comp
 * form's two party fields (NEW-8; provisional label until the real B# is minted at push time,
 * per /CLAUDE.md's LATE-BIND rule).
 *
 * The list behaviour (Up/Down highlight, Enter, Escape, the visible solid highlight, a11y props) is the app's ONE shared
 * suggestion-list hook (`shared/ui/useListboxNav.js`) — the same one the map toolbar's address field and Food's search use.
 * Only the SOURCE differs: this filters a small array already held in memory, synchronously, on every keystroke
 * (the map toolbar's field drives a debounced, abortable network geocode).
 *
 * NON-NEGOTIABLE: this NEVER forces a match. Selecting a suggestion just fills the input with
 * that exact stored string — it does not validate, normalize, or block anything else typed.
 * There is no <form> here and no onKeyDown Enter side-effect beyond closing the list, so typing
 * a brand-new name and clicking elsewhere (or the Save button) always just works.
 *
 * MODULE-SCOPE-COMPONENTS: defined at module scope.
 */
import { useState } from "react";
import { matchPartyNames } from "../lib/partySuggest.js";
import { useListboxNav } from "../../ui/useListboxNav.js";
import { listboxRowStyle } from "../../ui/listboxNav.js";

const inputStyle = {
  width: "100%", padding: "6px 8px", fontSize: 12.5, borderRadius: 6, fontFamily: "inherit",
  border: "1px solid var(--border-default)", background: "var(--surface-base)", color: "var(--text-primary)",
};

export default function PartyNameField({ label, value, onChange, candidates, listboxId, placeholder = "optional" }) {
  const [open, setOpen] = useState(false);

  const matches = matchPartyNames(value, candidates);

  // ONE shared list behaviour (shared/ui/useListboxNav.js) — identical arrows / Enter / Escape / visible highlight everywhere.
  const nav = useListboxNav({ count: matches.length, open, setOpen, listboxId, onCommit: (i) => commit(matches[i]) });
  const activeIndex = nav.activeIndex;

  const commit = (name) => { onChange(name); setOpen(false); nav.reset(); };

  const handleChange = (e) => {
    onChange(e.target.value);
    nav.reset();
    setOpen(true); // matches recomputed from the new value on next render; harmless if empty
  };

  const handleKeyDown = (e) => {
    if (nav.onKeyDown(e)) return;
    if (e.key === "Enter") setOpen(false); // whatever was typed stands as-is — never forced, never blocked
  };

  return (
    <div style={{ position: "relative", width: 220 }}>
      <input
        {...nav.inputProps}
        aria-label={label}
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (matches.length) setOpen(true); }}
        onBlur={() => { setTimeout(() => setOpen(false), 120); }}
        style={inputStyle}
      />
      {open && matches.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          style={{
            position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 1300,
            margin: 0, padding: 4, listStyle: "none", maxHeight: 160, overflowY: "auto",
            background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: 8,
            boxShadow: "0 8px 24px rgba(0,0,0,0.22)", fontFamily: "inherit",
          }}
        >
          {matches.map((name, i) => (
            <li
              key={name}
              {...nav.optionProps(i)}
              onClick={() => commit(name)}
              style={{
                padding: "6px 8px", fontSize: 12.5, cursor: "pointer", borderRadius: 5,
                color: "var(--text-primary)", ...listboxRowStyle(i === activeIndex),
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}
            >
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
