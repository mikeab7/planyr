/* Library › folder rail — one background Google Drive mirror run, TAGGED with the project it belongs to.
 *
 * NEW-5 (2026-10-29): FolderTree stays mounted across a project switch, and the sync it started for
 * project A kept reporting into the single "drive" status line after the person opened project B —
 * "Mirroring to Google Drive… 3 of 12", then "Synced · just now" or a red error, all about A, under
 * B's folders. The sync itself cannot be aborted (it is a chain of server calls), so its REPORTS are
 * filtered instead: progress and the final verdict reach the screen only while `isShown(projectId)`
 * is true. The one thing that still happens for a project that is no longer shown is remembering
 * that ITS mirror was confirmed (`remember`), because that fact is true of A whatever B is showing.
 * Everything is injected, so test/libraryDriveSyncSwitch.test.js drives it with a fake sync. */
export async function runDriveSync({ projectId, isShown, setDrive, sync, now = Date.now, remember }) {
  const show = (status) => { if (isShown(projectId)) setDrive(status); };
  show({ state: "syncing", msg: "Mirroring to Google Drive…" });
  let r;
  try {
    r = await sync(projectId, {
      onProgress: ({ done, total }) => show({ state: "syncing", msg: `Mirroring to Google Drive… ${done} of ${total}` }),
    });
  } catch (e) {
    r = { ok: false, error: (e && e.message) || "Drive sync had a problem." }; // LOUD-FAILURE: a throw is a red status, not a stuck "Mirroring…"
  }
  if (r && r.skipped) show({ state: "off", msg: "Saved in Planyr — Google Drive isn't connected.", at: 0 });
  else if (r && r.ok) {
    // A CONFIRMED reconcile — the only thing that may claim "Synced" (the label is driven by the
    // real backend result, never a static checkmark).
    const at = now();
    if (remember) remember(projectId, at);
    show({ state: "ok", msg: "", at });
  } else show({ state: "error", msg: (r && r.error) || "Drive sync had a problem.", at: 0 });
}
