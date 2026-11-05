/* CompEntryMobileSheet — the REVIEW-FIRST phone comp sheet (NEW-2, owner-approved from interactive
 * mockups 2026-10-05; replaces the B1091712 transposed layout). Below `MOBILE_BREAKPOINT_PX`
 * (compMobileLayout.js) `CompEntryGrid.jsx` renders this instead of its own horizontal sheet — the
 * desktop table is untouched above the breakpoint.
 *
 * One scrolling column of grouped iOS-Settings-style cards (label left, value right): header card
 * (a Lease|Land|Bldg Sale segmented control + the deal name typed in place — deliberately NO hero
 * number), "Deal" (Location, Tenant/Buyer, Landlord/Seller, Size with its unit INSIDE the value, Price +
 * a derived read-back), "Rent" (lease: one Rate row whose `/mo` and `NNN` are tappable pills, a guessed
 * period shown as a dashed pill; Term with a `mo`/`yr` pill), "Details" (filled extras) + "Add more"
 * (`＋ label` chips), then a sticky footer with a read-back (hidden while empty) and one Save that is
 * never disabled for a missing field — tapping it with a blocker scrolls to and flags the offending row
 * (round 3, 2026-10-19: NEW-1..NEW-11). There is no "Needed to save" section.
 *
 * Shares state and every mutation path with the desktop sheet — `rows` is the SAME lifted array and
 * every edit goes back through CompEntryGrid's `commitRows`/undo stack via `onCommitField` /
 * `onSetToday` / `onResolvePeriod`, so the two layouts can never hold two ideas of what a comp is.
 * `lib/compMobileSheetModel.js` is the pure half (read-back strings, Save copy, term unit).
 *
 * Every value is a real `<input>` mounted at rest (no tap-to-swap editor); the whole row is the tap
 * target (a `<label>` wraps it). MODULE-SCOPE-COMPONENTS: every component here is module scope.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../ui/controls.jsx";
import { RADIUS } from "../../ui/radius.js";
import { FONT_SIZE } from "../../ui/designTokens.js";
import { cellState, TYPE_OPTIONS } from "../lib/compSheetColumns.js";
import { rowStatusText } from "../lib/compMobileLayout.js";
import { compHeadline, draftToComp } from "../lib/comps.js";
import {
  mobileCol, mobilePartyLabels, termToMonths, termForDisplay, termOtherReading, TERM_UNIT_SHORT, flipTermUnit,
  flipPeriod, flipBasis, periodGuessStep, partyNameFallback,
  priceReadback, footerReadback, saveState, saveTapPlan, rowFieldState, hugWidthCh, moreDetailFields, moreFieldHasValue, MORE_AFFIX,
} from "../lib/compMobileSheetModel.js";

const ROW_MIN_H = 48;
const HIT_TARGET = 44;
const JUMP_ROW_H = 60;
const FOOTER_BTN_H = 46;
const VALUE_FS = 15; // design-exempt: deliberate 15px value size — the one thing every row exists to show
const NAME_FS = 18; // design-exempt: deliberate 18px deal name — the one headline on the sheet, typed in place

// Segmented type order on the phone: the owner's order, Lease first.
const TYPE_SEG = ["lease", "land", "building_sale"].map((v) => ({ value: v, label: { lease: "Lease", land: "Land", building_sale: "Bldg Sale" }[v] }));
const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]));
// Term entry unit is remembered for the session (storage is always months).
let sessionTermUnit = "months";

// Placeholder "Add" in the accent colour (so empty rows read as tappable) + the focused-row tint —
// neither expressible as an inline style.
const SHEET_CSS = `
.cm-input::placeholder{color:var(--accent);opacity:1;font-weight:500}
.cm-row:focus-within{background:var(--focus-ring-soft)}
.cm-nudge{background:var(--warn-bg);transition:background .4s}
.cm-name::placeholder{color:var(--text-secondary);opacity:1;font-weight:500}
.cm-name:focus{border-bottom-color:var(--accent) !important}
`;

/** One status dot — a green/amber 6px dot; used by the jump sheet only. */
function StatusDot({ ready }) {
  return (
    <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: RADIUS.pill, background: ready ? "var(--success-text)" : "var(--warn-text)" }} />
  );
}

