/* PartyNameField — a plain text input with a loose-match suggestion dropdown, for the comp
 * form's two party fields (NEW-8; provisional label until the real B# is minted at push time,
 * per /CLAUDE.md's LATE-BIND rule).
 *
 * DELIBERATE SECOND IMPLEMENTATION of the accessible-combobox pattern — see partySuggest.js's
 * header for why this doesn't reuse the map toolbar's in-flight PlaceSearchField (B831779): that
 * one drives a debounced, abortable network geocode with provider-status states; this one
 * filters a small array already held in memory, synchronously, on every keystroke. Same a11y
 * shape (role="combobox" + a listbox, arrow keys, Enter, Escape), independent implementation.
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

const inputStyle = {
  width: "100%", padding: "6px 8px", fontSize: 12.5, borderRadius: 6, fontFamily: "inherit",
  border: "1px solid var(--border-default)", background: "var(--surface-base)", color: "var(--text-primary)",
};

function optionId(base, i) { return `${base}-opt-${i}`; }

export default function PartyNameField({ label, value, onChange, candidates, listboxId, placeholder = "optional" }) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const matches = matchPartyNames(value, candidates);

  const commit = (name) => { onChange(name); setOpen(false); setActiveIndex(-1); };

  const handleChange = (e) => {
    onChange(e.target.value);
    setActiveIndex(-1);
    setOpen(true); // matches recomputed from the new value on next render; harmless if empty
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      if (!matches.length) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % matches.length);
    } else if (e.key === "ArrowUp") {
      if (!matches.length) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i <= 0 ? matches.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (activeIndex >= 0 && activeIndex < matches.length) {
        e.preventDefault();
        commit(matches[activeIndex]);
      } else {
        setOpen(false); // whatever was typed stands as-is — never forced, never blocked
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const activeId = activeIndex >= 0 && activeIndex < matches.length ? optionId(listboxId, activeIndex) : undefined;

  return (
    <div style={{ position: "relative", width: 220 }}>
      <input
        role="combobox"
        aria-expanded={open && matches.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
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
              id={optionId(listboxId, i)}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => commit(name)}
              style={{
                padding: "6px 8px", fontSize: 12.5, cursor: "pointer", borderRadius: 5,
                color: "var(--text-primary)", background: i === activeIndex ? "var(--hover-menu)" : "transparent",
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
