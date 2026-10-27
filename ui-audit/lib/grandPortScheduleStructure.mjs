/* The REAL structure of the owner's Grand Port › Master Schedule (schedule id 2, project smqfy2r7pdec),
 * read read-only from production on 2026-10-27 for B2445008 (×2). 365 tasks, in stored order, with the
 * exact parent / collapse state of every row. What is real: ids, order, parentId, isExpanded, and the
 * predecessor links + pinned (locked) starts inside the Pipeline Coordination block (132–168), which is
 * the block the failing gesture lives in. What is NOT real, on purpose: names outside that block
 * ("Task N") and dates / notes everywhere — none of them decides where a drop lands, and the repo does
 * not need a copy of his schedule's contents.
 *
 * The region he works in (visible rows, collapsed parents marked ▸):
 *   132 Pipeline Coordination & LONOs
 *     133 Plan B ▾ → 134 (▾ 135 136) · 137 (▾ 138–140) · 141 (▾ 142–147)
 *     148 Surveying ▾ → 149–152
 *     153 Kinder Morgan ▸ (154 155 hidden)   156 Enterprise ▸ (157 158 hidden)
 *     159 Exxon ▾ → 160–163                  164 Air Liquide ▾ → 165 166
 *   167 Plan A   — a LEAF, sibling of 132, immediately below 166
 *   168 CenterPoint GTO …
 */

// [firstId, lastId, parentId, collapsed?] runs, in stored order. Each run is a set of consecutive ids
// sharing a parent. Transcribed from the production read; `test/scheduleNestRealStructure.test.js`
// pins the shape (365 rows, every parent precedes its children, Plan A a leaf sibling of 132).
const RUNS = [
  [1, 1, null, 1], [2, 2, 1], [3, 3, null], [4, 4, 3, 1], [5, 6, 4], [7, 7, 3, 1], [8, 8, 7], [9, 9, 3, 1], [10, 13, 9],
  [14, 14, 3, 1], [15, 17, 14], [18, 18, 3], [19, 19, 18], [20, 29, 19], [30, 32, 18], [33, 34, 32], [35, 35, 3, 1],
  [36, 41, 35], [42, 42, 3, 1], [43, 44, 42], [45, 45, 3, 1], [46, 47, 45],
  [48, 48, null], [49, 49, 48], [50, 57, 49], [58, 58, 48], [59, 61, 58], [62, 76, 61], [77, 77, 58, 1], [78, 81, 77],
  [82, 82, 48], [83, 90, 82], [91, 91, 48], [92, 99, 91], [100, 100, 48, 1], [101, 108, 100], [109, 109, 48], [110, 110, 109],
  [111, 111, 48, 1], [112, 116, 111], [117, 117, 48], [118, 123, 117], [124, 124, 48], [125, 128, 124], [129, 129, 48],
  [130, 131, 129], [132, 132, 48], [133, 133, 132], [134, 134, 133], [135, 136, 134], [137, 137, 133], [138, 140, 137],
  [141, 141, 133], [142, 147, 141], [148, 148, 132], [149, 152, 148], [153, 153, 132, 1], [154, 155, 153],
  [156, 156, 132, 1], [157, 158, 156], [159, 159, 132], [160, 163, 159], [164, 164, 132], [165, 166, 164],
  [167, 168, 48], [169, 172, 168], [173, 173, 48, 1], [174, 174, 173], [175, 175, 48, 1], [176, 177, 175], [178, 178, 48],
  [179, 180, 178], [181, 181, 180, 1], [182, 199, 181], [200, 200, 180], [201, 202, 200], [203, 203, 180, 1], [204, 205, 203],
  [206, 206, 180], [207, 218, 206], [219, 219, 178], [220, 225, 219], [226, 226, 48], [227, 228, 226],
  [229, 229, null], [230, 230, 229], [231, 231, 230], [232, 232, 229], [233, 234, 232], [235, 235, 232, 1], [236, 238, 235],
  [239, 239, 232, 1], [240, 241, 239], [242, 242, 232], [243, 245, 242], [246, 246, 229], [247, 247, 246], [248, 248, 246, 1],
  [249, 251, 248], [252, 252, 246, 1], [253, 254, 252], [255, 255, 246, 1], [256, 256, 255], [257, 257, 246], [258, 261, 257],
  [262, 262, 246], [263, 268, 262], [269, 269, 229], [270, 270, 269, 1], [271, 272, 270], [273, 273, 269, 1], [274, 274, 273],
  [275, 275, 269, 1], [276, 277, 275], [278, 278, 269], [279, 279, 278], [280, 280, 229], [281, 281, 280], [282, 283, 281],
  [284, 284, 280], [285, 287, 284], [288, 288, 229], [289, 289, 288, 1], [290, 291, 289], [292, 292, 288], [293, 295, 292],
  [296, 296, 229], [297, 297, 296], [298, 299, 297], [300, 300, 296], [301, 303, 300], [304, 304, 229], [305, 307, 304],
  [308, 308, 229], [309, 311, 308],
  [312, 312, null], [313, 315, 312], [316, 316, 312, 1], [317, 317, 316, 1], [318, 319, 317], [320, 320, 316, 1], [321, 323, 320],
  [324, 324, 316, 1], [325, 325, 324], [326, 330, 312],
  [331, 331, null], [332, 332, 331], [333, 337, 332], [338, 338, 331], [339, 345, 338], [346, 347, 331], [348, 348, 331, 1], [349, 349, 348],
  [350, 350, null], [351, 351, 350], [352, 353, null], [354, 354, 353, 1], [355, 361, 354], [362, 362, 353, 1], [363, 364, 362],
  [365, 365, null],
];

