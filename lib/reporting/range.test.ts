import { describe, it, expect } from "vitest";
import { presetRange, parseRange, rangeDays, isoDate, eachMonth, monthKey, monthLabel } from "./range";

const NOW = new Date(Date.UTC(2026, 6, 24)); // 2026-07-24

describe("presetRange", () => {
  it("d7 spans 7 days ending today", () => {
    const r = presetRange("d7", NOW);
    expect(r.fromIso).toBe("2026-07-18");
    expect(r.toIso).toBe("2026-07-24");
    expect(isoDate(r.toExclusive)).toBe("2026-07-25");
    expect(rangeDays(r)).toBe(7);
  });

  it("mtd starts on the first of the month", () => {
    const r = presetRange("mtd", NOW);
    expect(r.fromIso).toBe("2026-07-01");
    expect(r.toIso).toBe("2026-07-24");
    expect(rangeDays(r)).toBe(24);
  });

  it("week starts on Sunday and ends today", () => {
    const r = presetRange("week", NOW);
    expect(r.from.getUTCDay()).toBe(0);
    expect(r.fromIso <= "2026-07-24").toBe(true);
    expect(r.toIso).toBe("2026-07-24");
  });
});

describe("parseRange", () => {
  it("uses an explicit from/to as a custom range (to is inclusive)", () => {
    const r = parseRange({ from: "2026-01-01", to: "2026-01-31" }, NOW);
    expect(r.preset).toBe("custom");
    expect(r.fromIso).toBe("2026-01-01");
    expect(r.toIso).toBe("2026-01-31");
    expect(isoDate(r.toExclusive)).toBe("2026-02-01");
    expect(rangeDays(r)).toBe(31);
  });

  it("falls back to month-to-date when params are missing or malformed", () => {
    expect(parseRange({}, NOW).preset).toBe("mtd");
    expect(parseRange({ from: "nope", to: "2026-01-31" }, NOW).preset).toBe("mtd");
  });

  it("ignores an inverted from/to and falls back", () => {
    expect(parseRange({ from: "2026-02-01", to: "2026-01-01" }, NOW).preset).toBe("mtd");
  });

  it("honours a named preset", () => {
    expect(parseRange({ preset: "d30" }, NOW).preset).toBe("d30");
    expect(parseRange({ preset: "ytd" }, NOW).preset).toBe("ytd");
  });
});

describe("year-scale presets", () => {
  it("ytd runs from Jan 1 of the current year to today", () => {
    const r = presetRange("ytd", NOW);
    expect(r.fromIso).toBe("2026-01-01");
    expect(r.toIso).toBe("2026-07-24");
  });

  it("py is the full prior calendar year", () => {
    const r = presetRange("py", NOW);
    expect(r.fromIso).toBe("2025-01-01");
    expect(r.toIso).toBe("2025-12-31");
    expect(isoDate(r.toExclusive)).toBe("2026-01-01");
  });

  it("all runs from the 2024 history floor to today", () => {
    const r = presetRange("all", NOW);
    expect(r.fromIso).toBe("2024-01-01");
    expect(r.toIso).toBe("2026-07-24");
  });
});

describe("month bucketing", () => {
  it("monthKey slices a date to yyyy-mm", () => {
    expect(monthKey(new Date(Date.UTC(2026, 2, 15)))).toBe("2026-03");
  });

  it("eachMonth covers every month the window touches, inclusive of partials", () => {
    const r = parseRange({ from: "2025-11-20", to: "2026-02-03" }, NOW);
    expect(eachMonth(r)).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("monthLabel renders a compact label", () => {
    expect(monthLabel("2026-03")).toBe("Mar '26");
  });
});
