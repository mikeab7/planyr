/* Single-active-editor lock (B455/NEW-7) — the deferred structural half of B313.
 *
 * B313 shipped a multi-tab WARNING (BroadcastChannel). This goes further: using the Web
 * Locks API, only ONE tab/window holds the editor lock for a given project at a time. The
 * holder is the active editor; any OTHER tab open on the SAME project is told it is
 * READ-ONLY and must not push saves — the direct structural fix for the stale-tab clobber
 * (a background tab can no longer overwrite the active tab's newer cloud row). When the
 * active tab closes, the lock hands off automatically and a waiting tab becomes active.
 *
 * Scope mirrors the rest of our multi-tab safety net: Web Locks is same-origin, same-
 * browser (the gap BroadcastChannel covers too); cross-DEVICE conflicts stay the job of the
 * optimistic-concurrency guard (B314). Where Web Locks is unavailable the lock DEGRADES
 * OPEN — the tab is treated as active (never locked out), so nothing breaks; we just lose
 * the extra protection. Until the lock has decided (a sub-millisecond window) we also treat
 * the tab as active, so a sole tab never flashes a spurious "read-only" banner.
 *
 * createEditorLock returns a controller:
 *   setProject(id)  acquire the lock for this project (releases any previous hold; null = none)
 *   onChange(cb)    cb({ active, readOnly }) whenever the role changes
 *   role()          current { active, readOnly }
 *   stop()          release + tear down
 * The pure lockRole() maps (state) → role and is unit-tested; the orchestration is exercised
 * against an injected `locks` mock.
 */

// Pure role mapping. `locksAvailable` false → degrade open (active). No project → neutral
// (nothing to edit, not read-only). Not yet decided → optimistic active (no flash, and the
// save debounce is far longer than the decision window). Decided → active iff we hold it.
export function lockRole({ locksAvailable, hasProject, decided, granted }) {
  if (!locksAvailable) return { active: true, readOnly: false };
  if (!hasProject) return { active: false, readOnly: false };
  if (!decided) return { active: true, readOnly: false };
  return { active: granted, readOnly: !granted };
}

export function createEditorLock(opts = {}) {
  const locks = opts.locks !== undefined
    ? opts.locks
    : (typeof navigator !== "undefined" && navigator.locks ? navigator.locks : null);
  const prefix = opts.prefix || "planyr-editor";
  const name = (p) => `${prefix}:${p}`;

  let project = null;
  let granted = false;
  let decided = false;
  let release = null; // resolves the held-lock promise → releases the Web Lock
  let token = 0;      // bumps on each setProject/stop so a stale grant callback is ignored
  let stopped = false;
  let cb = () => {};

  const role = () => lockRole({ locksAvailable: !!locks, hasProject: project != null, decided, granted });
  const emit = () => { try { cb(role()); } catch { /* a listener must never break the lock */ } };

  function drop() {
    if (release) { try { release(); } catch { /* already released */ } release = null; }
    granted = false; decided = false;
  }

  // Queue a Web Lock request. `wait:false` probes with ifAvailable (instant active-or-read-only);
  // `wait:true` is a blocking request that grants later, on handoff when the holder releases.
  function requestLock(p, my, wait) {
    if (!locks) return;
    const lockOpts = wait ? {} : { ifAvailable: true };
    let req;
    try {
      req = locks.request(name(p), lockOpts, (lock) => {
        if (stopped || my !== token) return; // superseded by a newer setProject/stop — don't hold
        if (!lock) {                          // ifAvailable + held elsewhere → read-only now…
          decided = true; granted = false; emit();
          requestLock(p, my, true);           // …then wait for handoff
          return;
        }
        decided = true; granted = true; emit();
        return new Promise((res) => { release = res; }); // hold until drop()
      });
    } catch {
      decided = true; granted = true; emit(); // fail open — never lock the user out
      return;
    }
    if (req && typeof req.catch === "function") {
      req.catch(() => { if (my === token && !granted) { decided = true; granted = true; emit(); } });
    }
  }

  return {
    setProject(p) {
      const next = p != null ? p : null;
      if (next === project) return;
      drop();
      project = next;
      token += 1;
      const my = token;
      emit(); // neutral/optimistic role for the new project until the lock decides
      if (project != null && locks) requestLock(project, my, false);
    },
    onChange(fn) { cb = typeof fn === "function" ? fn : () => {}; emit(); },
    role,
    active: () => role().active,
    readOnly: () => role().readOnly,
    stop() { stopped = true; token += 1; drop(); project = null; emit(); },
    _name: name, // test seam
  };
}
