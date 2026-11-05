/* RailMenus.jsx — NEW-1 / NEW-2 (owner-approved 2026-10-11). The two right-rail flyouts that were
 * plain text lists: PARCEL TOOLS (a sorted list with icons, hints and a "This parcel" switches
 * section) and MEASURE (an explained list of its four modes). Module scope (MODULE-SCOPE-COMPONENTS).
 *
 * Presentational only: WHAT the parcel menu shows is decided by `lib/parcelActions.js`
 * (`parcelMenuModel`), WHAT a row does is the caller's `run` map, and what the measure modes mean
 * is the caller's `MEASURE_MODES` — nothing here decides or stores anything. Colours are theme
 * tokens (never a raw hex); the icon idiom is the rail's: 16×16, 1.4 stroke, `currentColor`.
 */
import { Switch } from "../../../shared/ui/controls.jsx";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { RADIUS } from "../../../shared/ui/radius.js";

const P = {
  draw: <><path d="M3 5.2 L8 2.6 L13.2 5.6 L12.2 12.4 L4.2 13.2 Z" /><circle cx="3" cy="5.2" r="1" fill="currentColor" stroke="none" /><circle cx="8" cy="2.6" r="1" fill="currentColor" stroke="none" /><circle cx="13.2" cy="5.6" r="1" fill="currentColor" stroke="none" /></>,
  identify: <><rect x="2.5" y="2.5" width="11" height="11" rx="0.8" /><path d="M8 2.5 V13.5 M2.5 8 H13.5" /></>,
  deed: <><path d="M4.5 2 H9 L12 5 V13 a1 1 0 0 1-1 1 H4.5 a1 1 0 0 1-1-1 V3 a1 1 0 0 1 1-1 Z" /><path d="M9 2 V5 H12" /><path d="M5.6 8 H10 M5.6 10.2 H10 M5.6 12.2 H8.4" /></>,
  address: <><path d="M8 14 s4.6-4.2 4.6-7.4 a4.6 4.6 0 0 0-9.2 0 C3.4 9.8 8 14 8 14 Z" /><circle cx="8" cy="6.6" r="1.7" /></>,
  split: <><rect x="2.5" y="3" width="11" height="10" rx="0.8" /><path d="M3 12.5 L13 3.5" strokeDasharray="2 1.6" /></>,
  combine: <><rect x="2.5" y="2.5" width="7" height="7" rx="0.6" /><rect x="6.5" y="6.5" width="7" height="7" rx="0.6" /></>,
  boundary: <><path d="M3.4 5.4 L8 2.8 L12.6 5.6 L11.6 12 L4.4 12.6 Z" /><rect x="2.2" y="4.2" width="2.4" height="2.4" fill="currentColor" stroke="none" /><rect x="11.4" y="4.4" width="2.4" height="2.4" fill="currentColor" stroke="none" /><rect x="10.4" y="10.8" width="2.4" height="2.4" fill="currentColor" stroke="none" /></>,
  trash: <path d="M3 4.5 H13 M6.5 4.5 V3 h3 V4.5 M4.4 4.5 l.6 8.6 h6 l.6-8.6 M7 7 v4 M9 7 v4" />,
  // Measure modes
  line: <path d="M2.5 8 H13.5 M2.5 5.2 V10.8 M13.5 5.2 V10.8" />,
  polyline: <><path d="M2.5 11.5 L6 5.5 L9.5 9.5 L13.5 3.5" /><circle cx="2.5" cy="11.5" r="1" fill="currentColor" stroke="none" /><circle cx="6" cy="5.5" r="1" fill="currentColor" stroke="none" /><circle cx="9.5" cy="9.5" r="1" fill="currentColor" stroke="none" /><circle cx="13.5" cy="3.5" r="1" fill="currentColor" stroke="none" /></>,
  area: <><path d="M3 5 L9 2.8 L13.2 7.6 L8.4 13 L3.4 11 Z" /><path d="M4.6 9.4 L9.6 4 M6.4 11.6 L11.8 6" strokeWidth="1" /></>,
  count: <><circle cx="4" cy="4.5" r="1.4" /><circle cx="4" cy="11.5" r="1.4" /><circle cx="9" cy="8" r="1.4" /><path d="M12.5 3 V7 M10.5 5 H14.5" /></>,
};

export const MenuIcon = ({ id, size = 16 }) => (
  <svg data-menu-icon="1" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flex: "none" }} aria-hidden="true">
    {P[id] || <circle cx="8" cy="8" r="5.5" />}
  </svg>
);

/* The rail's heading look: small caps + a thin rule to the right edge. */
export function RailMenuHeading({ children }) {
  return (
    <div className="rail-menu-hdr" style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 8px 5px", fontSize: FONT_SIZE.label, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
      <span>{children}</span>
      <span aria-hidden="true" style={{ flex: 1, height: 1, background: "var(--chrome-divider)" }} />
    </div>
  );
}

const hintStyle = { display: "block", fontSize: FONT_SIZE.label, fontWeight: 400, color: "var(--text-secondary)", lineHeight: 1.25, marginTop: 1 };

/* One row: icon · name (+ hint underneath) · right slot (detail text, check mark, or nothing).
 * `style` is the planner's own menuItem(...) object so a row still hovers/rounds like every other
 * menu row in the file; `right` replaces the detail slot (a check mark for the armed measure mode). */
