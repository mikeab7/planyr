/* @planner-extract — AUDIT BATCH G4: version history + plan activity (the automatic-backups dialog state, the Activity tab fetch, open/restore) that used to be state and handlers inside the SitePlanner component. Moved verbatim into one hook that receives the few things it needs (siteId, readOnly, the history/replace/flash functions) and returns what the dialog reads. Behaviour-identical; see test/helpers/plannerSource.js. */
import { useState } from "react";
import { saveSite, isCloudActive, listVersions, getVersion, initHistoryStore, backupNow, backupNowVerified, historyIdbOnly } from "./storage.js";
import { reportClientEvent } from "../../../shared/telemetry/clientErrors.js";
import { groupRowsIntoOperations, describeOperation } from "./operationEnvelope.js";
import { fetchElements } from "./elementApi.js";
import { supabase } from "./supabase.js";
import { journalSid } from "./plannerConstants.js";

export function useVersionHistory(p) {
  const { closeHdrMenus, flashWarn, flushSite, nameResolverRef, pushHistory, readOnly, replacePlanContents, setMulti, setSel, siteId } = p;
  const [versionsOpen, setVersionsOpen] = useState(false); // version-history (automatic backups) dialog
  const [versionList, setVersionList] = useState([]);    // [{at, buildings, sig}] snapshots for this plan
  /* B472048 (NEW-7 · NEW-3) — PLAN ACTIVITY: a second tab in the SAME dialog (per the item's own
   * instruction to extend the existing clock/history control rather than build a second one).
   * Version history is a per-DEVICE ring of whole-plan snapshots with no actor; it cannot answer
   * "who did this" by construction. Activity reads the opposite source — the site_elements ROWS
   * themselves, which now carry an operation envelope (db/commit_elements_op_envelope.sql) — and
   * is therefore the one surface in the app that is genuinely CROSS-SESSION: unlike the local
   * Undo/Redo history dropdown (B648353's `describeHistoryStep`, which can only ever describe
   * frames THIS tab pushed), it names what a DIFFERENT session did too. */
  const [activityTab, setActivityTab] = useState("versions"); // "versions" | "activity"
  const [activityRows, setActivityRows] = useState(null);     // null = not loaded yet; [] = loaded, empty
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityErr, setActivityErr] = useState("");
  // Version history (automatic local backups, B126): open the dialog with this plan's
  // saved snapshots, and restore one into the canvas (which then autosaves as the newest
  // version — and the thinner state it replaces is itself snapshotted, so a restore is
  // reversible). Geometry is fully restored; any stripped backdrop image may need re-dropping.
  const openVersionHistory = () => { setVersionList(listVersions(siteId)); initHistoryStore().then(() => setVersionList(listVersions(siteId))).catch(() => {}); /* B2236000 — the ring hydrates off the boot path; re-list once it has */ setActivityTab("versions"); setVersionsOpen(true); closeHdrMenus(); };
  // B472048 (NEW-7 · NEW-3) — the Activity tab's data, fetched lazily on first switch (not on
  // every dialog open) so opening "Version history" for its ordinary purpose costs nothing new.
  // `groupRowsIntoOperations` + `describeOperation` are the ALREADY-SHIPPED, unit-tested pure
  // model from lib/operationEnvelope.js (B472048's foundation PR) — this is the wiring, not a
  // reimplementation. Names are resolved through the SAME roster resolver B673's conflict toasts
  // use (`nameResolverRef`), so a teammate's name can never disagree between the two surfaces.
  const loadPlanActivity = async () => {
    if (!siteId || !isCloudActive()) { setActivityRows([]); return; }
    setActivityLoading(true); setActivityErr("");
    try {
      const r = await fetchElements(supabase, siteId);
      if (!r.ok) { setActivityErr("Couldn't load activity — try again."); setActivityRows([]); return; }
      const ops = groupRowsIntoOperations(r.rows, { selfSessionId: journalSid }).slice(0, 40);
      const uids = [...new Set(ops.filter((o) => !o.isMine && o.userId).map((o) => o.userId))];
      const names = new Map();
      await Promise.all(uids.map(async (u) => {
        try { const a = await nameResolverRef.current(u); if (a && !a.self && a.name) names.set(u, a.name); } catch (_) { /* falls back to "Someone" below */ }
      }));
      setActivityRows(ops.map((op) => ({
        opId: op.opId, at: op.at, rowCount: op.rowCount,
        text: describeOperation(op, { nameOf: (sessionId, userId) => names.get(userId) || "Someone" }),
        created: op.created, deleted: op.deleted, updated: op.updated,
      })));
    } catch (_) {
      setActivityErr("Couldn't load activity — try again.");
      setActivityRows([]);
    } finally {
      setActivityLoading(false);
    }
  };
  const openActivityTab = () => { setActivityTab("activity"); if (activityRows === null && !activityLoading) loadPlanActivity(); };
  const restoreVersion = async (at) => {
    // B467/NEW-4 — Restore is a WRITE. A read-only tab (another tab is the active editor) must not be
    // able to overwrite the canvas; block it loudly with the way out.
    if (readOnly) { flashWarn("⚠ This tab is read-only — the plan is open in another tab. Take over editing here first, then restore.", 9000); return; }
    const v = getVersion(siteId, at);
    if (!v) return;
    // B467/NEW-4 — VERIFY the dialog's "your current version is backed up too, so a restore can be
    // undone" promise BEFORE destroying the current canvas. Flush the live state to the mirror, then
    // force a backup snapshot and confirm it actually persisted; if it couldn't (device storage full),
    // CANCEL rather than overwrite current work with no real undo.
    flushSite();
    if (!(historyIdbOnly() ? await backupNowVerified(siteId) : backupNow(siteId))) {   // B2200385 — on a device whose ring lives only in IndexedDB the backup is awaited, committed and read back before it is claimed
      reportClientEvent("restore-backup-failed", "pre-restore backup could not be written — restore blocked", { id: siteId, at });
      flashWarn("Couldn't back up your current version, so the restore was cancelled — your current work is safe. (Your device's storage may be full.)", 11000);
      return;
    }
    pushHistory();
    replacePlanContents(v);
    // B563 — parcelDrawings rides its OWN persistence path (off the main autosave snapshot), so the
    // restore above silently skips it. The per-parcel Attached-Drawings UI was removed, but the data
    // still round-trips and must survive a version restore (else a restored version would keep the
    // CURRENT drawings — a mixed-version state). The stored version captures parcelDrawings, so
    // durably re-apply them via a saveSite MERGE ({...existing, ...partial} preserves the rest).
    // (B672: the old noteLocalContent thin-clobber rebase is gone with the guard — a restore to a
    // thinner version now diffs into per-element deletes through the rev-checked path.)
    if (siteId) saveSite({ id: siteId, parcelDrawings: v.parcelDrawings || [] });
    setSel(null); setMulti([]); setVersionsOpen(false);
  };
  return { activityErr, activityLoading, activityRows, activityTab, openActivityTab, openVersionHistory, restoreVersion, setActivityTab, setVersionsOpen, versionList, versionsOpen };
}
