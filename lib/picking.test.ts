import { describe, it, expect } from "vitest";
import { pickCategory, sortSourcesByLocation, summarizePick } from "./picking";

describe("pickCategory", () => {
  it("buckets by the product category, one type at a time", () => {
    expect(pickCategory("Base")).toBe("BASE");
    expect(pickCategory("Glass Top")).toBe("GLASS");
    expect(pickCategory("Appliances-Extras")).toBe("APPLIANCE");
    expect(pickCategory("Raw")).toBe("APPLIANCE");
    expect(pickCategory("Extra")).toBe("APPLIANCE");
    expect(pickCategory("Widget")).toBe("OTHER");
    expect(pickCategory(null)).toBe("OTHER");
  });
});

describe("sortSourcesByLocation", () => {
  it("walks aisles in natural order, then bay/level, nulls last", () => {
    const sources = [
      { id: "10-A-2", aisle: "10", bay: "A", level: 2 },
      { id: "2-B-1", aisle: "2", bay: "B", level: 1 },
      { id: "10-A-1", aisle: "10", bay: "A", level: 1 },
      { id: "wh", aisle: null, bay: null, level: null },
      { id: "N1-A-1", aisle: "N1", bay: "A", level: 1 },
    ];
    expect(sortSourcesByLocation(sources).map((s) => s.id)).toEqual([
      "2-B-1",
      "10-A-1",
      "10-A-2",
      "N1-A-1",
      "wh",
    ]);
  });

  it("does not mutate the input", () => {
    const sources = [
      { aisle: "10", bay: "A", level: 1 },
      { aisle: "2", bay: "A", level: 1 },
    ];
    const copy = [...sources];
    sortSourcesByLocation(sources);
    expect(sources).toEqual(copy);
  });
});

describe("summarizePick", () => {
  it("reports remaining per product and rolls up completeness", () => {
    const r = summarizePick(
      [
        { productId: "a", needed: 3 },
        { productId: "b", needed: 2 },
      ],
      new Map([["a", 1]])
    );
    expect(r.lines).toEqual([
      { productId: "a", needed: 3, staged: 1, remaining: 2, done: false },
      { productId: "b", needed: 2, staged: 0, remaining: 2, done: false },
    ]);
    expect(r.allDone).toBe(false);
    expect(r.shortCount).toBe(2);
  });

  it("is done when everything needed is staged, and clamps an over-stage", () => {
    const done = summarizePick([{ productId: "a", needed: 2 }], new Map([["a", 2]]));
    expect(done.allDone).toBe(true);
    expect(done.shortCount).toBe(0);

    const over = summarizePick([{ productId: "a", needed: 2 }], new Map([["a", 5]]));
    expect(over.lines[0]).toMatchObject({ remaining: 0, done: true });
    expect(over.allDone).toBe(true);
  });

  it("is not 'done' with nothing needed", () => {
    expect(summarizePick([], new Map()).allDone).toBe(false);
  });
});
