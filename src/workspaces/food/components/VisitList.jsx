/* VisitList — everywhere he's been. Sortable by rating, cost and date; filterable by name.
 * Pure presentational component: FoodApp resolves each visit's display name (from the
 * snapshot, from a manual pin, or "Unknown place") before handing rows in here.
 *
 * `query` is a CONTROLLED prop, not local state (owner, 2026-08-18: "ONE CONTROL. A search
 * box" — the same header SearchBox that searches the whole 34,000-place snapshot in Map view
 * doubles as this list's filter in List view; this component owns no text input of its own).
 */
import { useMemo, useState } from "react";
import { colorForRating, textColorForRating } from "../lib/ratingColor.js";

const SORTS = {
  // A dateless visit's key is "" — the empty string, which string-compares BELOW every real
  // "YYYY-MM-DD" value, so with dir:-1 (most-recent-first) it sorts to the end rather than
  // landing at some arbitrary point or throwing on `new Date(null)` (owner, 2026-08-18: a
  // dateless visit "must render and sort sensibly ... rather than falling to [an unsorted mess]
  // or showing 'Invalid Date'" — this file never parses visited_on as a Date at all).
  date: { label: "Date", get: (v) => v.visited_on || "", dir: -1 },
  // rating/cost are Postgres `numeric` columns, which PostgREST returns as JSON STRINGS
  // ("7.5") — comparing those as strings breaks as soon as a two-digit value like "10.0"
  // exists ("10.0" < "9.5" lexically), so both are coerced through Number() here.
  rating: { label: "Rating", get: (v) => (v.rating == null ? -1 : Number(v.rating)), dir: -1 },
  cost: { label: "Cost", get: (v) => (v.cost == null ? -1 : Number(v.cost)), dir: -1 },
  name: { label: "Name", get: (v) => (v.placeName || "").toLowerCase(), dir: 1 },
};

function fieldStyle() {
  return {
    boxSizing: "border-box", padding: "6px 10px", borderRadius: 999,
    border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)",
    font: "inherit", fontSize: 12.5,
  };
}

export default function VisitList({ visits, query, onSelect }) {
  const [sortKey, setSortKey] = useState("date");

  const rows = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    const filtered = q ? visits.filter((v) => (v.placeName || "").toLowerCase().includes(q)) : visits;
    const { get, dir } = SORTS[sortKey];
    return [...filtered].sort((a, b) => (get(a) < get(b) ? -1 : get(a) > get(b) ? 1 : 0) * dir);
  }, [visits, query, sortKey]);

  return (
    <div data-testid="food-visit-list" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "12px 16px", overflow: "hidden" }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 10 }}>
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
                  <td style={{ padding: "7px 8px" }}>
                    {v.rating ? (
                      <span style={{
                        display: "inline-block", borderRadius: 5, padding: "1px 6px", fontWeight: 700,
                        background: colorForRating(v.rating), color: textColorForRating(v.rating),
                      }}>
                        {v.rating}/10
                      </span>
                    ) : (
                      <span style={{ color: "var(--text-tertiary)" }}>—</span>
                    )}
                  </td>
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
