/* VisitList — everywhere he's been. Sortable by rating, cost and date; searchable by name.
 * Pure presentational component: FoodApp resolves each visit's display name (from the
 * snapshot, from a manual pin, or "Unknown place") before handing rows in here.
 */
import { useMemo, useState } from "react";

const SORTS = {
  date: { label: "Date", get: (v) => v.visited_on || "", dir: -1 },
  rating: { label: "Rating", get: (v) => v.rating ?? -1, dir: -1 },
  cost: { label: "Cost", get: (v) => v.cost ?? -1, dir: -1 },
  name: { label: "Name", get: (v) => (v.placeName || "").toLowerCase(), dir: 1 },
};

function fieldStyle() {
  return {
    boxSizing: "border-box", padding: "6px 10px", borderRadius: 999,
    border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)",
    font: "inherit", fontSize: 12.5,
  };
}

export default function VisitList({ visits, onSelect }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState("date");

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q ? visits.filter((v) => (v.placeName || "").toLowerCase().includes(q)) : visits;
    const { get, dir } = SORTS[sortKey];
    return [...filtered].sort((a, b) => (get(a) < get(b) ? -1 : get(a) > get(b) ? 1 : 0) * dir);
  }, [visits, query, sortKey]);

  return (
    <div data-testid="food-visit-list" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "12px 16px", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
        <input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name…" style={{ ...fieldStyle(), flex: "1 1 180px" }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {Object.entries(SORTS).map(([key, s]) => (
            <button
              key={key} type="button" onClick={() => setSortKey(key)}
              aria-pressed={sortKey === key}
              style={{
                ...fieldStyle(), cursor: "pointer",
                background: sortKey === key ? "var(--accent-food)" : "var(--surface-page)",
                color: sortKey === key ? "var(--on-accent-food)" : "var(--text-primary)", fontWeight: sortKey === key ? 700 : 500,
              }}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {rows.length === 0 ? (
        <div style={{ color: "var(--text-tertiary)", fontSize: 13, padding: "24px 4px" }}>
          {visits.length === 0 ? "Nothing logged yet — click a pin on the map to get started." : "No visits match that search."}
        </div>
      ) : (
        <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-tertiary)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <th style={{ padding: "4px 8px", fontWeight: 700 }}>Place</th>
                <th style={{ padding: "4px 8px", fontWeight: 700 }}>Rating</th>
                <th style={{ padding: "4px 8px", fontWeight: 700 }}>Cost</th>
                <th style={{ padding: "4px 8px", fontWeight: 700 }}>Date</th>
                <th style={{ padding: "4px 8px", fontWeight: 700 }}>What I had</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => (
                <tr
                  key={v.id} onClick={() => onSelect?.(v)} data-testid="food-visit-row"
                  style={{ cursor: onSelect ? "pointer" : "default", borderTop: "1px solid var(--border-default)" }}
                >
                  <td style={{ padding: "7px 8px", color: "var(--text-primary)", fontWeight: 600 }}>{v.placeName}</td>
                  <td style={{ padding: "7px 8px", color: "var(--warn-text)" }}>{v.rating ? "★".repeat(v.rating) : "—"}</td>
                  <td style={{ padding: "7px 8px" }}>{v.cost != null ? `$${Number(v.cost).toFixed(2)}` : "—"}</td>
                  <td style={{ padding: "7px 8px", color: "var(--text-secondary)" }}>{v.visited_on || "—"}</td>
                  <td style={{ padding: "7px 8px", color: "var(--text-secondary)" }}>{v.what_i_had || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
