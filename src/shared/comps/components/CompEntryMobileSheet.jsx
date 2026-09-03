/* CompEntryMobileSheet — the TRANSPOSED comp entry layout for narrow viewports (B1091712,
 * owner rule 2026-09-03). Below `MOBILE_BREAKPOINT_PX` (compMobileLayout.js), `CompEntryGrid.jsx`
 * renders this instead of its own horizontal sheet — the desktop table is untouched above the
 * breakpoint (see that file's own header). One comp per screen, fields as ROWS: a comp has ~18
 * fields and no horizontal table fits them at phone width (measured: even a 1191px DESKTOP
 * viewport ran 85px past its own scroller before this shipped).
 *
 * Shares state and every mutation path with the desktop sheet — `rows` is the SAME lifted array
 * (CompsPanel.jsx owns it), and every edit here goes back through `CompEntryGrid.jsx`'s own
 * `commitRows`/undo stack via the `onCommitField`/`onSetToday`/`onResolvePeriod` props, so the two
 * layouts can never drift into two different ideas of what a "comp" is. `compMobileLayout.js` is
 * the pure half — which fields show, in which section, per comp type; read its own header before
 * touching field grouping.
 *
 * MODULE-SCOPE-COMPONENTS: every component here is defined at module scope.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../../ui/controls.jsx";
import { RADIUS } from "../../ui/radius.js";
import { FONT_SIZE } from "../../ui/designTokens.js";
import { SHEET_COLUMNS, columnIndex, cellState, TYPE_OPTIONS } from "../lib/compSheetColumns.js";
import { mobileSections, neededToSaveColumns, mobileLabel, neededToSaveRemaining, rowStatusText, isRequiredColEmpty } from "../lib/compMobileLayout.js";
import { compHeadline, draftToComp } from "../lib/comps.js";

const ROW_MIN_H = 48;
const HIT_TARGET = 44;
const JUMP_ROW_H = 60;
const FOOTER_BTN_H = 46;

const TYPE_LABEL = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]));
// LEASE reuses the existing --info-bg/--info-text pair (no prior "info" background existed);
// LAND reuses the existing warn tint (a land comp's badge is the same amber the rest of the app
// already uses for "pay attention"); BUILDING SALE gets no dedicated hue — the owner's spec only
// colored two of the three badges, so the third stays a neutral chip built from tokens every
// other chrome control already uses, rather than inventing a third one-off color pair.
const BADGE_TOKENS = {
  lease: { bg: "var(--info-bg)", fg: "var(--info-text)" },
  land: { bg: "var(--warn-bg)", fg: "var(--warn-text)" },
  building_sale: { bg: "var(--hover-chrome)", fg: "var(--text-secondary)" },
};

function TypeBadge({ compType }) {
  const t = BADGE_TOKENS[compType] || BADGE_TOKENS.building_sale;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", padding: "3px 7px", borderRadius: RADIUS.sm,
      fontSize: FONT_SIZE.micro, fontWeight: 800, letterSpacing: "0.09em", textTransform: "uppercase",
      background: t.bg, color: t.fg,
    }}>
      {(TYPE_LABEL[compType] || compType || "").toUpperCase()}
    </span>
  );
}

/** One status dot in the pager strip — a 20px accent PILL for the current comp, a 6px dot
 * (green/amber) for every other one. Deliberately not interactive: "you can see two of three
 * still need work without paging through them" is the whole job — jumping is the pager label's. */
function StatusDot({ ready, current }) {
  if (current) {
    return <span aria-hidden="true" style={{ width: 20, height: 6, borderRadius: RADIUS.pill, background: "var(--accent)" }} />;
  }
  return (
    <span aria-hidden="true" style={{
      width: 6, height: 6, borderRadius: RADIUS.pill,
      background: ready ? "var(--success-text)" : "var(--warn-text)",
    }} />
  );
}

function ChevronButton({ dir, onClick, disabled, label }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      style={{
        width: HIT_TARGET, height: HIT_TARGET, flex: "none", display: "flex", alignItems: "center", justifyContent: "center",
        border: "none", background: "transparent", color: disabled ? "var(--text-tertiary)" : "var(--text-primary)",
        fontSize: FONT_SIZE.display, cursor: disabled ? "default" : "pointer", fontFamily: "inherit", padding: 0,
      }}>
      {dir === "prev" ? "‹" : "›"}
    </button>
  );
}

