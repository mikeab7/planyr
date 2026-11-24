/* useMyTeams — who is signed in, which teams they belong to, and the account's Sites-panel arrangement load; moved verbatim
 * out of MapFinder.jsx (audit batch L2). `myUid` also feeds the Comps rate-period load and the prefs writer back in MapFinder. */
import { useEffect, useState } from "react";
import { listMyTeams, currentIdentity } from "./teams.js";
import { loadUserPrefs } from "./userPrefs.js";

export function useMyTeams() {
  const [myUid, setMyUid] = useState(null);
  const [myTeams, setMyTeams] = useState([]);
  const teamName = (id) => { const t = myTeams.find((x) => x.id === id); return t ? t.name : "a team"; };
  const refreshTeams = async () => {
    const { uid } = await currentIdentity();
    setMyUid(uid);
    if (!uid) { setMyTeams([]); return; }
    try { setMyTeams(await listMyTeams()); } catch (_) { /* keep prior list on transient error */ }
  };
  useEffect(() => { let live = true; (async () => { const { uid } = await currentIdentity(); if (!live) return; setMyUid(uid); if (uid) { try { const t = await listMyTeams(); if (live) setMyTeams(t); } catch (_) {} } })(); return () => { live = false; }; }, []);
  // B855952/B855953/B855954 — replace the local mirror with the real cross-device Sites-panel
  // arrangement once the account row loads (mirrors SitePlanner.jsx's identical `userPrefs` load).
  // Re-runs once `myUid` resolves from null → a real id (or stays null, signed out — the local
  // mirror / signed-out default is what `loadUserPrefs` already returns for that case).
  useEffect(() => {
    loadUserPrefs(myUid).then(() => { /* the load writes the shared mirror; subscribers re-render */ });
  }, [myUid]);
  return { myUid, myTeams, refreshTeams, teamName };
}
