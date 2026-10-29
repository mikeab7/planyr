/* The Spreadsheet must at least RENDER. #2631 declared `shownStatus` (reads `fileMode` and `fw`) above
 * the lines that declare them, so every open of the tab threw "Cannot access 'fileMode' before
 * initialization" and showed "Spreadsheet hit an error and couldn't load" — and nothing in this repo
 * rendered ModelApp, so the build stayed green. This server-renders the real component (no DOM
 * needed: a use-before-declare throws on the first render pass, effects never matter) for each of
 * the three places a workbook lives.
 */
import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ModelApp from "../src/workspaces/model/ModelApp.jsx";

const base = { isActive: true, shellModule: "model", onShellSwitch() {}, authControl: null, accountActive: false, userId: null, onNavigate() {}, onGoDashboard() {}, onNewProject() {}, onSelectOrg() {} };
const html = (props) => renderToStaticMarkup(createElement(ModelApp, { ...base, ...props }));

describe("ModelApp renders (no use-before-declare in its body)", () => {
  it("a project's workbook", () => { expect(() => html({ projectId: "p1", crossProject: false })).not.toThrow(); });
  it("the Organization workbook list", () => { expect(() => html({ projectId: null, crossProject: false, org: true })).not.toThrow(); });
  it("no project open", () => { expect(() => html({ projectId: null, crossProject: false })).not.toThrow(); });
});
