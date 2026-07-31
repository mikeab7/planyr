// Rehydrate a compact schedule fixture (a `fields` header + array-of-arrays `rows`) into the
// task objects the Schedule app (public/sequence/index.html) consumes.
//
// The compact form exists so a real 200+ task program stays reviewable in a diff; this is the one
// place that knows how to expand it, so a harness, a unit test and a Playwright spec can't drift
// in how they read the same fixture. Pure — no fs, no DOM — so it is importable from anywhere.
// (NEW-1, 2026-07-31.)

const DEFAULTS = {
  predecessors: [],
  responsibleParty: "",
  cost: "",
  notes: [],
  isExpanded: true,
  percentComplete: 0,
  health: "gray",
};

/** fixture -> { id, name, labelAlign, tasks:[…] } with every task field the Gantt reads. */
export const expandFixture = (fx) => {
  const fields = fx.fields;
  const tasks = fx.rows.map((row) => {
    const t = { ...DEFAULTS };
    fields.forEach((k, i) => { t[k] = row[i]; });
    return t;
  });
  return { ...fx.project, tasks };
};

/** Depth of a task in the parent chain (0 = top level), matching the app's own flatten. */
export const depthOf = (tasks, id) => {
  let d = 0, t = tasks.find((x) => x.id === id);
  while (t && t.parentId != null) { d++; t = tasks.find((x) => x.id === t.parentId); }
  return d;
};

/** The rows the chart actually renders: a task is hidden when ANY ancestor is collapsed. */
export const visibleTasks = (tasks) => tasks.filter((t) => {
  let pid = t.parentId;
  while (pid != null) {
    const par = tasks.find((x) => x.id === pid);
    if (!par) return true;
    if (par.isExpanded === false) return false;
    pid = par.parentId;
  }
  return true;
});