function ValueText({ text, empty, muted }) {
  return (
    <span style={{
      // The transposed sheet's field VALUE is the one thing every row exists to show — the
      // owner's spec steps it up from the 13px label to 15px specifically so it reads at a
      // glance; the nearest token (14, "display") nearly erases that deliberate 2px gap.
      fontSize: 15, // design-exempt: deliberate 15px value size, see comment above
      fontWeight: 500, color: empty ? "var(--text-tertiary)" : muted ? "var(--text-secondary)" : "var(--text-primary)",
      textAlign: "right", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
    }}>
      {empty ? "—" : text}
    </span>
  );
}

const rowShellStyle = {
  display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
  minHeight: ROW_MIN_H, padding: "0 16px", width: "100%", boxSizing: "border-box",
  border: "none", borderBottom: "1px solid var(--border-default)", background: "transparent",
  fontFamily: "inherit", textAlign: "left",
};
const labelStyle = { fontSize: FONT_SIZE.emphasis, fontWeight: 400, color: "var(--text-secondary)", flex: "none" };
const caretStyle = { flex: "none", fontSize: FONT_SIZE.display, color: "var(--text-tertiary)" };
const inputStyle = {
  flex: 1, minWidth: 0, textAlign: "right", fontSize: 15, fontWeight: 500, fontFamily: "inherit", // design-exempt: matches ValueText's own reasoning above
  color: "var(--text-primary)", background: "var(--surface-base)", border: "1px solid var(--accent)",
  borderRadius: RADIUS.sm, padding: "4px 8px", outline: "none",
};

/** One editable text/number/date field row: static value at rest, an `<input>` while editing.
 * `col.kind === "date"` for `compDate` additionally carries the "Today" quick-set chip — the
 * owner's own answer to date friction: the user asserts today, the app never assumes it. */
function EditableRow({ col, draft, onCommit, onToday }) {
  const st = cellState(col, draft);
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(st.raw ?? "");
  const inputRef = useRef(null);
  useEffect(() => { if (!editing) setVal(st.raw ?? ""); }, [st.raw, editing]);
  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);
  const commit = () => { onCommit(col, val); setEditing(false); };
  const cancel = () => { setVal(st.raw ?? ""); setEditing(false); };
  const isToday = col.key === "compDate";
  return (
    <div style={rowShellStyle}>
      <span style={labelStyle}>{mobileLabel(col)}</span>
      <span style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, justifyContent: "flex-end" }}>
        {isToday && (
          <button
            onClick={() => onToday()}
            style={{
              flex: "none", border: "none", borderRadius: RADIUS.sm, padding: "3px 8px",
              background: "var(--focus-ring-soft)", color: "var(--accent)", fontSize: FONT_SIZE.control, fontWeight: 600,
              cursor: "pointer", fontFamily: "inherit",
            }}>
            Today
          </button>
        )}
        {editing ? (
          <input
            ref={inputRef}
            value={val}
            onChange={(e) => setVal(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); commit(); }
              else if (e.key === "Escape") { e.preventDefault(); cancel(); }
            }}
            inputMode={col.kind === "number" ? "decimal" : "text"}
            placeholder={col.editHint || undefined}
            style={inputStyle}
          />
        ) : (
          <button onClick={() => setEditing(true)} style={{ border: "none", background: "none", padding: 0, cursor: "pointer", minWidth: 0 }}>
            <ValueText text={st.text} empty={!st.text} />
          </button>
        )}
      </span>
    </div>
  );
}

/** A choice field (Type/Unit/Per/Basis) — a visible value + caret with a real, visually-hidden
 * native `<select>` layered on top so a tap opens the OS picker directly (no dialog box: this is
 * a plain form control, not window.prompt/confirm). Committing a pick is the whole action, same
 * as the desktop sheet's own select cells. */
