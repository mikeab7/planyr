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
 *
 * ── The arrangeable grid (NEW-1, the react-grid-layout rework) ────────────────────────────────
 * The original release (B1213313) hand-rolled HTML5 native drag-and-drop over a CSS auto-fit
 * grid, with resize limited to one wide/normal toggle. This uses react-grid-layout (MIT; pulls
 * react-draggable + react-resizable, ~35 KB minified combined — well inside the bundle budget,
 * see the item this shipped under) for real free-form drag/resize: cards drag by their own
 * header only (DashboardCard's `dashboard-card-drag-handle` class, matched via `draggableHandle`
 * below — a native-drag whole-card wrapper couldn't tell "reorder this" from "scroll this card's
 * list"), resize from the bottom-right corner only (`resizeHandles={["se"]}`), and every card
 * type carries its own minimum footprint (CARD_DEFS' minW/minH) so it can't be crushed to
 * unreadable.
 *
 * Below NARROW_BREAKPOINT_PX react-grid-layout isn't mounted at all — "don't let a phone
 * drag-resize a grid it cannot see" is satisfied by there being no grid to drag in the first
 * place; cards render as a plain single-column stack, ordered by the position the user actually
 * arranged on the wide grid (lib/dashboardLayout.js's narrowOrder — top-to-bottom, left-to-right
 * by x/y, never by array storage order, which carries no meaning once cards have x/y positions).
 * Remove / Add / Reset stay live at any width; only the drag/resize gesture is width-gated.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import GridLayout, { WidthProvider } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import { Button, ToggleChip } from "../../shared/ui/controls.jsx";
import DashboardCard from "./components/DashboardCard.jsx";
import DashboardTopoBackground from "./components/DashboardTopoBackground.jsx";
import {
  JumpBackInCard, JumpBackInCountControl, PipelineCard, GoingQuietCard, ScheduleHealthCard,
  CardSkeleton,
} from "./components/DashboardCards.jsx";
import CompsCard from "./components/CompsCard.jsx";
import { NeedsAttentionCard } from "./components/NeedsAttentionCard.jsx";
import { PursuitsCard } from "./components/PursuitsCard.jsx";
import { RecentPlansCard } from "./components/RecentPlansCard.jsx";
import { SinceLastHereCard } from "./components/SinceLastHereCard.jsx";
import {
  CARD_DEFS, GRID_COLS, normalizeLayout, availableToAdd, addCard, removeCard, resetLayout,
  applyGridChange, narrowOrder, toRglItem, dismissCard, undismissCard,
  JUMP_BACK_IN_COUNT_DEFAULT, JUMP_BACK_IN_COUNT_MIN, JUMP_BACK_IN_COUNT_MAX, normalizeJumpBackInCount,
} from "./lib/dashboardLayout.js";
import { pickRecentPlans } from "./lib/recentPlans.js";
import { loadDashboardLayout, saveDashboardLayout } from "./lib/dashboardPrefs.js";
import { loadCompsRatePeriod, saveCompsRatePeriod } from "../../shared/comps/lib/compsRatePeriodPrefs.js";
import { loadSinceLastHere, saveSinceLastHere } from "./lib/dashboardSinceLastHerePrefs.js";
import { fetchSiteSummaries } from "./lib/dashboardSitesFetch.js";
import { fetchAllCompsForCard, fetchCompsForMap } from "./lib/dashboardCompsFetch.js";
import { buildCompsCardData } from "./lib/compsCardModel.js";
import { fetchRecentComps } from "./lib/dashboardCompsRecentFetch.js";
import { fetchRecentNotePages } from "./lib/dashboardNotesRecentFetch.js";
import { fetchLastTouchedDoc } from "./lib/dashboardDocFetch.js";
import { fetchScheduleProjects, fetchScheduleLastWriteAt } from "./lib/dashboardScheduleFetch.js";
import { fetchAllElementRecency } from "./lib/dashboardElementRecencyFetch.js";
import { fetchElementsForSites } from "./lib/dashboardYieldFetch.js";
import { yieldBySite, buildingCountBySite } from "./lib/buildingYield.js";
import { groupProjectsByGroupId, pipelineCounts, goingQuiet, recentProjects } from "./lib/dashboardPipeline.js";
import { summarizeScheduleHealth } from "./lib/scheduleHealth.js";
import { needsAttentionList } from "./lib/needsAttentionList.js";
import { pursuitsTable, quietDaysByGroupFromRows } from "./lib/pursuitsList.js";
import { buildSinceLastHereFeed } from "./lib/sinceLastHereFeed.js";
import { spanWords } from "./lib/dashboardDates.js";

// B1426608 — cards whose content is a short text/number list (no chart, map, or
// thumbnail grid measuring its own box) shrink to content instead of stretching to fill their
// reserved grid tile — see DashboardCard's own `sizeToContent` header. Left off for recentPlans
// (its thumbnail grid measures its own box to choose a layout), compsSummary (its peer scale bar
// is laid out against the card's available room) and locationsMap (a real Leaflet map needs a
// defined height to render into). Applied only once `dataReady` (below) — every card still shows
// the SAME stable, full-height skeleton while loading, so this never touches the "every card
// swaps to real content in one synchronized paint" guarantee CardSkeleton's own header describes.
const SIZE_TO_CONTENT_CARDS = new Set([
  "jumpBackIn", "pipelineStatus", "needsAttention", "pursuitsTable", "scheduleHealth", "goingQuiet", "sinceLastHere",
]);

const SAVE_DEBOUNCE_MS = 900;
const ROW_HEIGHT_PX = 32;
const GRID_MARGIN_PX = 14;
// Below this measured grid-width, react-grid-layout's 12-column grid has no room left to be
// useful (a card's own minW alone would crowd several columns), so the Dashboard renders a plain
// single-column stack instead — see this file's own header, "don't let a phone drag-resize a
// grid it cannot see".
const NARROW_BREAKPOINT_PX = 640;

const ReactGridLayout = WidthProvider(GridLayout);

// NEW-1 (Locations map card) — its own lazy chunk, same reasoning as every other Leaflet-carrying
// module in this repo: the Dashboard is the app's landing page and loads on every session, so
// Leaflet's real weight (this card's whole point — a real interactive map) must never ride the
// Dashboard's own static bundle. See that file's own header for the map library / basemap choice.
const LocationsMapCard = lazy(() => import("./components/LocationsMapCard.jsx"));

function layoutKeyOf(layout) {
  return JSON.stringify([...layout].sort((a, b) => a.key.localeCompare(b.key)));
}

function useMeasuredWidth() {
  const ref = useRef(null);
  const [width, setWidth] = useState(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width;
      if (typeof w === "number") setWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export default function Dashboard({ onShellSwitch, authControl, accountActive, userId, onNewProject, onNavigate, onOpenReviewInDocReview, onOpenTaskInScheduler, onOpenCompInSitePlanner, onOpenMissingLocationsInSitePlanner, onOpenNoteInNotes }) {
  const [layout, setLayout] = useState(() => normalizeLayout(null));
  // B1422496 — cards this account has deliberately removed, so catalog reconciliation (see
  // dashboardPrefs.js's loadDashboardLayout) never re-adds them; see dashboardLayout.js's own
  // header for the full reasoning.
  const [dismissed, setDismissed] = useState([]);
  // NEW-1 (2026-09-17) — how many recent projects the Jump-back-in card lists; a per-user
  // preference persisted alongside the layout (see lib/dashboardPrefs.js).
  const [jumpBackInCount, setJumpBackInCount] = useState(JUMP_BACK_IN_COUNT_DEFAULT);
  const [customizing, setCustomizing] = useState(false);
  const [saveNote, setSaveNote] = useState(null); // null | "saved" | "local" | "error"
  const layoutLoadedRef = useRef(false);
  const saveTimerRef = useRef(null);
  const [gridWrapRef, gridWidth] = useMeasuredWidth();
  const isNarrow = gridWidth != null && gridWidth < NARROW_BREAKPOINT_PX;
  // NEW-1 (dashboard-topo-background) — true for the duration of a react-grid-layout drag or
  // resize gesture, so DashboardTopoBackground can stop its animation loop dead rather than
  // repainting a full-viewport canvas every frame underneath the gesture (that is how a drag
  // gets janky). react-grid-layout fires the matching Stop callback even if the gesture ends
  // off the grid, so this can't get stuck true.
  const [gridInteracting, setGridInteracting] = useState(false);

  // Load the saved layout once per mount (this component is not kept alive — see Shell.jsx).
  // loadDashboardLayout already reconciles it against the current card catalog — any card shipped
  // since this was last saved is appended here, before it ever reaches state (B1422496).
  useEffect(() => {
    let live = true;
    layoutLoadedRef.current = false;
    loadDashboardLayout(userId).then(({ layout: loaded, dismissed: loadedDismissed, jumpBackInCount: loadedCount }) => {
      if (!live) return;
      setLayout(loaded);
      setDismissed(loadedDismissed);
      setJumpBackInCount(loadedCount);
      layoutLoadedRef.current = true;
    });
    return () => { live = false; };
  }, [userId]);

  // NEW-COMPS-CARD — the Comps card's own "per year / per month" toggle. A per-user preference,
  // same account-scoped store as the layout above (`compsRatePeriodPrefs.js`), so it follows him
  // across reloads and devices rather than resetting per visit. Loaded once per mount, same as
  // the layout; the toggle writes straight through (no debounce needed — it's a single flip, not
  // a drag gesture).
  const [compsPeriod, setCompsPeriod] = useState("annual");
  useEffect(() => {
    let live = true;
    loadCompsRatePeriod(userId).then(({ period }) => { if (live) setCompsPeriod(period); });
    return () => { live = false; };
  }, [userId]);
  const changeCompsPeriod = (period) => {
    setCompsPeriod(period);
    saveCompsRatePeriod(userId, period);
  };

  // Persist on every change, debounced — never on the initial load itself. Also fires right after
  // load when reconciliation appended a newly-shipped card, so that addition is saved back
  // immediately rather than only living in this session's state (B1422496).
  useEffect(() => {
    if (!layoutLoadedRef.current) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveDashboardLayout(userId, layout, dismissed, jumpBackInCount).then((res) => setSaveNote(res.ok ? "saved" : userId ? "error" : "local"));
    }, SAVE_DEBOUNCE_MS);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [layout, dismissed, jumpBackInCount, userId]);

  // react-grid-layout calls onLayoutChange on mount and on every width recalculation, not just a
  // real drag/resize — most of those echo back the SAME grid-unit positions (only pixel sizes
  // changed), so this skips the state update (and the save-debounce it would otherwise re-arm)
  // when nothing actually moved.
  const onGridLayoutChange = (rglLayout) => {
    setLayout((l) => {
      const next = applyGridChange(l, rglLayout);
      return layoutKeyOf(next) === layoutKeyOf(l) ? l : next;
    });
  };

  // ── Data: one fetch per source, in parallel, once per mount. ──────────────────────────────
  const [sites, setSites] = useState([]);
  const [comps, setComps] = useState([]);
  // NEW-1 (Locations map card) — the raw located-comp rows (id/lat/lon) the map draws as quiet
  // dots. Separate from `comps` above, which now feeds the Comps card's featured-comp/peer-set
  // derivation (full rows), not a type-count breakdown — the map only ever needs positions.
  const [compsForMap, setCompsForMap] = useState([]);
  const [doc, setDoc] = useState(null);
  const [scheduleProjects, setScheduleProjects] = useState(null);
  // B1366384 (NEW-1) — "Since you were last here". `sinceLastHere` holds the already-built feed
  // + its header span string, computed ONCE per mount alongside everything else (see the effect
  // below) rather than re-derived on every render, so the card's "since X" doesn't creep forward
  // on an unrelated re-render.
  const [sinceLastHere, setSinceLastHere] = useState(null);
  // B1161793 (NEW-2) — building elements for each open pursuit's own representative plan, for
  // the Yield column. Fetched as a genuinely SECOND round trip (not a fifth parallel branch):
  // which plans to ask for isn't known until `sites` resolves — see the effect below.
  const [yieldRows, setYieldRows] = useState([]);
  // B1161793 (NEW-2) — per-project real-edit-recency days for the Pursuits card's "Quiet for"
  // column (never sites.updated_at — see dashboardElementRecencyFetch.js's own header). Computed
  // inside the effect below, not a useMemo, because deriving it needs `siteRecency.js`'s
  // aggregation, which is loaded dynamically (see that import's own comment just below).
  const [quietDaysByGroup, setQuietDaysByGroup] = useState({});
  // NEW-1 — every card's row count is unknown until its own source resolves, so a card that
  // resolves quickly used to show its final content (and take real taps) before a slower sibling
  // card had grown into its own final height, shoving the whole grid below it down the page out
  // from under a tap already in flight (event:click-swallowed, "moved": true). Nothing renders a
  // real, variable-height card until every source has resolved — see CardSkeleton's own header.
  const [dataReady, setDataReady] = useState(false);
  useEffect(() => {
    let live = true;
    setDataReady(false);
    (async () => {
      // The since-last-here mark has to be known BEFORE the recent-comps/recent-notes fetches
      // fire — both are bounded by it (`since`), never an account-wide pull. It's one small,
      // fast read (profiles.prefs, same row dashboardLayout already reads), not a second waterfall.
      const nowMs = Date.now();
      const { mark } = await loadSinceLastHere(userId);
      if (!live) return;
      const windowStartMs = mark.lastVisitAt != null ? Number(mark.lastVisitAt) : nowMs - 24 * 60 * 60 * 1000;
      const sinceIso = new Date(windowStartMs).toISOString();

      const results = await Promise.allSettled([
        fetchSiteSummaries().then((v) => { if (live) setSites(v); return v; }),
        fetchAllCompsForCard().then((v) => { if (live) setComps(v); }),
        fetchCompsForMap().then((v) => { if (live) setCompsForMap(v); }),
        fetchLastTouchedDoc().then((v) => { if (live) setDoc(v); }),
        fetchScheduleProjects().then((v) => { if (live) setScheduleProjects(v); return v; }),
        fetchAllElementRecency().then((v) => v),
        fetchRecentComps(sinceIso),
        fetchRecentNotePages(userId, windowStartMs),
        fetchScheduleLastWriteAt(),
      ]);
      if (!live) return;
      const siteRows = results[0].status === "fulfilled" ? results[0].value || [] : [];
      const scheduleProjectsValue = results[4].status === "fulfilled" ? results[4].value : null;
      const elementRecencyRows = results[5].status === "fulfilled" ? results[5].value || [] : [];
      const recentComps = results[6].status === "fulfilled" ? results[6].value || [] : [];
      const recentNotePages = results[7].status === "fulfilled" ? results[7].value || [] : [];
      const scheduleLastWriteAt = results[8].status === "fulfilled" ? results[8].value : null;
      const openPursuits = pursuitsTable(groupProjectsByGroupId(siteRows), {});
      const pursuitSiteIds = [...new Set(openPursuits.map((p) => p.siteId).filter(Boolean))];
      const elementRows = await fetchElementsForSites(pursuitSiteIds).catch(() => []);
      if (!live) return;
      setYieldRows(elementRows);
      setQuietDaysByGroup(quietDaysByGroupFromRows(elementRecencyRows, siteRows));

      const feed = buildSinceLastHereFeed({
        now: nowMs,
        lastVisitAt: mark.lastVisitAt != null ? Number(mark.lastVisitAt) : null,
        sites: siteRows,
        buildingCountBySite: buildingCountBySite(elementRows),
        sqftBySite: yieldBySite(elementRows),
        scheduleProjects: scheduleProjectsValue,
        comps: recentComps,
        notePages: recentNotePages,
        prevSnapshot: mark.snapshot,
        scheduleLastWriteAt,
        compsRatePeriod: compsPeriod,
      });
      setSinceLastHere({ feed, headerSpan: spanWords(feed.spanAnchorMs, nowMs), now: nowMs });
      // Fire-and-forget: this visit's own mark for NEXT time. Never blocks dataReady — a failed
      // cloud write here degrades to "the next visit re-derives against the local mirror (or a
      // fresh 24h window)", not a broken dashboard.
      saveSinceLastHere(userId, { lastVisitAt: nowMs, snapshot: feed.nextSnapshot });

      setDataReady(true);
    })();
    return () => { live = false; };
    // `compsPeriod` deliberately excluded: it only seeds the "New comp" rows' initial subline
    // (SinceLastHereCard.jsx recomputes it live off the current period on every render regardless
    // — see sinceLastHereFeed.js's header, FEED-3) and re-running this whole fetch waterfall on a
    // toggle flip would refetch everything for no reason.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const projects = useMemo(() => groupProjectsByGroupId(sites), [sites]);
  const yieldBySiteMap = useMemo(() => yieldBySite(yieldRows), [yieldRows]);
  const needsAttentionRows = useMemo(() => (scheduleProjects ? needsAttentionList(scheduleProjects) : []), [scheduleProjects]);
  const pursuitsRows = useMemo(() => pursuitsTable(projects, quietDaysByGroup), [projects, quietDaysByGroup]);

  const cardData = useMemo(() => ({
    jumpBackIn: { projects: recentProjects(projects, jumpBackInCount), doc },
    recentPlans: { plans: pickRecentPlans(sites, 4) },
    pipelineStatus: { counts: pipelineCounts(projects) },
    needsAttention: { rows: needsAttentionRows },
    pursuitsTable: { rows: pursuitsRows, yieldBySite: yieldBySiteMap },
    goingQuiet: { rows: goingQuiet(projects) },
    compsSummary: { data: buildCompsCardData(comps, compsPeriod) },
    scheduleHealth: { rows: scheduleProjects ? summarizeScheduleHealth(scheduleProjects) : [] },
    sinceLastHere: { feed: sinceLastHere?.feed || null },
  }), [projects, sites, doc, comps, scheduleProjects, needsAttentionRows, pursuitsRows, yieldBySiteMap, sinceLastHere, compsPeriod, jumpBackInCount]);

  const openProject = (p) => onNavigate?.({ module: "site-planner", projectId: p.groupId, cross: false, org: false });
  const openSchedule = (p) => onNavigate?.({ module: "scheduler", projectId: p.linkedSiteId, cross: false, org: false });
  const openDoc = (d) => onOpenReviewInDocReview?.({ id: d.id, project_id: d.projectId });
  const openTask = (row) => onOpenTaskInScheduler?.({ linkedSiteId: row.linkedSiteId, taskId: row.taskId });
  // Deep-links to the comp ITSELF (main's Comps-card behaviour, kept over this branch's older
  // open-the-linked-plan route): MapFinder's `focusCompId` effect opens the Comps tab with the
  // panel on that comp, which is strictly more specific than landing on its plan.
  const openComp = (comp) => onOpenCompInSitePlanner?.({ compId: comp.id });
  // Empty-state "add one" — there's no specific comp to deep-link into yet, so this lands the
  // owner on the map/finder view, one click from the Comps tab (MapFinder's own toolbar).
  const addComp = () => onNavigate?.({ module: "site-planner", projectId: null, cross: false, org: false });
  // LOCATIONS-MAP-CARD FIX (owner report, 2026-09-09) — this used to call `onNavigate` directly,
  // landing on the Site Planner's plain, unfiltered project list: exactly what clicking the Site
  // Planner tab itself gives you, with nothing to show it was about the missing locations at all
  // (read, and reported, as a dead link). `onOpenMissingLocationsInSitePlanner` is the same
  // token-stamped-intent shape `onOpenCompInSitePlanner` already uses — it still lands on the
  // Site Planner's project list (there's no dedicated "missing locations" page to send him to
  // instead), but MapFinder's own effect on the intent arriving opens the Sites tab and narrows
  // the list to exactly the projects with no location, so the destination actually answers "which
  // ones, and let me fix them."
  const fixLocations = () => onOpenMissingLocationsInSitePlanner?.();

  // NEW-1 — while data is still loading every slot renders the SAME stable-height skeleton
  // instead of its real (variable-height) content; see the `dataReady` effect above.
  const SKELETON_ROWS = { jumpBackIn: JUMP_BACK_IN_COUNT_DEFAULT + 1, recentPlans: 2, pipelineStatus: 2, scheduleHealth: 3, needsAttention: 4, pursuitsTable: 4, compsSummary: 6, goingQuiet: 3, sinceLastHere: 6, locationsMap: 6 };
  const CARD_RENDERERS = dataReady ? {
    jumpBackIn: () => <JumpBackInCard {...cardData.jumpBackIn} onOpenProject={openProject} onOpenDoc={openDoc} />,
    recentPlans: () => <RecentPlansCard {...cardData.recentPlans} onOpenProject={openProject} />,
    pipelineStatus: () => <PipelineCard {...cardData.pipelineStatus} />,
    needsAttention: () => <NeedsAttentionCard {...cardData.needsAttention} onOpenTask={openTask} />,
    pursuitsTable: () => <PursuitsCard {...cardData.pursuitsTable} onOpenProject={openProject} />,
    goingQuiet: () => <GoingQuietCard {...cardData.goingQuiet} onOpenProject={openProject} />,
    compsSummary: () => <CompsCard {...cardData.compsSummary} onOpenComp={openComp} onAddComp={addComp} onChangePeriod={changeCompsPeriod} />,
    scheduleHealth: () => <ScheduleHealthCard {...cardData.scheduleHealth} onOpenSchedule={openSchedule} />,
    sinceLastHere: () => (
      <SinceLastHereCard
        feed={cardData.sinceLastHere.feed}
        now={sinceLastHere?.now ?? Date.now()}
        compsRatePeriod={compsPeriod}
        onOpenProject={openProject}
        onOpenTask={openTask}
        onOpenSchedule={openSchedule}
        onOpenComp={openComp}
        onOpenNote={onOpenNoteInNotes}
      />
    ),
    locationsMap: () => (
      <Suspense fallback={<CardSkeleton rows={SKELETON_ROWS.locationsMap} />}>
        <LocationsMapCard projects={projects} comps={compsForMap} onOpenProject={openProject} onFixLocations={fixLocations} />
      </Suspense>
    ),
  } : Object.fromEntries(Object.keys(CARD_DEFS).map((k) => [k, () => <CardSkeleton rows={SKELETON_ROWS[k]} />]));

  // NEW-COMPS-CARD — the header row's quiet right-side "latest of N" meta, computed only once
  // real data is in (a skeleton card has nothing to count yet).
  const compsHeaderMeta = dataReady && cardData.compsSummary.data.total
    ? `latest of ${cardData.compsSummary.data.total}` : undefined;

  const toAdd = availableToAdd(layout);
  const orderedForNarrow = isNarrow ? narrowOrder(layout) : layout;

  const cardEl = (entry) => {
    const def = CARD_DEFS[entry.key];
    const render = CARD_RENDERERS[entry.key];
    if (!def || !render) return null;
    return (
      <DashboardCard
        cardKey={entry.key}
        title={def.title}
        headerMeta={entry.key === "compsSummary" ? compsHeaderMeta : undefined}
        headerRight={entry.key === "sinceLastHere" ? sinceLastHere?.headerSpan : null}
        customizing={customizing}
        showDragHandle={!isNarrow}
        sizeToContent={dataReady && SIZE_TO_CONTENT_CARDS.has(entry.key)}
        customizeControls={entry.key === "jumpBackIn" ? (
          <JumpBackInCountControl
            count={jumpBackInCount}
            min={JUMP_BACK_IN_COUNT_MIN}
            max={JUMP_BACK_IN_COUNT_MAX}
            onChange={(n) => setJumpBackInCount(normalizeJumpBackInCount(n))}
          />
        ) : undefined}
        onRemove={() => {
          setLayout((l) => removeCard(l, entry.key));
          setDismissed((d) => dismissCard(d, entry.key));
        }}
      >
        {render()}
      </DashboardCard>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", position: "relative" }}>
      {/* NEW-1 (dashboard-topo-background) — fixed full-viewport, behind everything else on
          this screen. AppHeader below stacks itself above this on its own (it's already
          position:relative + a high z-index); the scrollable content wrapper further down gets
          its own explicit stacking context at zIndex:1 so its cards (plain position:static)
          paint above this canvas regardless of DOM order — same pattern Shell.jsx's own
          `main`(zIndex:0)/workspace-wrapper(zIndex:1) pair already uses. */}
      <DashboardTopoBackground paused={gridInteracting} />
      <AppHeader
        // Not a real module id — no tab in AppHeader's fixed six matches "dashboard", so none
        // of them highlight (B1213312's "no module tab active" requirement, satisfied for free).
        module="dashboard"
        onSwitch={onShellSwitch}
        onNewProject={onNewProject}
        authControl={authControl}
        accountActive={accountActive}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "18px 22px 40px", position: "relative", zIndex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 1040, margin: "0 auto 16px" }}>
          <h1 style={{ fontSize: 14, fontWeight: 700, color: "var(--text-primary)", margin: 0, flex: 1 }}>Dashboard</h1>
          {customizing && saveNote && (
            <span style={{ fontSize: 10.5, color: saveNote === "error" ? "var(--danger-text)" : "var(--text-secondary)" }}>
              {saveNote === "saved" ? "Saved" : saveNote === "local" ? "Saved on this device" : "Couldn't save — try again"}
            </span>
          )}
          {customizing && (
            <Button size="sm" variant="ghost" onClick={() => { setLayout(resetLayout()); setDismissed([]); }}>Reset layout</Button>
          )}
          <Button
            size="sm"
            variant={customizing ? "primary" : "ghost"}
            onClick={() => setCustomizing((c) => !c)}
          >
            {customizing ? "Done" : "Customize"}
          </Button>
        </div>

        <div ref={gridWrapRef} style={{ maxWidth: 1040, margin: "0 auto" }}>
          {isNarrow ? (
            <div style={{ display: "flex", flexDirection: "column", gap: GRID_MARGIN_PX }}>
              {orderedForNarrow.map((entry) => (
                <div key={entry.key}>{cardEl(entry)}</div>
              ))}
            </div>
          ) : (
            <ReactGridLayout
              className="dashboard-grid"
              layout={layout.map(toRglItem)}
              cols={GRID_COLS}
              rowHeight={ROW_HEIGHT_PX}
              margin={[GRID_MARGIN_PX, GRID_MARGIN_PX]}
              containerPadding={[0, 0]}
              isDraggable={customizing}
              isResizable={customizing}
              draggableHandle=".dashboard-card-drag-handle"
              resizeHandles={["se"]}
              compactType="vertical"
              onLayoutChange={onGridLayoutChange}
              onDragStart={() => setGridInteracting(true)}
              onDragStop={() => setGridInteracting(false)}
              onResizeStart={() => setGridInteracting(true)}
              onResizeStop={() => setGridInteracting(false)}
            >
              {layout.map((entry) => (
                <div key={entry.key}>{cardEl(entry)}</div>
              ))}
            </ReactGridLayout>
          )}
        </div>

        {customizing && (
          <div style={{ maxWidth: 1040, margin: "18px auto 0" }}>
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: "var(--text-secondary)", marginBottom: 8 }}>
              Add a card
            </div>
            {toAdd.length ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {toAdd.map((key) => (
                  <ToggleChip
                    key={key}
                    onClick={() => {
                      setLayout((l) => addCard(l, key));
                      setDismissed((d) => undismissCard(d, key));
                    }}
                  >
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