// The block the gesture lives in, with its real names, links and locked starts.
const NAMES = {
  48: "Entitlements & Third Parties", 132: "Pipeline Coordination & LONOs", 133: "Plan B", 134: "Easement Acquisition",
  137: "Design", 141: "LONOs", 148: "Surveying", 153: "Kinder Morgan", 154: "Set up meeting", 155: "Meeting Held",
  156: "Enterprise", 157: "Set up meeting", 158: "Hold Meeting", 159: "Exxon", 160: "Hold Meeting", 161: "Reschedule Meeting",
  162: "Hold Meeting", 163: "Follow up on pipeline depth confirmation", 164: "Air Liquide", 165: "Set up meeting",
  166: "Set up meeting once we have pipeline depths", 167: "Plan A", 168: "CenterPoint GTO",
};
const LINKS = { 136: [135], 151: [150], 152: [151], 155: [154], 161: [160], 163: [162], 166: [152], 171: [170] };
const PINNED = new Set([135, 138, 149, 150, 154, 157, 158, 160, 162, 169, 170, 172]);

export const GRAND_PORT_PLAN_A = 167;
export const GRAND_PORT_TASK_COUNT = 365;

export function grandPortTasks() {
  const tasks = [];
  for (const [a, b, parentId, collapsed] of RUNS) {
    for (let id = a; id <= b; id++) {
      const pinned = PINNED.has(id);
      tasks.push({
        id, name: NAMES[id] || `Task ${id}`, parentId: parentId ?? null, isExpanded: !collapsed,
        start: "2026-10-12", end: "2026-10-12", duration: 1, durValue: 1, durUnit: "d",
        predecessors: (LINKS[id] || []).map(p => ({ id: p, type: "FS", lag: 0 })),
        ...(pinned ? { pinnedStart: true } : {}),
        health: "gray", percentComplete: 0, responsibleParty: [], notes: id === 157 ? [{ id: 1, date: "2026-10-08", text: "keep this note" }] : [],
      });
    }
  }
  // Plan A as stored: a leaf with no dates and a 0d duration.
  const a = tasks.find(t => t.id === GRAND_PORT_PLAN_A);
  Object.assign(a, { start: "", end: "", duration: 0, durValue: 0 });
  return tasks;
}

// The app's import shape (the same JSON a History-panel import reads).
export function grandPortFixture({ rowHeight = 20 } = {}) {
  return { aPid: 1, nPid: 2, nTid: 1000, view: "grid", section: "projects", settings: { rowHeight },
    projects: { 1: { id: 1, name: "Grand Port structure (fixture)", tasks: grandPortTasks() } } };
}
