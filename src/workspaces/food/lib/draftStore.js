/* draftStore — keeps a half-typed Food form alive when the CARD CHANGES PARENT (rotate the phone).
 *
 * THE DEFECT IT CLOSES (V1476080 step 6, measured live on planyr.io 2026-10-08, WebKit iPhone 15 + SE): `VisitPanel` returns a
 * different parent for each layout — `SideDock` (phone sideways), `BottomSheet` (phone upright), the plain right rail (desktop).
 * Turning the phone swaps that parent, so React REMOUNTS the whole card and every `useState` inside the visit form, the edit-a-visit
 * form and the add-a-dish row starts again from empty: a dish name, cost, notes and ratings the person had typed were silently
 * gone. Nothing was saved and nothing said so (LOUD-FAILURE; the same family as EDITOR-EXIT-CONTRACT — an exit the editor did not
 * plan for must not discard what it shows).
 *
 * THE FIX, deliberately small: the panel owns ONE store (a ref'd Map that outlives the swap); a form field reads its kept value on
 * mount and writes every change back. The store is dropped when the panel itself goes (a different place, the ✕), and a form clears
 * its own key on an explicit Cancel or a confirmed save — so "re-opening an edit starts from the CURRENT saved row, never a stale
 * in-progress edit from before a Cancel" (VisitPanel's own contract) is unchanged. Outside a provider (a unit test, a fixture) the
 * hook is plain `useState`. Focus is NOT carried across the swap (the element is new): the keyboard closes, the text stays.
 */
import { createContext, useContext, useEffect, useState } from "react";

export function createDraftStore() {
  const forms = new Map();
  return {
    read(key, field) { const d = forms.get(key); return d && Object.prototype.hasOwnProperty.call(d, field) ? d[field] : undefined; },
    write(key, field, value) { let d = forms.get(key); if (!d) { d = {}; forms.set(key, d); } d[field] = value; },
    clear(key) { forms.delete(key); },
    has(key) { return forms.has(key); },
  };
}

export const DraftStoreContext = createContext(null);
export const useDraftStore = () => useContext(DraftStoreContext);

/** `useState` whose value survives the owning component being remounted under the same provider. `init` may be a function, like useState's. */
export function useDraftField(key, field, init) {
  const store = useDraftStore();
  const [value, setValue] = useState(() => {
    const kept = store ? store.read(key, field) : undefined;
    return kept !== undefined ? kept : (typeof init === "function" ? init() : init);
  });
  useEffect(() => { if (store) store.write(key, field, value); }, [store, key, field, value]);
  return [value, setValue];
}
