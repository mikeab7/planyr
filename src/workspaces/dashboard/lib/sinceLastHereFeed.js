/* sinceLastHereFeed — the pure engine behind the "Since you were last here" dashboard card
 * (B1366384, NEW-1).
 *
 * ⛔ THERE IS NO EVENT LOG IN THIS APP. Audited before writing a line of this file: no
 * `activity_log`/`audit_log`/`event_log` table exists anywhere in the schema, and nothing on the
 * client records "X happened at time T" as a standalone fact. So this feed is derived entirely
 * from timestamps and state that already exist on the records themselves — plans, comps and notes
 * genuinely stamp `createdAt`/`updatedAt` (comps and, going forward, plans, on the DATABASE row;
 * notes on the synced page-tree node); a project rename stamps `siteRenamedAt` (the same field
 * `projectName.js` already treats as authoritative). Two of the five categories this card covers —
 * a schedule date moving, and a task being marked done — have NO such stamp anywhere (the embedded
 * Scheduler's `planar_data` blob is a live document with no per-field history), so those two are
 * answered the only honest way available without inventing an event log: by keeping a small
 * SNAPSHOT of what this account's plans/tasks looked like as of the last visit, and diffing the
 * current state against it. That snapshot is exactly as reliable as "since you were last here"
 * already promises to be — it only ever compares two dashboard visits, never claims to reconstruct
 * history from before this feature shipped.
 *
 * ⛔ THERE IS NO "TASKS COMPLETED" ROW — REMOVED, NOT MERELY UNBUILT (B1405456, 2026-09-08 review
 * FEED-2). An earlier version of this file reported a batch of tasks "closed" by watching a leaf
 * task's raw `.health` field flip to `"green"` between two visits. That is a status LABEL a person
 * sets by clicking a color picker (`HealthPicker`, public/sequence/index.html) — it carries no
 * completion event, no timestamp, and no guarantee the word "green" even MEANS finished on this
 * account: `healthLabelOverrides` lets an account relabel it to anything, and nothing here reads
 * that label back. `percentComplete` is no better a signal — B785744's own history is that marking
 * a task Complete never touches it, so it drifts from the true status on real data (212 of 557 leaf
 * tasks, measured live). There is no field anywhere in this document, and no timestamp anywhere in
 * `public.planar_data`/`public.planar_history`, that records a genuine per-task completion EVENT —
 * only a mutable status a person can set, unset, and reset for reasons that have nothing to do with
 * finishing the work. Reporting "Closed N tasks" off that is worse than not reporting it at all: it
 * can announce a batch closed when nobody finished anything. Per this same review's own stated
 * remedy — derive a row from real completions with real timestamps, or drop it rather than infer
 * one — deriving is not honestly possible here, so the row is dropped. `schedule-slip` below is not
 * the same class: an `end` date changing is an objective, unambiguous fact recorded directly in the
 * document (never a status label), and its only honesty gap was the earlier TIMING defect fixed by
 * B1373536 below — which is why it keeps its `tsApprox` treatment and this one does not exist to
 * need it.
 * ⛔ HOW THE REMAINING SNAPSHOT-DIFFED KIND IS TIMESTAMPED, and why it is not `windowStartMs`
 * (B1373536, 2026-09-08; upper-bound source widened by B1927952, 2026-09-27 — see the note at the
 * end of this bullet). `schedule-slip` has no exact occurrence time — re-confirmed against
 * production before that fix, not assumed: `public.planar_data` carries NO `updated_at` column, and
 * no task object in the live document carries a temporal field of any kind (32 distinct task keys;
 * none records when a field last changed). The first cut stamped it at `windowStartMs` — the OLDEST
 * instant the change could possibly have happened. That is a valid lower bound and a catastrophic
 * sort key: with the rows sorted newest-first and capped, an event stamped at the floor of the
 * window sorts BELOW every real-stamped event in it, so a returning user who has been away long
 * enough to overflow the cap loses 100% of their schedule rows, every time — measured at 3 of 3 on
 * a one-month absence (back when a second snapshot-diffed kind, `tasks-completed`, still existed).
 * The honest fix has two independent halves, because either alone still fails:
 *   (a) STAMP AT A MEASURED UPPER BOUND, not the floor. `scheduleLastWriteAt`
 *       (`dashboardScheduleFetch.js`) is a real, observed moment the schedule was last written, so
 *       a change we detect by diff happened at or before it — but that moment now comes from EITHER
 *       of two sources depending on the account, and this file stays agnostic to which. For an
 *       unflipped account it is still `public.planar_history`'s newest `created_at` (an append-only
 *       ring of dated writes of the whole document) — a genuine upper bound, since the snapshot
 *       write postdates whatever edit it captured. For a rows-authoritative account (B1927952) it is
 *       `max(updated_at)` across the per-schedule rows — an EXACT write instant, not inferred, but
 *       still treated as an upper bound HERE because "exact write time" is not "exact cause": the
 *       write that moved a task's `end` date could be the same write that touched an unrelated
 *       field, so the row this file diffs out could still have happened slightly before the stamp
 *       it's given. Where no source is available the bound loosens to `now`, never tightens to a
 *       guess. Either way the row is marked `tsApprox` and carries its real `tsEarliest`/`tsLatest`
 *       interval, so no consumer can mistake the point for an exact stamp.
 *   (b) CAP FAIRLY ACROSS KINDS. (a) alone is not enough: a schedule last written early in a long
 *       window legitimately stamps old, and would be cut again for an honest reason. So the cap
 *       reserves one slot per event kind present before any kind takes a second, then fills what is
 *       left by real recency. A date moving is the most consequential thing that can happen while
 *       he is away; the cap may shorten that story, never delete it.
 * No other event kind has this problem: plan-created/renamed/edited, comp-added and note-written
 * every one reads a real recorded stamp off the record itself (`created_at`, `siteRenamedAt`,
 * `updated_at`, `createdAt`) and is exact.
 *
 * ⛔ THE "NEW COMP" ROW'S RATE READS THROUGH THE SAME MODEL THE COMPS CARD USES, NOT ITS OWN COPY
 * (B1405457, 2026-09-08 review FEED-3). This file used to carry a local re-implementation of the
 * comp headline-rate math, including a lease rate rendered in the comp's OWN entered period (its
 * `leaseRatePeriod`) rather than the account's chosen display period. The Dashboard's Comps card
 * (`dashboard/lib/compsCardModel.js`) normalizes every lease rate it shows to ONE period — Michael's
 * own "per year / per month" toggle, `compsRatePeriodPrefs.js` — so the same comp could read, say,
 * "$0.65/SF/mo" in this feed and "$7.80/SF/yr" on the card two inches away, on the same screen, for
 * the exact same lease. `compAddedSubline` below calls `compHeadlineRate`/`formatRateValue` from
 * `compsCardModel.js` directly — the SAME functions the card calls, given the SAME `compsRatePeriod`
 * the card is currently showing — so the two can never disagree again. It is recomputed at RENDER
 * time (`SinceLastHereCard.jsx`'s `FeedRow`), not baked in once at feed-build time, so flipping the
 * toggle updates both cards together rather than leaving this one on whatever period was current
 * when the dashboard first loaded.
 *
 * "Plans meaningfully edited" is scoped to whichever plans the Pursuits card already fetched
 * building geometry for (the touched-pursuit set) — reusing an existing, already-paid-for fetch
 * rather than adding a new account-wide element scan. A plan outside that set (tracked/complete/
 * dead, or a pursuit nobody opened this session) simply cannot report an edit; it can still report
 * being created or renamed, which read off real stamps with no such limit.
 */

