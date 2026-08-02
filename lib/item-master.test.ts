import { describe, it, expect } from "vitest";
import { itemMasterRow, productDisplayName } from "./item-master";

describe("productDisplayName", () => {
  it("prefers the WMS override, then the NetSuite name, then the sku", () => {
    expect(
      productDisplayName({ displayName: "Pro Double Burner", name: "GSL DBL Burner - LP", sku: "4821" })
    ).toBe("Pro Double Burner");
    expect(productDisplayName({ displayName: null, name: "GSL DBL Burner - LP", sku: "4821" })).toBe(
      "GSL DBL Burner - LP"
    );
    expect(productDisplayName({ displayName: null, name: "", sku: "VOLGX10-CUT" })).toBe("VOLGX10-CUT");
  });

  it("treats blank/whitespace override or name as absent", () => {
    expect(productDisplayName({ displayName: "   ", name: "Real Name", sku: "9" })).toBe("Real Name");
    expect(productDisplayName({ displayName: undefined, name: undefined, sku: "9" })).toBe("9");
  });
});

describe("itemMasterRow", () => {
  it("maps a full row", () => {
    expect(
      itemMasterRow({
        number: "12345",
        sku: "VOLGX10BLANK",
        displayName: "Volcanic GX10 Blank",
        description: "Verano VOL GX10 Glass Blank",
        barcode: "0123456789012",
        category: "Glass",
      })
    ).toEqual({
      netsuiteNumber: "12345",
      sku: "VOLGX10BLANK",
      name: "Volcanic GX10 Blank",
      description: "Verano VOL GX10 Glass Blank",
      barcode: "0123456789012",
      category: "Glass",
    });
  });

  it("defaults sku to the NetSuite number when no SKU is given (a purchased item)", () => {
    const r = itemMasterRow({ number: "999", displayName: "Side Burner LP", category: "Appliance" });
    expect(r?.sku).toBe("999");
    expect(r?.netsuiteNumber).toBe("999");
  });

  it("falls back name → description → number so it is never empty", () => {
    expect(itemMasterRow({ number: "1", description: "A Desc" })?.name).toBe("A Desc");
    expect(itemMasterRow({ number: "2" })?.name).toBe("2");
  });

  it("requires a NetSuite number", () => {
    expect(itemMasterRow({ sku: "X", displayName: "no number" })).toBeNull();
    expect(itemMasterRow({ number: "   " })).toBeNull();
  });

  it("trims and nulls blank optional fields", () => {
    const r = itemMasterRow({ number: " 42 ", sku: " ", barcode: " ", category: " ", description: " " });
    expect(r).toMatchObject({ netsuiteNumber: "42", sku: "42", description: null, barcode: null, category: null });
  });
});
