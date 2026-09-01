/* CompEntryGrid — the paste-box-over-a-card-stack comp entry surface (B849232/NEW-1), replacing
 * the old one-comp-at-a-time form as the CREATE path. Michael enters comps in batches, copied
 * out of broker emails; this is the review surface itself — parsed values land straight in
 * typed, editable fields, there is no separate confirm step.
 *
 * ⛔ ROUND 4 REWRITE (B986096-HARDENING-4, owner rule 2026-09-01) — THE SHARED-COLUMN ROW GRID
 * IS GONE. "A land comp has four meaningful fields. A lease comp has twelve. I specified a
 * shared-column grid, so every lease row has to cram twelve fields into columns sized for four"
 * — the owner's own words, describing his own spec error. One CARD per comp now, laid out for
 * its OWN type only (a land card never renders lease-only fields, and vice versa) — no shared
 * column template to fight, nothing exiled below the row, no floating unlabeled numbers. Every
 * field carries a visible uppercase label (the shared `Field` primitive, `stacked`). A derived
 * value (Annual rent, $/SF) gets its own labelled READ-ONLY cell — never a floating "-/yr"
 * between two inputs. Uncertainty renders as a full-width SENTENCE below the row it concerns —
 * a blocking one with quick-resolve buttons, a soft one in amber — never a dot/badge glued to an
 * input's corner. Numbers display comma-formatted (613,208, not 613208) while editable; the
 * underlying stored value is untouched. The dialog is sized to the width it's actually given —
 * measured at 1191px on the owner's screen, not the 820px cap the previous round guessed at.
 *
 * ⛔ THE "ONE RECORD, THREE ROWS" BUG (owner-measured, round 4) — ROOT-CAUSED AND ELIMINATED,
 * NOT PATCHED. The prior round's "parse on any `\n` inside onChange" heuristic was the fragile
 * surface: it fires mid-typing, on ANY input event that happens to contain a newline, with no
 * guarantee that event fires exactly once per logical paste — the exact shape a duplicate/
 * fragmented browser event (or a repeated accidental paste while the box gave no clear feedback
 * that a previous paste had already landed) turns into two or three partial "single record"
 * commits, each producing its own row, while the banner only ever reflects the LAST one ("why
 * are there three drafts when i never asked for three" is exactly this: one real row plus two
 * earlier partial commits). Fixed by removing the heuristic entirely rather than special-casing
 * it: `onChange` is now a PLAIN state update, nothing more. There are exactly two ways to commit
 * text, both unambiguous — a real clipboard `paste` event (immediate, one shot), or an explicit
 * user action (the Add button, or Ctrl/Cmd+Enter) for hand-typed text. A plain Enter inserts a
 * literal newline like any ordinary textarea, so hand-typing a multi-line abstract line-by-line
 * can no longer fragment into premature partial commits. A `lastCommitRef` dedupe guard blocks a
 * literal duplicate (identical text within 800ms) from either entry point as a second line of
 * defense. `parsePaste`'s own contract (never emit a row it didn't affirmatively populate) is
 * unchanged and still holds — the bug was never inside the parser, only in how many times the
 * caller invoked it for what the user experienced as one action.
 *
 * MODULE-SCOPE-COMPONENTS: every component here is defined at module scope.
 */
import { useState, useRef } from "react";
import { createPortal } from "react-dom";
import { Button, Field } from "../../ui/controls.jsx";
import { parsePaste, rowHasBlockingFlags, parseProseLine, splitPasteLines } from "../lib/compParse.js";
import {
  emptyDraft, draftToComp, validateComp, annualLeaseRate, partyLabels,
  landPricePerSf, buildingPricePerSf, COMP_TYPES, LEASE_PERIODS, LEASE_EXPENSE_BASES,
} from "../lib/comps.js";
import { compMarkerColor } from "../lib/compMarkerIcon.js";

const TYPE_LABEL = { land: "Land", building_sale: "Bldg sale", lease: "Lease" };

let _rowSeq = 0;
function newRowId() { return `row${Date.now()}_${_rowSeq++}`; }

export function draftFromParsedRow(parsed) {
  return { _id: newRowId(), draft: { ...emptyDraft(null), ...parsed.draft }, cellFlags: parsed.cellFlags || {} };
}

