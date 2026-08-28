/* VisitList — everywhere he's been. Sortable by rating, cost and date; filterable by name.
 * Pure presentational component: FoodApp resolves each visit's display name (from the
 * snapshot, from a manual pin, or "Unknown place") before handing rows in here.
 *
 * `query` is a CONTROLLED prop, not local state (owner, 2026-08-18: "ONE CONTROL. A search
 * box" — the same header SearchBox that searches the whole 34,000-place snapshot in Map view
 * doubles as this list's filter in List view; this component owns no text input of its own).
 *
 * ⛔ AMBIANCE (B634978, owner, 2026-08-19: "add an ambiance rating too... sortable by either, and both
 * visible on a row"). A second, independent column + sort, same shape as Rating's own. THE MAP
 * PIN STAYS KEYED TO FOOD ONLY — this file's Ambiance handling never touches pin colour, which
 * lives entirely in foodStore.js and never reads rating_ambiance.
 *
 * ⛔ ROW HIGHLIGHT (B634976, owner, 2026-08-19: "the selected row highlights too, and stays highlighted
 * while its panel is open"). `selectedKey` is the exact same string FoodMap.jsx uses to pick the
 * highlighted PIN and VisitPanel uses as its own key — computed once in FoodApp so all three
 * agree without re-deriving the identity logic three times.
 *
 * "What was good" (B634979) gets its own column here too — each row shows THAT visit's own
 * value (never an aggregate; the panel's own accumulated summary is a separate concern, see
 * VisitPanel.jsx's LikedDishes) — same shape as the existing "What I had" column beside it.
 *
 * ⛔ "WANT TO TRY" SHORTLIST (B669312, owner chat block, 2026-08-22). Flagged-but-unvisited places
 * appear as rows here too (FoodApp's `listRows` folds them in, `isWishlist: true`, every visit
 * field null) — a "Want to try" chip, same visual language as the sort row above, FILTERS to just
 * those rather than sorting (owner: "follow the existing chip pattern... do not invent a new
 * control style"). A per-row outlined pill next to the place name marks which rows are flagged,
 * same visual as the SearchBox badge for the identical reason (an outline reads as "not yet
 * visited," never competing with the rating pills' own fill colours).
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
  ambiance: { label: "Ambiance", get: (v) => (v.rating_ambiance == null ? -1 : Number(v.rating_ambiance)), dir: -1 },
  cost: { label: "Cost", get: (v) => (v.cost == null ? -1 : Number(v.cost)), dir: -1 },
  name: { label: "Name", get: (v) => (v.placeName || "").toLowerCase(), dir: 1 },
};

// Same identity FoodApp/FoodMap/VisitPanel already use — a row's OWN key, for comparing against
// the shared `selectedKey` prop.
function rowKey(v) {
  return v.place_id ? `place:${v.place_id}` : `pin:${v.custom_name}`;
}

function fieldStyle() {
  return {
    boxSizing: "border-box", padding: "6px 10px", borderRadius: 999,
    border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)",
    font: "inherit", fontSize: 12.5,
  };
}

export default function VisitList({ visits, query, onSelect, selectedKey }) {
  const [sortKey, setSortKey] = useState("date");
  // "Want to try" shortlist filter (B669312) — same chip visual as the sort row, but a FILTER
  // toggle, not a sort: narrows the rows down to flagged-but-unvisited places rather than
  // reordering them. Rows carry `isWishlist` (set by FoodApp's listRows).
  const [shortlistOnly, setShortlistOnly] = useState(false);

  const rows = useMemo(() => {
    const q = (query || "").trim().toLowerCase();
    let filtered = q ? visits.filter((v) => (v.placeName || "").toLowerCase().includes(q)) : visits;
    if (shortlistOnly) filtered = filtered.filter((v) => v.isWishlist);
    const { get, dir } = SORTS[sortKey];
    return [...filtered].sort((a, b) => (get(a) < get(b) ? -1 : get(a) > get(b) ? 1 : 0) * dir);
  }, [visits, query, sortKey, shortlistOnly]);

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
        <button
          type="button" onClick={() => setShortlistOnly((s) => !s)} aria-pressed={shortlistOnly}
          data-testid="food-list-shortlist-filter"
          style={{
            ...fieldStyle(), cursor: "pointer",
            background: shortlistOnly ? "var(--accent-food)" : "var(--surface-page)",
            color: shortlistOnly ? "var(--on-accent-food)" : "var(--text-primary)", fontWeight: shortlistOnly ? 700 : 500,
          }}
        >
          Want to try
        </button>
      </div>

      {rows.length === 0 ? (
        <div style={{ color: "var(--text-tertiary)", fontSize: 13, padding: "24px 4px" }}>
          {shortlistOnly ? "Nothing on your want-to-try list yet."
            : visits.length === 0 ? "Nothing logged yet — click a pin on the map to get started."
            : "No visits match that search."}
        </div>
      ) : (
        <div style={{ overflowY: "auto", flex: 1, minHeight: 0 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--text-tertiary)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                <th style={{ padding: "4px 8px", fontWeight: 700 }}>Place</th>
                <th style={{ padding: "4px 8px", fontWeight: 700 }}>Rating</th>
                <th style={{ padding: "4px 8px", fontWeight: 700 }}>Ambiance</th>
                <th style={{ padding: "4px 8px", fontWeight: 700 }}>Cost</th>
                <th style={{ padding: "4px 8px", fontWeight: 700 }}>Date</th>
                <th style={{ padding: "4px 8px", fontWeight: 700 }}>What I had</th>
                <th style={{ padding: "4px 8px", fontWeight: 700 }}>What was good</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((v) => {
                const isSelected = selectedKey != null && rowKey(v) === selectedKey;
                return (
                  <tr
                    key={v.id} onClick={() => onSelect?.(v)} data-testid="food-visit-row"
                    aria-selected={isSelected}
                    style={{
                      cursor: onSelect ? "pointer" : "default", borderTop: "1px solid var(--border-default)",
                      // A light tint + left accent stripe, never a solid fill — the rating/ambiance
                      // pills carry their OWN ramp colours (cream through deep red-brown) and a
                      // solid accent-food row background would fight them for legibility.
                      background: isSelected ? "color-mix(in srgb, var(--accent-food) 12%, transparent)" : "transparent",
                      boxShadow: isSelected ? "inset 3px 0 0 var(--accent-food)" : "none",
                    }}
                  >
                    <td style={{ padding: "7px 8px", color: "var(--text-primary)", fontWeight: 600 }}>
                      {v.placeName}
                      {v.isWishlist && (
                        <span style={{
                          marginLeft: 6, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.03em",
                          color: "var(--accent-food)", background: "transparent", border: "1px solid var(--accent-food)",
                          borderRadius: 999, padding: "0 5px",
                        }}>
                          Want to try
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "7px 8px" }}>
                      {v.rating ? (
                        <span style={{
                          display: "inline-block", borderRadius: 5, padding: "1px 6px", fontWeight: 700,
                          background: colorForRating(v.rating), color: textColorForRating(v.rating),
                        }}>
                          {/* Number(): rating is a Postgres numeric(4,2) column, so PostgREST's raw
                           * string is always 2-decimal-padded ("9.00", "8.50") — the numeric cast
                           * strips that padding back to natural precision ("9", "8.5"), same as
                           * VisitPanel.jsx's Chip does for this exact reason. */}
                          {Number(v.rating)}/10
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-tertiary)" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "7px 8px" }}>
                      {v.rating_ambiance ? (
                        <span style={{
                          display: "inline-block", borderRadius: 5, padding: "1px 6px", fontWeight: 700,
                          background: colorForRating(v.rating_ambiance), color: textColorForRating(v.rating_ambiance),
                        }}>
                          {Number(v.rating_ambiance)}/10
                        </span>
                      ) : (
                        <span style={{ color: "var(--text-tertiary)" }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: "7px 8px", color: "var(--text-primary)" }}>{v.cost != null ? `$${Number(v.cost).toFixed(2)}` : "—"}</td>
                    <td style={{ padding: "7px 8px", color: "var(--text-secondary)" }}>{v.visited_on || "—"}</td>
                    <td style={{ padding: "7px 8px", color: "var(--text-secondary)" }}>{v.what_i_had || "—"}</td>
                    <td style={{ padding: "7px 8px", color: "var(--text-secondary)" }}>{v.what_was_good || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
