/* PlaceSearchField — B831779 (NEW-4): the map toolbar's address field, as a live-suggestion
 * combobox. Replaces the old accent-red "Go" pill: typing opens a keyboard-navigable list of
 * PLACES (address / intersection / place) beneath the field; click or Enter commits.
 *
 * MODULE-SCOPE-COMPONENTS: defined at module scope (imported into MapFinder's render, never
 * declared inside it).
 *
 * Non-negotiable behaviours (owner brief, 2026-08-28):
 *  (a) ENTER ALWAYS WORKS, including before suggestions arrive — falls back to geocoding the raw
 *      typed string via `onCommitRaw`. Implemented as: Enter with nothing highlighted in the list
 *      always fires `onCommitRaw(text)`, regardless of whether a fetch is in flight or has ever
 *      completed. There is no code path where Enter does nothing.
 *  (b) Debounced ~250ms, and the in-flight request is ABORTED on every keystroke (this app has a
 *      documented GIS-latency history — a suggestion list lagging behind typing is worse than the
 *      button it replaced).
 *  (c) A quiet return-key glyph at the field's right edge, appearing only once text is typed —
 *      not a button, not accented, a hint. The open list's last row restates it as
 *      `Press ⏎ to search "<typed text>"`.
 *  (d) LOUD-FAILURE: a genuine no-match (both providers answered, neither found anything —
 *      B709696 was exactly a silent version of this) says so, with "Search anyway" and "Drop a
 *      pin here" offered rather than the field just going quiet. A provider OUTAGE is a different
 *      fact and is left to the existing `onCommitRaw` → `geocodeAddress` pipeline's own honest
 *      unavailable-vs-not-found banner, so that distinction is made in exactly one place.
 *  (e) Full combobox a11y: role="combobox", aria-expanded, aria-controls, aria-activedescendant,
 *      a listbox of options, Up/Down to move, Enter to commit, Escape to close and restore the
 *      typed text (the input's value is never rewritten by navigation, so there is nothing to
 *      restore beyond just closing the list).
 */
import { useEffect, useRef, useState } from "react";
import { RADIUS, nestedIn } from "../../../shared/ui/radius.js";
import { suggestPlaces } from "../lib/placeSuggest.js";
import { buildPlaceRows, resolvePlaceEnter, resolvePlaceRowCommit } from "../lib/placeSuggestRows.js";

const DEBOUNCE_MS = 250;

function optionId(base, i) { return `${base}-opt-${i}`; }