function cellStyle(flag) {
  const base = {
    width: "100%", boxSizing: "border-box", padding: "5px 8px", fontSize: 12, borderRadius: 6,
    fontFamily: "inherit", color: "var(--text-primary)", background: "var(--surface-base)",
    border: "1px solid var(--border-default)",
  };
  if (!flag) return base;
  if (flag.level === "blocking") return { ...base, borderColor: "var(--danger)", borderWidth: 2, background: "var(--danger-bg)" };
  return { ...base, borderColor: "var(--warn-border)", background: "var(--warn-bg)" };
}

const LOC_BUTTON_STYLE = { width: "100%", boxSizing: "border-box", borderRadius: 6, padding: "5px 8px", fontSize: 12, cursor: "pointer", fontFamily: "inherit" };

/* ---- number display: comma-separated while resting, raw digits while being typed ----------- */

function formatNumberDisplay(raw) {
  if (raw === "" || raw == null) return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;
  const s = String(raw);
  const dot = s.indexOf(".");
  if (dot === -1) return n.toLocaleString("en-US");
  const decimals = Math.max(0, s.length - dot - 1);
  return n.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function sanitizeNumericInput(raw) {
  let s = String(raw || "").replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
  return s;
}

/** A labelled numeric input that shows comma separators at rest and raw digits while focused
 * (so the caret position stays sane while typing) — the stored draft value is always the plain
 * numeric string, only the DISPLAY is formatted. */
function NumberField({ label, value, onChange, flag, placeholder, required }) {
  const [focused, setFocused] = useState(false);
  return (
    <Field label={label} stacked required={required}>
      <input type="text" inputMode="decimal" placeholder={placeholder}
        value={focused ? value : formatNumberDisplay(value)}
        onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
        onChange={(e) => onChange(sanitizeNumericInput(e.target.value))}
        aria-invalid={flag?.level === "blocking" ? "true" : undefined}
        style={cellStyle(flag)} />
    </Field>
  );
}

/** A labelled READ-ONLY cell for a derived figure (Annual rent, $/SF) — never a floating,
 * unlabeled number between two inputs. Dashed border reads as "not directly editable." */
function DerivedField({ label, value }) {
  return (
    <Field label={label} stacked>
      <div style={{
        width: "100%", boxSizing: "border-box", padding: "5px 8px", fontSize: 12, borderRadius: 6,
        color: "var(--text-secondary)", background: "var(--surface-base)", border: "1px dashed var(--border-default)",
        minHeight: 15, lineHeight: "15px",
      }}>
        {value ?? "—"}
      </div>
    </Field>
  );
}

function TypeBadge({ compType }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-secondary)", flex: "none" }}>
      <span style={{
        width: 8, height: 8,
        borderRadius: 2, // design-exempt: mirrors CompsPanel.jsx's TypeChip diamond glyph verbatim — no small-glyph radius token exists yet
        background: compMarkerColor(compType), transform: "rotate(45deg)", flex: "none",
      }} />
      {TYPE_LABEL[compType] || compType}
    </span>
  );
}

/** The canonical blocking case, rendered as a sentence with two quick-resolve buttons — never a
 * "!" dot on the rate input's corner. Clicking either button sets the period directly. */
function BlockingPeriodNotice({ draft, cellFlags, onResolve }) {
  const flag = cellFlags.leaseRatePeriod;
  if (!flag || flag.level !== "blocking") return null;
  const rate = draft.leaseRate;
  return (
    <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, background: "var(--danger-bg)", border: "1px solid var(--danger-border)" }}>
      <div style={{ fontSize: 12, color: "var(--danger-text)", marginBottom: 6 }}>
        Rate has no period — monthly and annual differ by 12x. Pick one to save.
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button size="sm" variant="danger" onClick={() => onResolve("monthly")}>${rate || "0.00"}/SF/mo</Button>
        <Button size="sm" variant="danger" onClick={() => onResolve("annual")}>${rate || "0.00"}/SF/yr</Button>
      </div>
    </div>
  );
}

/** Every other soft flag on the row, each its own amber sentence — the k/m-suffix guesses, the
 * estimated-commencement note, an unstated NNN/gross basis. Generic over whatever compParse.js
 * flagged, so a new soft-flag key needs no matching UI change here. */
