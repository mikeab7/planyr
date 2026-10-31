/* The Univer grid loaded the way the real app loads it: through React.lazy, as its OWN chunk, after the host page is idle
 * (verification only; never part of the production build). measure-univer-tti.mjs uses it for the "click after hover" arm:
 *   window.__warm()          — what hovering the Spreadsheet tab does (src/workspaces/model/lib/univerWarm.js: fetch + evaluate the chunk)
 *   window.__mountUniver(wb) — what clicking it does (the lazy import resolves from the warm module, or fetches it if cold)
 * The cold arm is the same page without calling __warm first. */
import { createRoot } from "react-dom/client";
import { lazy, Suspense, useState } from "react";
import { warmUniver } from "../../src/workspaces/model/lib/univerWarm.js";

window.__PLANYR_E2E = true;
const UniverSheet = lazy(() => import("../../src/workspaces/model/components/UniverSheet.jsx"));
window.__warm = () => warmUniver({ force: true });
function Host() {
  const [wb, setWb] = useState(null);
  window.__mountUniver = (w) => setWb(w);
  return wb ? <div style={{ height: "100%", display: "flex", flexDirection: "column" }}><Suspense fallback={<div data-testid="loading" />}><UniverSheet workbook={wb} projectNames={{}} onChange={() => {}} onNotice={() => {}} onReady={() => {}} /></Suspense></div> : <div data-testid="idle" />;
}
createRoot(document.getElementById("root")).render(<Host />);
window.__hostReady = true;
