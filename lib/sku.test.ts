import { describe, it, expect } from "vitest";
import { decodeSku, composeSku, segmentsFor, type SkuGrammar } from "./sku";

// Mock grammars prove the engine independent of the real (pending) Base/Glass data.
const positional: SkuGrammar = {
  category: "BASE",
  segments: [
    {
      key: "style",
      label: "Style",
      start: 0,
      length: 2,
      options: [
        { code: "GR", label: "Grand" },
        { code: "AV", label: "Avalon" },
      ],
    },
    {
      key: "burners",
      label: "Burners",
      start: 2,
      length: 1,
      options: [
        { code: "2", label: "2 Burner" },
        { code: "4", label: "4 Burner" },
      ],
    },
    {
      key: "sink",
      label: "Sink",
      start: 3,
      length: 1,
      options: [
        { code: "S", label: "Sink" },
        { code: "N", label: "No Sink" },
      ],
    },
  ],
};

const delimited: SkuGrammar = {
  category: "GLASS",
  delimiter: "-",
  segments: [
    {
      key: "style",
      label: "Style",
      index: 0,
      options: [
        { code: "BLK", label: "Black" },
        { code: "WHT", label: "White" },
      ],
    },
    {
      key: "cut",
      label: "Cut",
      index: 1,
      options: [
        { code: "GRL", label: "Grill" },
        { code: "DBL", label: "Double Burner" },
      ],
    },
  ],
};

describe("decodeSku", () => {
  it("decodes a positional SKU into human attributes", () => {
    const d = decodeSku("GR2S", positional);
    expect(d.attributes.map((a) => a.value)).toEqual(["Grand", "2 Burner", "Sink"]);
    expect(d.label).toBe("Grand · 2 Burner · Sink");
  });

  it("flags unknown codes but keeps the raw value", () => {
    const d = decodeSku("XX4N", positional);
    expect(d.attributes[0].known).toBe(false);
    expect(d.attributes[0].value).toBe("XX");
    expect(d.attributes[1].value).toBe("4 Burner");
  });

  it("decodes a delimited SKU", () => {
    expect(decodeSku("BLK-GRL", delimited).label).toBe("Black · Grill");
  });

  it("returns the raw SKU as its label when there is no grammar", () => {
    expect(decodeSku("ANY-THING", null).label).toBe("ANY-THING");
  });
});

describe("composeSku round-trips with decodeSku", () => {
  it("positional", () => {
    const sku = composeSku(positional, { style: "AV", burners: "4", sink: "N" });
    expect(sku).toBe("AV4N");
    expect(decodeSku(sku, positional).label).toBe("Avalon · 4 Burner · No Sink");
  });

  it("delimited", () => {
    const sku = composeSku(delimited, { style: "WHT", cut: "DBL" });
    expect(sku).toBe("WHT-DBL");
    expect(decodeSku(sku, delimited).label).toBe("White · Double Burner");
  });
});

describe("segmentsFor", () => {
  it("orders positional segments by start", () => {
    expect(segmentsFor(positional).map((s) => s.key)).toEqual([
      "style",
      "burners",
      "sink",
    ]);
  });
});
