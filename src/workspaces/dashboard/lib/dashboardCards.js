/* dashboardCards.js — the card catalog: id -> title + the component that renders it (B1196305,
 * NEW-2). Ids here MUST match `userPrefs.js`'s `DASHBOARD_CARD_IDS` exactly — imported from
 * there rather than re-declared, so the two can never drift.
 */
import { DASHBOARD_CARD_IDS } from "../../site-planner/lib/userPrefs.js";
import ScheduleHealthCard from "../components/ScheduleHealthCard.jsx";
import NeedsOwnerCard from "../components/NeedsOwnerCard.jsx";
import PipelineStatusCard from "../components/PipelineStatusCard.jsx";
import PursuitsByActivityCard from "../components/PursuitsByActivityCard.jsx";
import JumpBackInCard from "../components/JumpBackInCard.jsx";
import CompsSummaryCard from "../components/CompsSummaryCard.jsx";
import GoingQuietCard from "../components/GoingQuietCard.jsx";

export const CARD_REGISTRY = {
  scheduleHealth: { title: "Schedule health", Component: ScheduleHealthCard },
  needsOwner: { title: "Needs an owner", Component: NeedsOwnerCard },
  pipelineStatus: { title: "Pipeline", Component: PipelineStatusCard },
  pursuitsByActivity: { title: "Pursuits by activity", Component: PursuitsByActivityCard },
  jumpBackIn: { title: "Jump back in", Component: JumpBackInCard },
  compsSummary: { title: "Comps summary", Component: CompsSummaryCard },
  goingQuiet: { title: "Going quiet", Component: GoingQuietCard },
};

// Guard: every catalog id in userPrefs.js must have a registry entry here, and vice versa —
// keeps the two in lockstep without a runtime lookup that could silently return undefined.
for (const id of DASHBOARD_CARD_IDS) {
  if (!CARD_REGISTRY[id]) throw new Error(`dashboardCards.js: missing a registry entry for "${id}"`);
}
