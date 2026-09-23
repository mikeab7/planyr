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
/* ⛔ ALWAYS THE MOMENT THE HARNESS RUNS, NEVER A FIXED PAST DATE (NEW-1 fix, found running this
 * harness for the width-squeeze check below). A hardcoded `NOW` drifts: `stampLabel` rounds to
 * whole weeks once a timestamp is old enough, so "4 days before a fixed September 2026 date"
 * and "1 day before" it both round to the SAME "Nd ago"/weeks bucket by the time real wall-clock
 * time has moved a few weeks past that fixed point — two checks in this file's own "main
 * fixture" block (`legend states the old→new direction`, `the older copy's day-count is
 * genuinely larger`) started failing for exactly that reason, on unmodified code, with nothing
 * about the conflict UI itself broken. Deriving `NOW` from the real clock keeps the fixture's
 * 4-day/1-day gap meaningfully distinct forever. */
const NOW = Date.now();

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

/* NEW-3's own stress case — a long, unbroken sentence (no natural wrap points, echoing the
 * word-wrapped clip he reported: "…SHOULD BE ABLE TO PROVIDE BY T") on one side, ordinary
 * text on the other, so the layout check has something genuinely wide to try to overflow. */
const LONG_LINE = "We should be able to provide by the end of next week a complete revised set of civil drawings covering the detention pond regrading, the utility relocation exhibit, and the updated drainage report the reviewing engineer requested.";
const LONGTEXT_OLDER = { type: "doc", content: [p("Utility contacts"), p(LONG_LINE)] };
const LONGTEXT_NEWER = { type: "doc", content: [p("Utility contacts"), p("Utility contacts revised."), p(LONG_LINE)] };

/* A multi-column table WITH a header row — none of the other fixtures exercise this (they all
 * use single-cell signature-block rows), and it's a real shape a table can take (a schedule, a
 * comparison grid). Critique-loop round 2. */
const headerRow = (...cells) => ({ type: "tableRow", content: cells.map((text) => ({ type: "tableHeader", content: [p(text)] })) });
const dataRow = (...cells) => ({ type: "tableRow", content: cells.map((text) => ({ type: "tableCell", content: [p(text)] })) });
const gridTable = { type: "table", content: [
  headerRow("Item", "Due", "Status"),
  dataRow("Drainage report", "Sep 15", "In review"),
  dataRow("Utility relocation exhibit", "Sep 22", "Not started"),
] };
const MULTITABLE_OLDER = { type: "doc", content: [p("Open items"), gridTable] };
const MULTITABLE_NEWER = { type: "doc", content: [p("Open items"), p("See attached schedule.")] };

/* NEW-2's own stress case — a page TITLE with no spaces at all (a compound filename, a pasted
 * URL, a long unbroken project code). The compact notice interpolates the title straight into
 * its one-line message ("<title>" also changed…), and unlike LONG_LINE above (which lives deep
 * inside the review's own scroll pane) this string sits in the notice's flex row, which is
 * rendered ABOVE the two-pane layout with nothing to clip a cross-axis overflow — exactly the
 * shape that can squeeze the whole page sideways rather than just its own card. */
const LONG_TITLE = "UtilityRelocationExhibitRevisionDraftForBaytownCivilSubmittalPackageFinalApprovedVersion";

const FIXTURES = {
  main: { localUpdatedAt: NOW - 4 * DAY, serverUpdatedAt: NOW - 1 * DAY },     // local(mine) = OLDER, server(theirs) = NEWER
  mineNewer: { localUpdatedAt: NOW - 1 * DAY, serverUpdatedAt: NOW - 4 * DAY }, // mirror: local = NEWER
  unknown: { localUpdatedAt: null, serverUpdatedAt: null },
  tie: { localUpdatedAt: NOW - DAY, serverUpdatedAt: NOW - DAY },
  longtext: { localUpdatedAt: NOW - 4 * DAY, serverUpdatedAt: NOW - 1 * DAY, docs: [LONGTEXT_OLDER, LONGTEXT_NEWER] },
  multitable: { localUpdatedAt: NOW - 4 * DAY, serverUpdatedAt: NOW - 1 * DAY, docs: [MULTITABLE_OLDER, MULTITABLE_NEWER] },
  longtitle: { localUpdatedAt: NOW - 4 * DAY, serverUpdatedAt: NOW - 1 * DAY, title: LONG_TITLE },
};

const params = new URLSearchParams(window.location.search);
const fixtureName = params.get("fixture") || "main";
const times = FIXTURES[fixtureName] || FIXTURES.main;
const [fixtureOlder, fixtureNewer] = times.docs || [OLDER_DOC, NEWER_DOC];

function App() {
  window.__choices = window.__choices || [];
  return (
    <div style={{ minHeight: "100vh", background: "var(--surface-page)" }}>
      <div style={{ padding: 16, color: "var(--text-primary)", fontFamily: "system-ui, sans-serif" }}>
        <p>Harness content behind the conflict UI (fixture: {fixtureName}).</p>
      </div>
      <ConflictNotice
        title={times.title || "Utility"}
        localDoc={fixtureOlder}
        serverDoc={fixtureNewer}
        localUpdatedAt={times.localUpdatedAt}
        serverUpdatedAt={times.serverUpdatedAt}
        onKeepMine={() => window.__choices.push("mine")}
        onKeepTheirs={() => window.__choices.push("theirs")}
      />
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
