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
import { upsertReview, writeDraft, currentUid, cloudReady } from "./reviewStore.js";
import { onAuthChange } from "../../site-planner/lib/auth.js";

const DEBOUNCE_MS = 600;

export function useReviewPersistence({ buildSnapshot, isEmpty, deps, enabled = true }) {
  const [status, setStatus] = useState("local"); // local | saving | saved | unsaved

  const snapRef = useRef(buildSnapshot); snapRef.current = buildSnapshot;
  const emptyRef = useRef(isEmpty); emptyRef.current = isEmpty;
  const enabledRef = useRef(enabled); enabledRef.current = enabled;
  const readyRef = useRef(false);
  const uidRef = useRef(null);
  const firstRun = useRef(true);
  const suspendUntilRef = useRef(0); // a programmatic load parks this in the future so the autosave won't re-save what it just loaded (B19)
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
    if (snap) writeDraft(uidRef.current, snap);
    return snap;
  }, []);

  // A programmatic load (resume/open) sets the same deps the autosave watches; parking
  // the suspend window in the future makes the next autosave tick(s) skip, so a just-
  // loaded snapshot isn't re-stamped with a fresh updatedAt (which could clobber a newer
  // cloud edit). Re-armed before each async commit so a slow load stays covered (B19).
  const suspendSave = useCallback((ms = 1500) => { suspendUntilRef.current = Date.now() + ms; }, []);

  const writeNow = useCallback(async () => {
    if (!enabledRef.current || emptyRef.current()) return;
    const snap = flushLocal();
    if (!snap) return;
    if (!readyRef.current) { setStatus("local"); return; }
    setStatus("saving");
    const { ok, conflict } = await upsertReview({ ...snap, updatedAt: Date.now() });
    if (ok) dirtyRef.current = false; // cloud has the latest; a later edit re-flags dirty (B44)
    // A conflict (B297) — this review was changed in another session — is its own state, not a
    // plain "unsaved": retrying won't help, the user must reload to merge in the latest first.
    setStatus(conflict ? "conflict" : (ok ? "saved" : "unsaved"));
  }, [flushLocal]);

  // Debounced autosave on edits; skips only the initial mount.
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return; }
    if (Date.now() < suspendUntilRef.current) return; // deps set by a programmatic load — don't autosave them back (B19)
    if (!enabledRef.current || emptyRef.current()) return;
    dirtyRef.current = true;                  // a real edit — the flush may need to write it (B44)
    flushLocal();                            // local mirror is immediate
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
    return () => { window.removeEventListener("beforeunload", flush); document.removeEventListener("visibilitychange", onVis); flush(); };
  }, [flushLocal]);

  return { status, setStatus, saveNow: writeNow, suspendSave };
}