export default function PlaceSearchField({
  value, onChange, center, narrow, busy, placeholder, listboxZIndex = 1200,
  onCommit, onCommitRaw, onDropPinHere, dropPinLabel = "Drop a pin here",
}) {
  const [open, setOpen] = useState(false);
  const [results, setResults] = useState([]);
  // 'idle' (nothing fetched / empty box) | 'loading' | 'ready' (>=1 result) | 'nomatch' (reached, 0 hits) | 'unavailable' (reached nothing)
  const [status, setStatus] = useState("idle");
  const [activeIndex, setActiveIndex] = useState(-1);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);
  const reqTokRef = useRef(0);
  const inputRef = useRef(null);
  const listboxId = useRef(`place-suggest-${Math.random().toString(36).slice(2)}`).current;

  const cancelInFlight = () => {
    if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    if (abortRef.current) { abortRef.current.abort(); abortRef.current = null; }
  };

  useEffect(() => () => cancelInFlight(), []);

  const runFetch = (q) => {
    const tok = ++reqTokRef.current;
    const ac = new AbortController();
    abortRef.current = ac;
    setStatus("loading");
    suggestPlaces(q, typeof center === "function" ? center() : center, { signal: ac.signal })
      .then((res) => {
        if (tok !== reqTokRef.current) return; // superseded by a newer keystroke
        setResults(res.results);
        setStatus(res.results.length ? "ready" : (res.reachedAny ? "nomatch" : "unavailable"));
        setActiveIndex(-1);
      })
      .catch((e) => {
        if (e && e.name === "AbortError") return; // a newer request cancelled this one — not a failure
        if (tok !== reqTokRef.current) return;
        setResults([]);
        setStatus("unavailable");
        setActiveIndex(-1);
      });
  };

  const handleChange = (e) => {
    const v = e.target.value;
    onChange(v);
    cancelInFlight();
    setActiveIndex(-1);
    const q = v.trim();
    if (!q) { setOpen(false); setResults([]); setStatus("idle"); return; }
    setOpen(true);
    debounceRef.current = setTimeout(() => runFetch(q), DEBOUNCE_MS);
  };

  // The interactive rows, in the order they render — the pure decision half (placeSuggestRows.js)
  // decides both WHAT shows and what Enter/a click on it DOES, so those rules are provable without
  // a browser.
  const { rows, noMatchNote } = buildPlaceRows(status, results, value);

  const runAction = (action) => {
    if (!action) return;
    if (action.type === "result") onCommit && onCommit(action.hit);
    else if (action.type === "raw") onCommitRaw && onCommitRaw(action.text);
    else if (action.type === "dropPin") onDropPinHere && onDropPinHere();
    setOpen(false);
    setActiveIndex(-1);
  };

  const handleKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      if (!rows.length) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i + 1) % rows.length);
    } else if (e.key === "ArrowUp") {
      if (!rows.length) return;
      e.preventDefault();
      setOpen(true);
      setActiveIndex((i) => (i <= 0 ? rows.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      if (busy) return;
      e.preventDefault();
      // (a) ENTER ALWAYS WORKS: an explicitly-highlighted row wins; otherwise it falls straight
      // through to a raw-text commit, whether or not suggestions have arrived yet.
      runAction(resolvePlaceEnter(rows, activeIndex, value));
    } else if (e.key === "Escape") {
      // The input's value is never rewritten by navigation, so closing IS restoring it.
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  const activeId = activeIndex >= 0 && activeIndex < rows.length ? optionId(listboxId, activeIndex) : undefined;

  return (
    <div style={{ position: "relative", flex: 1, minWidth: narrow ? 60 : 90, maxWidth: 300, height: "100%" }}>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open && rows.length > 0}
        aria-controls={listboxId}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        autoComplete="off"
        style={{
          width: "100%", height: "100%", boxSizing: "border-box",
          padding: value ? "0 24px 0 10px" : "0 10px", background: "transparent", border: "none", outline: "none",
          color: "var(--chrome-text)", fontSize: 13, fontFamily: "inherit",
        }}
        placeholder={placeholder}
        aria-label="Search for an address or place"
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => { if (rows.length) setOpen(true); }}
        onBlur={() => { setTimeout(() => setOpen(false), 120); }}
      />
      {/* (c) — a quiet hint, never a button: appears only once text is typed. mousedown on a row
          below is prevented from stealing focus (so onBlur's timeout is what closes the list,
          giving a click time to land first). */}
      {value && (
        <span aria-hidden="true" style={{
          position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)",
          fontSize: 12, color: "var(--chrome-muted)", pointerEvents: "none", lineHeight: 1,
        }}>⏎</span>
      )}
      {open && rows.length > 0 && (
        <ul
          id={listboxId}
          role="listbox"
          style={{
            position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, minWidth: 260,
            margin: 0, padding: 4, listStyle: "none", zIndex: listboxZIndex,
            background: "var(--surface-overlay)", border: "1px solid var(--chrome-divider)",
            borderRadius: RADIUS.lg, boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
            maxHeight: 280, overflowY: "auto", fontFamily: "inherit",
          }}
        >
          {noMatchNote && (
            <li aria-hidden="true" style={{ padding: "6px 9px", fontSize: 11.5, color: "var(--chrome-muted)" }}>
              {noMatchNote}
            </li>
          )}
          {rows.map((row, i) => (
            <li key={row.kind === "result" ? `${row.hit.lat},${row.hit.lon},${row.hit.label}` : row.kind}
              id={optionId(listboxId, i)} role="option" aria-selected={i === activeIndex}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setActiveIndex(i)}
              onClick={() => runAction(resolvePlaceRowCommit(row))}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "7px 9px", cursor: "pointer",
                borderRadius: nestedIn(RADIUS.lg, 4), fontSize: 12.5, color: "var(--chrome-text)",
                background: i === activeIndex ? "var(--surface-raised)" : "transparent",
              }}
            >
              {row.kind === "result" && <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.hit.label}</span>}
              {row.kind === "raw" && <span style={{ flex: 1, color: "var(--chrome-muted)" }}>Press ⏎ to search &ldquo;{row.text}&rdquo;</span>}
              {row.kind === "searchAnyway" && <span style={{ flex: 1 }}>Search anyway</span>}
              {row.kind === "dropPin" && <span style={{ flex: 1 }}>{dropPinLabel}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
