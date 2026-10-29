/* The planner canvas's layer CLICK CARD (B2507062, owner constraint #45). Module-scope component (MODULE-SCOPE-COMPONENTS). Every item is passed through
 * `cleanCard` (lib/identifyCard.js) first — plain labels, no raw field names, no empty rows, normal dates, short labelled links — and the layer's source / vintage
 * sits behind a small (i), never on the card face. Colours come in as props so the card follows the planner's palette without importing it. */
import { useState } from "react";
import { cleanCard } from "../lib/identifyCard.js";

function CardItem({ item, first, ink, muted, accent }) {
  const [aboutOpen, setAboutOpen] = useState(false);
  return (
    <div style={{ marginTop: first ? 0 : 8 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 6, fontWeight: 700, fontSize: 12.5, marginBottom: 2, color: ink }}>
        <span>{item.title}</span>
        {item.about && (
          <button type="button" onClick={() => setAboutOpen((v) => !v)} title="About this layer" aria-label="About this layer" aria-expanded={aboutOpen} data-testid="gis-identify-about"
            style={{ flex: "none", width: 16, height: 16, borderRadius: "50%", border: `1px solid ${muted}`, background: "transparent", color: muted, cursor: "pointer", fontFamily: "inherit", fontSize: 10, fontWeight: 600, lineHeight: 1, padding: 0 }}>i</button>
        )}
      </div>
      {item.rows.map((r, j) => (
        <div key={j}>
          <span style={{ color: muted }}>{r.label}: </span>
          {r.href
            ? <a href={r.href} target="_blank" rel="noopener noreferrer" style={{ color: accent }}>{r.text}</a>
            : <span>{r.text}</span>}
        </div>
      ))}
      {item.note && <div style={{ color: muted, marginTop: 3 }}>{item.note}</div>}
      {item.about && aboutOpen && <div data-testid="gis-identify-source" style={{ color: muted, fontSize: 10.5, marginTop: 4, whiteSpace: "pre-line" }}>{item.about}</div>}
    </div>
  );
}

export default function GisIdentifyCard({ hit, size, onClose, ink, muted, accent, line }) {
  const items = (hit.items || []).map(cleanCard).filter(Boolean);
  if (!items.length) return null;
  return (
    <div data-export="skip" data-testid="gis-identify"
      style={{ position: "absolute", zIndex: 45, maxWidth: 260,
        left: Math.max(6, Math.min(hit.x + 10, (size.w || 0) - 268)),
        top: Math.max(6, Math.min(hit.y + 10, (size.h || 0) - 120)),
        background: "var(--surface-overlay)", color: ink, border: `1px solid ${line}`,
        borderRadius: 9, boxShadow: "0 8px 26px rgba(28,25,20,0.24)", padding: "9px 11px",
        fontSize: 11.5, lineHeight: 1.45 }}>
      <button onClick={onClose} title="Close" aria-label="Close feature details"
        style={{ float: "right", marginLeft: 8, background: "transparent", border: "none", color: muted, cursor: "pointer", fontFamily: "inherit", fontSize: 12, lineHeight: 1, padding: 0 }}>✕</button>
      {items.map((it, i) => <CardItem key={it.id || i} item={it} first={i === 0} ink={ink} muted={muted} accent={accent} />)}
    </div>
  );
}
