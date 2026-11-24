/* useCriteriaRequest — @planner-extract — the ONE copy of the "Request criteria for this county" UI status (audit batch L3).
 *
 * SitePlanner (Easement rules panel) and DrainagePanel (Detention verdict row) each kept their own copy of this
 * state + sender. Keyed on `county:family` so unrelated rows never share state; `wasRequested` (checked at each read
 * site) seeds the "Requested ✓" read-back from localStorage after a reload. Declare it BEFORE any JSX that reads
 * `critReqStatus` (a read before the declaration is a temporal-dead-zone throw). */
import { useState } from "react";
import { supabase } from "./supabase.js";
import { requestCriteria } from "./criteriaRequests.js";

export function useCriteriaRequest(siteId, siteState) {
  const [critReqStatus, setCritReqStatus] = useState({});
  const onRequestCriteria = async (info) => {
    if (!info || !info.countyKey || !info.family) return;
    const k = `${info.countyKey}:${info.family}`;
    setCritReqStatus((s) => ({ ...s, [k]: { busy: true } }));
    const r = await requestCriteria(supabase, { countyKey: info.countyKey, countyLabel: info.countyLabel, state: siteState || null, family: info.family, siteId: siteId || null });
    setCritReqStatus((s) => ({ ...s, [k]: r.ok ? { done: true, at: r.at } : { error: r.error || "Couldn't send the request." } }));
  };
  return { critReqStatus, onRequestCriteria };
}
