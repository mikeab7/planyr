import { describe, it, expect } from "vitest";
import { openPipelineProjects, mapMarkers, missingLocationCount } from "../src/workspaces/dashboard/lib/dashboardMapMarkers.js";

const active = (id, origin) => ({ groupId: id, name: id, role: "pursuit", status: "active", origin });
const pursuit = (id, origin) => ({ groupId: id, name: id, role: "pursuit", status: "pursuit", origin });
const onhold = (id, origin) => ({ groupId: id, name: id, role: "pursuit", status: "onhold", origin });
const complete = (id, origin) => ({ groupId: id, name: id, role: "pursuit", status: "complete", origin });
const dead = (id, origin) => ({ groupId: id, name: id, role: "pursuit", status: "dead", origin });
const tracked = (id, origin) => ({ groupId: id, name: id, role: "tracked", status: "active", origin });

const HERE = { lat: 29.76, lon: -95.37 };

describe("openPipelineProjects", () => {
  it("keeps active/pursuit/onhold and drops complete/dead/tracked", () => {
    const projects = [active("a", HERE), pursuit("p", HERE), onhold("o", HERE), complete("c", HERE), dead("d", HERE), tracked("t", HERE)];
    expect(openPipelineProjects(projects).map((p) => p.groupId)).toEqual(["a", "p", "o"]);
  });

  it("handles empty/missing input without throwing", () => {
    expect(openPipelineProjects([])).toEqual([]);
    expect(openPipelineProjects(null)).toEqual([]);
  });
});

describe("mapMarkers", () => {
  it("active status becomes the loudest weight, pursuit/onhold the lighter weight", () => {
    const markers = mapMarkers([active("a", HERE), pursuit("p", HERE), onhold("o", HERE)], []);
    expect(markers.map((m) => [m.id, m.kind])).toEqual([["a", "active"], ["p", "pursuit"], ["o", "pursuit"]]);
  });

  it("excludes complete/dead/tracked projects entirely, located or not", () => {
    const markers = mapMarkers([complete("c", HERE), dead("d", HERE), tracked("t", HERE)], []);
    expect(markers).toEqual([]);
  });

  it("drops a project with no usable location rather than plotting a wrong point", () => {
    const markers = mapMarkers([active("a", null), active("b", { lat: null, lon: -95 }), active("c", HERE)], []);
    expect(markers.map((m) => m.id)).toEqual(["c"]);
  });

  it("adds one comp weight per located comp, unlabeled (no name field)", () => {
    const markers = mapMarkers([], [{ id: "comp1", lat: 30, lon: -96 }, { id: "comp2", lat: null, lon: -96 }]);
    expect(markers).toEqual([{ kind: "comp", id: "comp1", lat: 30, lon: -96 }]);
  });

  it("a marker carries the coordinates and, for a project, its own name and record", () => {
    const p = active("a", HERE);
    const [m] = mapMarkers([p], []);
    expect(m).toMatchObject({ kind: "active", id: "a", lat: HERE.lat, lon: HERE.lon, name: "a", project: p });
  });

  // B1407824 — the pin label has no fixed width of its own, so a long project name is shortened
  // here rather than left to run the label plate off the map. The exact cut is shortenDisplayName's
  // job (see test/projects.test.js for its own case table); this just proves the marker uses it.
  it("shortens a long project name for the pin label, never on a dangling comma", () => {
    const p = { ...active("a", HERE), name: "ALUMAX RD, NASHVILLE, TX 75569" };
    const [m] = mapMarkers([p], []);
    expect(m.name.length).toBeLessThan(p.name.length);
    expect(m.name).not.toMatch(/[,.\-\s]…$/);
    expect(m.name.endsWith("…")).toBe(true);
    // the marker's OWN record still carries the real, untouched name for anything that needs it
    expect(m.project.name).toBe(p.name);
  });

  // B1407824 — the exact reported production case: the stored name FITS under the pin's own
  // limit (nothing to cut for space), but itself dangles on a bare trailing comma. Confirms the
  // map pin shows it cleaned up, not verbatim.
  it("cleans a short name that itself dangles on a comma, even though nothing needed cutting for space", () => {
    const p = { ...active("a", HERE), name: "ALUMAX RD, NASH," };
    const [m] = mapMarkers([p], []);
    expect(m.name).toBe("ALUMAX RD, NASH");
  });
});

describe("missingLocationCount", () => {
  it("counts only open-pipeline projects/pursuits lacking a usable origin", () => {
    const projects = [
      active("a", HERE), active("b", null),
      pursuit("p", null), onhold("o", null),
      complete("c", null), // settled — not counted, even though it has no location
      tracked("t", null),  // market record — not counted
    ];
    expect(missingLocationCount(projects)).toBe(3);
  });

  it("zero when every open project/pursuit has a location", () => {
    expect(missingLocationCount([active("a", HERE), pursuit("p", HERE)])).toBe(0);
  });

  it("handles empty/missing input without throwing", () => {
    expect(missingLocationCount([])).toBe(0);
    expect(missingLocationCount(null)).toBe(0);
  });
});

// NEW-2 — company-scope Site tab: scope "all" plots EVERY project (any status), one pin each.
import { mapMarkers as mapMarkersAll, missingLocationCount as missingAll, allSiteProjects } from "../src/workspaces/dashboard/lib/dashboardMapMarkers.js";
describe("scope: all (company-scope Site tab)", () => {
  const P = (id, status, origin, role = "pursuit") => ({ groupId: id, name: id, status, role, origin });
  const projects = [
    P("a", "active", { lat: 1, lon: 1 }), P("b", "pursuit", { lat: 2, lon: 2 }), P("c", "complete", { lat: 3, lon: 3 }),
    P("d", "dead", { lat: 4, lon: 4 }), P("e", "active", null), P("t", "pursuit", { lat: 5, lon: 5 }, "tracked"),
  ];
  it("default (pipeline) scope still plots only open projects", () => {
    expect(mapMarkersAll(projects, null).map((m) => m.id).sort()).toEqual(["a", "b"]);
  });
  it("all scope plots every located non-tracked project, complete and dead included", () => {
    expect(mapMarkersAll(projects, null, null, "all").map((m) => m.id).sort()).toEqual(["a", "b", "c", "d"]);
    expect(allSiteProjects(projects)).toHaveLength(5);
  });
  it("counts the unlocated ones instead of dropping them silently", () => {
    expect(missingAll(projects, "all")).toBe(1);
  });
});