const rowShellStyle = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  minHeight: ROW_MIN_H, padding: "0 16px", width: "100%", boxSizing: "border-box",
  border: "none", borderBottom: "1px solid var(--border-default)", background: "transparent",
  fontFamily: "inherit", textAlign: "left",
};
const labelStyle = { fontSize: FONT_SIZE.emphasis, fontWeight: 400, color: "var(--text-secondary)", flex: "none" };
const affixStyle = { fontSize: VALUE_FS, fontWeight: 500, color: "var(--text-secondary)", flex: "none" };
const inputStyle = {
  flex: 1, minWidth: 0, textAlign: "right", fontSize: VALUE_FS, fontWeight: 500, fontFamily: "inherit",
  color: "var(--text-primary)", background: "transparent", border: "none", outline: "none", padding: "12px 0",
};
const noteStyle = { padding: "0 16px 10px", marginTop: 0, fontSize: FONT_SIZE.label, color: "var(--text-secondary)", textAlign: "right" };

/** Enter moves to the next input in DOM order (the last one just closes the keyboard). */
function focusNextInput(el) {
  const root = el.closest("[data-comp-entry-mobile]");
  const all = root ? [...root.querySelectorAll("input[data-sheet-input]")] : [];
  const next = all[all.indexOf(el) + 1];
  if (next) next.focus(); else el.blur();
}

const PILL_H = 28;
const SEG_H = 36; // one height for every segmented control in the sheet (type, rate, basis, term, size unit)

/** A segmented toggle (Lease|Land|Bldg Sale, AC|SF).
 * `fill` stretches it to its container with equal-width segments. */
function Segmented({ options, value, onChange, label, warn, fill }) {
  return (
    <span role="group" aria-label={label} style={{
      display: fill ? "flex" : "inline-flex", flex: fill ? "1 1 0%" : "none", minWidth: 0, height: SEG_H, boxSizing: "border-box",
      borderRadius: RADIUS.sm, overflow: "hidden",
      border: `1px solid ${warn ? "var(--warn-border)" : "var(--border-strong)"}`,
      background: warn ? "var(--warn-bg)" : "transparent",
    }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button key={o.value} type="button" aria-pressed={on} data-seg-value={o.value}
            onClick={() => onChange(o.value)}
            style={{
              border: "none", padding: "0 10px", height: "100%", flex: fill ? "1 1 0%" : "none", fontFamily: "inherit", cursor: "pointer",
              fontSize: FONT_SIZE.control, fontWeight: on ? 700 : 500, whiteSpace: "nowrap",
              background: on ? "var(--accent)" : "transparent", color: on ? "var(--on-accent)" : "var(--text-primary)",
            }}>
            {o.label}
          </button>
        );
      })}
    </span>
  );
}

/** A small tappable pill that flips a two-state value in place (`/mo`↔`/yr`, `NNN`↔`Gross`, `mo`↔`yr`).
 * `tone`: `solid` (the person's choice) · `guess` (dashed, soft amber — a guess they can overrule) ·
 * `warn` (nothing picked yet). The value always reads as text, so the state never rides on colour alone. */
function Pill({ label, onClick, tone = "solid", ariaLabel, dataPill }) {
  const tones = {
    solid: { border: "1px solid var(--border-strong)", background: "var(--focus-ring-soft)", color: "var(--accent)" },
    guess: { border: "1px dashed var(--warn-border)", background: "var(--warn-bg)", color: "var(--warn-text)" },
    warn: { border: "1px solid var(--warn-border)", background: "var(--warn-bg)", color: "var(--warn-text)" },
  };
  return (
    <button type="button" data-pill={dataPill} data-pill-tone={tone} aria-label={ariaLabel}
      onClick={(e) => { e.preventDefault(); onClick(); }}
      style={{ flex: "none", height: PILL_H, padding: "0 10px", borderRadius: RADIUS.pill, fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, whiteSpace: "nowrap", cursor: "pointer", marginLeft: 4, ...tones[tone] }}>
      {label}
    </button>
  );
}

/** One editable field row — a REAL input mounted at rest. `prefix`/`suffix` render only once the
 * input has a value or focus. `display`/`toCommit` let Term show + commit in its chosen unit. */