function SoftNotices({ cellFlags }) {
  const entries = Object.entries(cellFlags || {}).filter(([, f]) => f?.level === "soft");
  if (!entries.length) return null;
  return (
    <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
      {entries.map(([key, f]) => (
        <div key={key} style={{ fontSize: 11.5, color: "var(--warn-text)" }}>~ {f.reason}</div>
      ))}
    </div>
  );
}

function LeaseFields({ draft, cellFlags, set, setField }) {
  const annual = annualLeaseRate(draftToComp(draft));
  const basisLabel = draft.leaseRateExpense ? draft.leaseRateExpense.toUpperCase() : "";
  const labels = partyLabels("lease");
  return (
    <>
      <div style={{ display: "grid", gridTemplateColumns: "96px 96px 96px 118px 118px 104px 104px 104px 1fr", gap: 8 }}>
        <NumberField label="Rate $/SF" value={draft.leaseRate} onChange={(v) => setField("leaseRate", v)} flag={cellFlags.leaseRate} placeholder="0.00" />
        <Field label="Per" stacked>
          <select value={draft.leaseRatePeriod} onChange={(e) => setField("leaseRatePeriod", e.target.value)}
            aria-invalid={cellFlags.leaseRatePeriod?.level === "blocking" ? "true" : undefined}
            style={cellStyle(cellFlags.leaseRatePeriod)}>
            <option value="">—</option>
            {LEASE_PERIODS.map((p) => <option key={p} value={p}>{p === "annual" ? "YR" : "MO"}</option>)}
          </select>
        </Field>
        <Field label="Basis" stacked>
          <select value={draft.leaseRateExpense} onChange={(e) => setField("leaseRateExpense", e.target.value)} style={cellStyle(cellFlags.leaseRateExpense)}>
            <option value="">—</option>
            {LEASE_EXPENSE_BASES.map((b) => <option key={b} value={b}>{b.toUpperCase()}</option>)}
          </select>
        </Field>
        <DerivedField label={`Annual ${basisLabel}`.trim()} value={annual != null ? `$${annual.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/yr` : null} />
        <NumberField label="Leased SF" value={draft.leaseSizeSf} onChange={(v) => setField("leaseSizeSf", v)} flag={cellFlags.leaseSizeSf} placeholder="SF" />
        <Field label="Term" stacked><input value={draft.leaseTerm} onChange={set("leaseTerm")} placeholder="e.g. 5 yrs" style={cellStyle(null)} /></Field>
        <NumberField label="Free rent (mo)" value={draft.leaseFreeRentMonths} onChange={(v) => setField("leaseFreeRentMonths", v)} placeholder="mo" />
        <NumberField label="TI $/SF" value={draft.leaseTi} onChange={(v) => setField("leaseTi", v)} placeholder="$/SF" />
        <NumberField label="Escalation %/yr" value={draft.leaseEscalationPct} onChange={(v) => setField("leaseEscalationPct", v)} placeholder="%/yr" />
      </div>
      <BlockingPeriodNotice draft={draft} cellFlags={cellFlags} onResolve={(period) => setField("leaseRatePeriod", period)} />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1.5fr", gap: 8, marginTop: 10 }}>
        <Field label={labels.provider} stacked><input value={draft.partyProvider} onChange={set("partyProvider")} placeholder={labels.provider} style={cellStyle(null)} /></Field>
        <Field label={labels.acquirer} stacked><input value={draft.partyAcquirer} onChange={set("partyAcquirer")} placeholder={labels.acquirer} style={cellStyle(null)} /></Field>
        <Field label="Notes" stacked><textarea value={draft.notes} onChange={set("notes")} rows={1} style={{ ...cellStyle(null), resize: "vertical" }} /></Field>
      </div>
    </>
  );
}

