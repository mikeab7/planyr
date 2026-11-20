/* Model workspace — the panels of the Planyr-only tools on the Univer grid (NEW-1, cutover step 6; lib/univerTools/).
 *
 * The SAME components the old grid mounts — InconsistencyPanel, NameManager, CommandPalette — fed by the tools controller instead of
 * ModelApp's state, so a flag list, a name list and a palette row look and behave identically on both grids. They render in normal
 * flow ABOVE Univer's toolbar (the old arrangement: panels sit in the flow slot under the header, never as a fixed-offset overlay), and
 * the palette is the same fixed-position box. A thin status strip says what the trace is showing (level, truncation) and how to clear it. */
import { useSyncExternalStore } from "react";
import InconsistencyPanel from "./InconsistencyPanel.jsx";
import NameManager from "./NameManager.jsx";
import CommandPalette from "./CommandPalette.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";

const noop = () => {};
const EMPTY = Object.freeze({ panel: null, paletteOpen: false, flags: [], sheet: null, trace: null, rendered: null, selRange: { r1: 0, r2: 0, c1: 0, c2: 0 }, paletteRows: [], paletteCtx: {} });

function TraceStrip({ rendered, onClear }) {
  if (!rendered) return null;
  const what = rendered.mode === "precedents" ? "Precedents" : "Dependents";
  const bits = [`level ${rendered.level}`];
  if (rendered.noFurther) bits.push(rendered.mode === "precedents" ? "no further precedents" : "no further dependents");
  if (rendered.truncated) bits.push(`showing ${rendered.cellCount} cells — narrow the selection to see the rest`);
  if (rendered.markers && rendered.markers.length) bits.push(`${rendered.markers.length} link${rendered.markers.length === 1 ? "" : "s"} leave this sheet`);
  return (
    <div
      role="status" data-testid="univer-trace-strip"
      style={{ flex: "none", display: "flex", alignItems: "center", gap: 8, padding: "3px 10px", fontSize: 12, color: "var(--text-primary)", background: "var(--surface-raised)", borderBottom: "1px solid var(--border-default)" }}
    >
      <span style={{ fontWeight: 700 }}>Trace {what}</span>
      <span style={{ color: "var(--text-secondary)" }}>({bits.join(", ")}) — click the button again for one more level</span>
      <button
        type="button" onClick={onClear} data-testid="univer-trace-clear"
        style={{ marginLeft: "auto", height: 22, padding: "0 8px", borderRadius: RADIUS.sm, border: "1px solid var(--border-default)", background: "var(--surface-page)", color: "var(--text-primary)", font: "inherit", fontSize: 11, cursor: "pointer" }}
      >Remove arrows (Esc)</button>
    </div>
  );
}

export default function UniverToolPanels({ tools }) {
  const state = useSyncExternalStore(tools ? tools.subscribe : () => noop, tools ? tools.getState : () => EMPTY);
  if (!tools) return null;
  const close = () => tools.closePanel();
  return (
    <>
      <TraceStrip rendered={state.rendered} onClear={() => tools.run("planyr.tools.trace-clear")} />
      {state.sheet && <NameManager
        open={state.panel === "names"}
        sheet={state.sheet}
        selRange={state.selRange}
        onClose={close}
        onGoTo={tools.goTo}
        onDefineName={(name, rect) => tools.names.define(name, rect)}
        onRenameName={(oldName, newName) => tools.names.rename(oldName, newName)}
        onRetargetName={(name, rect) => tools.names.retarget(name, rect)}
        onDeleteName={(name) => tools.names.remove(name)}
      />}
      <InconsistencyPanel
        open={state.panel === "inconsistencies"}
        flags={state.flags}
        onClose={close}
        onGoTo={tools.goTo}
        onDismiss={tools.dismiss}
      />
      <CommandPalette open={state.paletteOpen} ctx={state.paletteCtx} commands={state.paletteRows} onClose={() => tools.closePalette()} />
    </>
  );
}
