/* Headless harness for B389 — the Light/Dark/System picker moved into account → Settings.
 * Mounts the REAL components so verify-b389-theme-in-profile.mjs can prove (logged-out, no
 * real auth needed — AuthPanel is fed a mock user):
 *   • signed OUT: AppHeader still shows the row-1 theme gear (B342 preserved);
 *   • signed IN:  AppHeader shows NO theme gear (it moved to account → Settings);
 *   • the AuthPanel Settings tab renders the ThemePicker with Light/Dark/System;
 *   • clicking an option actually changes the app theme (data-theme on <html>).
 * Served by `npm run dev`. */
import { createRoot } from "react-dom/client";
import { ThemeProvider } from "../src/shared/theme/ThemeProvider.jsx";
import AppHeader from "../src/shared/ui/AppHeader.jsx";
import AuthPanel from "../src/workspaces/site-planner/components/AuthPanel.jsx";

const profileApi = { profile: { first_name: "Test", last_name: "User", org: "Planyr" }, save: async () => ({ ok: true }) };

function App() {
  return (
    <ThemeProvider>
      <div data-scope="signedout"><AppHeader module="site-planner" accountActive={false} authControl={<button>Sign in</button>} /></div>
      <div style={{ height: 12 }} />
      <div data-scope="signedin"><AppHeader module="site-planner" accountActive={true} authControl={<button>Account</button>} /></div>
      <div data-scope="authpanel">
        <AuthPanel user={{ email: "test@planyr.io" }} recovery={false} initialTab="settings" profileApi={profileApi} onClose={() => {}} />
      </div>
    </ThemeProvider>
  );
}

createRoot(document.getElementById("root")).render(<App />);
