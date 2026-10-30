/* Standalone host for UniverSheet (verification only; never part of the production build). It mounts the REAL
 * component with a workbook chosen by the harness (`window.__sandboxLoad(workbook, projectNames)`) and records every
 * workbook the grid emits, so the parity run can assert what WOULD be saved. The same checklist runs against the real
 * app (signed in as the test account) — this page exists because the sandbox has no owner account to switch on. */
import { createRoot } from "react-dom/client";
import { useState } from "react";
import UniverSheet from "../../src/workspaces/model/components/UniverSheet.jsx";
import { createWorkbook } from "../../src/workspaces/model/lib/sheetModel.js";

window.__PLANYR_E2E = true;
window.__saved = [];

function Host() {
  const [wb, setWb] = useState(() => (window.__sandboxInitial ? window.__sandboxInitial : createWorkbook()));
  const [names, setNames] = useState({});
  window.__sandboxLoad = (next, projectNames) => { setNames(projectNames || {}); setWb(next); };
  window.__sandboxNames = (n) => setNames(n);
  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <UniverSheet
        workbook={wb} projectNames={names}
        onChange={(next, notes) => { window.__saved.push({ wb: next, notes }); setWb(next); }}
        onNotice={(t) => { window.__notices = (window.__notices || []).concat(t); }}
      />
    </div>
  );
}
createRoot(document.getElementById("root")).render(<Host />);
