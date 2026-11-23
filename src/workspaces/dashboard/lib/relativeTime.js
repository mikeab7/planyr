import { dashboardShort } from "../../../shared/units/dateFormat.js";
/* relativeTime — a short "how long ago" string, down to minutes (NEW-1, 2026-09-08). Distinct
 * from DashboardCards.jsx's own day/month-only `relativeDays`: the Recent Plans card's timestamp
 * line is the one place on this screen a plan saved moments ago needs to read as more recent than
 * "today".
 */
export const relativeTimeShort = dashboardShort;
