/* diagArm.js — moved to src/shared/telemetry/diagArm.js (audit M2) so shared code (the Supabase client) can read the same
 * arm gate without importing from a workspace. Re-exported here so every existing import and test keeps working. */
export { DIAG_KEY, DIAG_PARAM, isDiagArmed, latchDiagArm } from "../../../shared/telemetry/diagArm.js";