import { compHeadlineRate, formatRateValue, DEFAULT_LEASE_PERIOD, countyNameWords } from "./compsCardModel.js";
import { shortenDisplayName } from "../../../shared/projects/projectModel.js";
import { crossScheduleLabel } from "../../../shared/schedule/scheduleOwnership.js";

// B1407824 — how far a name in this feed's own sentence/subline can run before it's shortened
// (shortenDisplayName's contract: a name at or under this stays untouched; a longer one is cut
// cleanly, never on a dangling comma/period/hyphen/space). The feed row sits beside an icon tile
// and a right-aligned age chip, so it has real but not unlimited width.
const FEED_NAME_MAX_CHARS = 36;

const MS_PER_DAY = 86400000;
const OWN_ACTION_DEBOUNCE_MS = 30000; // "his own actions from thirty seconds ago" — never shown
const FIRST_VISIT_FALLBACK_MS = 24 * 60 * 60 * 1000; // no prior mark at all: look back one day
const CAP_ROWS = 12;

export const KIND_META = {
  "plan-created": { glyph: "+", accent: "site" },
  "plan-renamed": { glyph: "✎", accent: "site" }, // ✎
  "plan-edited": { glyph: "▦", accent: "site" }, // ▦
  "schedule-slip": { glyph: "↷", accent: "schedule" }, // ↷
  "comp-added": { glyph: "$", accent: "site" },
  "note-written": { glyph: "▤", accent: "notes" }, // ▤
};

