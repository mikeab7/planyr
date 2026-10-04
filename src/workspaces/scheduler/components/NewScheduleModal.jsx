/* NewScheduleModal — "New schedule" ASKS for a name and an owner. It never picks either for him.
 *
 * ⛔ WHAT THIS REPLACES, and why it is a dialog rather than a one-click action. The old "+ New"
 * took no name and no owner: standing on a project it auto-named the new schedule after that
 * project and, on a collision, appended "(2)", "(3)", "(4)". Production carries the result — three
 * empty schedules called "Goose Creek (2)", "(3)" and "(4)", created by three presses, with no
 * prompt at any point and nothing on screen to say anything had happened. So the ask is the fix,
 * not a step added in front of one.
 *
 * This is NOT a dialog-box EDIT (the owner's standing "no window.prompt/confirm/alert — inline
 * editors only" rule, which bans editing an existing value behind a native modal). Nothing exists
 * yet to edit inline: this is the create form for an object that has no place on the canvas until
 * it has a name and an owner, the same shape as the app's own RenameModal / MoveToModal.
 *
 * Two decisions, both pre-filled and both changeable:
 *   • NAME — pre-filled with the project's own name when that project has no schedule yet, and
 *     deliberately left EMPTY once it does (never "Goose Creek (5)"): a second schedule under a
 *     project is a different thing — a master schedule and a land sale — and only he knows which.
 *   • LIVES UNDER — pre-selected to the project he is standing on, with every other project and
 *     the Organization in the same list. There is no "none" option, because a schedule that
 *     belongs to nothing is the state this whole model removes.
 *
 * Owner rule, verbatim (2026-09-08): "I thought that was the whole purpose of organization, for it
 * to go under this kind of thing?" — everything lives under something, and the organization is a
 * real container in the list rather than an unassigned pile.
 *
 * Theme tokens + shared primitives throughout (docs/DESIGN.md); the scheduler accent is spent on
 * the one primary action.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { isCoarsePointer } from "../../../shared/ui/coarsePointer.js";
import { Button, Field } from "../../../shared/ui/controls.jsx";
import { RADIUS } from "../../../shared/ui/radius.js";
import { FONT_SIZE, SPACE } from "../../../shared/ui/designTokens.js";
import { MODULE_ACCENT } from "../../../shared/ui/moduleAccent.js";
import {
  ORG_OWNER_KEY, ORG_OWNER_LABEL, OWNER_KIND_ORG, OWNER_KIND_SITE,
  validateNewSchedule, suggestScheduleName,
} from "../../../shared/schedule/scheduleOwnership.js";

const ACCENT = MODULE_ACCENT.scheduler;

const scrim = {
  position: "absolute", inset: 0, zIndex: 40,
  display: "grid", placeItems: "center", padding: SPACE.xxl,
  // No --scrim token exists repo-wide; this matches the dim used by the app's other full-surface
  // overlays rather than inventing a colour. The iframe behind stays visible but inert.
  background: "rgba(0,0,0,0.32)", // design-exempt: no scrim token defined in index.css
};
const card = {
  width: "min(420px, 100%)", boxSizing: "border-box", padding: SPACE.xxl,
  background: "var(--surface-raised)", color: "var(--text-primary)",
  border: "1px solid var(--border-default)", borderRadius: RADIUS.lg,
  boxShadow: "0 8px 28px rgba(0,0,0,0.16)", // design-exempt: no shadow-color token yet repo-wide
  fontFamily: "system-ui, sans-serif",
};
const title = { fontSize: FONT_SIZE.display, fontWeight: 700, margin: 0, marginBottom: SPACE.xl };
const input = {
  width: "100%", boxSizing: "border-box", padding: "7px 10px",
  fontSize: FONT_SIZE.control, fontFamily: "inherit",
  color: "var(--text-primary)", background: "var(--surface-base)",
  border: "1px solid var(--border-default)", borderRadius: RADIUS.md,
};
const note = { fontSize: FONT_SIZE.control, lineHeight: 1.45, marginTop: SPACE.sm };
const actions = { display: "flex", justifyContent: "flex-end", gap: SPACE.md, marginTop: SPACE.xxl };

export default function NewScheduleModal({
  // The schedules that already exist (the embedded app's bridged list) — read ONLY to warn about a
  // same-owner name collision; never to invent a name.
  schedules = [],
  // Every Site Planner project that can own a schedule: [{ id, name }].
  siteProjects = [],
  // The owner to pre-select: the project he is standing on, or null for the organization.
  defaultSiteId = null,
  defaultSiteName = null,
  onCreate,
  onClose,
}) {
  // The owner picker's value is a single key — a site's group id, or ORG_OWNER_KEY — so "which
  // owner is selected" has one representation here and matches ownerKeyOf() everywhere else.
  const [ownerKey, setOwnerKey] = useState(() => (defaultSiteId != null ? defaultSiteId : ORG_OWNER_KEY));
  const nameRef = useRef(null);
  const touchedRef = useRef(false);   // has he typed? — a pre-fill may be replaced, never overwritten

  const owners = useMemo(() => {
    const rows = [{ key: ORG_OWNER_KEY, label: ORG_OWNER_LABEL }];
    for (const p of siteProjects) {
      if (p && p.id != null) rows.push({ key: p.id, label: p.name || "Untitled project" });
    }
    // The pre-selected project may not be in the local registry yet (a fresh tab that hasn't warmed
    // it). Add it rather than silently falling back to the organization — that fallback would be a
    // silent ownership change, which is the whole class of bug this work removes.
    if (defaultSiteId != null && !rows.some((r) => r.key === defaultSiteId)) {
      rows.splice(1, 0, { key: defaultSiteId, label: defaultSiteName || "This project" });
    }
    return rows;
  }, [siteProjects, defaultSiteId, defaultSiteName]);

  const ownerKind = ownerKey === ORG_OWNER_KEY ? OWNER_KIND_ORG : OWNER_KIND_SITE;
  const siteId = ownerKind === OWNER_KIND_SITE ? ownerKey : null;
  const siteName = owners.find((o) => o.key === ownerKey)?.label ?? null;

  const [name, setName] = useState(() =>
    suggestScheduleName(schedules, defaultSiteId != null ? OWNER_KIND_SITE : OWNER_KIND_ORG, defaultSiteId, defaultSiteName));

  // Changing the owner re-suggests a name — but ONLY while he hasn't typed one. Overwriting a name
  // he had already entered because he then corrected the owner would lose real input.
  useEffect(() => {
    if (touchedRef.current) return;
    setName(suggestScheduleName(schedules, ownerKind, siteId, siteName));
    // `schedules` is intentionally read fresh here rather than tracked: a bridged list update mid-
    // dialog must not retype the field under him.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ownerKey]);

  useEffect(() => { if (isCoarsePointer()) return; nameRef.current?.focus(); nameRef.current?.select(); }, []);

  const result = validateNewSchedule({ name, ownerKind, siteId, siteName, projects: schedules });
  // The error is the reason Create is disabled — shown only once he has engaged with the field, so
  // an empty form does not open already scolding him.
  const showError = !result.ok && touchedRef.current;

  const submit = () => {
    if (!result.ok) { touchedRef.current = true; setName((n) => n); nameRef.current?.focus(); return; }
    onCreate?.({ name: result.name, ownerKind: result.ownerKind, siteId: result.siteId, siteName: result.siteName });
  };

  return (
    <div
      style={scrim}
      role="dialog"
      aria-modal="true"
      aria-label="New schedule"
      data-testid="new-schedule-modal"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}
    >
      <form
        style={card}
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        onKeyDown={(e) => { if (e.key === "Escape") { e.stopPropagation(); onClose?.(); } }}
      >
        <h2 style={title}>New schedule</h2>

        <Field label="Name" stacked required>
          <input
            ref={nameRef}
            style={input}
            value={name}
            placeholder="Master Schedule"
            data-testid="new-schedule-name"
            onChange={(e) => { touchedRef.current = true; setName(e.target.value); }}
          />
        </Field>

        <Field label="Lives under" stacked required>
          <select
            style={input}
            value={ownerKey}
            data-testid="new-schedule-owner"
            onChange={(e) => setOwnerKey(e.target.value)}
          >
            {owners.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </Field>

        {showError && (
          <div style={{ ...note, color: "var(--danger-text)" }} data-testid="new-schedule-error">{result.error}</div>
        )}
        {result.ok && result.warning && (
          <div style={{ ...note, color: "var(--warn-text)" }} data-testid="new-schedule-warning">{result.warning}</div>
        )}

        <div style={actions}>
          <Button type="button" variant="secondary" onClick={() => onClose?.()}>Cancel</Button>
          <Button
            type="submit"
            accent={ACCENT}
            disabled={!result.ok}
            data-testid="new-schedule-create"
          >
            Create schedule
          </Button>
        </div>
      </form>
    </div>
  );
}
