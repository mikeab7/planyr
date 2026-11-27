/* "Connect to Claude" — WHAT an assistant can do once connected, in ONE place (adversarial review A9, 2026-11-27).
 * functions/api/mcp/_tools.js checks at import that its tool list is exactly this list, so the Allow page and the
 * Settings card can never promise more (or less) than the connector really does. Plain words, read only.
 * Pure data; imported by the browser (ConnectLanding, Settings → AI assistants) and by the Pages Function. */

export const CONNECTOR_SCOPE = "planyr.read";

export const CONNECTOR_TOOLS = [
  { tool: "list_projects", can: "See the list of your projects: names, status, counties, how many site plans and drawings, and the linked schedule" },
  { tool: "get_project", can: "Read one project: its site plans' areas and building sizes, its drawing list and reviews, and its schedule summary" },
  { tool: "get_site_layout", can: "Read one site plan's layout summary: acreage, buildings, coverage, parking, ponds and paving" },
  { tool: "get_schedule", can: "Read a project's construction schedule: tasks, dates, progress and what is overdue" },
  { tool: "search_project_files", can: "Search your file NAMES and drawing titles across projects (it can't open or read the files themselves)" },
];

export const CONNECTOR_CANNOT = [
  "Change, add, share or delete anything",
  "Open or read the contents of your files or Notes",
  "See anything you can't see yourself in Planyr",
];

export const CONNECTOR_SEES =
  "Only what you can see in Planyr: your own projects and the ones shared with you through a team.";
