/* Harness-only entry: mounts AdminApp exactly as AdminGate does once is_admin() has answered true
 * (AdminGate renders <AdminApp/> on a confirmed `true` and nothing else), so the admin page can be
 * driven headlessly without a signed-in Supabase session. Never reachable from the app build. */
import { createRoot } from "react-dom/client";
import "../../src/index.css";
import AdminApp from "../../src/workspaces/admin/AdminApp.jsx";

createRoot(document.getElementById("root")).render(<AdminApp onExit={() => {}} />);