function parseLocalDate(isoDate) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate || ""));
  if (!m) return null;
  const t = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
  return Number.isNaN(t) ? null : t;
}

function leafTasks(tasks) {
  const parentIds = new Set();
  for (const t of tasks) { if (t && t.parentId != null) parentIds.add(t.parentId); }
  return tasks.filter((t) => t && !parentIds.has(t.id));
}

function fmtInt(n) {
  return Number.isFinite(n) ? Math.round(n).toLocaleString("en-US") : "0";
}

function statusLabel(status) {
  const MAP = { pursuit: "Pursuit", active: "Active", onhold: "On hold", complete: "Complete", dead: "Dead" };
  return MAP[status] || null;
}

function planIdentity(site) {
  return { groupId: site.group_id || site.id, siteId: site.id };
}

/** "Harris County · Pursuit" — real, already-fetched facts, used as the sub-line's fallback
 * substance whenever a plan's building geometry isn't in the touched set (a freshly created plan
 * that isn't a pursuit, or one nobody opened this session).
 *
 * B1407824 — `site.county` is a lower-case ROUTING KEY ("harris", "fort_bend" — see
 * shared/CLAUDE.md's County ROUTING KEYS note), never a display string, so building the sentence
 * with it verbatim printed "harris County" / "bowie County". `countyNameWords` (compsCardModel.js
 * — the SAME title-casing the Comps card already shows) is the one place this repo turns that key
 * into "Harris" / "Fort Bend"; this composes it into "County" exactly like that module's own
 * `countyLabel` composes it into "County, TX/CO" — one capitalization rule, two sentences. */
function planContextLine(site) {
  const bits = [];
  const { words } = countyNameWords(site.county);
  if (words) bits.push(`${words.join(" ")} County`);
  const label = statusLabel(site.status);
  if (label) bits.push(label);
  return bits.join(" · ");
}

function buildingsLine(buildingCount, sqft) {
  const n = buildingCount || 0;
  return `${n} building${n === 1 ? "" : "s"} · ${fmtInt(sqft)} SF`;
}

/** Plan events (created / renamed / meaningfully edited) — at most ONE per plan per visit,
 * priority created > renamed > edited, so one plan never produces three rows for what is really
 * one story. Also returns the next `plans` snapshot: a full replace of the touched-pursuit set
 * (dropped plans that cycled out of it are simply not carried forward — they contribute nothing
 * either way until they're touched again). */
function buildPlanEvents({ sites, buildingCountBySite, sqftBySite, prevPlanSnapshot, windowStartMs }) {
  const rows = [];
  const nextPlans = {};
  for (const site of sites || []) {
    if (!site || !site.id) continue;
    const { groupId, siteId } = planIdentity(site);
    const createdMs = Date.parse(site.created_at || "");
    const updatedMs = Date.parse(site.updated_at || "");
    const renamedMs = site.siteRenamedAt != null ? Number(site.siteRenamedAt) : NaN;
    const hasBuildingData = Object.prototype.hasOwnProperty.call(buildingCountBySite || {}, siteId);
    const name = (site.site || site.name || "Untitled site").trim() || "Untitled site";
    // B1407824 — the FULL name is what's kept in the snapshot and what `open` resolves against;
    // only the SENTENCE gets shortened, so a long name never breaks this row's own layout.
    const displayName = shortenDisplayName(name, FEED_NAME_MAX_CHARS);

    let fired = false;

    if (Number.isFinite(createdMs) && createdMs >= windowStartMs) {
      const line = hasBuildingData
        ? buildingsLine(buildingCountBySite[siteId], sqftBySite[siteId])
        : planContextLine(site);
      rows.push({
        id: `plan-created:${siteId}`,
        kind: "plan-created",
        ts: createdMs,
        parts: [{ text: "New plan " }, { text: displayName, bold: true }],
        subline: line || "New plan",
        open: { kind: "project", groupId },
      });
      fired = true;
    }

    if (!fired && Number.isFinite(renamedMs) && renamedMs >= windowStartMs) {
      rows.push({
        id: `plan-renamed:${siteId}`,
        kind: "plan-renamed",
        ts: renamedMs,
        parts: [{ text: "Renamed to " }, { text: displayName, bold: true }],
        subline: planContextLine(site) || "Renamed",
        open: { kind: "project", groupId },
      });
      fired = true;
    }

    if (!fired && hasBuildingData && Number.isFinite(updatedMs) && updatedMs >= windowStartMs) {
      const prev = prevPlanSnapshot ? prevPlanSnapshot[siteId] : null;
      const nowCount = buildingCountBySite[siteId] || 0;
      const nowSqft = sqftBySite[siteId] || 0;
      if (prev && (prev.buildingCount !== nowCount || Math.abs((prev.sqft || 0) - nowSqft) > 25)) {
        rows.push({
          id: `plan-edited:${siteId}:${updatedMs}`,
          kind: "plan-edited",
          ts: updatedMs,
          parts: [{ text: displayName, bold: true }, { text: " updated" }],
          subline: buildingsLine(nowCount, nowSqft),
          open: { kind: "project", groupId },
        });
      }
    }

    if (hasBuildingData) {
      nextPlans[siteId] = { name, buildingCount: buildingCountBySite[siteId] || 0, sqft: sqftBySite[siteId] || 0 };
    }
  }
  return { rows, nextPlans };
}