function ChoiceRow({ col, draft, onCommit }) {
  const st = cellState(col, draft);
  return (
    <label style={{ ...rowShellStyle, cursor: "pointer" }}>
      <span style={labelStyle}>{mobileLabel(col)}</span>
      <span style={{ position: "relative", display: "flex", alignItems: "center", gap: 4, flex: 1, minWidth: 0, justifyContent: "flex-end" }}>
        <ValueText text={st.text} empty={!st.text} />
        <span aria-hidden="true" style={caretStyle}>▾</span>
        <select
          value={st.raw ?? ""}
          onChange={(e) => onCommit(col, e.target.value)}
          aria-label={mobileLabel(col)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer" }}
        >
          <option value="" disabled hidden />
          {col.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </span>
    </label>
  );
}

/** A read-only row: derived value (Net rate, $/SF or $/AC) or an applicable-but-fixed one (Unit
 * on a non-land row, always "SF"). Never a caret — nothing here opens a picker. */
function ReadOnlyRow({ col, draft }) {
  const st = cellState(col, draft);
  return (
    <div style={rowShellStyle}>
      <span style={labelStyle}>{mobileLabel(col)}</span>
      <ValueText text={st.text} empty={!st.text} muted />
    </div>
  );
}

/** The Location row — always an action (never typed text): tapping arms the row for a map pick,
 * or re-focuses the map on its already-picked anchor. Mirrors the desktop sheet's own Location
 * cell (`CompEntryGrid.jsx`'s `triggerAction`). */
function LocationRow({ col, draft, locationText, onTap }) {
  return (
    <button onClick={onTap} style={rowShellStyle}>
      <span style={labelStyle}>{mobileLabel(col)}</span>
      <ValueText text={locationText || "Set"} empty={!locationText} />
    </button>
  );
}

/** The Rate/Per pair when the paste parser flagged a genuine 12x ambiguity (no stated period) —
 * two quick-resolve chips instead of a normal row, same escape hatch as the desktop sheet's
 * `ProblemsList`. */
function PeriodAmbiguityRow({ col, draft, onResolvePeriod }) {
  const rate = draft.leaseRate || "0.00";
  return (
    <div style={{ ...rowShellStyle, flexDirection: "column", alignItems: "stretch", gap: 8, paddingTop: 8, paddingBottom: 8 }}>
      <span style={{ fontSize: FONT_SIZE.label, color: "var(--danger-text)" }}>{mobileLabel(col)} — no period stated, monthly and annual differ by 12x.</span>
      <span style={{ display: "flex", gap: 8 }}>
        <Button size="sm" variant="danger" onClick={() => onResolvePeriod("monthly")}>${rate}/SF/mo</Button>
        <Button size="sm" variant="danger" onClick={() => onResolvePeriod("annual")}>${rate}/SF/yr</Button>
      </span>
    </div>
  );
}

function FieldRow({ col, row, locationText, onCommitField, onToday, onResolvePeriod, onLocationTap }) {
  const { draft, cellFlags } = row;
  const flagKey = col.flagKey ? col.flagKey(draft) : col.key;
  const flag = cellFlags[flagKey];
  if (col.key === "leaseRatePeriod" && flag?.level === "blocking") {
    return <PeriodAmbiguityRow col={col} draft={draft} onResolvePeriod={(p) => onResolvePeriod(row._id, p)} />;
  }
  if (col.kind === "action") return <LocationRow col={col} draft={draft} locationText={locationText} onTap={onLocationTap} />;
  const st = cellState(col, draft);
  if (col.kind === "derived" || st.state === "fixed") return <ReadOnlyRow col={col} draft={draft} />;
  if (col.kind === "select") return <ChoiceRow col={col} draft={draft} onCommit={(c, v) => onCommitField(row._id, c, v)} />;
  return <EditableRow col={col} draft={draft} onCommit={(c, v) => onCommitField(row._id, c, v)} onToday={() => onToday()} />;
}

function SectionCaption({ children, amber, count }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 16px 4px",
      fontSize: FONT_SIZE.micro, fontWeight: 800, letterSpacing: "0.1em", textTransform: "uppercase",
      color: amber ? "var(--warn-text)" : "var(--text-tertiary)",
    }}>
      <span>{children}</span>
      {count != null && <span>{count} left</span>}
    </div>
  );
}

