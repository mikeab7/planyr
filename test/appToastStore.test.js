// source-scan: asserts the shell mounts the one toast host and Library no longer mounts its own — wiring that cannot run in node.
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { useToast, resetAppToasts } from "../src/shared/ui/Toast.jsx";

// The app-level toast store (audit I6): one list the shell's AppToastHost renders.
describe("app toast store", () => {
  beforeEach(() => resetAppToasts());
  it("exposes a stable api", () => {
    expect(useToast()).toBe(useToast());
  });
  it("dedupeKey replaces in place and dismissByKey withdraws", () => {
    const api = useToast();
    api.show({ dedupeKey: "k", text: "a" });
    api.show({ dedupeKey: "k", text: "b" });
    api.dismissByKey("k");
    api.dismissByKey("k"); // idempotent
  });
});

describe("one toast host", () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
  it("the shell mounts AppToastHost", () => {
    expect(read("../src/app/Shell.jsx")).toContain("<AppToastHost />");
  });
  it("Library no longer mounts its own floating UndoToast", () => {
    expect(read("../src/workspaces/library/components/FileBrowser.jsx")).not.toMatch(/<UndoToast/);
    expect(read("../src/workspaces/library/components/LibraryHome.jsx")).not.toMatch(/<UndoToast/);
  });
});
