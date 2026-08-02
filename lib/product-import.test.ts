import { describe, it, expect } from "vitest";
import {
  classificationFromRow,
  isSentinelParent,
  normalizeBuildCategory,
  isChanged,
} from "./product-import";

const BASE_COLS = {
  sku: "Item",
  buildCategory: "Base Category",
  parent: "Build Item",
  maxStock: "Max Capacity",
};
const GLASS_COLS = {
  sku: "SKU",
  buildCategory: null,
  parent: "Parent",
  maxStock: null,
};

describe("normalizeBuildCategory", () => {
  it("accepts the sheet's three values, case-insensitively", () => {
    expect(normalizeBuildCategory("Special")).toBe("SPECIAL");
    expect(normalizeBuildCategory("parent")).toBe("PARENT");
    expect(normalizeBuildCategory(" CHILD ")).toBe("CHILD");
  });

  it("rejects anything else rather than guessing", () => {
    expect(normalizeBuildCategory("Stocked")).toBeNull();
    expect(normalizeBuildCategory("")).toBeNull();
  });
});

describe("isSentinelParent", () => {
  it("rejects the Do Not Replenish instruction parked in the Parent column", () => {
    expect(isSentinelParent("Do Not Replenish")).toBe(true);
  });

  it("accepts real SKUs in both shapes", () => {
    expect(isSentinelParent("ISLGX10BLANK")).toBe(false);
    expect(isSentinelParent("ARB6-L-NN-1-1-0-0-N-Y-N-CA")).toBe(false);
  });

  it("treats an empty cell as nothing to store", () => {
    expect(isSentinelParent("   ")).toBe(true);
  });
});

describe("classificationFromRow — base sheet", () => {
  it("reads a Parent row", () => {
    const r = classificationFromRow(
      {
        Item: "ARB6-L-NN-1-1-0-0-N-Y-N-CA",
        "Base Category": "Parent",
        "Build Item": "ARB6-L-NN-1-1-0-0-N-Y-N-CA",
        "Max Capacity": "18",
      },
      BASE_COLS
    )!;
    expect(r.buildCategory).toBe("PARENT");
    // Self-parent is kept: that is how the sheet says "stocked in its own right".
    expect(r.parentSku).toBe("ARB6-L-NN-1-1-0-0-N-Y-N-CA");
    expect(r.maxStockLevel).toBe(18);
    expect(r.notes).toEqual([]);
  });

  it("reads a Child row pointing at a different build", () => {
    const r = classificationFromRow(
      {
        Item: "ARB6-L-NN-1-1-0-0-Y-Y-Y-CA",
        "Base Category": "Child",
        "Build Item": "ARB6-L-NN-1-1-0-0-N-Y-N-CA",
        "Max Capacity": "",
      },
      BASE_COLS
    )!;
    expect(r.buildCategory).toBe("CHILD");
    expect(r.parentSku).toBe("ARB6-L-NN-1-1-0-0-N-Y-N-CA");
    expect(r.maxStockLevel).toBeNull();
  });

  it("skips a row with no SKU", () => {
    expect(classificationFromRow({ Item: "  " }, BASE_COLS)).toBeNull();
  });

  it("notes an unrecognised category instead of storing it", () => {
    const r = classificationFromRow(
      { Item: "X", "Base Category": "Stocked", "Build Item": "", "Max Capacity": "" },
      BASE_COLS
    )!;
    expect(r.buildCategory).toBeNull();
    expect(r.notes[0]).toContain("Stocked");
  });
});

describe("classificationFromRow — glass sheet", () => {
  it("reads the parent blank a top is cut from", () => {
    const r = classificationFromRow(
      { SKU: "TITGX08RDLNYN", Parent: "TITGX08BLANK" },
      GLASS_COLS
    )!;
    expect(r.parentSku).toBe("TITGX08BLANK");
    expect(r.buildCategory).toBeNull(); // the glass sheet has no category column
    expect(r.maxStockLevel).toBeNull();
  });

  it("refuses to store 'Do Not Replenish' as a parent, and says why", () => {
    const r = classificationFromRow(
      { SKU: "ISLMA08NNNNNY", Parent: "Do Not Replenish" },
      GLASS_COLS
    )!;
    expect(r.parentSku).toBeNull();
    expect(r.notes[0]).toContain("Do Not Replenish");
  });
});

describe("isChanged", () => {
  const current = { parentSku: null, buildCategory: null, maxStockLevel: null };

  it("detects a new classification", () => {
    expect(
      isChanged(
        { sku: "A", buildCategory: "PARENT", parentSku: null, maxStockLevel: null, notes: [] },
        current
      )
    ).toBe(true);
  });

  it("is false when the sheet repeats what we already hold", () => {
    expect(
      isChanged(
        { sku: "A", buildCategory: "PARENT", parentSku: "B", maxStockLevel: 4, notes: [] },
        { parentSku: "B", buildCategory: "PARENT", maxStockLevel: 4 }
      )
    ).toBe(false);
  });

  it("does not let a sheet without a column wipe a value another sheet set", () => {
    // The glass sheet carries no Base Category, so importing it must not clear one.
    expect(
      isChanged(
        { sku: "A", buildCategory: null, parentSku: "B", maxStockLevel: null, notes: [] },
        { parentSku: "B", buildCategory: "PARENT", maxStockLevel: null }
      )
    ).toBe(false);
  });
});
