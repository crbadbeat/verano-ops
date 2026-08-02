import { describe, it, expect } from "vitest";
import {
  buildMonthGrid,
  shiftMonth,
  parseMonth,
  monthParam,
  stagingDateForLoadDate,
  computeShortfalls,
  requiresNote,
  isoDate,
  type PickLineInput,
} from "./scheduling";

const utc = (y: number, m1: number, d: number) => new Date(Date.UTC(y, m1 - 1, d));

describe("buildMonthGrid", () => {
  it("pads a mid-week month to whole Sunday-first weeks", () => {
    // July 2026 starts on a Wednesday.
    const weeks = buildMonthGrid(2026, 6);
    expect(weeks).toHaveLength(5); // ceil((3 leading + 31) / 7)
    for (const week of weeks) expect(week).toHaveLength(7);

    // First cell is the Sunday before the 1st; the 1st sits in column 3 (Wed).
    expect(weeks[0][0].iso).toBe("2026-06-28");
    expect(weeks[0][0].inMonth).toBe(false);
    expect(weeks[0][3].iso).toBe("2026-07-01");
    expect(weeks[0][3].inMonth).toBe(true);

    // Last cell is the trailing pad day.
    const last = weeks[4][6];
    expect(last.iso).toBe("2026-08-01");
    expect(last.inMonth).toBe(false);

    // Exactly 31 in-month days, and the grid is a contiguous run of days.
    const cells = weeks.flat();
    expect(cells.filter((c) => c.inMonth)).toHaveLength(31);
    for (let i = 1; i < cells.length; i++) {
      const diff = cells[i].date.getTime() - cells[i - 1].date.getTime();
      expect(diff).toBe(24 * 60 * 60 * 1000);
    }
  });

  it("needs no leading pad when the month starts on a Sunday", () => {
    // February 2026 starts on a Sunday and is 28 days → exactly 4 weeks.
    const weeks = buildMonthGrid(2026, 1);
    expect(weeks).toHaveLength(4);
    expect(weeks[0][0].iso).toBe("2026-02-01");
    expect(weeks[0][0].inMonth).toBe(true);
    expect(weeks[3][6].iso).toBe("2026-02-28");
  });

  it("spans six rows when a 31-day month starts late in the week", () => {
    // May 2026 starts on a Friday.
    expect(buildMonthGrid(2026, 4)).toHaveLength(6);
  });
});

describe("shiftMonth", () => {
  it("rolls the year backward and forward", () => {
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month0: 11 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month0: 0 });
    expect(shiftMonth(2026, 6, 0)).toEqual({ year: 2026, month0: 6 });
  });
});

describe("parseMonth / monthParam", () => {
  it("round-trips a valid month", () => {
    expect(parseMonth("2026-07")).toEqual({ year: 2026, month0: 6 });
    expect(monthParam(2026, 6)).toBe("2026-07");
    expect(monthParam(2026, 0)).toBe("2026-01");
  });

  it("rejects missing or malformed values", () => {
    expect(parseMonth(undefined)).toBeNull();
    expect(parseMonth("")).toBeNull();
    expect(parseMonth("2026-13")).toBeNull();
    expect(parseMonth("2026-00")).toBeNull();
    expect(parseMonth("nope")).toBeNull();
  });
});

describe("stagingDateForLoadDate", () => {
  it("is the business day before the load date, skipping the weekend", () => {
    // Monday 2026-07-20 → previous Friday 2026-07-17.
    expect(isoDate(stagingDateForLoadDate(utc(2026, 7, 20)))).toBe("2026-07-17");
    // Tuesday → Monday (no weekend to cross).
    expect(isoDate(stagingDateForLoadDate(utc(2026, 7, 21)))).toBe("2026-07-20");
  });
});

describe("computeShortfalls / requiresNote", () => {
  const line = (productId: string, qty: number, label = productId): PickLineInput => ({
    productId,
    sku: productId,
    label,
    qty,
  });

  it("sums lines per product and flags only the ones under on-hand", () => {
    const lines = [line("a", 3), line("a", 2), line("b", 2)];
    const onHand = new Map([
      ["a", 4],
      ["b", 5],
    ]);
    const short = computeShortfalls(lines, onHand);
    expect(short).toHaveLength(1);
    expect(short[0]).toMatchObject({ productId: "a", needed: 5, onHand: 4, short: 1 });
    expect(requiresNote(short)).toBe(true);
  });

  it("treats a product missing from the on-hand map as zero", () => {
    const short = computeShortfalls([line("z", 1)], new Map());
    expect(short[0]).toMatchObject({ productId: "z", needed: 1, onHand: 0, short: 1 });
  });

  it("returns nothing (and requires no note) when everything is covered", () => {
    const short = computeShortfalls([line("a", 1)], new Map([["a", 10]]));
    expect(short).toEqual([]);
    expect(requiresNote(short)).toBe(false);
  });
});
