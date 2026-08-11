/* IntegrityBanner — the two findings nothing could previously mention (B315715, B342992).
 *
 * ⛔ IT IS ITS OWN LAZY CHUNK, and that is a measured bundle decision rather than tidiness.
 * The bar renders only when there is a real finding, which is almost never — so on the
 * overwhelming majority of loads its bytes would be downloaded before the notebook rail can
 * paint, for a component nobody sees. Same reasoning as the editor and Quick Open. It is
 * pulled in from Notes.jsx behind a Suspense with a null fallback: a bar that arrives a
 * moment late is exactly as useful, and a rail that paints a moment sooner is the thing this
 * route's byte budget exists to protect.
 */
import { NO_PROJECT_LABEL } from "../lib/notesModel.js";
import { duplicateNotice } from "../lib/notesDuplicates.js";
import { absoluteStamp } from "../lib/notesTime.js";

const RADIUS = { control: 8, pill: 999 };

/** ⛔ THE SAME NOTE IN TWO PROJECTS, AND A NOTE THAT WAS FILED NOWHERE — SAID OUT LOUD.
 *
 *  Two findings, one bar, and each one exists because the product had no way to mention
 *  something it already knew:
 *
 *  • A NOTE IN TWO PROJECTS (NEW-4, prior round). Copied into an unrelated pursuit, found by
 *    hand a week later under a tombstone heading.
 *  • A NOTE WITH NO NODE (NEW-1). The first version of this bar said "One note is filed in no
 *    project and reachable from nowhere" — a correct finding, rendered useless: it named no
 *    note, opened nothing and offered no action, so the only thing a person could do with it
 *    was worry. It now NAMES each one (its first line, when it was written, how much is
 *    there), it has ALREADY put them somewhere visible by the time you read it, and every way
 *    out is one click away in the bar itself.
 *
 *  ⛔ THE RECOVERY IS NOT A BUTTON, IT IS DONE. Auto-adoption runs on load, so the note is
 *  reachable before anyone reads this. A "Put it back" the user had to find was one more
 *  chance for a real note to sit lost while a banner talked about it. */
export default function IntegrityBanner({ duplicates, unreachable, recovered, projectNames, projects, onOpen, onFile, onBin, onDismiss }) {
  const dupLine = duplicateNotice(duplicates);
  const lost = (recovered || []).length;
  const stillLost = (unreachable || []).length;
  if (!dupLine && !lost && !stillLost) return null;
  const nameOf = (id) => (id == null ? NO_PROJECT_LABEL : projectNames.get(id) || "a project that no longer exists");
  const first = duplicates?.[0] || null;
  const pill = (extra = {}) => ({
    flex: "0 0 auto", border: "1px solid var(--warn-text)", borderRadius: RADIUS.pill,
    background: "transparent", color: "var(--warn-text)", font: "inherit",
    fontSize: 11.5, fontWeight: 700, padding: "2px 10px", cursor: "pointer", ...extra,
  });
  return (
    <div
      role="alert"
      data-testid="notes-integrity-banner"
      data-duplicates={duplicates?.length || 0}
      data-unreachable={stillLost}
      data-recovered={lost}
      style={{
        flex: "none", display: "flex", flexDirection: "column", gap: 6, padding: "7px 14px",
        background: "var(--warn-bg)", borderBottom: "1px solid var(--border-default)",
        color: "var(--warn-text)", fontSize: 12.5, fontWeight: 600,
      }}
    >
      {dupLine ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            {`${dupLine} ${first ? first.pages.map((p) => `“${p.title}” in ${nameOf(p.projectId)}` + (p.where === "bin" ? " (in the bin)" : "")).join(" · ") : ""}`}
          </span>
          {first ? <button type="button" data-testid="notes-integrity-open" onClick={() => onOpen(first)} style={pill()}>Show me</button> : null}
        </div>
      ) : null}

      {lost ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          {/* ⛔ PLURAL-CORRECT, and it says what ALREADY HAPPENED rather than what could. */}
          <span data-testid="notes-recovered-summary">
            {lost === 1 ? "One note had lost its place" : `${lost} notes had lost their place`} and {lost === 1 ? "has" : "have"} been put back under “{NO_PROJECT_LABEL}”.
            {" "}Nothing was lost — but {lost === 1 ? "its name lived on the entry that went missing, so it is named" : "their names lived on the entries that went missing, so they are named"} from {lost === 1 ? "its" : "their"} first line.
          </span>
          {(recovered || []).map((r) => (
            <div key={r.pageId} data-testid={`notes-recovered-${r.pageId}`} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                data-testid={`notes-recovered-open-${r.pageId}`}
                onClick={() => onOpen({ pages: [{ pageId: r.pageId, projectId: null, where: "live", title: r.title }] })}
                title="Open this note"
                style={{ flex: "1 1 220px", minWidth: 0, textAlign: "left", border: "none", background: "transparent", color: "var(--warn-text)", font: "inherit", fontWeight: 700, cursor: "pointer", textDecoration: "underline", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
              >{r.firstLine || r.title}</button>
              <span style={{ flex: "0 0 auto", fontWeight: 600, opacity: 0.85 }}>
                {r.chars} characters{r.createdAt ? ` · written ${absoluteStamp(r.createdAt).split(",")[0]}` : ""}
              </span>
              {/* File under a project… — a real <select>, because "which project" is a list
                  and an inline editor beats a dialog (house rule). */}
              <select
                data-testid={`notes-recovered-file-${r.pageId}`}
                value=""
                onChange={(e) => { if (e.target.value !== "") onFile(r.pageId, e.target.value === "__none__" ? null : e.target.value); }}
                style={{ flex: "0 0 auto", font: "inherit", fontSize: 11.5, fontWeight: 700, borderRadius: RADIUS.control, border: "1px solid var(--warn-text)", background: "transparent", color: "var(--warn-text)", padding: "2px 6px", cursor: "pointer" }}
              >
                <option value="">File under…</option>
                <option value="__none__">Keep as loose</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              <button type="button" data-testid={`notes-recovered-bin-${r.pageId}`} onClick={() => onBin(r.pageId)} style={pill()}>Move to bin</button>
            </div>
          ))}
        </div>
      ) : null}

      {stillLost ? (
        <span data-testid="notes-integrity-stuck">
          {stillLost === 1 ? "One note is" : `${stillLost} notes are`} filed nowhere and could NOT be put back — this browser refused the write, so nothing was changed.
        </span>
      ) : null}

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="button" onClick={onDismiss} style={pill({ border: "1px solid var(--border-default)" })}>Dismiss</button>
      </div>
    </div>
  );
}