function InputRow({ col, label, draft, onCommit, prefix, suffix, trailing, trailingIfValue, display, toCommit, autoFocus, onAutoFocused, today, nudge }) {
  const st = rowFieldState(cellState(col, draft));
  const numeric = col.kind === "number";
  const shownRaw = display ? display(col.getValue(draft)) : (st.raw ?? "");
  const shownRest = display ? display(col.getValue(draft)) : st.text;
  const [focused, setFocused] = useState(false);
  const [val, setVal] = useState(shownRaw);
  const ref = useRef(null);
  useEffect(() => { if (!focused) setVal(shownRaw); }, [shownRaw, focused]);
  // Layout effect (not passive): focus inside the tap's own task so iOS Safari raises the keyboard.
  useLayoutEffect(() => { if (autoFocus) { ref.current?.focus(); onAutoFocused?.(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (st.state === "derived") { // read-only ONLY when the triangle really derived a number (never a bare dash)
    return (
      <div data-field-key={col.key} data-field-editor="readonly" style={rowShellStyle}>
        <span style={labelStyle}>{label}</span>
        <span style={{ ...affixStyle, color: "var(--text-secondary)" }}>{st.text}</span>
      </div>
    );
  }
  const hasValue = (focused ? val : shownRest) !== "";
  const hug = !!(prefix || suffix || trailing);
  const showTrailing = trailing && (!trailingIfValue || hasValue); // value + its unit read as one unit at the right edge
  const commit = () => {
    setFocused(false);
    if (val === shownRaw) return;
    onCommit(col, toCommit ? toCommit(val) : val);
  };
  return (
    <label className={nudge ? "cm-row cm-nudge" : "cm-row"} data-field-key={col.key} data-field-editor="text" style={{ ...rowShellStyle, cursor: "text" }}>
      <span style={labelStyle}>{label}</span>
      <span style={{ display: "flex", alignItems: "center", gap: hug ? 2 : 6, flex: 1, minWidth: 0, justifyContent: "flex-end" }}>
        {today}
        {prefix && hasValue && <span style={affixStyle}>{prefix}</span>}
        <input
          ref={ref}
          className="cm-input"
          data-sheet-input=""
          value={focused ? val : shownRest}
          onFocus={() => { setFocused(true); setVal(shownRaw); }}
          onChange={(e) => setVal(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); focusNextInput(e.currentTarget); }
            else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setVal(shownRaw); e.currentTarget.blur(); }
          }}
          inputMode={numeric ? "decimal" : "text"}
          enterKeyHint="next"
          aria-label={label}
          placeholder="Add"
          style={hug ? { ...inputStyle, flex: "0 1 auto", width: `${hugWidthCh(focused ? val : shownRest)}ch`, minWidth: "3ch", maxWidth: "100%" } : inputStyle}
        />
        {suffix && hasValue && <span style={affixStyle}>{suffix}</span>}
        {showTrailing ? trailing : null}
      </span>
    </label>
  );
}

/** The header's deal name — a typeable field (gray placeholder, a thin underline that turns accent on
 * focus, dark text once typed). Blank + a Tenant/Buyer entered → a quiet `Will save as "…"` hint; the
 * name itself is only filled in at save time (`withTitleFallback`), never while typing. Commits on blur /
 * Enter like InputRow. */
function DealNameField({ col, draft, onCommit }) {
  const stored = col.getValue(draft) ?? "";
  const [focused, setFocused] = useState(false);
  const [val, setVal] = useState(stored);
  useEffect(() => { if (!focused) setVal(stored); }, [stored, focused]);
  const commit = () => { setFocused(false); if (val !== stored) onCommit(col, val); };
  const party = partyNameFallback(draft);
  const shown = focused ? val : stored;
  return (
    <div style={{ padding: "6px 16px 12px" }}>
      <input
        className="cm-input cm-name" data-sheet-input="" data-deal-name="1" data-field-key="title"
        value={shown}
        onFocus={() => { setFocused(true); setVal(stored); }}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); focusNextInput(e.currentTarget); }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setVal(stored); e.currentTarget.blur(); }
        }}
        enterKeyHint="next" aria-label="Deal name" placeholder="Add a deal name"
        style={{ ...inputStyle, flex: "none", width: "100%", boxSizing: "border-box", textAlign: "left", fontSize: NAME_FS, fontWeight: 700, padding: "8px 0 6px", borderBottom: "1px solid var(--border-strong)" }}
      />
      {!shown.trim() && party && (
        <div data-hint="name-fallback" style={{ marginTop: 6, fontSize: FONT_SIZE.label, color: "var(--text-secondary)" }}>Will save as “{party}”</div>
      )}
    </div>
  );
}

