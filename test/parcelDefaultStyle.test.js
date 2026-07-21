import { describe, it, expect } from "vitest";
import { parcelDefaultStyle } from "../src/workspaces/site-planner/lib/planStyle.js";

/* B929 — the default style stamped onto a freshly drawn / added parcel from the user's
 * Standards → Parcels defaults (settings.parcelStyle). Only keys the user actually
 * customized are returned, so an untouched default leaves the parcel to the theme-aware
 * built-in render fallbacks. Fill is opt-in; fillOpacity rides along only with a fill. */

describe("parcelDefaultStyle — stamped-at-creation parcel defaults", () => {
  it("no settings / empty parcelStyle → no style keys (theme built-ins win)", () => {
    expect(parcelDefaultStyle(undefined)).toEqual({});
    expect(parcelDefaultStyle({})).toEqual({});
    expect(parcelDefaultStyle({ parcelStyle: {} })).toEqual({});
  });

  it("stamps a customized outline color", () => {
    expect(parcelDefaultStyle({ parcelStyle: { stroke: "#ff0000" } })).toEqual({ stroke: "#ff0000" });
  });

  it("stamps weight (including 0.5) but not the theme-default when unset", () => {
    expect(parcelDefaultStyle({ parcelStyle: { weight: 3 } })).toEqual({ weight: 3 });
    expect(parcelDefaultStyle({ parcelStyle: { weight: 0.5 } })).toEqual({ weight: 0.5 });
  });

  it("stamps a non-solid dash, but 'solid' is the built-in and is not stamped", () => {
    expect(parcelDefaultStyle({ parcelStyle: { dash: "dashed" } })).toEqual({ dash: "dashed" });
    expect(parcelDefaultStyle({ parcelStyle: { dash: "solid" } })).toEqual({});
  });

  it("fill is opt-in: a fill color brings its opacity along", () => {
    expect(parcelDefaultStyle({ parcelStyle: { fill: "#5b6650", fillOpacity: 0.3 } })).toEqual({ fill: "#5b6650", fillOpacity: 0.3 });
  });

  it("fill off (null) never stamps fill, even if a stray fillOpacity lingers", () => {
    expect(parcelDefaultStyle({ parcelStyle: { fill: null, fillOpacity: 0.3 } })).toEqual({});
    expect(parcelDefaultStyle({ parcelStyle: { fillOpacity: 0.3 } })).toEqual({});
  });

  it("a fill color without an explicit opacity stamps just the fill (render supplies 0.12)", () => {
    expect(parcelDefaultStyle({ parcelStyle: { fill: "#123456" } })).toEqual({ fill: "#123456" });
  });

  it("combines every customized property at once", () => {
    expect(parcelDefaultStyle({ parcelStyle: { stroke: "#0af", weight: 4, dash: "dotted", fill: "#5b6650", fillOpacity: 0.2 } }))
      .toEqual({ stroke: "#0af", weight: 4, dash: "dotted", fill: "#5b6650", fillOpacity: 0.2 });
  });
});
