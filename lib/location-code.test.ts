import { describe, it, expect } from "vitest";
import {
  normalizeLocationCode,
  parseLocationCode,
  compareAisles,
  compareBins,
} from "./location-code";

describe("normalizeLocationCode", () => {
  it("upper-cases and tidies separators", () => {
    expect(normalizeLocationCode("  10-a-2 ")).toBe("10-A-2");
    expect(normalizeLocationCode("10 - A - 2")).toBe("10-A-2");
    expect(normalizeLocationCode("--10--A--2--")).toBe("10-A-2");
  });

  it("keeps spaces INSIDE a segment — they are part of the name", () => {
    // Collapsing these to dashes would turn a 2-segment code into 3 and shift
    // every part along, which is exactly the bug this guards.
    expect(normalizeLocationCode("7-End Cap")).toBe("7-END CAP");
    expect(normalizeLocationCode("Crate City-Floor")).toBe("CRATE CITY-FLOOR");
    expect(normalizeLocationCode("Base  Wall-Floor")).toBe("BASE WALL-FLOOR");
  });
});

describe("parseLocationCode", () => {
  it("splits a racked bin into aisle, bay and level", () => {
    expect(parseLocationCode("10-A-2")).toEqual({ aisle: "10", bay: "A", level: 2 });
    expect(parseLocationCode("N1-C-3")).toEqual({ aisle: "N1", bay: "C", level: 3 });
    expect(parseLocationCode("R8-J-4")).toEqual({ aisle: "R8", bay: "J", level: 4 });
  });

  it("treats a code with no level segment as level 1", () => {
    expect(parseLocationCode("10-Floor")).toEqual({
      aisle: "10",
      bay: "FLOOR",
      level: 1,
    });
    expect(parseLocationCode("7-End Cap")).toEqual({
      aisle: "7",
      bay: "END CAP",
      level: 1,
    });
    expect(parseLocationCode("Outside-Container")).toEqual({
      aisle: "OUTSIDE",
      bay: "CONTAINER",
      level: 1,
    });
  });

  it("handles the named open areas", () => {
    expect(parseLocationCode("Crate City-Floor")).toEqual({
      aisle: "CRATE CITY",
      bay: "FLOOR",
      level: 1,
    });
    expect(parseLocationCode("AZWareSpace-Floor")).toEqual({
      aisle: "AZWARESPACE",
      bay: "FLOOR",
      level: 1,
    });
  });

  it("refuses to force-fit anything that isn't a bin code", () => {
    // The Ocoee warehouse's own code has five segments.
    expect(parseLocationCode("4-OCOEE-WAREHOUSE-FL-PGS")).toEqual({
      aisle: null,
      bay: null,
      level: null,
    });
    expect(parseLocationCode("SOMEWHERE")).toEqual({
      aisle: null,
      bay: null,
      level: null,
    });
    expect(parseLocationCode("")).toEqual({ aisle: null, bay: null, level: null });
  });

  it("keeps aisle and bay when the level segment isn't a number", () => {
    expect(parseLocationCode("10-A-X")).toEqual({ aisle: "10", bay: "A", level: null });
  });
});

describe("compareAisles", () => {
  it("orders numerically, not as strings", () => {
    const sorted = ["10", "2", "1", "30", "11"].sort(compareAisles);
    expect(sorted).toEqual(["1", "2", "10", "11", "30"]);
  });

  it("groups the lettered aisles after the numbered ones", () => {
    const sorted = ["R2", "1", "N1", "C3", "10", "R10"].sort(compareAisles);
    expect(sorted).toEqual(["1", "10", "C3", "N1", "R2", "R10"]);
  });

  it("puts named areas last", () => {
    const sorted = ["Crate City", "5", "N1", "Base Wall"].sort(compareAisles);
    expect(sorted).toEqual(["5", "N1", "Base Wall", "Crate City"]);
  });
});

describe("compareBins", () => {
  it("orders rack bays by letter then level", () => {
    const sorted = [
      { bay: "B", level: 1 },
      { bay: "A", level: 3 },
      { bay: "A", level: 1 },
    ].sort(compareBins);
    expect(sorted).toEqual([
      { bay: "A", level: 1 },
      { bay: "A", level: 3 },
      { bay: "B", level: 1 },
    ]);
  });

  it("puts named positions after the lettered bays", () => {
    const sorted = [
      { bay: "FLOOR", level: 1 },
      { bay: "J", level: 2 },
      { bay: "END CAP", level: 1 },
    ].sort(compareBins);
    expect(sorted.map((b) => b.bay)).toEqual(["J", "END CAP", "FLOOR"]);
  });
});
