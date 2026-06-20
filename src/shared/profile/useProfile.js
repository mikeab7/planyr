/* useProfile (B271 / NEW-1) — load + expose the signed-in user's profile (name, org)
 * from public.profiles, with a never-blank display name for the header pill (NEW-2).
 *
 * Pass the current auth user (the Shell already owns it via onAuthChange). The hook
 * fetches that user's profile row, recomputes when the user changes, and hands back
 * everything the header and the account panel need:
 *
 *   { profile, loading, displayName, firstName, initial, reload, save }
 *
 * Display logic (NEW-2): "First Last" → first name alone → last name alone → the
 * signup metadata (covers the moment right after signup, before the profile row is
 * readable, and any backfill miss) → email. It never returns a blank string while a
 * user is signed in, so the pill never renders empty. The display helpers are pure
 * and exported so the fallback chain is unit-tested without React.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { loadProfile, saveProfile } from "../../workspaces/site-planner/lib/profile.js";

const s = (v) => (v == null ? "" : String(v)).trim();

// Best first/last available, preferring the profiles table, then the signup metadata.
function nameParts(profile, user) {
  const meta = (user && user.user_metadata) || {};
  return {
    first: s(profile?.first_name) || s(meta.first_name),
    last: s(profile?.last_name) || s(meta.last_name),
  };
}

// Pure: the never-blank display name (NEW-2). Exported for testing.
export function displayNameFor(profile, user) {
  const { first, last } = nameParts(profile, user);
  if (first && last) return `${first} ${last}`;
  return first || last || (user && user.email) || "";
}

export function firstNameFor(profile, user) {
  return nameParts(profile, user).first;
}

export function orgFor(profile, user) {
  const meta = (user && user.user_metadata) || {};
  return s(profile?.org) || s(meta.org);
}

// Pure: the avatar letter — first char of the display name, or a dot placeholder.
export const initialFor = (name) => (s(name)[0] || "•").toUpperCase();

export function useProfile(user) {
  const uid = user?.id || null;
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(false);
  // Guard against a slow fetch resolving after the user changed (avoid showing the
  // previous user's profile).
  const reqRef = useRef(0);

  const reload = useCallback(async () => {
    if (!uid) { setProfile(null); return null; }
    const my = ++reqRef.current;
    setLoading(true);
    try {
      const row = await loadProfile(uid);
      if (my === reqRef.current) setProfile(row);
      return row;
    } catch (_) {
      // Offline / transient — keep whatever we had rather than blanking the name.
      return null;
    } finally {
      if (my === reqRef.current) setLoading(false);
    }
  }, [uid]);

  useEffect(() => { reload(); }, [reload]);

  const save = useCallback(async (fields) => {
    if (!uid) return { ok: false, error: "not signed in" };
    const res = await saveProfile(uid, fields);
    if (res.ok) {
      // Optimistic local update so the pill/name refresh immediately.
      setProfile((p) => ({
        ...(p || { id: uid }),
        first_name: s(fields.firstName) || null,
        last_name: s(fields.lastName) || null,
        org: s(fields.org) || null,
      }));
    }
    return res;
  }, [uid]);

  const displayName = displayNameFor(profile, user);

  return {
    profile,
    loading,
    displayName,
    firstName: firstNameFor(profile, user),
    org: orgFor(profile, user),
    initial: initialFor(displayName),
    reload,
    save,
  };
}

export default useProfile;
