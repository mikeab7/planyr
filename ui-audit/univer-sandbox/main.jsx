/* Standalone host for UniverSheet (verification only; never part of the production build). It mounts the REAL
 * component with a workbook chosen by the harness (`window.__sandboxLoad(workbook, projectNames)`) and records every
 * workbook the grid emits, so the parity run can assert what WOULD be saved. The same checklist runs against the real
 * app (signed in as the test account) — this page exists because the sandbox has no owner account to switch on. */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import UniverSheet from "../../src/workspaces/model/components/UniverSheet.jsx";
import { createWorkbook, migrateWorkbook } from "../../src/workspaces/model/lib/sheetModel.js";
import { evaluateWorkbook } from "../../src/workspaces/model/lib/sheetEngine.js";

window.__PLANYR_E2E = true;
window.__saved = [];
// Planyr's OWN formula engine, in the same page, so the measurement script times both engines in one Chromium.
window.__oldEngine = { evaluateWorkbook, migrateWorkbook };

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
        workbook={wb} projectNames={names}
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
createRoot(document.getElementById("root")).render(<Host />);
