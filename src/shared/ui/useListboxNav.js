/* useListboxNav — the hook over listboxNav.js. One highlight state + the keydown handler + the a11y props for a typeahead
 * suggestion list, so every list in the app (map address search, party names, Food restaurant search) behaves identically.
 *
 *   const nav = useListboxNav({ count: rows.length, open, setOpen, onCommit: (i) => pick(rows[i]), listboxId });
 *   <input {...nav.inputProps} onKeyDown={(e) => { if (nav.onKeyDown(e)) return; …own Enter fallback… }} onChange={() => nav.reset()} />
 *   <ul id={listboxId} role="listbox">{rows.map((r, i) => <li {...nav.optionProps(i)} style={{ …, ...listboxRowStyle(i === nav.activeIndex) }} onClick={…} />)}</ul>
 *
 * - The caret never jumps: Up/Down are preventDefault-ed whenever the list has rows.
 * - The highlighted row scrolls into view (nearest edge) when the list scrolls.
 * - Hover and keyboard share ONE highlight. Hover uses mousemove, not mouseenter: a list that scrolls under a stationary pointer
 *   fires mouseenter for the row that slid beneath it and would steal the keyboard highlight.
 * - A mousedown on a row is prevented, so the input keeps focus and its blur-close timer cannot eat the click.
 */
import { useCallback, useEffect, useState } from "react";
import { stepListIndex, listboxKeyAction, listboxOptionId } from "./listboxNav.js";

export function useListboxNav({ count, open, setOpen, onCommit, listboxId }) {
  const [rawIndex, setRawIndex] = useState(-1);
  // The row set shrinks as results change; a stale index past the end reads as "nothing highlighted".
  const activeIndex = rawIndex >= 0 && rawIndex < count ? rawIndex : -1;
  const reset = useCallback(() => setRawIndex(-1), []);

  const onKeyDown = (e) => {
    const action = listboxKeyAction(e, { open, count, active: activeIndex });
    if (!action) return false;
    e.preventDefault();
    if (action === "next" || action === "prev") {
      if (setOpen) setOpen(true);
      setRawIndex((i) => stepListIndex(i < count ? i : -1, action === "next" ? 1 : -1, count));
    } else if (action === "commit") {
      onCommit(activeIndex);
    } else if (action === "close") {
      if (setOpen) setOpen(false);
      setRawIndex(-1);
    }
    return true;
  };

  useEffect(() => {
    if (!open || activeIndex < 0 || typeof document === "undefined") return;
    const el = document.getElementById(listboxOptionId(listboxId, activeIndex));
    if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, listboxId]);

  const showing = !!open && count > 0;
  const inputProps = {
    role: "combobox",
    "aria-expanded": showing,
    "aria-controls": listboxId,
    "aria-activedescendant": showing && activeIndex >= 0 ? listboxOptionId(listboxId, activeIndex) : undefined,
    "aria-autocomplete": "list",
    autoComplete: "off",
  };
  const optionProps = (i) => ({
    id: listboxOptionId(listboxId, i),
    role: "option",
    "aria-selected": i === activeIndex,
    onMouseDown: (e) => e.preventDefault(),
    onMouseMove: () => { if (i !== activeIndex) setRawIndex(i); },
  });

  return { activeIndex, setActiveIndex: setRawIndex, reset, onKeyDown, inputProps, optionProps };
}
