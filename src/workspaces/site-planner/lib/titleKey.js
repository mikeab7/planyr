/* The title-reader's stored API key — split out of `titleReader.js` so the planner can read it
 * WITHOUT dragging the reader in (B1123 bundle-budget offset).
 *
 * Why this file exists. `titleReader.js` carries the Claude structured-output SCHEMA and the prompt
 * text: several KB of string literals that survive minification untouched, and that nothing needs
 * until someone actually uploads a title commitment. But `SitePlanner.jsx` also needed `getKey` /
 * `setKey` synchronously — the key seeds a `useState` initializer and an onChange handler — and a
 * static import of the reader for those three lines pulled the whole schema onto the site route's
 * critical path. These helpers are trivial and have no dependencies, so they live here; the reader
 * is now loaded on demand from the extract handler.
 *
 * `titleReader.js` re-exports these, so any other consumer keeps working unchanged.
 */
export const KEY_LS = "planarfit:anthropicKey";
export const getKey = () => { try { return localStorage.getItem(KEY_LS) || ""; } catch (_) { return ""; } };
export const setKey = (k) => { try { k ? localStorage.setItem(KEY_LS, k) : localStorage.removeItem(KEY_LS); } catch (_) {} };
