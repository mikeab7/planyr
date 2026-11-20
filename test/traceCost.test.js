// ui-audit/lib/traceCost.mjs — the speed round's trace parser (NEW-1). Self time must not double-count a nested event, the
// longest task is the main thread's longest TOP-LEVEL task, and a worker thread's time never lands on the main thread.
import { describe, it, expect } from "vitest";
import { summariseTrace, classOf } from "../ui-audit/lib/traceCost.mjs";

const M = (pid, tid, name) => ({ ph: "M", name: "thread_name", pid, tid, args: { name } });
const X = (tid, name, ts, dur, data) => ({ ph: "X", pid: 1, tid, name, ts: ts * 1000, dur: dur * 1000, args: data ? { data } : {} });

describe("summariseTrace", () => {
  const events = [
    M(1, 10, "CrRendererMain"), M(1, 20, "DedicatedWorker thread"),
    // task 1: 100 ms — a 60 ms FunctionCall holding a 20 ms forced Layout
    X(10, "RunTask", 0, 100), X(10, "FunctionCall", 5, 60, { functionName: "build", url: "x/a.js" }), X(10, "Layout", 30, 20),
    // task 2: 30 ms of paint
    X(10, "RunTask", 200, 30), X(10, "Paint", 205, 25),
    // a worker task: never main-thread time
    X(20, "RunTask", 0, 500),
  ];
  const s = summariseTrace(events);
  it("main ms is the sum of top-level main-thread tasks; longest is the longest", () => {
    expect(s.mainMs).toBe(130);
    expect(s.longestTask).toBe(100);
    expect(s.workerMs).toBe(500);
  });
  it("self time: the forced layout is layout, not scripting twice", () => {
    expect(s.scripting).toBe(40);
    expect(s.styleLayout).toBe(20);
    expect(s.paint).toBe(25);
    expect(s.other).toBe(45);   // the two RunTask shells' own time
    expect(s.top[0]).toEqual(["build a.js:", 40]);
  });
  it("names what the longest task was", () => {
    expect(s.longestWhat.join(" ")).toMatch(/FunctionCall build a\.js 60/);
  });
  it("classes", () => {
    expect(classOf("MinorGC")).toBe("gc");
    expect(classOf("UpdateLayoutTree")).toBe("styleLayout");
    expect(classOf("SomethingNew")).toBe("other");
  });
});
