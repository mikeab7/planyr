/* scheduleSiteNames.js — registers the ONE project-name resolver the schedule ownership module asks
 * (NEW-1, B1991040). Imported for its side effect by the app shell, so every host-side surface that
 * labels a schedule (Dashboard Schedule health / Needs attention / Since-you-were-here, the
 * breadcrumb) resolves the linked project's LIVE name by id from `shared/names`, never from the
 * `linkedSiteName` copy stored in the schedule. */
import { setSiteNameResolver } from "./scheduleOwnership.js";
import { storedProjectName } from "../names/names.js";

setSiteNameResolver(storedProjectName);
