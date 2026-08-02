import { describe, it, expect } from "vitest";
import { decodeSku, composeSku } from "./sku";
import { getGrammar } from "./sku-grammar";

const BASE = getGrammar("Base")!;
const GLASS = getGrammar("Glass")!;

/** Convenience: attribute value by key. */
function val(sku: string, grammar: typeof BASE, key: string) {
  return decodeSku(sku, grammar).attributes.find((a) => a.key === key)?.value;
}

describe("base SKUs (dash-delimited, real examples)", () => {
  it("decodes GX10-CXL-PR-D1-1-2-0-N-N-N-DG", () => {
    const s = "GX10-CXL-PR-D1-1-2-0-N-N-N-DG";
    expect(val(s, BASE, "style")).toBe("GX-10");
    expect(val(s, BASE, "grillHole")).toBe("Grill center (XL)");
    expect(val(s, BASE, "burner")).toBe("Power burner right");
    expect(val(s, BASE, "accessDoors")).toBe("D1 access door");
    expect(val(s, BASE, "fridges")).toBe("1 fridge");
    expect(val(s, BASE, "drawerTrash")).toBe("2 drawer/trash");
    expect(val(s, BASE, "warming")).toBe("No warming drawers");
    expect(val(s, BASE, "siding")).toBe("Dark grey siding");
    expect(decodeSku(s, BASE).attributes.every((a) => a.known)).toBe(true);
  });

  it("decodes the audio/LED/foot-rail tail of PRT9-N-NN-0-2-0-0-Y-Y-Y-DG", () => {
    const s = "PRT9-N-NN-0-2-0-0-Y-Y-Y-DG";
    expect(val(s, BASE, "grillHole")).toBe("No grill hole");
    expect(val(s, BASE, "burner")).toBe("No burner");
    expect(val(s, BASE, "fridges")).toBe("2 fridges");
    expect(val(s, BASE, "audio")).toBe("Audio package");
    expect(val(s, BASE, "led")).toBe("LED lighting");
    expect(val(s, BASE, "footRail")).toBe("Foot rail");
  });

  it("understands the specialty audio codes", () => {
    expect(val("MA14-D-NN-2-0-2-0-LSPO-Y-Y-CA", BASE, "audio")).toBe(
      "LED speakers only"
    );
    expect(val("PRT7-N-NN-0-1-0-0-L-Y-Y-CA", BASE, "audio")).toBe(
      "LED audio package"
    );
    expect(val("GX06-L-DR-1-1-0-0-N-N-N-DG", BASE, "siding")).toBe(
      "Dark grey siding"
    );
  });

  it("flags an unknown style rather than silently mislabelling it", () => {
    // Real row from the sheet: GX9 where every other row uses GX09.
    const decoded = decodeSku("GX9-D-DL-2-0-2-0-N-Y-N-CA", BASE);
    const style = decoded.attributes.find((a) => a.key === "style")!;
    expect(style.known).toBe(false);
    expect(style.value).toBe("GX9");
  });

  it("round-trips through composeSku", () => {
    const sku = composeSku(BASE, {
      style: "GX09",
      grillHole: "L",
      burner: "PR",
      accessDoors: "1",
      fridges: "1",
      drawerTrash: "2",
      warming: "0",
      audio: "N",
      led: "N",
      footRail: "N",
      siding: "CA",
    });
    expect(sku).toBe("GX09-L-PR-1-1-2-0-N-N-N-CA");
  });
});

