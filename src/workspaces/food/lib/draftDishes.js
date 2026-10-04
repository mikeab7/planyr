/* draftDishes — the dishes typed into a NEW visit's form, before the visit exists.
 *
 * `food_dishes.visit_id` is required, so a dish can only be written after its visit. The form
 * therefore holds drafts and hands them to FoodApp's submitVisit, which writes the visit and then
 * each dish. This file is the pure part: turn the draft rows into the payload, or say why not.
 * A rated-but-unnamed row is an ERROR (LOUD-FAILURE), never silently dropped; a completely blank
 * row (no name, no score) is just an unused slot and is ignored. */
let seq = 0;
export const newDraftDish = () => ({ key: `dd-${++seq}`, name: "", score: null });

export function cleanDraftDishes(rows) {
  const dishes = [];
  for (const r of rows || []) {
    const name = (r.name || "").trim();
    if (!name && r.score == null) continue;
    if (!name) return { dishes: [], error: "Name the dish you rated, or clear its rating." };
    dishes.push({ name, score: r.score == null ? null : Number(r.score) });
  }
  return { dishes, error: null };
}
