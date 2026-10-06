/* AdminData — the datasets more than one section reads (accounts, support queue, county requests, the
 * 7-day error groups), loaded ONCE when the admin page opens and shared through context, so Overview,
 * the nav badges and the sections themselves can never disagree (one source of truth; no section seeds
 * its own copy). Every dataset is { loading, data, error, reload } from useAdminLoad. */
import { createContext, useContext, useMemo, useState, useCallback } from "react";
import { supabase } from "../site-planner/lib/supabase.js";
import { useAdminLoad } from "./AdminPanel.jsx";
import { fetchErrorGroups, shapeErrorGroups, fetchSupportReports, shapeTickets } from "./lib/adminPanels.js";
import { fetchUsersOverview, shapeUsers, isInternalEmail } from "./lib/adminUsers.js";
import { foldIssues } from "./lib/adminIssues.js";
import { prepareCriteriaRequestRows } from "./lib/criteriaRequestsAdmin.js";

const Ctx = createContext(null);
export const useAdminData = () => useContext(Ctx);

const MARK_KEY = "planyr:admin:internalEmails";
function readMarked() {
  try { return new Set(JSON.parse(localStorage.getItem(MARK_KEY) || "[]")); } catch { return new Set(); }
}

export function AdminDataProvider({ selfEmail, children }) {
  const usersLoad = useAdminLoad(() => fetchUsersOverview(supabase), []);
  const supportLoad = useAdminLoad(() => fetchSupportReports(supabase), []);
  const errorsLoad = useAdminLoad(() => fetchErrorGroups(supabase, "error", 7), []);
  const criteriaLoad = useAdminLoad(async () => {
    if (!supabase) return { data: null, error: "Not connected." };
    const { data, error } = await supabase.rpc("admin_list_criteria_requests");
    return error ? { data: null, error: error.message || String(error) } : { data: prepareCriteriaRequestRows(data), error: null };
  }, []);

  // The "Hide internal" toggle is ONE piece of state: Overview's headline counts and the Users list follow it.
  const [hideInternal, setHideInternal] = useState(true);
  const [marked, setMarked] = useState(readMarked); // stale-ok: per-browser "mark internal" list, written only by toggleMarked below
  const toggleMarked = useCallback((email) => {
    setMarked((cur) => {
      const next = new Set(cur); const e = String(email).toLowerCase();
      if (next.has(e)) next.delete(e); else next.add(e);
      try { localStorage.setItem(MARK_KEY, JSON.stringify([...next])); } catch { /* per-viewer convenience only */ }
      return next;
    });
  }, []);

  const value = useMemo(() => {
    const users = shapeUsers(usersLoad.data, { selfEmail, marked, now: Date.now() });
    const tickets = shapeTickets(supportLoad.data);
    const issues = foldIssues(shapeErrorGroups(errorsLoad.data));
    const criteriaRows = Array.isArray(criteriaLoad.data) ? criteriaLoad.data : [];
    return {
      users: { ...usersLoad, list: users }, support: { ...supportLoad, tickets }, errors7: { ...errorsLoad, issues },
      criteria: { ...criteriaLoad, rows: criteriaRows, outstanding: criteriaRows.filter((r) => !r.wired).length },
      hideInternal, setHideInternal, marked, toggleMarked, selfEmail,
      isInternal: (email) => isInternalEmail(email, { selfEmail, marked }),
    };
  }, [usersLoad, supportLoad, errorsLoad, criteriaLoad, hideInternal, marked, toggleMarked, selfEmail]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
