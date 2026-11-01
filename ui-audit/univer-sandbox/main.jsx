/* Standalone host for UniverSheet (verification only; never part of the production build). It mounts the REAL
 * component with a workbook chosen by the harness (`window.__sandboxLoad(workbook, projectNames)`) and records every
 * workbook the grid emits, so the parity run can assert what WOULD be saved. The same checklist runs against the real
 * app (signed in as the test account) — this page exists because the sandbox has no owner account to switch on. */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import UniverSheet, { prewarmFramework } from "../../src/workspaces/model/components/UniverSheet.jsx";
import { createWorkbook, migrateWorkbook } from "../../src/workspaces/model/lib/sheetModel.js";
import { evaluateWorkbook } from "../../src/workspaces/model/lib/sheetEngine.js";

window.__PLANYR_E2E = true;
const REAL = new URLSearchParams(location.search).get("prewarm") === "real";
window.__saved = [];
// Planyr's OWN formula engine, in the same page, so the measurement script times both engines in one Chromium.
window.__oldEngine = { evaluateWorkbook, migrateWorkbook };
// NEW-1 (V2034432): the headless evaluator the Excel/CSV export uses, loaded lazily exactly as ModelApp does — run it in THIS page while the grid is mounted.
window.__evaluateForExport = (wb, projectNames) => import("../../src/workspaces/model/lib/univerEval.js").then((m) => m.evaluateForExport(wb, { projectNames }));

// NEW-2 — this host plays ModelApp's part of the save contract: an URGENT save (page hide / unload / unmount / export) is
// persisted SYNCHRONOUSLY into localStorage ("what the regular write-through would have stored"), a normal one is only recorded.
// `__sandboxExport()` is Export's path: flush the grid, read the workbook straight from the result.
function Host() {
  const [wb, setWb] = useState(() => (window.__sandboxInitial ? window.__sandboxInitial : createWorkbook()));
  const [names, setNames] = useState({});
  const [mounted, setMounted] = useState(true);
  window.__sandboxLoad = (next, projectNames) => { setNames(projectNames || {}); setWb(next); };
  window.__sandboxNames = (n) => setNames(n);
  window.__sandboxMount = (on) => setMounted(!!on);
  window.__sandboxExport = () => { const h = window.__sandboxHandle; return h ? h.flush({ urgent: true }) : null; };
  window.__sandboxCommitEditing = () => (window.__sandboxHandle ? window.__sandboxHandle.commitEditing() : null);
  if (!mounted) return <div data-testid="sandbox-unmounted" />;
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <UniverSheet
        workbook={wb} projectNames={names} viewKey={REAL ? "sbx" : undefined}
        onChange={(next, notes, meta) => {
          window.__saved.push({ wb: next, notes, urgent: !!(meta && meta.urgent) });
          if (meta && meta.urgent) { try { localStorage.setItem("sandbox:persisted", JSON.stringify(next)); } catch (_) {} }
          setWb(next);
        }}
        onNotice={(t) => { window.__notices = (window.__notices || []).concat(t); }}
        onReady={(h) => { window.__sandboxHandle = h; }}
      />
    </div>
  );
}
// ?prewarm=1 — build the framework instance AHEAD of the mount, exactly as the Spreadsheet tab's hover does (components/univerFramework.js), and give it
// time to reach Rendered, so the whole parity checklist can be run against the ADOPTED-instance path (verify-univer-parity.mjs, PARITY_PREWARM=1).
// ?prewarm=real — the same, but the instance is built from the DEVICE COPY of the workbook (B2607857): the initial workbook is stored where the app keeps a
// project's workbook and the pre-build is told the project, so the grid ADOPTS a unit that already holds the real workbook (PARITY_PREWARM=real).
const PREWARM = new URLSearchParams(location.search).get("prewarm");
if (PREWARM === "1" || PREWARM === "real") {
  let opts = {};
  if (REAL) {
    const wb0 = window.__sandboxInitial || createWorkbook();
    window.__sandboxInitial = wb0;
    localStorage.setItem("planyr:model:sheet:v1:local:sbx", JSON.stringify(wb0));
    opts = { projectId: "sbx", userId: null };
  }
  window.__prewarmBuilt = prewarmFramework(opts);
  setTimeout(() => createRoot(document.getElementById("root")).render(<Host />), 1500);
} else createRoot(document.getElementById("root")).render(<Host />);
