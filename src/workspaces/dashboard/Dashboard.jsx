/* Dashboard.jsx — the app's real home page (B1196304/B1196305, NEW-1/NEW-2).
 *
 * Deliberately NOT a workspace: no header tab, no entry in Shell's WORKSPACES registry, never
 * offered by the module switcher (see route.js's DASHBOARD_MODULE). Reached only via the
 * wordmark, the admin/design exits, or a bare "#/"/"#/dashboard" URL.
 *
 * Three-column card grid at rest; a Customize control reveals per-card drag/width/remove/move
 * controls plus an Add-card tray. The layout persists per user (userPrefs.js's dashboardLayout
 * key — the same account-prefs store every other per-user arrangement in this app uses) and
 * NEVER reaches an empty board from any entry point (dashboardLayout.js's removeCard refuses the
 * last card; userPrefs.js's normalizer refuses to persist an empty one).
 */
import { useEffect, useState } from "react";
import AppHeader from "../../shared/ui/AppHeader.jsx";
import { Button } from "../../shared/ui/controls.jsx";
import { RADIUS } from "../../shared/ui/radius.js";
import { FONT_SIZE } from "../../shared/ui/designTokens.js";
import { loadUserPrefs, saveUserPrefs } from "../site-planner/lib/userPrefs.js";
import {
  moveCardToIndex, moveCardBy, cycleCardWidth, removeCard, addCard, availableCardIds, WIDTH_COLS,
} from "./lib/dashboardLayout.js";
import { CARD_REGISTRY } from "./lib/dashboardCards.js";
import DashboardCard from "./components/DashboardCard.jsx";

// B113/B485's existing phone breakpoint (760px, matchMedia) — a LOCAL copy rather than importing
// Shell.jsx's, matching that file's own reasoning (a small leaf duplicated per consumer rather
// than shared, so no consumer pays for another's bundle graph).
function useNarrow() {
  const [narrow, setNarrow] = useState(() => { try { return window.matchMedia("(max-width: 760px)").matches; } catch (_) { return false; } });
  useEffect(() => {
    let mq; try { mq = window.matchMedia("(max-width: 760px)"); } catch (_) { return undefined; }
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener ? mq.addEventListener("change", on) : mq.addListener(on);
    return () => { mq.removeEventListener ? mq.removeEventListener("change", on) : mq.removeListener(on); };
  }, []);
  return narrow;
}

export default function Dashboard({
  onShellSwitch, authControl, accountActive = false, userId = null,
  onNavigate, onNewProject, onSelectOrg,
}) {
  const [layout, setLayout] = useState(null); // null while loading
  const [customizing, setCustomizing] = useState(false);
  const [dragId, setDragId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const narrow = useNarrow(); // below 760px the board collapses to one column; the width enum stops applying

  useEffect(() => {
    let live = true;
    loadUserPrefs(userId).then(({ prefs }) => { if (live) setLayout(prefs.dashboardLayout); });
    return () => { live = false; };
  }, [userId]);

  const persist = (nextLayout) => {
    setLayout(nextLayout);
    loadUserPrefs(userId).then(({ prefs }) => {
      saveUserPrefs(userId, { ...prefs, dashboardLayout: nextLayout });
    });
  };

  if (!layout) return null; // one-tick load; no flash of an empty board

  const onMoveLeft = (id) => persist(moveCardBy(layout, id, -1));
  const onMoveRight = (id) => persist(moveCardBy(layout, id, 1));
  const onCycleWidth = (id) => persist(cycleCardWidth(layout, id));
  const onRemove = (id) => persist(removeCard(layout, id));
  const onAdd = (id) => persist(addCard(layout, id));

  // Drag-and-drop reorder — calls the IDENTICAL moveCardToIndex the Move-left/right buttons use
  // (via moveCardBy above), so the two paths can never diverge.
  const onDragStart = (id) => (e) => { setDragId(id); e.dataTransfer.effectAllowed = "move"; };
  const onDragOver = (id) => (e) => { e.preventDefault(); if (id !== dragOverId) setDragOverId(id); };
  const onDrop = (id) => (e) => {
    e.preventDefault();
    setDragOverId(null);
    if (!dragId || dragId === id) return;
    const targetIndex = layout.findIndex((c) => c.id === id);
    if (targetIndex >= 0) persist(moveCardToIndex(layout, dragId, targetIndex));
    setDragId(null);
  };
  const onDragEnd = () => { setDragId(null); setDragOverId(null); };

  const available = availableCardIds(layout);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <AppHeader
        module="dashboard"
        onSwitch={onShellSwitch}
        authControl={authControl}
        accountActive={accountActive}
        currentProject={null}
        onNewProject={onNewProject}
        onSelectOrg={onSelectOrg}
        centerContent={null}
        toolbarContent={null}
      />
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div style={{ fontSize: FONT_SIZE.display, fontWeight: 700, color: "var(--text-primary)" }}>Dashboard</div>
          <Button size="sm" variant={customizing ? "primary" : "ghost"} onClick={() => setCustomizing((c) => !c)}>
            {customizing ? "Done" : "Customize"}
          </Button>
        </div>

        {customizing && available.length > 0 && (
          <div style={{
            display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 12,
            padding: 10, background: "var(--surface-raised)", border: "1px dashed var(--border-default)", borderRadius: RADIUS.md,
          }}>
            <span style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", fontWeight: 600 }}>Add a card:</span>
            {available.map((id) => (
              <Button key={id} size="sm" variant="ghost" onClick={() => onAdd(id)}>+ {CARD_REGISTRY[id].title}</Button>
            ))}
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: narrow ? "1fr" : "repeat(3, 1fr)", gap: 12 }}>
          {layout.map((card) => {
            const reg = CARD_REGISTRY[card.id];
            if (!reg) return null;
            const Comp = reg.Component;
            return (
              <div key={card.id} style={{ gridColumn: narrow ? "span 1" : `span ${WIDTH_COLS[card.width] || 2}` }}>
                <DashboardCard
                  title={reg.title}
                  width={card.width}
                  customizing={customizing}
                  canRemove={layout.length > 1}
                  isDragOver={dragOverId === card.id}
                  draggable
                  onDragStart={onDragStart(card.id)}
                  onDragOver={onDragOver(card.id)}
                  onDrop={onDrop(card.id)}
                  onDragEnd={onDragEnd}
                  onMoveLeft={() => onMoveLeft(card.id)}
                  onMoveRight={() => onMoveRight(card.id)}
                  onCycleWidth={() => onCycleWidth(card.id)}
                  onRemove={() => onRemove(card.id)}
                >
                  <Comp userId={userId} onNavigate={onNavigate} />
                </DashboardCard>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