/** The jump sheet — tapping the pager label opens this: the whole batch at a glance, so paging
 * through eight pasted comps blind is never the only way to find the one that needs a date. */
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
              <StatusDot ready={rowIsReady(row)} current={false} />
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: FONT_SIZE.control, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {locationText || row.draft.title || "Untitled comp"}
                </div>
                <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginTop: 2 }}>
                  {TYPE_LABEL[row.draft.compType] || row.draft.compType} · {rowStatusText(row)}
                </div>
              </span>
              <span style={{
                // The jump sheet's headline rate is the one number the whole row exists to
                // surface at a glance — same reasoning as ValueText's 15px, one step further
                // because this is the row's ONLY number rather than one of several.
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

export default function CompEntryMobileSheet({
  rows, overlaysById, locationCellText, onCommitField, onSetToday, onResolvePeriod,
  armedRowId, onArm, onFocusAnchor, onSave, onCancel, saving, saveError, readyRows, rowIsReady,
  pasteBox,
}) {
  const [currentIndex, setCurrentIndex] = useState(0);
  const [jumpOpen, setJumpOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    setCurrentIndex((i) => Math.max(0, Math.min(i, rows.length - 1)));
  }, [rows.length]);

  const currentRow = rows[currentIndex] || null;

  // Arming the map for a pick (tapping an unset Location row) has nowhere to go on a phone if
  // this sheet stays full-screen — MINIMIZE it to a slim banner the moment the CURRENT row is
  // armed, so the map underneath becomes reachable, and restore full view the instant it's
  // disarmed (a pick lands, or the user cancels). Purely local to this component — CompsPanel's
  // own `armedRowId`/view state is untouched either way.
  useEffect(() => {
    if (armedRowId && currentRow && armedRowId === currentRow._id) setMinimized(true);
    else if (!armedRowId) setMinimized(false);
  }, [armedRowId, currentRow]);

  if (!currentRow) {
    return (
      <div style={{ position: "fixed", inset: 0, zIndex: 2600, display: "flex", flexDirection: "column", background: "var(--surface-page)" }}>
        <MobileHeader onCancel={onCancel} />
        {pasteBox}
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, textAlign: "center", fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>
          Paste a few comps above to get started.
        </div>
      </div>
    );
  }

  const locationText = locationCellText(currentRow, overlaysById);
  const compType = currentRow.draft.compType;
  const needed = neededToSaveColumns(compType);
  const neededLeft = neededToSaveRemaining(currentRow);
  const sections = mobileSections(compType);
  const isArmedHere = armedRowId === currentRow._id;

  const onLocationTap = () => {
    if (currentRow.draft.anchor) onFocusAnchor(currentRow.draft.anchor);
    else onArm(currentRow._id);
  };

  const needDateCount = rows.filter((r) => isRequiredColEmpty(SHEET_COLUMNS[columnIndex("compDate")], r.draft)).length;
  const footerParts = [`${rows.length} comp${rows.length === 1 ? "" : "s"}`, `${readyRows.length} ready`];
  if (needDateCount > 0) footerParts.push(`${needDateCount} need${needDateCount === 1 ? "s" : ""} a date`);

  if (minimized) {
    return (
      <div style={{
        position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 2700,
        background: "var(--warn-bg)", borderTop: "1px solid var(--warn-border)",
        padding: "12px 16px", display: "flex", flexDirection: "column", gap: 8,
      }}>
        <span style={{ fontSize: FONT_SIZE.control, color: "var(--warn-text)" }}>
          Tap the map to drop the pin for {locationText || currentRow.draft.title || "this comp"} — or tap <strong>Comp from parcel</strong> on the map toolbar.
        </span>
        <button onClick={() => onArm(null)} style={{ alignSelf: "flex-start", border: "none", background: "none", color: "var(--warn-text)", textDecoration: "underline", fontFamily: "inherit", fontSize: FONT_SIZE.label, cursor: "pointer", padding: 0 }}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div data-comp-entry-mobile="1" style={{ position: "fixed", inset: 0, zIndex: 2600, display: "flex", flexDirection: "column", background: "var(--surface-page)" }}>
      <MobileHeader onCancel={onCancel} />
      {pasteBox}

      {isArmedHere && (
        <div style={{ padding: "6px 16px", fontSize: FONT_SIZE.label, color: "var(--warn-text)", background: "var(--warn-bg)", borderBottom: "1px solid var(--warn-border)" }}>
          Placing this comp — tap the map.
        </div>
      )}

      {/* PAGER — chevrons page ±1; the label opens the jump sheet, the batch at a glance. */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "6px 0 4px", borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
          <ChevronButton dir="prev" label="Previous comp" disabled={currentIndex === 0} onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))} />
          <button onClick={() => setJumpOpen(true)} style={{ border: "none", background: "none", fontFamily: "inherit", cursor: "pointer", padding: "6px 10px", display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700, color: "var(--text-primary)" }}>Comp {currentIndex + 1} of {rows.length}</span>
            <span aria-hidden="true" style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>⌄</span>
          </button>
          <ChevronButton dir="next" label="Next comp" disabled={currentIndex === rows.length - 1} onClick={() => setCurrentIndex((i) => Math.min(rows.length - 1, i + 1))} />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 5, marginTop: 2 }}>
          {rows.map((r, i) => <StatusDot key={r._id} ready={rowIsReady(r)} current={i === currentIndex} />)}
        </div>
      </div>

      {/* IDENTITY STRIP — sticky under the pager: a scrolled screen must always answer "which comp am I in". */}
      <div style={{ position: "sticky", top: 0, zIndex: 1, display: "flex", alignItems: "center", gap: 8, padding: "8px 16px", background: "var(--surface-page)", borderBottom: "1px solid var(--border-default)" }}>
        <TypeBadge compType={compType} />
        <span style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {locationText || currentRow.draft.title || "New comp"}
        </span>
      </div>

      {/* FIELD LIST */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <SectionCaption amber count={neededLeft}>Needed to save</SectionCaption>
        {needed.map((col) => (
          <FieldRow
            key={col.key}
            col={col}
            row={currentRow}
            locationText={locationText}
            onCommitField={onCommitField}
            onToday={() => onSetToday(currentIndex)}
            onResolvePeriod={onResolvePeriod}
            onLocationTap={onLocationTap}
          />
        ))}
        {sections.map((section) => (
          <div key={section.title}>
            <SectionCaption>{section.title}</SectionCaption>
            {section.cols.map((col) => (
              <FieldRow
                key={col.key}
                col={col}
                row={currentRow}
                locationText={locationText}
                onCommitField={onCommitField}
                onToday={() => onSetToday(currentIndex)}
                onResolvePeriod={onResolvePeriod}
                onLocationTap={onLocationTap}
              />
            ))}
          </div>
        ))}
      </div>

      {/* FOOTER, sticky */}
      <div style={{ borderTop: "1px solid var(--border-default)", background: "var(--surface-raised)", padding: "8px 16px 10px" }}>
        <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginBottom: 8 }}>{footerParts.join(" · ")}</div>
        {saveError && <div style={{ fontSize: FONT_SIZE.label, color: "var(--danger-text)", marginBottom: 8 }}>{saveError}</div>}
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={onCancel} disabled={saving} style={{
            flex: 1, height: FOOTER_BTN_H, borderRadius: RADIUS.md, border: "1px solid var(--border-strong)",
            background: "transparent", color: "var(--text-primary)", fontSize: FONT_SIZE.emphasis, fontWeight: 600,
            fontFamily: "inherit", cursor: saving ? "default" : "pointer",
          }}>
            Close
          </button>
          <button
            onClick={() => onSave(readyRows)}
            disabled={saving || readyRows.length === 0}
            style={{
              flex: 1, height: FOOTER_BTN_H, borderRadius: RADIUS.md, border: "none",
              background: readyRows.length === 0 ? "var(--border-strong)" : "var(--accent)", color: "var(--on-accent)",
              fontSize: FONT_SIZE.emphasis, fontWeight: 600, fontFamily: "inherit",
              cursor: saving || readyRows.length === 0 ? "default" : "pointer",
            }}>
            {saving ? "Saving…" : `Save ${readyRows.length || ""} comp${readyRows.length === 1 ? "" : "s"}`.trim()}
          </button>
        </div>
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

function MobileHeader({ onCancel }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 10px 6px 16px" }}>
      <span style={{ fontSize: FONT_SIZE.emphasis, fontWeight: 700 }}>Paste comps</span>
      <button onClick={onCancel} aria-label="Close" style={{
        width: HIT_TARGET, height: HIT_TARGET, display: "flex", alignItems: "center", justifyContent: "center",
        border: "none", background: "transparent", color: "var(--text-secondary)", fontFamily: "inherit",
        fontSize: FONT_SIZE.emphasis, cursor: "pointer",
      }}>
        ✕
      </button>
    </div>
  );
}
