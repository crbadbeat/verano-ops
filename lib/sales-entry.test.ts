import { describe, it, expect } from "vitest";
import { parseCents, isOneOf, DEAL_TYPES } from "./sales-entry";

describe("parseCents", () => {
  it("parses plain, comma, and dollar-prefixed amounts to cents", () => {
    expect(parseCents("1234")).toBe(123400);
    expect(parseCents("1234.56")).toBe(123456);
    expect(parseCents("$1,234.56")).toBe(123456);
    expect(parseCents(" 1,000 ")).toBe(100000);
  });

  it("returns null for empty or malformed input", () => {
    expect(parseCents("")).toBeNull();
    expect(parseCents(null)).toBeNull();
    expect(parseCents("abc")).toBeNull();
    expect(parseCents("12.345")).toBeNull(); // more than 2 decimals
  });
});

describe("isOneOf", () => {
  it("validates a submitted dropdown value against its option list", () => {
    expect(isOneOf("New Deal", DEAL_TYPES)).toBe(true);
    expect(isOneOf("Nope", DEAL_TYPES)).toBe(false);
  });
});
