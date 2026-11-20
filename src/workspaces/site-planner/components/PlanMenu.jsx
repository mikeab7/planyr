/* The plan menu (the plan crumb's dropdown) — NEW-1, 2026-11-04, redrawn to the owner-approved mockup. Module scope
 * (MODULE-SCOPE-COMPONENTS); `SitePlanner.jsx` only hands it data and callbacks, `lib/planMenuModel.js` makes every decision.
 *
 * ⛔ THE NAME APPEARS TWICE, NEVER MORE: as the crumb (the trigger) and as the CURRENT ROW at the top of this menu — and that
 * row is also the rename control (double-click the name, or ⋯ ▸ Rename, and it turns into a text field in place). There is no
 * "Plan name" label and no separate name field any more; this REPLACES the B385042 / NEW-3 rule that kept a field beside a
 * list. B385042, B1469872, B1482000 and B1767168 are amended, not contradicted: a deleted plan is still exempt from auto-purge
 * and restorable from here ("Recently deleted"), and Delete forever keeps its inline "No restore after this." confirm.
 *
 * Shape (copied from the project switcher, `shared/ui/ProjectBreadcrumb.jsx`, through the shared `shared/ui/menuBin.jsx`):
 *   the current plan (one highlighted row) · [Find a plan — only at 8+ plans] · ONE scrolling list of the other plans ·
 *   a footer that can never be pushed out of the panel (New plan | Duplicate · Version history… · Recently deleted (n) ›).
 * "Recently deleted" swaps the list AND the footer for a bin view with a "‹ Plans" row, exactly as the project bin does.
 *
 * One ⋯ menu: the ⋯ button and a right-click on any plan row (current included) open the SAME menu — one item list
 * (`planMenuItems`), one renderer (the shared `ContextMenu`, a portal, so the scrolling list cannot clip it and it flips /
 * clamps at the screen edge). Storage on this device and Save now are no longer here: autosave is untouched, and the failure
 * banner's own "Save now" keeps calling `saveNow`. */
import { useEffect, useRef, useState } from "react";
import AnchoredMenu from "../../../shared/ui/AnchoredMenu.jsx";
import ContextMenu from "../../../shared/ui/ContextMenu.jsx";
import { Button, IconButton, MenuItem, menuPanelStyle } from "../../../shared/ui/controls.jsx";
import { MENU_COLUMN_PANEL, MenuScroll, MenuFooter, BinBackRow } from "../../../shared/ui/menuBin.jsx";
import { NO_AUTOFILL } from "../../../shared/ui/noAutofill.js";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { usePalette } from "../../../shared/theme/ThemeProvider.jsx";
import { PadlockIcon, PlusIcon, DuplicateIcon, HistoryIcon, MoreIcon, ChevronRightIcon } from "./icons.jsx";
import { showFind, filterPlans, otherPlans, planMenuItems, deletedEntries, deletedCount, deletedLine } from "../lib/planMenuModel.js";

// Wider than the old 284 so real names ("Phase II & III - Two (2) 1.2M") sit on one line; the panel is still clamped to the screen.
export const PLAN_MENU_WIDTH = 360;
const CTX_WIDTH = 240;       // wide enough that even "Locked — teammates can view only" is one line, so every row is the same height
const CTX_Z = 5000;          // strictly above AnchoredMenu's 4000 (menuLayers.js), so a press in it never closes the plan menu
const ROW_PAD = `${SPACE.sm}px ${SPACE.md}px`;
const WRAP = { whiteSpace: "normal", overflowWrap: "anywhere", lineHeight: 1.3 };   // long names wrap to a second line, never ellipsised

const CTX_PANEL = { ...menuPanelStyle, padding: SPACE.xs, borderRadius: RADIUS.md };

/** The single ⋯ / right-click menu. `items` come from `planMenuItems`; `onPick(id)` does the work. */
function ItemMenu({ at, items, onPick, onClose, testId, label }) {
  return (
    <ContextMenu x={at.x} y={at.y} onClose={onClose} width={CTX_WIDTH} zIndex={CTX_Z} className="menu" role="menu" ariaLabel={label} testId={testId} panelStyle={CTX_PANEL}>
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          role="menuitem"
          title={it.title}
          data-testid={`${testId}-${it.id}`}
          data-danger={it.danger ? "1" : undefined}
          onClick={() => onPick(it.id)}
          style={{
            display: "block", width: "100%", boxSizing: "border-box", textAlign: "left", height: 30, padding: `0 ${SPACE.lg}px`, border: "none", borderRadius: RADIUS.sm,
            background: "transparent", fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, whiteSpace: "nowrap",
            color: it.danger ? "var(--danger-text)" : "var(--text-primary)", cursor: "pointer",
          }}
        >{it.label}</button>
      ))}
    </ContextMenu>
  );
}

