/* Headless harness for the Row-2 center slot (B385). Mounts the REAL AppHeader twice —
 * once WITHOUT toolbarCenter (the unchanged 2-zone tabs|toolbar layout) and once WITH it
 * (the new 3-zone tabs|center|toolbar layout) — so verify-b385-toolbar-center.mjs can prove:
 *   • the center zone renders ONLY when the prop is supplied;
 *   • the module tabs + the right toolbar render in BOTH cases (additive, no regression);
 *   • when present, the center group sits between the tabs and the toolbar and is optically
 *     centered (the left & right zones share the slack the same way Row 1 centers its name).
 * Served by `npm run dev`. */
import { createRoot } from "react-dom/client";
import AppHeader from "../src/shared/ui/AppHeader.jsx";
import { ThemeProvider } from "../src/shared/theme/ThemeProvider.jsx";

// Reused right-toolbar + center probes (immutable element descriptions, safe to share).
const rightTools = (
  <>
    <button data-testid="toolbar-probe">Export</button>
    <button>Save</button>
  </>
);
const centerGroup = (
  <div data-testid="center-probe" style={{ display: "flex", gap: 4 }}>
    <button>Grid</button><button>Split</button><button>Gantt</button>
  </div>
);

function App() {
  return (
    <ThemeProvider>
      <div data-scope="without">
        <AppHeader module="site-planner" toolbarContent={rightTools} />
      </div>
      <div style={{ height: 28 }} />
      <div data-scope="with">
        <AppHeader module="scheduler" toolbarCenter={centerGroup} toolbarContent={rightTools} />
      </div>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