describe("glass SKUs (fixed-width positional, real examples)", () => {
  it("decodes ISLARB6LNNNNY", () => {
    const s = "ISLARB6LNNNNY";
    expect(val(s, GLASS, "color")).toBe("Greek Isle");
    expect(val(s, GLASS, "style")).toBe("Aruba 6");
    expect(val(s, GLASS, "grillHole")).toBe("Grill left");
    expect(val(s, GLASS, "burner")).toBe("No burner");
    expect(val(s, GLASS, "tiki")).toBe("No tiki");
    expect(val(s, GLASS, "sink")).toBe("No sink");
    expect(val(s, GLASS, "umbrella")).toBe("Umbrella hole");
    expect(decodeSku(s, GLASS).attributes.every((a) => a.known)).toBe(true);
  });

  it("decodes a single-burner and a sink variant", () => {
    expect(val("TRVGX04RDLNNN", GLASS, "burner")).toBe("Double burner left");
    expect(val("TRVGX04RDLNNN", GLASS, "color")).toBe("Travertine");
    expect(val("ISLARB8LNNNYY", GLASS, "sink")).toBe("Sink cutout");
    expect(val("VOLARB8LSRNNY", GLASS, "burner")).toBe("Single burner right");
    expect(val("VOLARB8LSRNNY", GLASS, "color")).toBe("Volcanic Ash");
  });

  it("composes the real child SKU and its parent blank", () => {
    const child = composeSku(GLASS, {
      color: "TRV",
      style: "ARB8",
      grillHole: "L",
      burner: "DR",
      tiki: "N",
      sink: "N",
      umbrella: "Y",
    });
    const parent = composeSku(GLASS, {
      color: "TRV",
      style: "ARB8",
      grillHole: "L",
      burner: "NN",
      tiki: "N",
      sink: "N",
      umbrella: "Y",
    });
    // Exactly the cut-from-parent pair in the source data.
    expect(child).toBe("TRVARB8LDRNNY");
    expect(parent).toBe("TRVARB8LNNNNY");
  });

  it("reads a short-form SKU as colour + style rather than slicing it up", () => {
    const decoded = decodeSku("ISLFIREPIT", GLASS);
    expect(decoded.variant).toBe("bare");
    expect(decoded.label).toBe("Greek Isle · Fire Pit");
  });
});

// The XL grill-hole codes are 3 characters, so glass is not fixed-width.
describe("glass XL grill holes", () => {
  it("prefers the 3-char XL code over the 1-char placement", () => {
    expect(val("ISLGX08RXLDLNNN", GLASS, "grillHole")).toBe("Grill right (XL)");
    expect(val("ISLGX08RXLDLNNN", GLASS, "burner")).toBe("Double burner left");
    expect(val("ISLGX12CXLNNNNN", GLASS, "grillHole")).toBe("Grill center (XL)");
    expect(val("VOLGX08LXLNNNNN", GLASS, "grillHole")).toBe("Grill left (XL)");
    expect(val("ISLGX12DXLDLNNN", GLASS, "grillHole")).toBe("Double grill (XL)");
  });

  it("still reads the plain 1-char placement correctly", () => {
    expect(val("VOLGX14RDLNYN", GLASS, "grillHole")).toBe("Grill right");
    expect(val("VOLGX12CNNNNN", GLASS, "grillHole")).toBe("Grill center");
  });

  it("decodes every XL row cleanly", () => {
    for (const s of ["ISLGX09RXLPLYYN", "TITGX10CXLDLNNN", "TRVGX09RXLNNYYN"]) {
      expect(decodeSku(s, GLASS).variant).toBe("configured");
    }
  });
});

// BLANK means zero cuts, so the character before it is the seam, not a grill hole.
describe("glass blanks and the seam position", () => {
  it("reads a seamless blank", () => {
    const d = decodeSku("ISLGX08BLANK", GLASS);
    expect(d.variant).toBe("blank");
    expect(d.attributes.map((a) => a.key)).toEqual(["color", "style", "blank"]);
    expect(d.label).toBe("Greek Isle · GX-08 · Blank (uncut)");
  });

  it("reads the seam on a 12/14ft blank instead of mis-parsing it", () => {
    expect(val("ISLGX12CBLANK", GLASS, "seam")).toBe("Center seam (equal halves)");
    expect(val("ISLMA12DBLANK", GLASS, "seam")).toBe("Offset seam");
    expect(decodeSku("ISLGX12CBLANK", GLASS).variant).toBe("blank");
    // Previously sliced into burner="BL", tiki="A", umbrella="K".
    expect(decodeSku("ISLGX12CBLANK", GLASS).attributes.every((a) => a.known)).toBe(
      true
    );
  });

  it("does not mistake an XL grill hole for a seam", () => {
    expect(decodeSku("ISLGX12CXLNNNNN", GLASS).variant).toBe("configured");
    expect(decodeSku("ISLGX12CXLNNNNN", GLASS).attributes.some((a) => a.key === "seam"))
      .toBe(false);
  });

  it("composes a blank through the variant", () => {
    expect(
      composeSku(GLASS, { color: "ISL", style: "GX12", seam: "C", blank: "BLANK" }, "blank")
    ).toBe("ISLGX12CBLANK");
    expect(
      composeSku(GLASS, { color: "ISL", style: "GX08", blank: "BLANK" }, "blank")
    ).toBe("ISLGX08BLANK");
  });
});