/** The ⋯ button of a row — opens the one menu under itself. */
function MoreButton({ onOpen, label, testId, disabled }) {
  return (
    <IconButton
      size={28}
      aria-label={label}
      aria-haspopup="menu"
      title="More"
      data-testid={testId}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); const r = e.currentTarget.getBoundingClientRect(); onOpen({ x: r.right - CTX_WIDTH, y: r.bottom + 2 }); }}
      style={{ border: "none", background: "transparent", boxShadow: "none" }}
    ><MoreIcon /></IconButton>
  );
}

/** A plan's name as an in-place text field: Enter or blur commits, Escape cancels. */
function RenameField({ initial, onCommit, onCancel }) {
  const done = useRef(false);
  const [v, setV] = useState(initial);
  const finish = (commit) => { if (done.current) return; done.current = true; if (commit) onCommit(v); else onCancel(); };
  return (
    <input
      {...NO_AUTOFILL}
      autoFocus
      data-testid="plan-rename-input"
      aria-label="Plan name"
      value={v}
      onChange={(e) => setV(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(false); }   // Esc cancels the rename only — it must not also close the menu
      }}
      style={{ flex: 1, minWidth: 0, boxSizing: "border-box", height: 28, padding: `0 ${SPACE.md}px`, fontFamily: "inherit", fontSize: FONT_SIZE.control, fontWeight: 600, color: "var(--text-primary)", background: "var(--surface-base)", border: "1px solid var(--accent-site)", borderRadius: RADIUS.sm, outline: "none" }}
    />
  );
}

/** One plan row (current or other): padlock (view-only) · name or rename field · `current` tag · ⋯. */
function PlanRow({ plan, current, renaming, onOpen, onRenameStart, onRenameCommit, onRenameCancel, onMore, onContext, confirming, onConfirmDelete, onCancelDelete, accentText }) {
  const name = plan.name || "Untitled plan";
  if (confirming) {
    return (
      <div data-testid={`plan-delete-confirm-${plan.id}`} style={{ display: "flex", alignItems: "center", gap: SPACE.md, padding: ROW_PAD, margin: `${SPACE.xxs}px ${SPACE.md}px`, borderRadius: RADIUS.sm, background: "var(--danger-bg)" }}>
        {/* B1469872 — a deleted plan moves to THIS project's own "Recently deleted" (restore it any time, or delete it forever from there); never auto-purged while a sibling plan stays live. */}
        <span style={{ flex: 1, minWidth: 0, fontSize: FONT_SIZE.control, color: "var(--text-primary)", ...WRAP }}>→ Recently deleted “{name}”?</span>
        <Button size="sm" variant="danger" data-testid="plan-delete-go" onClick={onConfirmDelete}>Delete</Button>
        <Button size="sm" variant="ghost" onClick={onCancelDelete}>Cancel</Button>
      </div>
    );
  }
  return (
    <div
      data-testid={current ? "plan-current-row" : `plan-row-${plan.id}`}
      data-plan-id={plan.id}
      data-current={current ? "1" : undefined}
      onContextMenu={(e) => { e.preventDefault(); onContext({ x: e.clientX, y: e.clientY }); }}
      style={{ display: "flex", alignItems: "center", gap: SPACE.xs, minHeight: 34, margin: `${SPACE.xxs}px ${SPACE.md}px`, paddingRight: SPACE.xxs, borderRadius: RADIUS.sm, background: current ? "var(--canvas-accent-soft)" : "transparent" }}
    >
      {renaming ? (
        <RenameField initial={plan.name || ""} onCommit={onRenameCommit} onCancel={onRenameCancel} />
      ) : (
        <MenuItem
          data-testid={current ? "plan-current-name" : `plan-open-${plan.id}`}
          title={current ? "Double-click to rename" : undefined}
          onClick={current ? undefined : onOpen}
          onDoubleClick={current ? onRenameStart : undefined}
          style={{ flex: 1, minWidth: 0, width: "auto", padding: ROW_PAD, fontWeight: current ? 700 : 500, background: "transparent", cursor: current ? "text" : "pointer", ...WRAP }}
        >
          {plan.shareLocked && <span aria-label="View-only for teammates" title="View-only for teammates" style={{ marginRight: SPACE.sm, display: "inline-flex", verticalAlign: "-2px" }}><PadlockIcon size={11} /></span>}
          {name}
        </MenuItem>
      )}
      {current && !renaming && <span style={{ flex: "none", color: accentText, fontSize: FONT_SIZE.label, fontWeight: 700 }}>current</span>}
      {!renaming && <MoreButton onOpen={onMore} label={`Actions for plan ${name}`} testId={`plan-more-${plan.id}`} />}
    </div>
  );
}

