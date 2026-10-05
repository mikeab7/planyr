/* orgNameStore (NEW-2, company workspace card) — the ONE home of "what is the organization
 * called", read everywhere through `useOrgName()` and never copied into component state (the
 * names / shared-data single-source rules in CLAUDE.md).
 *
 * The truth is the signed-in user's profile `org` field (Settings → Profile → Organization).
 * Shell.jsx owns `useProfile` and mirrors it here in one effect; the breadcrumb switcher's company
 * card and the "Map / <Company>" crumb read it from here, so a rename in Settings reaches both
 * on the next render with no per-component fetch. Empty string = nothing set (signed out, or no
 * name saved yet) — readers fall back to the word "Organization", never to a stale name.
 */
import { useSyncExternalStore } from "react";

let current = "";
const listeners = new Set();

export const getOrgName = () => current;

export function setOrgName(name) {
  const next = (name == null ? "" : String(name)).trim();
  if (next === current) return;
  current = next;
  for (const l of [...listeners]) l();
}

export function subscribeOrgName(fn) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function useOrgName() {
  return useSyncExternalStore(subscribeOrgName, getOrgName, () => "");
}