describe("Monaco holes and the misconfigured flag", () => {
  it("reads M as Monaco holes in the tiki position", () => {
    expect(val("ISLMA12CNNMNN", GLASS, "tiki")).toBe("Monaco holes");
    expect(val("TITMA12DDLMNN", GLASS, "tiki")).toBe("Monaco holes");
    // The Y/N rows in the same slot still read as tiki.
    expect(val("ISLMA12CNNYNN", GLASS, "tiki")).toBe("Tiki holes");
    expect(val("VOLGX12CNNNNN", GLASS, "tiki")).toBe("No tiki");
  });

  it("reads the -MC suffix as a condition, not part of the configuration", () => {
    const d = decodeSku("TRVGX08CDLNNN-MC", GLASS);
    expect(d.variant).toBe("configured");
    expect(d.attributes.find((a) => a.key === "misconfigured")?.value).toBe(
      "Misconfigured — holes cut in the wrong location"
    );
    // The configuration itself still reads normally.
    expect(val("TRVGX08CDLNNN-MC", GLASS, "grillHole")).toBe("Grill center");
    expect(val("TRVGX08CDLNNN-MC", GLASS, "burner")).toBe("Double burner left");
  });

  it("leaves the suffix off a normal top", () => {
    expect(
      decodeSku("TRVGX08CDLNNN", GLASS).attributes.some(
        (a) => a.key === "misconfigured"
      )
    ).toBe(false);
  });
});

describe("styles that were missing from the grammar", () => {
  it("decodes them in glass", () => {
    for (const [sku, style] of [
      ["ISLMA08NNNNNY", "Maui 08"],
      ["ISLMA10NNNNNN", "Maui 10"],
      ["ISLSTC8NNNNNY", "St. Croix 8"],
      ["ISLSTC9NNNYNN", "St. Croix 9"],
      ["ISLSTT9NNNNNN", "St. Thomas 9"],
      ["VOLGX03CNNNNN", "GX-03"],
      ["ISLEASYCNNNNN", "Speakeasy"],
      ["ISLSTR9NNNNNN", "St. Tropez"],
      ["TRVGX07RDLNNN", "GX-07"],
    ] as const) {
      expect(val(sku, GLASS, "style")).toBe(style);
      expect(decodeSku(sku, GLASS).variant).toBe("configured");
    }
  });

  it("decodes them in bases, including the fire pits", () => {
    expect(val("MA08-N-NN-0-1-0-0-Y-Y-Y-CA", BASE, "style")).toBe("Maui 08");
    expect(val("STC8-N-NN-0-1-0-0-L-Y-Y-CA", BASE, "style")).toBe("St. Croix 8");
    expect(val("GX03-C-NN-1-0-0-0-N-N-N-CA", BASE, "style")).toBe("GX-03");
    expect(val("EASY-C-NN-1-4-0-0-N-N-N-CA", BASE, "style")).toBe("Speakeasy");
    // Access doors also come in D2, not just D1.
    expect(val("GX10-D-DL-D2-1-1-0-N-N-N-CA", BASE, "accessDoors")).toBe(
      "D2 access doors"
    );
    expect(val("FIREPIT-N-NN-0-0-0-0-N-N-N-CA", BASE, "style")).toBe("Fire Pit");
    expect(val("26FIREPIT-N-NN-1-0-0-0-N-N-N-CA", BASE, "style")).toBe('26" Fire Pit');
  });
});

describe("the burner segment is always two characters", () => {
  it("rejects a lone N as malformed rather than reading it as 'no burner'", () => {
    const burner = decodeSku("MA12-CXL-N-N-1-0-0-N-N-N-CA", BASE).attributes.find(
      (a) => a.key === "burner"
    )!;
    expect(burner.known).toBe(false);
  });
});

describe("getGrammar", () => {
  it("is tolerant of the free-text product categories", () => {
    expect(getGrammar("Base")).not.toBeNull();
    expect(getGrammar("GLASS")).not.toBeNull();
    expect(getGrammar("Glass Tops")).not.toBeNull();
    expect(getGrammar("Appliances-Extras")).toBeNull();
    expect(getGrammar(null)).toBeNull();
  });
});