/** One row of the Recently-deleted view (a plan, or a deleted site-plan file with its "site plan" tag). */
function DeletedRow({ entry, busy, purging, onRestore, onMore, onPurge, onCancelPurge, now }) {
  const isFile = entry.kind === "file";
  const line = deletedLine(entry.deletedAt, now);
  if (purging) {
    return (
      <div data-testid={`deleted-purge-confirm-${entry.id}`} style={{ display: "flex", alignItems: "center", gap: SPACE.md, padding: ROW_PAD, margin: `${SPACE.xxs}px ${SPACE.md}px`, borderRadius: RADIUS.sm, background: "var(--danger-bg)" }}>
        {/* B1767168 — a permanent, no-restore removal (the plan AND its elements; site_elements cascades) — said plainly, never just "forever". */}
        <span style={{ flex: 1, minWidth: 0, fontSize: FONT_SIZE.control, color: "var(--text-primary)", ...WRAP }}>
          {isFile ? <>Permanently delete site plan “{entry.name}”? No restore after this.</> : <>Permanently delete “{entry.name}” and everything on it? No restore after this.</>}
        </span>
        <Button size="sm" variant="danger" data-testid="deleted-purge-go" disabled={busy} onClick={onPurge}>Delete</Button>
        <Button size="sm" variant="ghost" onClick={onCancelPurge}>Cancel</Button>
      </div>
    );
  }
  return (
    <div
      data-testid={isFile ? "deleted-site-plan-file" : "deleted-plan"}
      data-deleted-id={entry.id}
      style={{ display: "flex", alignItems: "flex-start", gap: SPACE.md, padding: ROW_PAD, margin: `${SPACE.xxs}px ${SPACE.md}px` }}
      title={isFile ? `${entry.src.fileName || entry.name}${entry.src.page ? ` — page ${entry.src.page}` : ""}` : undefined}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: FONT_SIZE.control, fontWeight: 600, color: "var(--text-primary)", ...WRAP }}>
          {entry.name}
          {/* The kind tag stays with the name, so a deleted FILE can never read as a deleted plan. */}
          {isFile && <span style={{ marginLeft: SPACE.md, fontSize: FONT_SIZE.label, fontWeight: 500, color: "var(--text-secondary)" }}>site plan</span>}
        </div>
        {line && <div data-testid="deleted-at" style={{ fontSize: FONT_SIZE.label, color: "var(--text-secondary)", marginTop: SPACE.xxs }}>{line}</div>}
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="tap-target"
        data-testid={`deleted-restore-${entry.id}`}
        aria-label={isFile ? `Restore site plan ${entry.name}` : `Restore plan ${entry.name}`}
        aria-busy={busy ? "true" : undefined}
        disabled={busy}
        onClick={onRestore}
        style={{ flex: "none" }}
      >{busy ? "Working…" : "Restore"}</Button>
      <MoreButton onOpen={onMore} label={`More for deleted ${isFile ? "site plan" : "plan"} ${entry.name}`} testId={`deleted-more-${entry.id}`} disabled={busy} />
    </div>
  );
}

