/* Food's Supabase client — now the ONE shared client (audit batch I1, 2026-11-23).
 *
 * Food used to carry its own three-line copy so a restaurant tracker could never drag site-planner's chunk
 * graph onto the /food route. The shared client (`src/shared/supabase/client.js`) imports nothing but
 * supabase-js, so that isolation intent still holds: Food depends on `shared/`, never on `site-planner/`
 * (guard: test/foodModule.test.js). One client also means one auth session object instead of two competing
 * GoTrue instances on the same storage key. `SUPABASE_ORIGIN` keeps its old name for Food's callers.
 */
import { supabaseRest } from "../../../shared/supabase/client.js";

export { supabase, supabaseConfigured } from "../../../shared/supabase/client.js";
export const SUPABASE_ORIGIN = supabaseRest().url;