function LandFields({ draft, cellFlags, set, setField }) {
  const psf = landPricePerSf(draftToComp(draft));
  const labels = partyLabels("land");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "140px 100px 70px 110px 1fr 1fr 1.5fr", gap: 8 }}>
      <NumberField label="Price" value={draft.landPrice} onChange={(v) => setField("landPrice", v)} flag={cellFlags.landPrice} placeholder="$" />
      <NumberField label="Size" value={draft.landSizeValue} onChange={(v) => setField("landSizeValue", v)} flag={cellFlags.landSizeValue} placeholder="Size" />
      <Field label="Unit" stacked>
        <select value={draft.landSizeUnit} onChange={set("landSizeUnit")} style={cellStyle(null)}>
          <option value="ac">AC</option><option value="sf">SF</option>
        </select>
      </Field>
      <DerivedField label="$/SF" value={psf != null ? `$${psf.toFixed(2)}` : null} />
      <Field label={labels.provider} stacked><input value={draft.partyProvider} onChange={set("partyProvider")} placeholder={labels.provider} style={cellStyle(null)} /></Field>
      <Field label={labels.acquirer} stacked><input value={draft.partyAcquirer} onChange={set("partyAcquirer")} placeholder={labels.acquirer} style={cellStyle(null)} /></Field>
      <Field label="Notes" stacked><input value={draft.notes} onChange={set("notes")} placeholder="Notes" style={cellStyle(null)} /></Field>
    </div>
  );
}

function BuildingSaleFields({ draft, cellFlags, set, setField }) {
  const psf = buildingPricePerSf(draftToComp(draft));
  const labels = partyLabels("building_sale");
  return (
    <div style={{ display: "grid", gridTemplateColumns: "140px 118px 110px 1fr 1fr 1.5fr", gap: 8 }}>
      <NumberField label="Price" value={draft.bldgPrice} onChange={(v) => setField("bldgPrice", v)} flag={cellFlags.bldgPrice} placeholder="$" />
      <NumberField label="Building SF" value={draft.bldgSizeSf} onChange={(v) => setField("bldgSizeSf", v)} flag={cellFlags.bldgSizeSf} placeholder="SF" />
      <DerivedField label="$/SF" value={psf != null ? `$${psf.toFixed(2)}` : null} />
      <Field label={labels.provider} stacked><input value={draft.partyProvider} onChange={set("partyProvider")} placeholder={labels.provider} style={cellStyle(null)} /></Field>
      <Field label={labels.acquirer} stacked><input value={draft.partyAcquirer} onChange={set("partyAcquirer")} placeholder={labels.acquirer} style={cellStyle(null)} /></Field>
      <Field label="Notes" stacked><input value={draft.notes} onChange={set("notes")} placeholder="Notes" style={cellStyle(null)} /></Field>
    </div>
  );
}