export default function PlanMenu({
  open, onClose, anchorRef,
  plans, currentId, currentName,
  onOpenPlan, onNewPlan, onDuplicate, onVersionHistory, onRename, onDeletePlan,
  lock, bin,
}) {
  const pal = usePalette();
  const [view, setView] = useState("list");       // "list" | "bin"
  const [query, setQuery] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [delArm, setDelArm] = useState(null);     // plan id whose inline "Delete?" confirm is showing
  const [purgeArm, setPurgeArm] = useState(null); // deleted entry id whose "Delete forever" confirm is showing
  const [ctx, setCtx] = useState(null);           // { x, y, kind: "plan"|"deleted", id }

  // Everything transient resets when the menu closes — it always opens on the plan list.
  useEffect(() => { if (!open) { setView("list"); setQuery(""); setRenamingId(null); setDelArm(null); setPurgeArm(null); setCtx(null); } }, [open]);

  const all = Array.isArray(plans) ? plans : [];
  // The current row reads the LIVE name (`currentName`, the names store) so a rename shows at once, not on the next sites-list refresh.
  const current = { ...(all.find((p) => p.id === currentId) || {}), id: currentId, name: currentName };
  const others = otherPlans(all, currentId);
  const canDelete = all.length >= 2;              // the last plan of a site is never deletable from here (same rule as the old ✕)
  const shown = filterPlans(others, query);
  const count = deletedCount(bin.plans, bin.files);
  const entries = deletedEntries(bin.plans, bin.files);

  // Leaving the bin view when its last entry goes (restored / deleted forever) — there is nothing left to look at.
  useEffect(() => { if (view === "bin" && count === 0) { setView("list"); setPurgeArm(null); setCtx(null); } }, [view, count]);

  const ctxPlan = ctx && ctx.kind === "plan" ? (ctx.id === currentId ? current : all.find((p) => p.id === ctx.id)) : null;
  const pickPlanItem = (id) => {
    const target = ctx; setCtx(null);
    if (!target) return;
    if (id === "rename") setRenamingId(target.id);
    else if (id === "duplicate") onDuplicate(target.id);
    else if (id === "lock") lock.onToggle();
    else if (id === "delete") setDelArm(target.id);
  };
  const ctxDeleted = ctx && ctx.kind === "deleted" ? entries.find((e) => e.id === ctx.id) : null;
  const pickDeletedItem = (id) => { const target = ctx; setCtx(null); if (id === "purge" && target) setPurgeArm(target.id); };

  const commitRename = (id, nameNow) => (v) => {
    setRenamingId(null);
    if (String(v).trim() === String(nameNow || "").trim()) return;   // untouched — nothing to save (an EMPTY name still goes through, to be refused with the existing notice)
    onRename(id, v);
  };

  const row = (p, isCurrent) => (
    <PlanRow
      key={p.id}
      plan={p}
      current={isCurrent}
      accentText={pal.accentStrong}
      renaming={renamingId === p.id}
      confirming={delArm === p.id}
      onOpen={() => onOpenPlan(p.id)}
      onRenameStart={() => setRenamingId(p.id)}
      onRenameCommit={commitRename(p.id, p.name)}
      onRenameCancel={() => setRenamingId(null)}
      onMore={(at) => setCtx({ ...at, kind: "plan", id: p.id })}
      onContext={(at) => setCtx({ ...at, kind: "plan", id: p.id })}
      onConfirmDelete={() => { setDelArm(null); onDeletePlan(p.id); }}
      onCancelDelete={() => setDelArm(null)}
    />
  );

  const now = Date.now();
  return (
    <>
      <AnchoredMenu
        open={open}
        onClose={onClose}
        anchorRef={anchorRef}
        placement="below-left"
        gap={8}
        width={PLAN_MENU_WIDTH}
        panelStyle={{ padding: 0, ...MENU_COLUMN_PANEL }}
      >
        {view === "bin" ? (
          <>
            <BinBackRow testId="plan-bin-back" label="Plans" onClick={() => { setView("list"); setPurgeArm(null); setCtx(null); }} />
            <MenuScroll testId="plan-bin-scroll" style={{ padding: `${SPACE.sm}px 0 ${SPACE.md}px` }}>
              {entries.map((e) => (
                <DeletedRow
                  key={`${e.kind}:${e.id}`}
                  entry={e}
                  now={now}
                  busy={bin.busyId === e.id}
                  purging={purgeArm === e.id}
                  onRestore={() => (e.kind === "file" ? bin.onRestoreFile(e.src) : bin.onRestorePlan(e.src))}
                  onMore={(at) => setCtx({ ...at, kind: "deleted", id: e.id })}
                  onPurge={() => { setPurgeArm(null); if (e.kind === "file") bin.onPurgeFile(e.src); else bin.onPurgePlan(e.src); }}
                  onCancelPurge={() => setPurgeArm(null)}
                />
              ))}
            </MenuScroll>
          </>
        ) : (
          <>
            {/* The current plan — one highlighted row, never in the scrolling list. */}
            <div style={{ flex: "none", paddingTop: SPACE.md }}>{row(current, true)}</div>
            {showFind(others.length + 1) && (
              <div style={{ flex: "none", padding: `${SPACE.sm}px ${SPACE.md}px` }}>
                <input
                  {...NO_AUTOFILL}
                  data-testid="plan-find"
                  aria-label="Find a plan"
                  placeholder="Find a plan"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{ width: "100%", boxSizing: "border-box", height: 30, padding: `0 ${SPACE.lg}px`, fontFamily: "inherit", fontSize: FONT_SIZE.control, color: "var(--text-primary)", background: "var(--surface-base)", border: "1px solid var(--border-default)", borderRadius: RADIUS.sm, outline: "none" }}
                />
              </div>
            )}
            {others.length > 0 && (
              <MenuScroll testId="plan-list-scroll" style={{ padding: `${SPACE.xxs}px 0` }}>
                {shown.length === 0
                  ? <div data-testid="plan-find-empty" style={{ padding: ROW_PAD, margin: `0 ${SPACE.md}px`, fontSize: FONT_SIZE.control, color: "var(--text-secondary)" }}>No plan by that name.</div>
                  : shown.map((p) => row(p, false))}
              </MenuScroll>
            )}
            <MenuFooter testId="plan-footer" style={{ padding: `${SPACE.md}px ${SPACE.md}px ${SPACE.lg}px`, borderTop: "1px solid var(--border-default)", display: "flex", flexDirection: "column", gap: SPACE.xxs }}>
              <div style={{ display: "flex", gap: SPACE.sm, marginBottom: SPACE.xs }}>
                <Button variant="ghost" size="md" style={{ flex: 1 }} data-testid="plan-new" onClick={onNewPlan} title="New layout on the same parcel"><span style={{ display: "inline-flex", alignItems: "center", gap: SPACE.sm }}><PlusIcon size={12} />New plan</span></Button>
                <Button variant="ghost" size="md" style={{ flex: 1 }} data-testid="plan-duplicate" onClick={() => onDuplicate(currentId)} title="Clone this plan to iterate on"><span style={{ display: "inline-flex", alignItems: "center", gap: SPACE.sm }}><DuplicateIcon size={12} />Duplicate</span></Button>
              </div>
              <MenuItem data-testid="plan-version-history" onClick={onVersionHistory} title="Restore an earlier automatically-saved version of this plan" style={{ display: "flex", alignItems: "center", gap: SPACE.md }}>
                <span aria-hidden style={{ flex: "none", display: "flex" }}><HistoryIcon /></span><span>Version history…</span>
              </MenuItem>
              {count > 0 && (
                <MenuItem data-testid="plan-bin-toggle" onClick={() => { setView("bin"); setDelArm(null); setRenamingId(null); }} aria-expanded={false} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: SPACE.md }}>
                  <span>Recently deleted ({count})</span>
                  <ChevronRightIcon />
                </MenuItem>
              )}
            </MenuFooter>
          </>
        )}
      </AnchoredMenu>
      {ctxPlan && (
        <ItemMenu
          at={ctx}
          label={`Actions for plan ${ctxPlan.name || "Untitled plan"}`}
          testId="plan-ctx"
          items={planMenuItems({ isCurrent: ctx.id === currentId, canDelete, canLock: !!(lock && lock.canLock), locked: !!(lock && lock.locked) })}
          onPick={pickPlanItem}
          onClose={() => setCtx(null)}
        />
      )}
      {ctxDeleted && (
        <ItemMenu
          at={ctx}
          label={`Actions for deleted ${ctxDeleted.name}`}
          testId="deleted-ctx"
          items={[{ id: "purge", label: "Delete forever", danger: true }]}
          onPick={pickDeletedItem}
          onClose={() => setCtx(null)}
        />
      )}
    </>
  );
}