/** The Location row — an action, never typed text. Unplaced: `Place on map ›` in accent; placed: the
 * resolved location in plain text (the words "Place on map" are gone). */
function LocationRow({ placed, locationText, onTap, nudge }) {
  return (
    <button className={nudge ? "cm-nudge" : undefined} data-field-key="location" data-field-editor="action" onClick={onTap} style={{ ...rowShellStyle, cursor: "pointer" }}>
      <span style={labelStyle}>Location</span>
      {placed ? (
        <span style={{ fontSize: VALUE_FS, fontWeight: 500, color: "var(--text-primary)", textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {locationText || "Placed"}
        </span>
      ) : (
        <span style={{ fontSize: VALUE_FS, fontWeight: 600, color: "var(--accent)", display: "inline-flex", alignItems: "center", gap: 4 }}>
          Place on map <span aria-hidden="true">›</span>
        </span>
      )}
    </button>
  );
}

function Group({ title, children }) {
  return (
    <div style={{ margin: "14px 12px 0" }}>
      {title && (
        <div style={{ padding: "0 16px 6px", fontSize: FONT_SIZE.micro, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-tertiary)" }}>
          {title}
        </div>
      )}
      <div style={{ borderRadius: RADIUS.lg, border: "1px solid var(--border-default)", background: "var(--surface-raised)", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}

/** The jump sheet — tapping the title opens this: the whole batch at a glance. */
function JumpSheet({ rows, currentIndex, overlaysById, locationCellText, rowIsReady, onPick, onClose }) {
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 2700, display: "flex", flexDirection: "column", background: "var(--surface-page)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px", borderBottom: "1px solid var(--border-default)" }}>
        <span style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700 }}>{rows.length} comp{rows.length === 1 ? "" : "s"}</span>
        <Button size="sm" onClick={onClose}>Done</Button>
      </div>
      <div style={{ flex: 1, overflowY: "auto" }}>
        {rows.map((row, i) => {
          const locationText = locationCellText(row, overlaysById);
          const comp = draftToComp(row.draft);
          return (
            <button
              key={row._id}
              onClick={() => onPick(i)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%", minHeight: JUMP_ROW_H,
                padding: "0 16px", border: "none", borderBottom: "1px solid var(--border-default)",
                background: i === currentIndex ? "var(--hover-menu)" : "transparent", cursor: "pointer",
                fontFamily: "inherit", textAlign: "left",
              }}>
              <StatusDot ready={rowIsReady(row)} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: FONT_SIZE.control, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {locationText || row.draft.title || "Untitled comp"}
                </div>
                <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginTop: 2 }}>
                  {TYPE_LABEL[row.draft.compType] || row.draft.compType} · {rowStatusText(row)}
                </div>
              </span>
              <span style={{
                // The jump sheet's headline rate is the one number each row exists to surface at a glance.
                fontSize: 19, // design-exempt: deliberate 19px headline number, see comment above
                fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-primary)", flex: "none",
              }}>
                {compHeadline(comp)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TopBar({ title, onCancel, onTitle, onPaste, pasteOpen }) {
  const btn = { border: "none", background: "transparent", color: "var(--accent)", fontFamily: "inherit", fontSize: FONT_SIZE.emphasis, cursor: "pointer", minHeight: HIT_TARGET, padding: "0 6px" };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", alignItems: "center", padding: "2px 10px", borderBottom: "1px solid var(--border-default)" }}>
      <button onClick={onCancel} style={{ ...btn, justifySelf: "start", fontWeight: 500 }}>Cancel</button>
      {onTitle ? (
        <button onClick={onTitle} aria-label="Jump to a comp" style={{ ...btn, color: "var(--text-primary)", fontWeight: 700 }}>{title} <span aria-hidden="true">⌄</span></button>
      ) : (
        <span style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700, color: "var(--text-primary)" }}>{title}</span>
      )}
      <button onClick={onPaste} aria-expanded={pasteOpen} style={{ ...btn, justifySelf: "end", fontWeight: 600 }}>＋ Paste</button>
    </div>
  );
}

export default function CompEntryMobileSheet({
  rows, overlaysById, locationCellText, onCommitField, onSetToday, onResolvePeriod,
  armedRowId, onArm, onFocusAnchor, onSave, onCancel, saving, saveError, readyRows, rowIsReady,
  pasteBox,
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [termUnit, setTermUnitState] = useState(sessionTermUnit);
  const [added, setAdded] = useState({});       // `${rowId}:${key}` -> true (a chip the user mounted)
  const [focusKey, setFocusKey] = useState(null);
  const [guessed, setGuessed] = useState({});     // rowId -> true while the rate period is a GUESS (NEW-4)
  const [locked, setLocked] = useState({});       // rowId -> true once the person tapped the period pill
  const [pendingNudge, setPendingNudge] = useState(null); // a Save tap's route to the first not-ready row
  const [nudge, setNudge] = useState(null);
  const [flash, setFlash] = useState(false);
  const prevLen = useRef(rows.length);

  const setTermUnit = (u) => { sessionTermUnit = u; setTermUnitState(u); };

  // NEW-4 — pre-pick a period from the rate (under 2 monthly, over 3 yearly, else stay unpicked) as a
  // VISIBLE guess. One row per pass (each commit rebuilds the lifted `rows`, so a second commit in the
  // same pass would overwrite the first); the effect re-runs on the rows it just changed.
  useEffect(() => {
    for (const r of rows) {
      if (r.draft.compType !== "lease") continue;
      const step = periodGuessStep({ rate: r.draft.leaseRate, period: r.draft.leaseRatePeriod, guessed: !!guessed[r._id], locked: !!locked[r._id] });
      if (!step) continue;
      if (step.period && r.cellFlags?.leaseRatePeriod?.level === "blocking") onResolvePeriod(r._id, step.period);
      else onCommitField(r._id, mobileCol("leaseRatePeriod"), step.period);
      setGuessed((g) => ({ ...g, [r._id]: step.guessed }));
      return;
    }
  }, [rows, guessed, locked]); // eslint-disable-line react-hooks/exhaustive-deps

  // NEW-9 — after a Save tap with a blocker, go to the first not-ready row once any rows that did save
  // have left the list, then scroll its offending field into view and flash it.
  useEffect(() => {
    if (!pendingNudge) return;
    const { target, savedIds } = pendingNudge;
    if (saving && savedIds.length) return;
    const idx = rows.findIndex((r) => r._id === target.rowId);
    if (idx < 0) { setPendingNudge(null); return; }
    setCurrentIndex(idx);
    setNudge(target);
    setPendingNudge(null);
  }, [pendingNudge, rows, saving]);
  useEffect(() => {
    if (!nudge) return undefined;
    setFlash(true);
    const raf = requestAnimationFrame(() => {
      const el = nudge.key && document.querySelector(`[data-comp-entry-mobile] [data-field-key="${nudge.key}"]`);
      el?.scrollIntoView?.({ block: "center", behavior: "smooth" });
    });
    const t = setTimeout(() => setFlash(false), 1600);
    return () => { cancelAnimationFrame(raf); clearTimeout(t); };
  }, [nudge]);

  useEffect(() => {
    setCurrentIndex((i) => Math.max(0, Math.min(i, rows.length - 1)));
  }, [rows.length]);

  // A paste that lands rows closes the paste panel (the list then shows the parsed row).
  useEffect(() => {
    if (rows.length > prevLen.current) setPasteOpen(false);
    prevLen.current = rows.length;
  }, [rows.length]);

  const currentRow = rows[currentIndex] || null;

  // Arming the map for a pick has nowhere to go on a phone if this sheet stays full-screen — MINIMIZE
  // it to a slim banner while the CURRENT row is armed, restore the instant it is disarmed.
  useEffect(() => {
    if (armedRowId && currentRow && armedRowId === currentRow._id) setMinimized(true);
    else if (!armedRowId) setMinimized(false);
  }, [armedRowId, currentRow]);

  const showPaste = pasteOpen || rows.length === 0;
  const save = saveState({ rows, readyCount: readyRows.length, saving });

  if (!currentRow) {
    return (
      <div data-comp-entry-mobile="1" style={{ position: "fixed", inset: 0, zIndex: 2600, display: "flex", flexDirection: "column", background: "var(--surface-page)" }}>
        <style>{SHEET_CSS}</style>
        <TopBar title="New comp" onCancel={onCancel} onPaste={() => {}} pasteOpen />
        {pasteBox}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>
          Paste a comp above to get started.
        </div>
        <div style={{ borderTop: "1px solid var(--border-default)", background: "var(--surface-raised)", padding: "8px 16px 10px" }}>
          <button disabled style={saveBtnStyle(true)}>{save.label}</button>
        </div>
      </div>
    );
  }

  const draft = currentRow.draft;
  const compType = draft.compType;
  const locationText = locationCellText(currentRow, overlaysById);
  const placed = !!draft.anchor; // a pending reverse-geocode still counts as placed — never "Place on map"
  const isLease = compType === "lease";
  const isLand = compType === "land";
  const parties = mobilePartyLabels(compType);
  const flag = currentRow.cellFlags?.leaseRatePeriod;
  const periodBlocking = isLease && flag?.level === "blocking";
  const hasRate = isLease && draft.leaseRate !== "" && draft.leaseRate != null;
  const periodMissing = hasRate && !draft.leaseRatePeriod;
  const periodGuessed = hasRate && !!draft.leaseRatePeriod && !!guessed[currentRow._id] && !locked[currentRow._id];
  const periodTone = periodMissing ? "warn" : periodGuessed ? "guess" : "solid";
  const periodLabel = draft.leaseRatePeriod === "monthly" ? "/mo" : draft.leaseRatePeriod === "annual" ? "/yr" : "/mo or /yr?";
  const nudged = nudge && nudge.rowId === currentRow._id ? nudge : null;
  const nudgeOn = (kind) => !!(nudged && flash && nudged.kind === kind);
  const onSaveTap = () => {
    const plan = saveTapPlan({ rows, isReady: rowIsReady });
    if (plan.toSave.length) onSave(plan.toSave);
    if (plan.target) setPendingNudge({ target: { ...plan.target, tick: Date.now() }, savedIds: plan.toSave.map((r) => r._id) });
  };
  const tapPeriod = () => {
    const next = flipPeriod(draft.leaseRatePeriod);
    setLocked((l) => ({ ...l, [currentRow._id]: true }));
    setGuessed((g) => ({ ...g, [currentRow._id]: false }));
    if (periodBlocking) onResolvePeriod(currentRow._id, next); else commit(cl("leaseRatePeriod"), next);
  };

  const commit = (col, v) => onCommitField(currentRow._id, col, v);
  const onLocationTap = () => {
    if (draft.anchor) onFocusAnchor(draft.anchor);
    else onArm(currentRow._id);
  };
  const cl = (k) => mobileCol(k);
  const price = priceReadback(draft);
  const termCol = cl("leaseTerm");
  const termMonths = isLease ? termCol.getValue(draft) : "";
  const termReading = termOtherReading(termMonths, termUnit);
  const more = moreDetailFields(compType);
  const shownMore = more.filter((m) => moreFieldHasValue(m.col, draft) || added[`${currentRow._id}:${m.col.key}`]);
  const chips = more.filter((m) => !shownMore.includes(m));
  const common = { draft, onCommit: commit };
  const readback = footerReadback(draft);
  const showBlockerLine = nudged && (nudged.kind === "flag" || nudged.kind === "other") && !rowIsReady(currentRow);

  if (minimized) {
    return (
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 2700,
        background: "var(--warn-bg)", borderTop: "1px solid var(--warn-border)",
        padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8,
      }}>
        <span style={{ fontSize: FONT_SIZE.control, color: "var(--warn-text)" }}>
          Tap the map to drop the pin for {locationText || draft.title || "this comp"} — or tap <strong>Comp from parcel</strong> on the map toolbar.
        </span>
        <button onClick={() => onArm(null)} style={{ alignSelf: "flex-start", border: "none", background: "none", color: "var(--warn-text)", textDecoration: "underline", fontFamily: "inherit", fontSize: FONT_SIZE.label, cursor: "pointer", padding: 0 }}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div data-comp-entry-mobile="1" style={{ position: "fixed", inset: 0, zIndex: 2600, display: "flex", flexDirection: "column", background: "var(--surface-page)" }}>
      <style>{SHEET_CSS}</style>
      <TopBar
        title={rows.length > 1 ? `Comp ${currentIndex + 1} of ${rows.length}` : "New comp"}
        onCancel={onCancel}
        onTitle={rows.length > 1 ? () => setJumpOpen(true) : null}
        onPaste={() => setPasteOpen((v) => !v)}
        pasteOpen={showPaste}
      />

      {showPaste && (
        <div data-paste-panel="1" style={{ flex: "none", maxHeight: "60%", overflowY: "auto", borderBottom: "1px solid var(--border-default)", background: "var(--surface-raised)" }}>
          {pasteBox}
          <div style={{ padding: "0 14px 10px", display: "flex", justifyContent: "flex-end" }}>
            <Button size="sm" onClick={() => setPasteOpen(false)}>Done</Button>
          </div>
        </div>
      )}

      <div style={{ flex: 1, overflowY: "auto", paddingBottom: 16 }}>
        {/* HEADER CARD — type switch + the deal name, typed in place. Never a hero number. */}
        <Group>
          <div style={{ padding: "12px 16px 0", display: "flex" }}>
            <Segmented fill label="Comp type" value={compType} options={TYPE_SEG}
              onChange={(v) => commit(cl("compType"), v)} />
          </div>
          <DealNameField col={cl("title")} draft={draft} onCommit={commit} />
        </Group>

        <Group title="Deal">
          <LocationRow placed={placed} locationText={locationText} onTap={onLocationTap} nudge={nudgeOn("location")} />
          {!placed && nudged?.kind === "location" && (
            <button type="button" data-hint="location-warn" onClick={onLocationTap}
              style={{ ...noteStyle, display: "block", width: "100%", boxSizing: "border-box", border: "none", background: "transparent", fontFamily: "inherit", cursor: "pointer", color: "var(--warn-text)", paddingTop: 8 }}>
              Place it on the map to save.
            </button>
          )}
          <InputRow {...common} col={cl("partyAcquirer")} label={parties.acquirer} />
          <InputRow {...common} col={cl("partyProvider")} label={parties.provider} />
          <InputRow
            {...common} col={cl("size")} label="Size"
            suffix={isLand ? null : "SF"}
            trailing={isLand ? (
              <Segmented label="Size unit" value={draft.landSizeUnit === "ac" ? "ac" : "sf"}
                options={[{ value: "ac", label: "AC" }, { value: "sf", label: "SF" }]}
                onChange={(v) => commit(cl("landSizeUnit"), v)} />
            ) : null}
          />
          {!isLease && <InputRow {...common} col={cl("price")} label="Price" prefix="$" />}
          {!isLease && price && <div data-readback="price" style={noteStyle}>{price}</div>}
        </Group>

        {isLease && (
          <Group title="Rent">
            <InputRow
              {...common} col={cl("leaseRate")} label="Rate" prefix="$" suffix="/SF" nudge={nudgeOn("period")}
              trailingIfValue
              trailing={(
                <>
                  <Pill dataPill="period" ariaLabel="Rate period" label={periodLabel} tone={periodTone} onClick={tapPeriod} />
                  <Pill dataPill="basis" ariaLabel="Rate basis" label={draft.leaseRateExpense === "gross" ? "Gross" : "NNN"}
                    onClick={() => commit(cl("leaseRateExpense"), flipBasis(draft.leaseRateExpense))} />
                </>
              )}
            />
            {periodMissing && (
              <div data-hint="period-warn" style={{ ...noteStyle, color: "var(--warn-text)" }}>Monthly or yearly? They differ by 12x.</div>
            )}
            {periodGuessed && (
              <div data-hint="period-guess" style={noteStyle}>
                Guessed {draft.leaseRatePeriod === "monthly" ? "monthly" : "yearly"} from the rate. Tap {periodLabel} to change.
              </div>
            )}
            <InputRow
              {...common} col={termCol} label="Term"
              display={(m) => termForDisplay(m, termUnit)}
              toCommit={(v) => termToMonths(v, termUnit)}
              trailingIfValue
              trailing={<Pill dataPill="term-unit" ariaLabel="Term unit" label={TERM_UNIT_SHORT[termUnit]} onClick={() => setTermUnit(flipTermUnit(termUnit))} />}
            />
            {termReading && <div data-readback="term" style={noteStyle}>{termReading}</div>}
          </Group>
        )}

        {shownMore.length > 0 && (
          <Group title="Details">
            {shownMore.map((m) => {
              const aff = MORE_AFFIX[m.col.key] || {};
              return (
                <InputRow
                  key={`${currentRow._id}:${m.col.key}`} {...common} col={m.col} label={m.label}
                  prefix={aff.prefix} suffix={aff.suffix}
                  autoFocus={focusKey === m.col.key} onAutoFocused={() => setFocusKey(null)}
                  today={m.col.key === "compDate" ? (
                    <button type="button" onClick={(e) => { e.preventDefault(); onSetToday(currentIndex); }}
                      style={{ flex: "none", border: "none", borderRadius: RADIUS.sm, padding: "3px 8px", background: "var(--focus-ring-soft)", color: "var(--accent)", fontSize: FONT_SIZE.control, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
                      Today
                    </button>
                  ) : null}
                />
              );
            })}
          </Group>
        )}

        {chips.length > 0 && (
          <Group title="Add more">
            <div style={{ padding: "10px 16px 12px", display: "flex", flexWrap: "wrap", gap: 8 }}>
              {chips.map((m) => (
                <button key={m.col.key} type="button" data-add-chip={m.col.key}
                  onClick={() => { setAdded((a) => ({ ...a, [`${currentRow._id}:${m.col.key}`]: true })); setFocusKey(m.col.key); }}
                  style={{ border: "1px solid var(--border-strong)", borderRadius: RADIUS.pill, background: "transparent", color: "var(--accent)", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, padding: "6px 12px", minHeight: 32, cursor: "pointer" }}>
                  ＋ {m.label}
                </button>
              ))}
            </div>
          </Group>
        )}
      </div>

      {/* FOOTER, sticky — one live read-back, one full-width Save. */}
      <div style={{ borderTop: "1px solid var(--border-default)", background: "var(--surface-raised)", padding: "8px 16px 10px" }}>
        {readback && <div data-footer-readback="1" style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginBottom: 8 }}>{readback}</div>}
        {showBlockerLine && <div data-hint="save-blocker" style={{ fontSize: FONT_SIZE.label, color: "var(--warn-text)", marginBottom: 8 }}>{nudged.text}</div>}
        {saveError && <div style={{ fontSize: FONT_SIZE.label, color: "var(--danger-text)", marginBottom: 8 }}>{saveError}</div>}
        <button data-save-button="1" onClick={onSaveTap} disabled={save.disabled} style={saveBtnStyle(save.disabled)}>
          {save.label}
        </button>
      </div>

      {jumpOpen && (
        <JumpSheet
          rows={rows}
          currentIndex={currentIndex}
          overlaysById={overlaysById}
          locationCellText={locationCellText}
          rowIsReady={rowIsReady}
          onPick={(i) => { setCurrentIndex(i); setJumpOpen(false); }}
          onClose={() => setJumpOpen(false)}
        />
      )}
    </div>
  );
}

function saveBtnStyle(disabled) {
  return {
    width: "100%", height: FOOTER_BTN_H, borderRadius: RADIUS.md, border: "none",
    background: disabled ? "var(--border-strong)" : "var(--accent)", color: "var(--on-accent)",
    fontSize: FONT_SIZE.emphasis, fontWeight: 600, fontFamily: "inherit", cursor: disabled ? "default" : "pointer",
  };
}
