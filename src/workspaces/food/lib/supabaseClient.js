/* Food's own Supabase client — deliberately NOT imported from site-planner/lib/supabase.js.
 *
 * Every other workspace (Notes, Doc Review) reaches Supabase through the site-planner copy of
 * this file, which works but means a change to this module is one import edge away from
 * dragging site-planner's chunk graph onto every route. /food is a clean-room module — the
 * owner's explicit ask was that a restaurant tracker cannot cost the Site route a single byte
 * — so it gets its own three-line client instead. Same env contract, same project, so signing
 * in from any other workspace signs you in here too: supabase-js persists the session under a
 * URL-derived localStorage key, and both clients resolve to the identical key because they
 * point at the identical VITE_SUPABASE_URL.
 */
import { createClient } from "@supabase/supabase-js";

const RAW_URL = ((import.meta.env && import.meta.env.VITE_SUPABASE_URL) || "").trim();
let SUPABASE_URL = RAW_URL.replace(/\/+$/, "");
try { if (RAW_URL) SUPABASE_URL = new URL(RAW_URL).origin; } catch (_) {}
const SUPABASE_ANON = ((import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) || "").trim();

export const supabaseConfigured = () => !!(SUPABASE_URL && SUPABASE_ANON);

export const supabase = supabaseConfigured() ? createClient(SUPABASE_URL, SUPABASE_ANON) : null;
