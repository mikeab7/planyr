/* Fixture page for ui-audit/verify-food-visit-phone.mjs (NEW-1, Food on a phone). Mounts the REAL
 * VisitPanel with in-memory handlers so the visit/dish form can be driven signed-out, with no
 * Supabase and no real data. Served only by a local vite dev server — never part of the build.
 * `?visits=1` seeds one existing visit (with legacy "What I had" text) + one dish, for the
 * edit-an-existing-visit cases. Every handler call is recorded on window.__calls. */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import "../../src/index.css";
import VisitPanel from "../../src/workspaces/food/components/VisitPanel.jsx";

const seeded = ["visits", "buffalo"].some((k) => new URLSearchParams(location.search).get(k) === "1");
const newPin = new URLSearchParams(location.search).get("newpin") === "1";
// `?buffalo=1` — the owner's own repro place (B2046224 recurrence, 2026-10-04): The Buffalo Grill,
// category line "Bar and Grill Restaurant", 1301 S Voss Rd — a place he has visited, so the sheet
// shows the Dishes · Sort row with "+ Add a dish" right under it. Fixture data only, no real rows.
const buffalo = new URLSearchParams(location.search).get("buffalo") === "1";
window.__calls = { visits: [], edits: [], dishes: [] };

function App() {
  const [visits, setVisits] = useState(seeded ? [{
    id: "v1", rating: "8", rating_ambiance: null, cost: null, visited_on: "2026-09-01",
    what_i_had: "Brisket plate, queso", what_was_good: null, notes: null, would_return: null,
  }] : []);
  const [pinName, setPinName] = useState("");
  const [dishes, setDishes] = useState(seeded ? [{ id: "d1", visit_id: "v1", name: "Brisket", score: "8", course: null, order_again: null, price_cents: null, note: null, visited_on: "2026-09-01" }] : []);
  return (
    <VisitPanel
      place={buffalo
        ? { name: "The Buffalo Grill", category: "bar_and_grill_restaurant", address: "1301 S Voss Rd, Houston, TX 77057", lat: 29.7499, lon: -95.4955 }
        : { name: "Fixture Smokehouse", category: "bbq_restaurant", address: null, lat: 29.76, lon: -95.37 }}
      pastVisits={visits}
      onClose={() => {}}
      manualNameEditable={newPin} manualName={pinName} onManualNameChange={setPinName}
      onSubmitVisit={async (fields) => {
        window.__calls.visits.push(fields);
        const { dishes: draft = [], ...rest } = fields;
        const id = `v${visits.length + 1}-new`;
        setVisits((v) => [{ id, ...rest }, ...v]);
        setDishes((d) => [...draft.map((x, i) => ({ id: `${id}-d${i}`, visit_id: id, ...x })), ...d]);
        return true;
      }}
      onEditVisit={async (id, fields) => { window.__calls.edits.push({ id, fields }); setVisits((v) => v.map((x) => (x.id === id ? { ...x, ...fields } : x))); return true; }}
      onDeleteVisit={() => {}}
      dishesWithDate={dishes}
      onSaveDish={async (f) => { window.__calls.dishes.push(f); return true; }}
      onDeleteDish={() => {}}
      pending={false}
    />
  );
}
createRoot(document.getElementById("root")).render(<App />);
