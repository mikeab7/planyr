/* Headless harness for the Notes conflict-review UI (B849104–B849107). Renders the REAL
 * `ConflictNotice`/`ConflictReview` components (real CSS tokens, real diff/redline engine) with
 * a fixture reproducing the owner's exact reported case — a signature-block TABLE on the OLDER
 * copy, converted to plain contact lines on the NEWER copy — on SCRATCH data only (never his
 * live conflict). Served by `vite` dev; see verify-notes-conflict-review.mjs.
 *
 * `?fixture=` selects which pair loads: `main` (the owner's case, both timestamps known),
 * `unknown` (neither timestamp known — the graceful-degradation path), `tie` (identical
 * timestamps — must NOT read as one side being newer).
 */
import { createRoot } from "react-dom/client";
import ConflictNotice from "../src/workspaces/notes/components/ConflictNotice.jsx";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-09-02T12:00:00Z").getTime();

const p = (text) => ({ type: "paragraph", content: text ? [{ type: "text", text }] : [] });
const tableRow = (text) => ({ type: "tableRow", content: [{ type: "tableCell", content: [p(text)] }] });
const table = (...rows) => ({ type: "table", content: rows.map(tableRow) });

const CONTACT_LINES = ["Executive Assistant", "O: 281-305-1115", "M: (281) 705-2931", "E: Kandicec@quadvest.com"];

/* The owner's reported case: a table with an Outlook-signature-style contact block that had
 * "Convert table to text" run on it in one window but not the other. The OLDER copy (4 days
 * ago) still has the TABLE; the NEWER copy (1 day ago) has the four lines as plain text and no
 * table at all — exactly what B649377's `convertTableToText` command produces. */
const OLDER_DOC = { type: "doc", content: [p("Utility contacts"), table(...CONTACT_LINES)] };
const NEWER_DOC = { type: "doc", content: [p("Utility contacts"), ...CONTACT_LINES.map((l) => p(l))] };

const FIXTURES = {
  main: { localUpdatedAt: NOW - 4 * DAY, serverUpdatedAt: NOW - 1 * DAY },     // local(mine) = OLDER, server(theirs) = NEWER
  mineNewer: { localUpdatedAt: NOW - 1 * DAY, serverUpdatedAt: NOW - 4 * DAY }, // mirror: local = NEWER
  unknown: { localUpdatedAt: null, serverUpdatedAt: null },
  tie: { localUpdatedAt: NOW - DAY, serverUpdatedAt: NOW - DAY },
};

const params = new URLSearchParams(window.location.search);
const fixtureName = params.get("fixture") || "main";
const times = FIXTURES[fixtureName] || FIXTURES.main;

function App() {
  window.__choices = window.__choices || [];
  return (
    <div style={{ minHeight: "100vh", background: "var(--surface-page)" }}>
      <div style={{ padding: 16, color: "var(--text-primary)", fontFamily: "system-ui, sans-serif" }}>
        <p>Harness content behind the conflict UI (fixture: {fixtureName}).</p>
      </div>
      <ConflictNotice
        title="Utility"
        localDoc={OLDER_DOC}
        serverDoc={NEWER_DOC}
        localUpdatedAt={times.localUpdatedAt}
        serverUpdatedAt={times.serverUpdatedAt}
        onKeepMine={() => window.__choices.push("mine")}
        onKeepTheirs={() => window.__choices.push("theirs")}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