function CompCard({ row, onChange, onRemove, onFocusAnchor, onArm, armed }) {
  const { draft, cellFlags } = row;
  const set = (key) => (e) => onChange({ ...row, draft: { ...draft, [key]: e.target.value }, cellFlags: withFlagCleared(cellFlags, key) });
  const setField = (key, value) => onChange({ ...row, draft: { ...draft, [key]: value }, cellFlags: withFlagCleared(cellFlags, key) });
  const canFocus = !!draft.anchor;

  return (
    <div
      onClick={() => canFocus && onFocusAnchor(draft.anchor)}
      style={{
        border: "1px solid var(--border-default)", borderRadius: 12, background: "var(--surface-raised)",
        padding: 12, marginBottom: 10, cursor: canFocus ? "pointer" : "default",
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <TypeBadge compType={draft.compType} />
        <span style={{ fontSize: 13, fontWeight: 700, color: "var(--text-primary)", flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {draft.title || "Untitled comp"}
        </span>
        <button onClick={(e) => { e.stopPropagation(); onRemove(row._id); }} title="Remove" aria-label="Remove comp"
          style={{ border: "none", background: "transparent", color: "var(--danger-text)", cursor: "pointer", fontSize: 14, padding: "2px 4px", flex: "none" }}>✕</button>
      </div>

      <div onClick={(e) => e.stopPropagation()} style={{ display: "grid", gridTemplateColumns: "112px 150px 1fr 190px", gap: 8, marginBottom: 10 }}>
        <Field label="Type" stacked>
          <select value={draft.compType} onChange={(e) => setField("compType", e.target.value)} style={cellStyle(cellFlags.compType)}>
            {COMP_TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}
          </select>
        </Field>
        <Field label="Date" stacked required>
          <input type="date" value={draft.compDate} onChange={set("compDate")} style={cellStyle(cellFlags.compDate)} />
        </Field>
        <Field label="Title / address" stacked>
          <input value={draft.title} onChange={set("title")} placeholder="Property / deal name" style={cellStyle(cellFlags.title)} />
        </Field>
        <Field label="Location" stacked required>
          {draft.anchor ? (
            <button onClick={() => onFocusAnchor(draft.anchor)}
              style={{ ...LOC_BUTTON_STYLE, border: "1px solid var(--border-default)", background: "var(--surface-base)", color: "var(--text-secondary)" }}>
              📍 Set — show on map
            </button>
          ) : (
            <button onClick={() => onArm(row._id)}
              style={{
                ...LOC_BUTTON_STYLE,
                border: `1px solid ${armed ? "var(--accent)" : "var(--warn-border)"}`, background: armed ? "var(--accent)" : "var(--warn-bg)",
                color: armed ? "var(--on-accent)" : "var(--warn-text)", fontWeight: 700,
              }}>
              {armed ? "Picking…" : "＋ Pick location"}
            </button>
          )}
        </Field>
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        {draft.compType === "lease" && <LeaseFields draft={draft} cellFlags={cellFlags} set={set} setField={setField} />}
        {draft.compType === "land" && <LandFields draft={draft} cellFlags={cellFlags} set={set} setField={setField} />}
        {draft.compType === "building_sale" && <BuildingSaleFields draft={draft} cellFlags={cellFlags} set={set} setField={setField} />}
      </div>

      <div onClick={(e) => e.stopPropagation()}>
        <SoftNotices cellFlags={cellFlags} />
      </div>
    </div>
  );
}

function withFlagCleared(cellFlags, key) {
  if (!cellFlags?.[key]) return cellFlags;
  const next = { ...cellFlags };
  delete next[key];
  return next;
}

function rowIsReady(row) {
  return !rowHasBlockingFlags(row.cellFlags) && validateComp(draftToComp(row.draft)).length === 0;
}

export default function CompEntryGrid({ rows, onRowsChange, armedRowId, onArm, onFocusAnchor, onSave, onCancel, saving, saveError }) {
  const [pasteText, setPasteText] = useState("");
  // Kept visible (collapsed to one line, expandable) until dismissed — a failed or partial
  // parse used to clear the box instantly, taking the only reference for fixing it with it.
  const [lastPasteText, setLastPasteText] = useState(null);
  const [lastCommitSummary, setLastCommitSummary] = useState(null);
  const [showPastedText, setShowPastedText] = useState(false);
  // Tracks the most recent commit IF it was interpreted as ONE record, so "split one row per
  // line instead" can undo exactly those rows and re-parse the same raw text the other way.
  const [lastSingleParse, setLastSingleParse] = useState(null);
  // Guards against a literal duplicate commit — the same text committed twice in quick
  // succession (a duplicate DOM event, or an accidental double-paste) is silently ignored
  // rather than appending a second copy of the same rows.
  const lastCommitRef = useRef(null);

  // No boundsRef — this card isn't clamped to the map container (this component has no access
  // to it), just to the window, which is enough: dragging is the escape hatch for whatever the
  // default position happens to cover, not a hard requirement to avoid it by construction.
  const [pos, setPos] = useState(() => {
    const w = typeof window !== "undefined" ? window.innerWidth : 1200;
    return { x: Math.max(16, (w - 1200) / 2), y: 80 };
  });
  const posRef = useRef(pos);
  posRef.current = pos;

  const startDrag = (e) => {
    if (e.button != null && e.button !== 0) return;
    e.preventDefault();
    const sx = e.clientX, sy = e.clientY;
    const ox = posRef.current.x, oy = posRef.current.y;
    const move = (ev) => {
      const w = typeof window !== "undefined" ? window.innerWidth : 1200;
      const h = typeof window !== "undefined" ? window.innerHeight : 800;
      setPos({ x: Math.max(4, Math.min(w - 60, ox + ev.clientX - sx)), y: Math.max(4, Math.min(h - 40, oy + ev.clientY - sy)) });
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // The ONE place text ever gets parsed and turned into rows — reached from exactly two places
  // (a real paste, or an explicit Add/Ctrl+Enter), both below. Never reached from a plain
  // keystroke or a plain onChange, which is the structural fix for the "one record, three rows"
  // bug (see the file header).
  const commitText = (text) => {
    if (!text.trim()) return;
    const now = Date.now();
    const last = lastCommitRef.current;
    if (last && last.text === text && now - last.time < 800) return; // duplicate event guard
    lastCommitRef.current = { text, time: now };

    const { rows: parsedRows, mode } = parsePaste(text);
    setLastPasteText(text);
    setShowPastedText(false);
    const lineCount = splitPasteLines(text).length;
    if (!parsedRows.length) {
      setLastSingleParse(null);
      setLastCommitSummary(`Nothing recognized in ${lineCount} pasted line${lineCount === 1 ? "" : "s"}.`);
      return;
    }
    const newRows = parsedRows.map(draftFromParsedRow);
    onRowsChange([...rows, ...newRows]);
    setLastSingleParse(mode === "single" ? { raw: text, rowIds: newRows.map((r) => r._id) } : null);
    if (mode === "single" && newRows.length === 1) {
      const typeLabel = (TYPE_LABEL[newRows[0].draft.compType] || "comp").toLowerCase();
      setLastCommitSummary(`Read 1 ${typeLabel} comp from ${lineCount} pasted line${lineCount === 1 ? "" : "s"}`);
    } else {
      setLastCommitSummary(`Read ${newRows.length} comp${newRows.length === 1 ? "" : "s"} from ${lineCount} pasted line${lineCount === 1 ? "" : "s"}`);
    }
  };

  // A real clipboard paste — the block/Excel/abstract shapes' primary path. Default insertion is
  // prevented so the raw pasted text never lands in the (controlled) textarea; parsing decides
  // what happens instead, and the box stays empty for the next paste.
  const handlePaste = (e) => {
    const text = e.clipboardData?.getData("text/plain");
    if (!text) return;
    e.preventDefault();
    commitText(text);
    setPasteText("");
  };

  // A PLAIN state update, nothing more — no parsing here. This is the fix: the old code scanned
  // every keystroke for an embedded newline and parsed on it, which is what let a fragmented or
  // duplicated event stream commit the same paste more than once.
  const handleChange = (e) => setPasteText(e.target.value);

  const commitTyped = () => {
    if (!pasteText.trim()) return;
    commitText(pasteText);
    setPasteText("");
  };

  // Ctrl/Cmd+Enter is the deliberate, explicit commit for hand-typed text — a plain Enter still
  // inserts a literal newline like any ordinary textarea, so typing a multi-line abstract
  // line-by-line can't fragment into premature partial commits.
  const handleKeyDown = (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); commitTyped(); }
  };

  const switchToOnePerLine = () => {
    if (!lastSingleParse) return;
    const { raw, rowIds } = lastSingleParse;
    const idSet = new Set(rowIds);
    const remaining = rows.filter((r) => !idSet.has(r._id));
    const multiRows = splitPasteLines(raw).map(parseProseLine).filter(Boolean).map(draftFromParsedRow);
    onRowsChange([...remaining, ...multiRows]);
    setLastSingleParse(null);
  };

  const updateRow = (updated) => onRowsChange(rows.map((r) => (r._id === updated._id ? updated : r)));
  const removeRow = (id) => onRowsChange(rows.filter((r) => r._id !== id));

  const readyRows = rows.filter(rowIsReady);
  const blockingCount = rows.filter((r) => rowHasBlockingFlags(r.cellFlags)).length;
  // Not blocked by a red field, but still can't save — missing the date or the location
  // validateComp requires. A different reason from a blocking field, worded and colored
  // differently too.
  const missingCount = rows.filter((r) => !rowHasBlockingFlags(r.cellFlags) && validateComp(draftToComp(r.draft)).length > 0).length;

  let footerMsg = "";
  if (rows.length > 0) {
    if (blockingCount === 0 && missingCount === 0) {
      footerMsg = `${readyRows.length} comp${readyRows.length === 1 ? "" : "s"} ready.`;
    } else {
      const parts = [];
      if (blockingCount > 0) parts.push(`${blockingCount} blocking`);
      if (missingCount > 0) parts.push(`${missingCount} need${missingCount === 1 ? "s" : ""} a date or a location`);
      footerMsg = `${readyRows.length} of ${rows.length} ready — ${parts.join(", ")}.`;
    }
  }

  const linkBtnStyle = { border: "none", background: "none", color: "var(--accent)", cursor: "pointer", padding: 0, textDecoration: "underline", fontSize: 11 };

  return createPortal(
    <div
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "fixed", left: pos.x, top: pos.y, width: "min(1200px, calc(100vw - 32px))",
        maxHeight: "min(85vh, 780px)", zIndex: 2600, display: "flex", flexDirection: "column",
        background: "var(--surface-overlay)", border: "1px solid var(--border-default)", borderRadius: 12,
        boxShadow: "0 16px 44px rgba(28,25,20,0.22), 0 3px 10px rgba(28,25,20,0.1)", // design-exempt: mirrors shared/ui/FloatingPanel.jsx's card shadow verbatim — no shadow token exists yet
      }}>
      <div onPointerDown={startDrag}
        style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", borderBottom: "1px solid var(--border-default)", cursor: "move", userSelect: "none" }}>
        <span style={{ fontSize: 13, fontWeight: 700 }}>New comps</span>
        <button onPointerDown={(e) => e.stopPropagation()} onClick={onCancel} aria-label="Close"
          style={{ border: "none", background: "transparent", color: "var(--text-secondary)", fontSize: 14, cursor: "pointer", padding: 2 }}>✕</button>
      </div>

      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <textarea
            value={pasteText}
            onChange={handleChange}
            onPaste={handlePaste}
            onKeyDown={handleKeyDown}
            placeholder="Paste a broker email or an Excel block — it parses immediately. Or type your own, then press Ctrl+Enter (⌘+Enter) or click Add."
            rows={2}
            style={{ flex: 1, boxSizing: "border-box", padding: "8px 10px", fontSize: 12, borderRadius: 8, fontFamily: "inherit", border: "1px solid var(--border-default)", background: "var(--surface-base)", color: "var(--text-primary)", resize: "vertical" }}
          />
          <Button size="sm" onClick={commitTyped} disabled={!pasteText.trim()}>Add</Button>
        </div>
        {lastCommitSummary && (
          <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-secondary)" }}>
            {lastCommitSummary}
            {lastPasteText && (
              <> · <button onClick={() => setShowPastedText((v) => !v)} style={linkBtnStyle}>{showPastedText ? "Hide pasted text" : "Show pasted text"}</button></>
            )}
            {lastSingleParse && (
              <> · <button onClick={switchToOnePerLine} style={linkBtnStyle}>Split one row per line</button></>
            )}
          </div>
        )}
        {showPastedText && lastPasteText && (
          <div style={{ marginTop: 4, fontSize: 10.5, color: "var(--text-secondary)", background: "var(--surface-raised)", border: "1px solid var(--border-default)", borderRadius: 6, padding: "6px 8px", whiteSpace: "pre-wrap", maxHeight: 120, overflowY: "auto" }}>
            {lastPasteText}
          </div>
        )}
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "10px 14px" }}>
        {armedRowId && (
          <div style={{ fontSize: 12, color: "var(--warn-text)", background: "var(--warn-bg)", border: "1px solid var(--warn-border)", borderRadius: 6, padding: "6px 8px", marginBottom: 8 }}>
            Now click <strong>Drop a pin</strong> or <strong>Comp from parcel</strong> on the map, then click the map — the location lands on the comp you picked. The map stays fully usable while you do this.{" "}
            <button onClick={() => onArm(null)} style={{ border: "none", background: "none", color: "inherit", textDecoration: "underline", cursor: "pointer", padding: 0, marginLeft: 4 }}>Cancel</button>
          </div>
        )}
        {rows.length === 0 ? (
          <div style={{ fontSize: 12, color: "var(--text-secondary)", padding: "18px 4px", textAlign: "center" }}>
            Paste a few comps above to get started.
          </div>
        ) : (
          rows.map((row) => (
            <CompCard key={row._id} row={row} onChange={updateRow} onRemove={removeRow}
              onFocusAnchor={onFocusAnchor} onArm={onArm} armed={armedRowId === row._id} />
          ))
        )}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 14px", borderTop: "1px solid var(--border-default)" }}>
        <span style={{ fontSize: 10.5, color: "var(--text-secondary)" }}>{footerMsg}</span>
        <span style={{ display: "flex", gap: 8 }}>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={saving}>Close</Button>
          <Button size="sm" onClick={() => onSave(readyRows)} disabled={saving || readyRows.length === 0}>
            {saving ? "Saving…" : `Save ${readyRows.length || ""} comp${readyRows.length === 1 ? "" : "s"}`.trim()}
          </Button>
        </span>
      </div>
      {saveError && <div style={{ fontSize: 12, color: "var(--danger-text)", padding: "0 14px 10px" }}>{saveError}</div>}
    </div>,
    document.body,
  );
}