/** Schedule events (a milestone's date moving) — diffed against the per-task snapshot from the
 * last visit, since nothing in the schedule data itself records when a field last changed. See
 * this module's header for how this is timestamped and why it is NOT `windowStartMs`: it carries
 * the tightest MEASURED upper bound available (`scheduleLastWriteAt`, the newest `planar_history`
 * write of this document; `now` when that is unavailable), clamped so an approximate row can never
 * suppress itself against the own-action debounce, and marked `tsApprox` with the real
 * `[tsEarliest, tsLatest]` interval it is known to lie in.
 *
 * ⛔ Deliberately does NOT also report a task's `.health` flipping to `"green"` as "completed" —
 * see this module's header (FEED-2, 2026-09-08 review): that field is a user-set status label with
 * no completion timestamp behind it, not a recorded event, and reporting it as one can announce a
 * batch of tasks "closed" when nobody finished anything.
 *
 * B1939344 (NEW-1) — `projectName` (used in the row's subline) is the QUALIFIED
 * "<Project> / <Schedule>" label (`crossScheduleLabel`), not the bare schedule name — see
 * scheduleHealth.js's own header for why a bare name is ambiguous on this account. */
function buildScheduleEvents({ scheduleProjects, prevTaskSnapshot, windowStartMs, approxTs, tsLatest }) {
  const rows = [];
  const nextTasks = {};
  const projects = scheduleProjects && typeof scheduleProjects === "object" ? Object.values(scheduleProjects) : [];
  for (const p of projects) {
    if (!p || p.id == null) continue;
    const tasks = Array.isArray(p.tasks) ? p.tasks : [];
    const leaves = leafTasks(tasks);
    const prevProject = (prevTaskSnapshot && prevTaskSnapshot[p.id]) || {};
    const nextProject = {};
    const projectName = crossScheduleLabel(p);

    for (const t of leaves) {
      if (!t || t.id == null) continue;
      nextProject[t.id] = { end: t.end || null, name: (t.name && String(t.name).trim()) || "" };
      const prev = prevProject[t.id];
      if (!prev) continue;

      if (prev.end && t.end && prev.end !== t.end) {
        const oldMs = parseLocalDate(prev.end);
        const newMs = parseLocalDate(t.end);
        if (oldMs != null && newMs != null) {
          const days = Math.round((newMs - oldMs) / MS_PER_DAY);
          if (days !== 0) {
            const taskName = nextProject[t.id].name || `Task #${t.id}`;
            rows.push({
              id: `schedule-slip:${p.id}:${t.id}`,
              kind: "schedule-slip",
              ts: approxTs,
              tsApprox: true,
              tsEarliest: windowStartMs,
              tsLatest,
              parts: [
                { text: "Milestone " },
                { text: taskName, bold: true },
                { text: days > 0 ? ` slipped ${days} day${days === 1 ? "" : "s"}` : ` moved up ${-days} day${-days === 1 ? "" : "s"}` },
              ],
              subline: `${projectName} · ${days > 0 ? "+" : ""}${days}d`,
              open: { kind: "task", linkedSiteId: p.linkedSiteId || null, taskId: t.id },
            });
          }
        }
      }
    }

    nextTasks[p.id] = nextProject;
  }
  return { rows, nextTasks };
}