export function RailMenuRow({ icon, label, hint, detail, right, danger, enabled = true, active, style, children, ...rest }) {
  return (
    <button disabled={!enabled} style={{ ...style, display: "flex", alignItems: "center", gap: 10, ...(danger && enabled ? { color: "var(--danger)" } : null) }} {...rest}>
      <span style={{ width: 16, height: 16, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", color: "inherit" }}>{icon ? <MenuIcon id={icon} /> : null}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: active ? 650 : 500 }}>{label}</span>
        {hint ? <span style={hintStyle}>{hint}</span> : null}
      </span>
      {right ?? (detail ? <span style={{ fontSize: FONT_SIZE.label, fontWeight: 600, color: danger ? "inherit" : "var(--text-secondary)", whiteSpace: "nowrap" }}>{detail}</span> : null)}
      {children}
    </button>
  );
}

const KeyCap = ({ children }) => (
  <kbd style={{ fontFamily: "inherit", fontSize: FONT_SIZE.label, fontWeight: 600, padding: "0 5px", lineHeight: "16px", border: "1px solid currentColor", borderRadius: RADIUS.sm, opacity: 0.9 }}>{children}</kbd>
);

const Check = () => (
  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" data-menu-check="1" style={{ flex: "none" }}><path d="M3.2 8.6 L6.6 12 L12.8 4.4" /></svg>
);

const fmtAcres = (a) => (Number.isFinite(a) ? `${a.toFixed(2)} AC` : "");

/**
 * PARCEL TOOLS. `groups` is `parcelMenuModel(...)`'s answer; `run` maps a row id to its handler;
 * `menuItem` / `disabledRow` are the planner's shared row styles.
 */
export function ParcelToolsMenu({ groups, run, menuItem, disabledRow }) {
  return groups.map((g, gi) => (
    <div key={g.id} data-parcel-group={g.id}>
      {gi > 0 && <div style={{ borderTop: "1px solid var(--chrome-divider)", margin: "5px 2px 3px" }} />}
      {g.label ? <RailMenuHeading>{g.label}</RailMenuHeading> : null}
      {/* a group whose rows are ALL disabled states its reason once, here, instead of leaving it to
          be inferred from N silently-greyed rows (NEW-2, B849585) */}
      {g.reason && (
        <div data-parcel-group-reason={g.id} style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", lineHeight: 1.35, padding: "0 8px 6px" }}>{g.reason}</div>
      )}
      {g.header && (
        <div data-parcel-this-header="1" style={{ display: "flex", alignItems: "center", gap: 8, padding: `2px 10px ${SPACE.xs}px`, fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>
          <span aria-hidden="true" style={{ width: 12, height: 12, flex: "none", borderRadius: RADIUS.sm, background: g.header.color || "var(--text-secondary)", boxShadow: "inset 0 0 0 1px var(--border-default)" }} />
          <span data-parcel-this-name="1" style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 650 }}>{g.header.name}</span>
          <span data-parcel-this-acres="1" style={{ flex: "none", fontWeight: 650, fontVariantNumeric: "tabular-nums" }}>{fmtAcres(g.header.acres)}</span>
        </div>
      )}
      {/* Every row is addressable by `data-parcel-action`. The Deed row keeps its historical
          `boundary-menu-mb` testid (two ui-audit harnesses click it by that name). A disabled row
          drops OPACITY (Button/IconButton's own `disabled → 0.5`), never a colour swap alone. */}
      {g.rows.map((r) => {
        const common = {
          "data-parcel-action": r.id,
          "data-testid": r.id === "deed" ? "boundary-menu-mb" : `parcel-menu-${r.id}`,
          title: r.enabled ? undefined : r.disabledReason,
        };
        if (r.kind === "switch") {
          // A SWITCH row: the whole row toggles, the menu STAYS OPEN (the handler never closes it).
          return (
            <RailMenuRow key={r.id} {...common} enabled={r.enabled} role="switch" aria-checked={!!r.checked}
              style={{ ...menuItem(false), ...(r.enabled ? null : disabledRow) }}
              onClick={r.enabled ? run[r.id] : undefined}
              label={r.label}
              right={<Switch decorative checked={!!r.checked} disabled={!r.enabled} />} />
          );
        }
        return (
          <RailMenuRow key={r.id} {...common} enabled={r.enabled} aria-pressed={r.active || undefined}
            style={{ ...menuItem(r.active), ...(r.enabled ? null : disabledRow) }}
            onClick={r.enabled ? run[r.id] : undefined}
            icon={r.icon} label={r.label} hint={r.hint} danger={r.danger} active={r.active}
            detail={r.id === "deleteSelected" ? null : r.detail}
            right={r.id === "deleteSelected" ? <KeyCap>Del</KeyCap> : undefined} />
        );
      })}
    </div>
  ));
}

/**
 * MEASURE. `modes` is the planner's `[[key, label]]` list, `hints` the per-mode one-liner,
 * `current` the persisted mode, `armed` whether Measure is the live tool. The CURRENT mode (armed
 * or not — it is the one a press of the Measure label would start) wears the accent tint + a check.
 */
export function MeasureMenu({ modes, hints, current, onPick, menuItem, accentSoft }) {
  return (
    <div>
      <RailMenuHeading>Measure</RailMenuHeading>
      {modes.map(([k, label]) => {
        const on = current === k;
        return (
          <RailMenuRow key={k} aria-label={label} aria-pressed={on} data-measure-mode={k} data-testid={`measure-mode-${k}`}
            style={{ ...menuItem(on), background: on ? accentSoft : "transparent" }}
            icon={k} label={label} hint={hints[k]} active={on}
            right={on ? <Check /> : undefined}
            onClick={() => onPick(k)} />
        );
      })}
    </div>
  );
}
