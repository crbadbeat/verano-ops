import { describe, it, expect } from "vitest";
import { validateSku } from "./sku-validate";

describe("validateSku — clean rows", () => {
  it("passes every glass form", () => {
    for (const sku of [
      "ISLARB6LNNNNY", // configured
      "ISLGX08RXLDLNNN", // XL grill hole
      "ISLGX08BLANK", // seamless blank
      "ISLGX12CBLANK", // seamed blank
      "ISLMA12CNNMNN", // Monaco holes
      "TRVGX08CDLNNN-MC", // misconfigured flag
      "ISLFIREPIT", // bare short code
    ]) {
      const v = validateSku(sku, "Glass");
      expect(v.ok, `${sku} -> ${JSON.stringify(v.problems)}`).toBe(true);
    }
  });

  it("passes a well-formed base", () => {
    expect(validateSku("GX10-CXL-PR-D1-1-2-0-N-N-N-DG", "Base").ok).toBe(true);
  });

  it("treats plain items with no grammar as nothing to check", () => {
    expect(validateSku("SOME-RANDOM-PART", "Accessories").ok).toBe(true);
    expect(validateSku("WHATEVER", null).ok).toBe(true);
  });

  it("reports which glass form matched", () => {
    expect(validateSku("ISLGX12CBLANK", "Glass").variant).toBe("blank");
    expect(validateSku("ISLARB6LNNNNY", "Glass").variant).toBe("configured");
    expect(validateSku("ISLFIREPIT", "Glass").variant).toBe("bare");
  });
});

describe("validateSku — the product owner's rulings", () => {
  it("flags GX9 and suggests the zero-padded GX09", () => {
    const v = validateSku("GX9-D-DL-2-0-2-0-N-Y-N-CA", "Base");
    expect(v.ok).toBe(false);
    expect(v.problems[0].kind).toBe("UNKNOWN_CODE");
    expect(v.problems[0].segment).toBe("style");
    expect(v.suggestion).toBe("GX09-D-DL-2-0-2-0-N-Y-N-CA");
  });

  it("flags a burner typed as N-N and suggests rejoining it", () => {
    // 12 segments: the burner `NN` was typed `N-N`, adding one.
    const v = validateSku("MA12-CXL-N-N-1-0-0-0-N-N-N-CA", "Base");
    expect(v.ok).toBe(false);
    expect(v.problems[0].kind).toBe("SEGMENT_COUNT");
    expect(v.suggestion).toBe("MA12-CXL-NN-1-0-0-0-N-N-N-CA");
    // …and the suggestion is itself valid.
    expect(validateSku(v.suggestion!, "Base").ok).toBe(true);
  });

  it("suggests nothing when the fix is not obvious", () => {
    const v = validateSku("ZZ99-D-DL-2-0-2-0-N-Y-N-CA", "Base");
    expect(v.ok).toBe(false);
    expect(v.suggestion).toBeUndefined();
  });
});

describe("validateSku — malformed glass", () => {
  it("flags an unknown colour", () => {
    const v = validateSku("XXXARB6LNNNNY", "Glass");
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.segment === "color")).toBe(true);
  });

  it("flags characters left over at the end", () => {
    const v = validateSku("ISLARB6LNNNNYZZ", "Glass");
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.kind === "UNPARSED")).toBe(true);
  });

  it("flags a truncated SKU as missing its tail segments", () => {
    const v = validateSku("ISLARB6L", "Glass");
    expect(v.ok).toBe(false);
    expect(v.problems.some((p) => p.kind === "MISSING_SEGMENT")).toBe(true);
  });

  it("does not report per-segment noise on a wrong-length base", () => {
    const v = validateSku("GX10-CXL-PR", "Base");
    expect(v.problems).toHaveLength(1);
    expect(v.problems[0].kind).toBe("SEGMENT_COUNT");
  });
});