function compSizeText(comp) {
  if (comp.compType === "land") {
    if (!comp.landSizeValue) return "";
    return `${fmtInt(comp.landSizeValue)} ${comp.landSizeUnit === "sf" ? "SF" : "ac"}`;
  }
  if (comp.compType === "building_sale") {
    return comp.bldgSizeSf ? `${fmtInt(comp.bldgSizeSf)} SF` : "";
  }
  if (comp.compType === "lease") {
    return comp.leaseSizeSf ? `${fmtInt(comp.leaseSizeSf)} SF` : "";
  }
  return "";
}

const COMP_TYPE_FALLBACK = { land: "Land comp", building_sale: "Building sale", lease: "Lease comp" };

/** The "New comp" row's rate + size line, e.g. "$7.80/SF/yr NNN · 600,000 SF" — the rate through
 * `compHeadlineRate`/`formatRateValue` (`compsCardModel.js`), the SAME functions and the SAME
 * `compsRatePeriod` the Comps card uses, so this can never disagree with what the card shows for
 * the same comp (see this module's header, FEED-3). Exported so `SinceLastHereCard.jsx` can
 * recompute it at render time against the CURRENT period, rather than freezing whichever one was
 * current when the feed was built. `land`/`building_sale` keep their old " land"/" sale" suffix
 * (the only place a comp-added row states its type at all); a lease needs none — its `/mo`/`/yr`
 * already says so. */
export function compAddedSubline(comp, compsRatePeriod = DEFAULT_LEASE_PERIOD) {
  const rate = compHeadlineRate(comp, compsRatePeriod);
  let rateText;
  if (rate == null) {
    rateText = COMP_TYPE_FALLBACK[comp.compType] || "Comp";
  } else {
    const unit = rate.unit.replace(/^\$/, "");
    const basis = rate.basis ? ` ${rate.basis.toUpperCase()}` : "";
    const suffix = comp.compType === "land" ? " land" : comp.compType === "building_sale" ? " sale" : "";
    rateText = `${formatRateValue(rate.value)}${unit}${basis}${suffix}`;
  }
  const size = compSizeText(comp);
  return [rateText, size].filter(Boolean).join(" · ") || "New comp";
}

/** Comp events — `compAddedSubline` above states the rate + size in one line. */
function buildCompEvents({ comps, compsRatePeriod }) {
  return (comps || []).map((comp) => {
    const ts = Date.parse(comp.createdAt || "");
    const noun = comp.title || "New comp";
    return {
      id: `comp-added:${comp.id}`,
      kind: "comp-added",
      ts: Number.isFinite(ts) ? ts : 0,
      parts: [{ text: "New comp " }, { text: noun, bold: true }],
      subline: compAddedSubline(comp, compsRatePeriod),
      open: { kind: "comp", comp },
    };
  }).filter((r) => r.ts > 0);
}

/** Note events — a page with no words yet carries no substance, so it is dropped rather than
 * shown with an empty quote (root CLAUDE.md's "if a row cannot carry substance, it does not
 * belong in the feed"). */
function buildNoteEvents({ notePages }) {
  return (notePages || [])
    .filter((p) => p.opening)
    .map((p) => ({
      id: `note-written:${p.id}`,
      kind: "note-written",
      ts: p.createdAt,
      parts: [{ text: "New note " }, { text: p.title, bold: true }],
      subline: `“${p.opening}”`,
      open: { kind: "note", pageId: p.id, projectId: p.projectId, orgScope: p.orgScope },
    }));
}

/**
 * Take at most `cap` rows out of `rows` (already sorted newest-first) WITHOUT letting any one
 * event kind be eliminated wholesale.
 *
 * Plain `slice(0, cap)` ranks purely on the timestamp, which is correct only while every kind's
 * timestamp is equally precise. Two of the seven kinds are snapshot-diffed and can only carry an
 * approximate one (see this module's header), so a plain slice systematically deletes exactly the
 * rows that matter most. Instead: one reserved pass hands each kind present its single newest row,
 * then every remaining slot is filled by real recency across what is left. With `cap` at or above
 * the number of kinds — 12 against 7 here — a kind present in the feed ALWAYS reaches the card.
 * The result is re-sorted newest-first so the card still reads as a chronology.
 */
