/* useReviewPersistence — the Site Planner's data-loss pattern for a Document Review
 * record:
 *   - persists on the FIRST real edit (not only on an explicit Save),
 *   - an honest save badge tracking the REAL cloud write
 *       "local"   — not signed in / cloud not configured (kept in memory only),
 *       "saving"  — a write is in flight,
 *       "saved"   — the cloud has the latest,
 *       "unsaved" — the last write failed,
 *   - a synchronous localStorage mirror + beforeunload/visibility flush so an edit
 *     made right before a refresh or tab-close is never lost.
 *
 * The component supplies `buildSnapshot()` (returns the serializable review, called
 * at save time so it always reads the latest state), `isEmpty()` (a blank review is
 * never written), and a `deps` array that changes whenever the review changes.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { upsertReview, keepaliveFlushReview, writeDraft, currentUid, cloudReady } from "./reviewStore.js";
import { planAutosave } from "./autosavePlan.js";
import { onAuthChange } from "../../site-planner/lib/auth.js";
import { registerFlush } from "../../../app/flushRegistry.js";
import { createEditorLock } from "../../../shared/presence/editorLock.js";

const DEBOUNCE_MS = 600;

// Map the doc-review save `status` (+ signed-in / idle) onto the normalized saveState
// vocabulary the shared CloudSyncBadge speaks ("synced"|"saving"|"error"|"local"|null).
// Pure + exported so the "a failed write is LOUD, never silent" contract is unit-locked
// (cloudSyncBadge.test.js), the same guarantee the old ReviewsBar chip carried:
//   idle (nothing loaded) → null  → the badge shows nothing (no cry-wolf at rest);
//   a failed/conflicting write → "error" → the badge goes LOUD and red;
//   a signed-in user's work reads as cloud-saved ("synced"); signed-out is "local" (device).
export function docSaveState(status, signedIn, idle) {
  if (idle) return null;
  if (status === "saving") return "saving";
  if (status === "unsaved" || status === "conflict") return "error"; // a cloud write didn't land — loud, never silent
  if (status === "saved" || signedIn) return "synced";
  return "local"; // signed-out with content — saved on this device only
}

// Pure: may we push a cloud save right now (B455/NEW-7)? No while a conflict is unresolved
// (the user must reload to merge the other session's change first — retrying just re-
// conflicts), and no from a read-only background tab (it would clobber the active tab's
// newer copy). The local mirror is unaffected — only the CLOUD push is gated. Unit-tested.
export function canCloudSave(status, readOnly) {
  return status !== "conflict" && !readOnly;
}

export function useReviewPersistence({ buildSnapshot, isEmpty, deps, enabled = true }) {
  const [status, setStatus] = useState("local"); // local | saving | saved | unsaved | conflict
  const statusRef = useRef(status); statusRef.current = status;
  // B455/NEW-7 — single-active-editor lockout, mirrored from the Site Planner. A second tab
  // on the SAME review goes read-only so it can't push over the active tab's newer copy.
  const [readOnly, setReadOnly] = useState(false);
  const readOnlyRef = useRef(false); readOnlyRef.current = readOnly;
  const lockRef = useRef(null);
  const lockIdRef = useRef(null);
  useEffect(() => {
    lockRef.current = createEditorLock();
    lockRef.current.onChange((r) => setReadOnly(!!r.readOnly));
    return () => { if (lockRef.current) lockRef.current.stop(); };
  }, []);

  const snapRef = useRef(buildSnapshot); snapRef.current = buildSnapshot;
  const emptyRef = useRef(isEmpty); emptyRef.current = isEmpty;
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const readyRef = useRef(false);
  const uidRef = useRef(null);
  const firstRun = useRef(true);
  const suspendUntilRef = useRef(0); // a programmatic load parks this in the future so the autosave won't re-save what it just loaded (B19)
  const loadEchoRef = useRef(false); // the next autosave tick is a programmatic load echoing its own deps, not a user edit — skip it without suppressing real edits in the same window (B324)
  const dirtyRef = useRef(false); // an unsaved edit since the last successful write — gates the unmount/hide flush so a single↔stitch toggle doesn't re-upsert unchanged data (B44)

  // Track cloud readiness up front and on auth changes. The badge stays "local"
  // ("Not saved") until a real edit drives a real write — we never claim "Saved" for
  // an untouched review; signing out forces the badge back to "local".
  useEffect(() => {
    let live = true;
    const refresh = async () => {
      const [ready, uid] = await Promise.all([cloudReady(), currentUid()]);
      if (!live) return;
      readyRef.current = ready; uidRef.current = uid;
      if (!ready) setStatus("local");
    };
    refresh();
    const off = onAuthChange(() => refresh());
    return () => { live = false; off && off(); };
  }, []);

  // Mirror to localStorage synchronously (instant, lossless) and write the snapshot.
  const flushLocal = useCallback(() => {
    if (!enabledRef.current || emptyRef.current()) return null;
    const snap = snapRef.current();
    if (snap) {
      writeDraft(uidRef.current, snap);
      // Keep the editor lock pointed at the review currently being edited (B455/NEW-7).
      if (snap.id !== lockIdRef.current) { lockIdRef.current = snap.id; if (lockRef.current) lockRef.current.setProject(snap.id || null); }
    }
    return snap;
  }, []);

  // A programmatic load (resume/open) sets the same deps the autosave watches; parking
  // the suspend window in the future makes the next autosave tick(s) skip, so a just-
  // loaded snapshot isn't re-stamped with a fresh updatedAt (which could clobber a newer
  // cloud edit). Re-armed before each async commit so a slow load stays covered (B19).
  const suspendSave = useCallback((ms = 1500) => { suspendUntilRef.current = Date.now() + ms; loadEchoRef.current = true; }, []);

  const writeNow = useCallback(async () => {
    if (!enabledRef.current || emptyRef.current()) return;
    const snap = flushLocal();           // local mirror always runs (the guaranteed safety net)
    if (!snap) return;
    if (!readyRef.current) { setStatus("local"); return; }
    // B455/NEW-7 — don't push over a conflict (must reload to merge first), or from a read-only
    // background tab (would clobber the active tab's newer copy). The local mirror above ran.
    if (!canCloudSave(statusRef.current, readOnlyRef.current)) { setStatus(statusRef.current === "conflict" ? "conflict" : "unsaved"); return; }
    setStatus("saving");
    // Unconfirmed-save watchdog (B455/NEW-7): a stalled write goes red (loud) instead of
    // spinning forever. Tied to the in-flight write, so it can't false-fire during editing.
    let settled = false;
    const wd = setTimeout(() => { if (!settled) setStatus("unsaved"); }, 6000);
    const { ok, conflict } = await upsertReview({ ...snap, updatedAt: Date.now() });
    settled = true; clearTimeout(wd);
    if (ok) dirtyRef.current = false; // cloud has the latest; a later edit re-flags dirty (B44)
    // A conflict (B314) — this review was changed in another session — is its own state, not a
    // plain "unsaved": retrying won't help, the user must reload to merge in the latest first.
    setStatus(conflict ? "conflict" : (ok ? "saved" : "unsaved"));
  }, [flushLocal]);

  // Debounced autosave on edits; skips only the initial mount.
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    // A programmatic load (resume/open) re-emits the deps it just set; that echo must not mark
    // dirty or re-save. A GENUINE edit — even one made inside the short post-load window — must
    // still be mirrored + flagged dirty so it's recoverable and reaches the cloud on flush; only
    // its debounced cloud write is suppressed while suspended (B19/B44/B324).
    const plan = planAutosave({
      enabled: enabledRef.current, empty: emptyRef.current(),
      loadEcho: loadEchoRef.current, suspended: Date.now() < suspendUntilRef.current,
    });
    if (plan.consumeEcho) loadEchoRef.current = false;
    if (plan.markDirty) dirtyRef.current = true;
    if (plan.mirror) flushLocal();            // local mirror is immediate
    if (!plan.scheduleSave) return;
    // B455/NEW-7 — a conflict pauses cloud autosave until reload; a read-only background tab
    // never pushes. The local mirror above already ran, so nothing is lost.
    if (!canCloudSave(statusRef.current, readOnlyRef.current)) return;
    if (readyRef.current) setStatus("saving");
    const t = setTimeout(writeNow, DEBOUNCE_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Flush on close / tab-hide / unmount (e.g. switching workspace modes). The
  // localStorage mirror is synchronous (guaranteed); the cloud upsert is best-effort
  // (the short debounce keeps that window tiny, and the mirror backs a refresh).
  useEffect(() => {
    const flush = () => {
      const snap = flushLocal();
      if (snap && readyRef.current && dirtyRef.current) upsertReview({ ...snap, updatedAt: Date.now() }).catch(() => {}); // best-effort, only when there's an unsaved edit — a mode toggle no longer re-upserts unchanged data (B44)
    };
    const onVis = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("beforeunload", flush);
    document.addEventListener("visibilitychange", onVis);
    // B452 — a FORCED reload (chunk-recovery / ErrorBoundary) flushes through this registry
    // before navigating: the synchronous local mirror PLUS a keepalive cloud push that
    // survives the navigation, so the last edits aren't stranded in memory + the mirror.
    const offFlush = registerFlush(() => {
      const snap = flushLocal();
      if (snap && readyRef.current && dirtyRef.current && canCloudSave(statusRef.current, readOnlyRef.current)) keepaliveFlushReview({ ...snap, updatedAt: Date.now() });
    });
    return () => { window.removeEventListener("beforeunload", flush); document.removeEventListener("visibilitychange", onVis); offFlush(); flush(); };
  }, [flushLocal]);

  return { status, setStatus, saveNow: writeNow, suspendSave, readOnly };
}
