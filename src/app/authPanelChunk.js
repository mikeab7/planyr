/* authPanelChunk — the one door to the sign-in panel's code (B329408). AuthPanel.jsx (~15 KB) is its own chunk so the entry bundle every route
 * downloads does not carry a panel that only opens on request. It is warmed on INTENT — the pointer reaching, or focus landing on, the header's
 * "Sign in" pill (AccountControl.jsx) — never from a boot-time timer or idle callback (test/perfBudgets.test.js: the shell schedules no prefetch),
 * so the click that follows finds it in the module cache. Shell.jsx renders it through `lazy(loadAuthPanel)`; a click that beats the fetch just waits. */
export const loadAuthPanel = () => import("../workspaces/site-planner/components/AuthPanel.jsx");
/** Best-effort warm-up on intent. Never throws. */
export const warmAuthPanel = () => { try { loadAuthPanel().catch(() => {}); } catch (_) { /* a failed warm-up only means the click fetches it */ } };
