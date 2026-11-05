/* A parcel's OWN PAGE inside the Parcels panel (Parcels panel rework — NEW-2).
 *
 * Replaces the stacked "Parcel record" / "Boundary" sections: clicking a row in the list opens this,
 * "← All parcels" goes back. Frame only — the Setbacks and Style sections need the planner's colour
 * and number primitives (module-scope in SitePlanner.jsx), so they arrive as `setbacks` / `style`
 * slots and the county tax table as `tax`. The SOURCE section is by provenance (lib/parcelOrigin.js):
 *   · combined — "Made from" the original lots + split back; never owner/account/address fields,
 *                never the word "Drawn";
 *   · county   — read-only record (owner, account, address, deed acres next to the drawn acres), read from
 *                the county's own attribute bag (lib/appraisal.js `countyRecord`), with a "More county
 *                fields" disclosure — there is no separate appraisal / taxes block any more;
 *   · drawn / deed — "You drew this one" and ONE link that reveals the editable fields;
 *   · unknown  — nothing proves where it came from: no chip, no source line, just the editable fields link.
 * Module-scope components only (MODULE-SCOPE-COMPONENTS).
 */
import { useEffect, useRef, useState } from "react";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE, CONTROL_H } from "../../../shared/ui/designTokens.js";
import { NUM_FONT, TABULAR_NUMS } from "../../../shared/theme/typography.js";
import { fetchTaxUnits, tableFromUnits, accountOf, TAX_UNIT_COUNTIES } from "../lib/taxUnitsClient.js";
import { taxTableForCombined } from "../lib/taxRates.js";
import { LINE, fmt, iconBtn, textBtn, LockGlyph, UnlockGlyph, MoreIcon, ZoomIcon, TrashIcon } from "./ParcelsPanel.jsx";
import { countyRecord, apprAll } from "../lib/appraisal.js";
import { accountOf as recordAccountOf } from "../lib/parcelOrigin.js";

const eyebrow = { fontSize: FONT_SIZE.micro, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--text-secondary)" };
const inputBox = { width: "100%", boxSizing: "border-box", height: CONTROL_H.lg, padding: `0 ${SPACE.lg}px`, border: LINE, borderRadius: RADIUS.sm, background: "var(--surface-field)", color: "var(--text-primary)", fontFamily: "inherit", fontSize: FONT_SIZE.control };

function PageSection({ title, children, testid }) {
  return (
    <section data-testid={testid} style={{ borderTop: LINE, paddingTop: SPACE.lg, marginTop: SPACE.xl }}>
      <div style={{ ...eyebrow, marginBottom: SPACE.md }}>{title}</div>
      {children}
    </section>
  );
}

function Fact({ label, children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "92px minmax(0, 1fr)", columnGap: SPACE.lg, alignItems: "baseline", padding: `${SPACE.xs}px 0` }}>
      <span style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>{label}</span>
      <span style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)", overflowWrap: "anywhere" }}>{children || "—"}</span>
    </div>
  );
}

/* Commit on Enter / blur, Esc reverts — one undo frame per edit (no dialogs, inline only). */
function CommitField({ value, placeholder, onCommit, testid, ariaLabel }) {
  const ref = useRef(null);
  return (
    <input ref={ref} defaultValue={value || ""} key={`${testid}:${value || ""}`} placeholder={placeholder} aria-label={ariaLabel} data-testid={testid} style={inputBox}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.stopPropagation(); e.currentTarget.blur(); }
        else if (e.key === "Escape") { e.stopPropagation(); e.currentTarget.value = value || ""; e.currentTarget.blur(); } // only the keys this field consumes (keyScope's FIELD scope covers the rest)
      }}
      onBlur={(e) => { if (e.target.value !== (value || "")) onCommit(e.target.value); }} />
  );
}

function MenuItem({ children, onClick, danger, testid }) {
  return (
    <button type="button" role="menuitem" onClick={onClick} data-testid={testid}
      style={{ display: "flex", alignItems: "center", gap: SPACE.md, width: "100%", textAlign: "left", padding: `${SPACE.sm}px ${SPACE.lg}px`, border: "none", borderRadius: RADIUS.sm, background: "transparent", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, color: danger ? "var(--danger-text)" : "var(--text-primary)", cursor: "pointer" }}>{children}</button>
  );
}