export function capRowsFairlyByKind(rows, cap) {
  if (!Array.isArray(rows) || rows.length <= cap) return (rows || []).slice();
  if (cap <= 0) return [];
  const taken = new Set();
  const seenKind = new Set();
  for (const r of rows) {                      // reserved pass — newest row of each kind
    if (taken.size >= cap) break;
    if (seenKind.has(r.kind)) continue;
    seenKind.add(r.kind);
    taken.add(r);
  }
  for (const r of rows) {                      // fill the rest by real recency
    if (taken.size >= cap) break;
    taken.add(r);
  }
  return rows.filter((r) => taken.has(r));     // `rows` order === newest-first
}

/**
 * Build the whole feed. Pure — no Date.now() default, so a caller (and every test) controls the
 * clock explicitly.
 *
 * @param {object} args
 * @param {number} args.now
 * @param {number|null} args.lastVisitAt — null on a genuine first visit under this feature
 * @param {Array}  args.sites — fetchSiteSummaries() rows (created_at/updated_at/siteRenamedAt included)
 * @param {object} args.buildingCountBySite — { [siteId]: N } for the touched-pursuit set only
 * @param {object} args.sqftBySite — { [siteId]: sqft } for the same set
 * @param {object|null} args.scheduleProjects — fetchScheduleProjects()'s raw projects map
 * @param {Array}  args.comps — fetchRecentComps() rows (already createdAt-filtered)
 * @param {Array}  args.notePages — fetchRecentNotePages() rows (already createdAt-filtered)
 * @param {object} args.prevSnapshot — the stored { plans, tasks } from the last visit
 * @param {string} [args.compsRatePeriod] — the Comps card's own "annual"|"monthly" display choice
 *   (`compsRatePeriodPrefs.js`), so a lease comp's rate here matches the card exactly — see this
 *   module's header, FEED-3. Defaults to `DEFAULT_LEASE_PERIOD`, same as an untouched card.
 */
export function buildSinceLastHereFeed({
  now,
  lastVisitAt,
  sites = [],
  buildingCountBySite = {},
  sqftBySite = {},
  scheduleProjects = null,
  comps = [],
  notePages = [],
  prevSnapshot = { plans: {}, tasks: {} },
  scheduleLastWriteAt = null,
  compsRatePeriod = DEFAULT_LEASE_PERIOD,
}) {
  const isFirstVisit = lastVisitAt == null;
  const windowStartMs = isFirstVisit ? now - FIRST_VISIT_FALLBACK_MS : lastVisitAt;

  // The tightest MEASURED upper bound on when a snapshot-diffed schedule change happened: the
  // newest write of the schedule document itself. Unavailable → `now`, which is a looser bound but
  // still a true one. Then clamped into the window at both ends: never before `windowStartMs` (a
  // write that predates the last visit cannot explain a change detected against it — the real
  // change is later, and this is a stale ring), and never inside the own-action debounce (an
  // approximate row must not be able to suppress ITSELF as "something you just did" — the debounce
  // exists to hide known-recent actions, and this time is not known).
  const lastWrite = Number(scheduleLastWriteAt);
  const tsLatest = Math.min(Number.isFinite(lastWrite) && lastWrite > 0 ? lastWrite : now, now);
  const scheduleTs = Math.min(Math.max(tsLatest, windowStartMs), now - OWN_ACTION_DEBOUNCE_MS);

  const plan = buildPlanEvents({ sites, buildingCountBySite, sqftBySite, prevPlanSnapshot: prevSnapshot.plans, windowStartMs });
  const schedule = buildScheduleEvents({
    scheduleProjects, prevTaskSnapshot: prevSnapshot.tasks, windowStartMs,
    approxTs: scheduleTs, tsLatest,
  });
  const compRows = buildCompEvents({ comps, compsRatePeriod });
  const noteRows = buildNoteEvents({ notePages });

  const allRows = [...plan.rows, ...schedule.rows, ...compRows, ...noteRows]
    .filter((r) => now - r.ts >= OWN_ACTION_DEBOUNCE_MS)
    .sort((a, b) => b.ts - a.ts);

  const capped = capRowsFairlyByKind(allRows, CAP_ROWS);
  const overflowCount = allRows.length - capped.length;

  const nextSnapshot = { plans: plan.nextPlans, tasks: schedule.nextTasks };
  const spanAnchor = isFirstVisit ? windowStartMs : lastVisitAt;

  return {
    rows: capped,
    totalCount: allRows.length,
    overflowCount,
    spanAnchorMs: spanAnchor,
    nextSnapshot,
    nextLastVisitAt: now,
  };
}
