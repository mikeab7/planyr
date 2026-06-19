/* Sequence Planyr workspace — embeds the scheduler in-page via iframe.
 * The sequence app's own header is hidden when it detects it's inside an iframe
 * (see public/sequence/index.html — the .in-iframe CSS class). */
import AppHeader from "../../shared/ui/AppHeader.jsx";

export default function Scheduler({ shellModule, onShellSwitch, authControl, onOpenFiles } = {}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#f6f8fa" }}>
      <AppHeader
        module={shellModule || "scheduler"}
        onSwitch={onShellSwitch}
        authControl={authControl}
        onOpenFiles={onOpenFiles}
      />
      <iframe
        src="/sequence/"
        title="Sequence Planyr"
        style={{ flex: 1, border: "none", width: "100%", minHeight: 0, display: "block" }}
      />
    </div>
  );
}