export default function ParcelPage({ parcel, name, unnamed, acres, included, origin, ownerText, cadName, drawnAcresOf, handlers, taxTable, taxSource, setbacks, style, deedFrom, idField, addrField }) {
  const [menu, setMenu] = useState(false);
  const [addFields, setAddFields] = useState(false);
  useEffect(() => { setMenu(false); setAddFields(false); }, [parcel.id]);
  useEffect(() => {
    if (!menu) return undefined;
    const off = (e) => { if (e.type === "keydown" ? e.key === "Escape" : !(e.target.closest && e.target.closest("[data-parcel-menu]"))) setMenu(false); };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", off);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", off); };
  }, [menu]);

  const from = (parcel.combined && parcel.combined.from) || [];
  const kind = origin.kind;
  const stated = parcel.statedAcres != null && parcel.statedAcres !== "" ? Number(parcel.statedAcres) : null;
  const hasTypedFacts = !!(parcel.owner || parcel.acct || stated != null);
  const rec = kind === "county" ? countyRecord(parcel.attrs, { acct: parcel.acct, addr: parcel.addr, idField, addrField }) : null;
  const deedAc = rec && rec.deedAcres != null ? rec.deedAcres : stated;

  return (
    <div data-testid="parcel-page" data-parcel-id={parcel.id} style={{ display: "flex", flexDirection: "column", minWidth: 0 }}>
      <button type="button" onClick={handlers.onBack} data-testid="parcel-page-back"
        style={{ alignSelf: "flex-start", display: "inline-flex", alignItems: "center", gap: SPACE.xs, padding: `${SPACE.xs}px 0`, marginBottom: SPACE.md, border: "none", background: "transparent", color: "var(--accent-site-text, var(--text-primary))", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 700, cursor: "pointer" }}>← All parcels</button>

      <div style={{ display: "flex", alignItems: "center", gap: SPACE.md, minWidth: 0 }}>
        <div data-testid="parcel-page-name" style={{ minWidth: 0, fontSize: FONT_SIZE.display, fontWeight: unnamed ? 400 : 700, color: unnamed ? "var(--text-secondary)" : "var(--text-primary)", overflowWrap: "anywhere" }}>{unnamed ? "Unnamed" : name}</div>
        {origin.chip && <span data-testid="parcel-provenance" style={{ flex: "none", padding: "0 8px", borderRadius: RADIUS.pill, border: LINE, background: "var(--surface-page)", color: "var(--text-secondary)", fontSize: FONT_SIZE.label, fontWeight: 700, lineHeight: "20px" }}>{origin.chip}</span>}
        <span style={{ flex: 1 }} />
        <button type="button" style={{ ...iconBtn, color: "var(--text-secondary)" }} onClick={() => handlers.onToggleLock(parcel.id)} data-testid="parcel-page-lock" aria-pressed={!!parcel.locked}
          aria-label={parcel.locked ? "Unlock this parcel" : "Lock this parcel"}
          title={parcel.locked ? "Locked — even Edit parcels can't change it. Click to unlock." : "Lock — keep Edit parcels from changing this boundary"}>
          {parcel.locked ? <LockGlyph /> : <UnlockGlyph />}
        </button>
        <div data-parcel-menu="1" style={{ position: "relative" }}>
          <button type="button" style={iconBtn} aria-haspopup="menu" aria-expanded={menu} aria-label="More actions" title="More" data-testid="parcel-page-more" onClick={() => setMenu((o) => !o)}><MoreIcon /></button>
          {menu && (
            <div role="menu" style={{ position: "absolute", right: 0, top: CONTROL_H.md, zIndex: 5, minWidth: 150, padding: SPACE.xs, border: LINE, borderRadius: RADIUS.md, background: "var(--surface-raised)", boxShadow: "var(--shadow-popover, 0 4px 14px var(--border-strong))" }}>
              <MenuItem onClick={() => { setMenu(false); handlers.onZoom(parcel.id); }} testid="parcel-page-zoom"><ZoomIcon /> Zoom to</MenuItem>
              <MenuItem danger onClick={() => { setMenu(false); handlers.onDelete(parcel.id); }} testid="parcel-page-delete"><TrashIcon /> Delete</MenuItem>
            </div>
          )}
        </div>
      </div>
      <div data-testid="parcel-page-sub" style={{ fontSize: FONT_SIZE.control, color: "var(--text-secondary)", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, marginTop: 2 }}>{fmt(acres)} AC · {included ? "active" : "not active"}</div>

      <label style={{ display: "block", marginTop: SPACE.xl }}>
        <span style={{ ...eyebrow, display: "block", marginBottom: SPACE.xs }}>Your name for it</span>
        <CommitField value={parcel.label || ""} placeholder="" ariaLabel="Your name for this parcel" testid="parcel-field-label" onCommit={(v) => handlers.onField(parcel.id, "label", v)} />
      </label>

      <PageSection title="Source" testid="parcel-source">
        {kind === "combined" && (
          <>
            <div style={{ fontSize: FONT_SIZE.label, ...{ color: "var(--text-secondary)" }, marginBottom: SPACE.xs }}>Made from</div>
            <div data-testid="parcel-made-from">
              {from.map((s, i) => (
                <div key={s.id || i} style={{ padding: `${SPACE.sm}px 0`, borderTop: i ? LINE : "none" }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: SPACE.md }}>
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: FONT_SIZE.control, fontWeight: 650, color: "var(--text-primary)" }}>{s.snapName || "Parcel"}</span>
                    <span style={{ flex: "none", fontSize: FONT_SIZE.control, fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS, color: "var(--text-primary)" }}>{fmt(handlers.acresOf(s))} AC</span>
                  </div>
                  <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", overflowWrap: "anywhere" }}>{[recordAccountOf(s, { idField }), s.attrs ? ownerText(s.attrs) : s.owner].filter(Boolean).join(" · ") || "No account on file"}</div>
                </div>
              ))}
            </div>
            <button type="button" style={{ ...textBtn, marginTop: SPACE.lg, width: "100%" }} onClick={() => handlers.onRestoreCombined(parcel.id)} data-testid="parcel-restore-combined">Split back into the {from.length} lots</button>
          </>
        )}
        {kind === "county" && (
          <div data-testid="parcel-county-record">
            <Fact label="Owner">{rec.owner || parcel.owner}</Fact>
            <Fact label="Account">{rec.account}</Fact>
            <Fact label="Address">{rec.address}</Fact>
            <Fact label="Deed acres">{deedAc != null ? <>{fmt(deedAc)} <span style={{ color: "var(--text-secondary)" }}>· drawn {fmt(drawnAcresOf(parcel))}</span></> : null}</Fact>
            <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginTop: SPACE.sm }}>{[cadName ? `Source: ${cadName}` : "Source: county appraisal district", rec.taxYear ? `tax year ${rec.taxYear}` : null].filter(Boolean).join(" · ")}</div>
            {parcel.attrs && (
              <details data-testid="parcel-more-fields" style={{ marginTop: SPACE.sm }}>
                <summary style={{ fontSize: FONT_SIZE.control, fontWeight: 700, color: "var(--accent-site-text, var(--text-primary))", cursor: "pointer" }}>More county fields</summary>
                <div style={{ marginTop: SPACE.sm, maxHeight: 220, overflowY: "auto" }}>
                  {apprAll(parcel.attrs).map((r) => (
                    <div key={r.label} style={{ display: "flex", justifyContent: "space-between", gap: SPACE.lg, alignItems: "baseline", padding: "2px 0" }}>
                      <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", flex: "none" }}>{r.label}</span>
                      <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-primary)", textAlign: "right", overflowWrap: "anywhere" }}>{String(r.value)}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
        {(kind === "drawn" || kind === "deed" || kind === "unknown") && (
          <div data-testid="parcel-drawn-record">
            {kind !== "unknown" && <div style={{ fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>{kind === "deed" ? "Plotted from a deed." : "You drew this one."}</div>}
            {kind === "deed" && parcel.deedMisclosureFt != null && (
              <div data-testid="parcel-misclosure" style={{ fontSize: FONT_SIZE.label, color: parcel.deedMisclosureFt > 1 ? "var(--warn-text)" : "var(--text-secondary)", marginTop: SPACE.xs }}>
                {parcel.deedMisclosureFt > 1 ? "⚠ " : ""}The deed's calls close to {parcel.deedMisclosureFt}′.
              </div>
            )}
            {!addFields && !hasTypedFacts ? (
              <button type="button" onClick={() => setAddFields(true)} data-testid="parcel-add-facts"
                style={{ marginTop: kind === "unknown" ? 0 : SPACE.md, padding: 0, border: "none", background: "transparent", color: "var(--accent-site-text, var(--text-primary))", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 700, cursor: "pointer", textAlign: "left" }}>+ Add owner, account and deed acres</button>
            ) : (
              <div style={{ display: "grid", gap: SPACE.md, marginTop: SPACE.md }}>
                <label><span style={{ ...eyebrow, display: "block", marginBottom: SPACE.xs }}>Owner</span><CommitField value={parcel.owner} placeholder="Owner of record" ariaLabel="Owner" testid="parcel-field-owner" onCommit={(v) => handlers.onField(parcel.id, "owner", v)} /></label>
                <label><span style={{ ...eyebrow, display: "block", marginBottom: SPACE.xs }}>Account</span><CommitField value={parcel.acct} placeholder="County account number" ariaLabel="Account" testid="parcel-field-acct" onCommit={(v) => handlers.onField(parcel.id, "acct", v)} /></label>
                <label><span style={{ ...eyebrow, display: "block", marginBottom: SPACE.xs }}>Deed acres</span><CommitField value={stated != null ? String(parcel.statedAcres) : ""} placeholder="What the deed or county calls it" ariaLabel="Deed acres" testid="parcel-field-statedAcres" onCommit={(v) => handlers.onField(parcel.id, "statedAcres", v)} /></label>
              </div>
            )}
          </div>
        )}
        {parcel.splitFrom && parcel.splitFrom.from && (
          <div data-testid="parcel-split-from" style={{ display: "flex", alignItems: "center", gap: SPACE.md, marginTop: SPACE.lg, fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>
            <span style={{ color: "var(--text-secondary)" }}>Split from</span>
            <strong style={{ minWidth: 0, overflowWrap: "anywhere" }}>{parcel.splitFrom.from.snapName || "the original"}</strong>
            <button type="button" style={{ ...textBtn, marginLeft: "auto" }} onClick={() => handlers.onRestoreSplit(parcel.id)} data-testid="parcel-restore-split">Restore original</button>
          </div>
        )}
        {parcel.fromDeedGroup && deedFrom && (
          <button type="button" style={{ ...textBtn, width: "100%", marginTop: SPACE.lg }} data-testid="parcel-select-deed" onClick={() => deedFrom(parcel.fromDeedGroup)}
            title="Select the deed this boundary came from — to compare it, rotate it, or align it once the county map is back">↩ Go to the deed this came from</button>
        )}
      </PageSection>

      {taxTable ? <TaxTable data={taxTable} /> : (taxSource && <ServerTaxTable {...taxSource} />)}
      {setbacks}
      {style}
    </div>
  );
}

/* The county tax-rate table (NEW-4). Rendered only when lib/taxRates.js has a COMPLETE, sourced answer —
 * it returns null (and this never mounts) for every county that has no reliable per-account source. */
function TaxTable({ data }) {
  const rows = data.rows || data.perLot || [];
  return (
    <PageSection title="Tax rates" testid="parcel-tax-table">
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: FONT_SIZE.control, color: "var(--text-primary)" }}>
        <thead><tr style={{ textAlign: "left" }}><th style={{ ...eyebrow, padding: `${SPACE.xs}px 0` }}>{data.rows ? "Taxing unit" : "Lot"}</th><th style={{ ...eyebrow, textAlign: "right" }}>{data.rows ? "Rate per $100" : "Total"}</th></tr></thead>
        <tbody>
          {rows.map((r, i) => <tr key={i} style={{ borderTop: LINE }}><td style={{ padding: `${SPACE.xs}px 0` }}>{r.unit || r.name}</td><td style={{ textAlign: "right", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>{(r.rate ?? r.total).toFixed(6)}</td></tr>)}
          <tr style={{ borderTop: LINE, fontWeight: 700 }}><td style={{ padding: `${SPACE.xs}px 0` }}>Total{data.rows ? "" : data.allShare ? " · all lots share it" : " · lots differ"}</td><td style={{ textAlign: "right", fontFamily: NUM_FONT, fontVariantNumeric: TABULAR_NUMS }}>{data.total != null ? data.total.toFixed(6) : "—"}</td></tr>
        </tbody>
      </table>
      {data.source && <div style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginTop: SPACE.sm }}>{data.source}{data.year ? ` · ${data.year}` : ""}</div>}
    </PageSection>
  );
}

/* B2158065 — the table from /api/taxunits (the CAD's own per-account unit list + adopted rates).
 * Renders nothing until every lot's answer is complete: a partial list would understate the total. */
function ServerTaxTable({ county, lots, combined, idField }) {
  const accts = lots.map((l) => accountOf(l, idField));
  const key = `${county}|${accts.join(",")}`;
  const [res, setRes] = useState({ key: "", tables: null });
  useEffect(() => {
    let live = true;
    if (!TAX_UNIT_COUNTIES.has(county) || !accts.length || accts.some((a) => !a)) { setRes({ key, tables: null }); return undefined; }
    Promise.all(accts.map((a) => fetchTaxUnits(county, a))).then((rs) => { if (live) setRes({ key, tables: rs.map(tableFromUnits) }); });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (res.key !== key || !res.tables || res.tables.some((t) => !t)) return null;
  const data = combined ? taxTableForCombined(lots, { tableOf: (p) => res.tables[lots.indexOf(p)] }) : res.tables[0];
  return data ? <TaxTable data={data} /> : null;
}

/* A tax year, only when the county record itself carries one. */
function taxYearOf(attrs) {
  for (const k of Object.keys(attrs || {})) {
    if (/^(tax_?yea?r|taxyr|tax_yr|appraisal_?year|apprYear)$/i.test(k)) { const v = String(attrs[k] ?? "").trim(); if (/^\d{4}$/.test(v)) return v; }
  }
  return null;
}
