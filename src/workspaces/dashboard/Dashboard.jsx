/* Dashboard — the real landing page above the six workspaces (B1213312/B1213313, owner decision
 * 2026-09-05). The wordmark, a bare planyr.io, and (per NEW-1) nothing else used to all resolve
 * to the Site Planner's map with no project open — a screen that was never actually built to be
 * a dashboard, just the thing that happened to render there. This is the real thing: a grid of
 * data-backed cards the owner arranges, with the layout saved to his account (see
 * lib/dashboardPrefs.js) so it follows him across devices.
 *
 * Not one of the six workspaces (see Shell.jsx's `active` — it's deliberately null while this is
 * open, so no module tab lights up), but it renders the SAME shared AppHeader every workspace
 * does, so the wordmark/tabs/account controls stay in one place and switching into a module from
 * here is a normal tab click, not a special case.
 *
 * Card content is read-only and best-effort: every data source degrades to an empty/"no data"
 * state on failure (LOUD-FAILURE is for writes; a dashboard summary card that can't reach one of
 * five independent sources should still render the other four, not blank the page).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import { Button, ToggleChip } from "../../shared/ui/controls.jsx";
import { RADIUS } from "../../shared/ui/radius.js";
import DashboardCard from "./components/DashboardCard.jsx";
import {
  JumpBackInCard, PipelineCard, PursuitsByActivityCard, GoingQuietCard, CompsSummaryCard, ScheduleHealthCard,
  CardSkeleton,
} from "./components/DashboardCards.jsx";
import { CARD_DEFS, normalizeLayout, availableToAdd, addCard, removeCard, toggleCardSize, moveCard } from "./lib/dashboardLayout.js";
import { loadDashboardLayout, saveDashboardLayout } from "./lib/dashboardPrefs.js";
import { fetchSiteSummaries } from "./lib/dashboardSitesFetch.js";
import { fetchCompsCounts } from "./lib/dashboardCompsFetch.js";
import { fetchLastTouchedDoc } from "./lib/dashboardDocFetch.js";
import { fetchScheduleProjects } from "./lib/dashboardScheduleFetch.js";
import { groupProjectsByGroupId, pipelineCounts, pursuitsByActivity, goingQuiet, mostRecentProject } from "./lib/dashboardPipeline.js";
import { summarizeScheduleHealth } from "./lib/scheduleHealth.js";

const SAVE_DEBOUNCE_MS = 900;

export default function Dashboard({ onShellSwitch, authControl, accountActive, userId, onNewProject, onNavigate, onOpenReviewInDocReview }) {
  const [layout, setLayout] = useState(() => normalizeLayout(null));
  const [customizing, setCustomizing] = useState(false);
  const [saveNote, setSaveNote] = useState(null); // null | "saved" | "local" | "error"
  const dragFromRef = useRef(null);
  const [dragOverIndex, setDragOverIndex] = useState(null);
  const layoutLoadedRef = useRef(false);
  const saveTimerRef = useRef(null);

  // Load the saved layout once per mount (this component is not kept alive — see Shell.jsx).
  useEffect(() => {
    let live = true;
    layoutLoadedRef.current = false;
    loadDashboardLayout(userId).then(({ layout: loaded }) => {
      if (!live) return;
      setLayout(loaded);
      layoutLoadedRef.current = true;
    });
    return () => { live = false; };
  }, [userId]);

  // Persist on every change, debounced — never on the initial load itself.
  useEffect(() => {
    if (!layoutLoadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveDashboardLayout(userId, layout).then((res) => setSaveNote(res.ok ? "saved" : userId ? "error" : "local"));
    }, SAVE_DEBOUNCE_MS);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, userId]);

  // ── Data: one fetch per source, in parallel, once per mount. ──────────────────────────────
  const [sites, setSites] = useState([]);
  const [comps, setComps] = useState(null);
  const [doc, setDoc] = useState(null);
  const [scheduleProjects, setScheduleProjects] = useState(null);
  // NEW-1 — every card's row count is unknown until its own source resolves, so a card that
  // resolves quickly used to show its final content (and take real taps) before a slower sibling
  // card had grown into its own final height, shoving the whole grid below it down the page out
  // from under a tap already in flight (event:click-swallowed, "moved": true). Nothing renders a
  // real, variable-height card until every source has resolved — see CardSkeleton's own header.
  const [dataReady, setDataReady] = useState(false);
  useEffect(() => {
    let live = true;
    setDataReady(false);
    Promise.allSettled([
      fetchSiteSummaries().then((v) => { if (live) setSites(v); }),
      fetchCompsCounts().then((v) => { if (live) setComps(v); }),
      fetchLastTouchedDoc().then((v) => { if (live) setDoc(v); }),
      fetchScheduleProjects().then((v) => { if (live) setScheduleProjects(v); }),
    ]).then(() => { if (live) setDataReady(true); });
    return () => { live = false; };
  }, [userId]);

  const projects = useMemo(() => groupProjectsByGroupId(sites), [sites]);
  const cardData = useMemo(() => ({
    jumpBackIn: { project: mostRecentProject(projects), doc },
    pipelineStatus: { counts: pipelineCounts(projects) },
    pursuitsByActivity: { rows: pursuitsByActivity(projects) },
    goingQuiet: { rows: goingQuiet(projects) },
    compsSummary: { counts: comps },
    scheduleHealth: { rows: scheduleProjects ? summarizeScheduleHealth(scheduleProjects) : [] },
  }), [projects, doc, comps, scheduleProjects]);

  const openProject = (p) => onNavigate?.({ module: "site-planner", projectId: p.groupId, cross: false, org: false });
  const openSchedule = (p) => onNavigate?.({ module: "scheduler", projectId: p.linkedSiteId, cross: false, org: false });
  const openDoc = (d) => onOpenReviewInDocReview?.({ id: d.id, project_id: d.projectId });

  // NEW-1 — while data is still loading every slot renders the SAME stable-height skeleton
  // instead of its real (variable-height) card; see the `dataReady` effect above.
  const SKELETON_ROWS = { jumpBackIn: 2, pipelineStatus: 2, scheduleHealth: 3, pursuitsByActivity: 3, compsSummary: 2, goingQuiet: 3 };
  const CARD_RENDERERS = dataReady ? {
    jumpBackIn: () => <JumpBackInCard {...cardData.jumpBackIn} onOpenProject={openProject} onOpenDoc={openDoc} />,
    pipelineStatus: () => <PipelineCard {...cardData.pipelineStatus} />,
    pursuitsByActivity: () => <PursuitsByActivityCard {...cardData.pursuitsByActivity} onOpenProject={openProject} />,
    goingQuiet: () => <GoingQuietCard {...cardData.goingQuiet} onOpenProject={openProject} />,
    compsSummary: () => <CompsSummaryCard {...cardData.compsSummary} />,
    scheduleHealth: () => <ScheduleHealthCard {...cardData.scheduleHealth} onOpenSchedule={openSchedule} />,
  } : Object.fromEntries(Object.keys(CARD_DEFS).map((k) => [k, () => <CardSkeleton rows={SKELETON_ROWS[k]} />]));

  const toAdd = availableToAdd(layout);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <AppHeader
        // Not a real module id — no tab in AppHeader's fixed six matches "dashboard", so none
        // of them highlight (B1213312's "no module tab active" requirement, satisfied for free).
        module="dashboard"
        onSwitch={onShellSwitch}
        onNewProject={onNewProject}
        authControl={authControl}
        accountActive={accountActive}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 22px 40px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 1040, margin: "0 auto 16px" }}>
          <h1 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", margin: 0, flex: 1 }}>Dashboard</h1>
          {customizing && saveNote && (
            <span style={{ fontSize: 10.5, color: saveNote === "error" ? "var(--danger-text)" : "var(--text-secondary)" }}>
              {saveNote === "saved" ? "Saved" : saveNote === "local" ? "Saved on this device" : "Couldn't save — try again"}
            </span>
          )}
          <Button
            size="sm"
            variant={customizing ? "primary" : "ghost"}
            onClick={() => setCustomizing((c) => !c)}
          >
            {customizing ? "Done" : "Customize"}
          </Button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: 14,
            maxWidth: 1040,
            margin: "0 auto",
          }}
        >
          {layout.map((entry, i) => {
            const def = CARD_DEFS[entry.key];
            const render = CARD_RENDERERS[entry.key];
            if (!def || !render) return null;
            return (
              <DashboardCard
                key={entry.key}
                title={def.title}
                wide={entry.size === "wide"}
                customizing={customizing}
                dragOver={dragOverIndex === i}
                draggable={customizing}
                onDragStart={() => { dragFromRef.current = i; }}
                onDragOver={(e) => { if (customizing) { e.preventDefault(); setDragOverIndex(i); } }}
                onDragEnd={() => setDragOverIndex(null)}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragFromRef.current != null) setLayout((l) => moveCard(l, dragFromRef.current, i));
                  dragFromRef.current = null;
                  setDragOverIndex(null);
                }}
                onToggleSize={() => setLayout((l) => toggleCardSize(l, entry.key))}
                onRemove={() => setLayout((l) => removeCard(l, entry.key))}
              >
                {render()}
              </DashboardCard>
            );
          })}
        </div>

        {customizing && (
          <div style={{ maxWidth: 1040, margin: "18px auto 0" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: 8 }}>
              Add a card
            </div>
            {toAdd.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {toAdd.map((key) => (
                  <ToggleChip key={key} onClick={() => setLayout((l) => addCard(l, key))}>
                    + {CARD_DEFS[key].title}
                  </ToggleChip>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "var(--text-secondary)", fontStyle: "italic" }}>Every available card is already on your dashboard.</div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
