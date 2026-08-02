import { describe, it, expect } from "vitest";
import {
  isWeekend,
  subtractBusinessDays,
  dueDateForLoadDate,
  isOverdue,
} from "./glass";

// Reference week: Thu 2026-07-16, Fri 17, Sat 18, Sun 19, Mon 20, Tue 21, Wed 22.
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const ymd = (date: Date) => date.toISOString().slice(0, 10);

describe("isWeekend", () => {
  it("flags Saturday and Sunday only", () => {
    expect(isWeekend(d("2026-07-18"))).toBe(true); // Sat
    expect(isWeekend(d("2026-07-19"))).toBe(true); // Sun
    expect(isWeekend(d("2026-07-17"))).toBe(false); // Fri
    expect(isWeekend(d("2026-07-20"))).toBe(false); // Mon
  });
});

describe("dueDateForLoadDate", () => {
  it("skips the weekend for a Monday load date", () => {
    // Mon 20 -> Fri 17 (1) -> Thu 16 (2)
    expect(ymd(dueDateForLoadDate(d("2026-07-20")))).toBe("2026-07-16");
  });

  it("stays inside the week for a Wednesday load date", () => {
    // Wed 22 -> Tue 21 (1) -> Mon 20 (2)
    expect(ymd(dueDateForLoadDate(d("2026-07-22")))).toBe("2026-07-20");
  });

  it("crosses the weekend for a Tuesday load date", () => {
    // Tue 21 -> Mon 20 (1) -> Fri 17 (2)
    expect(ymd(dueDateForLoadDate(d("2026-07-21")))).toBe("2026-07-17");
  });

  it("honours a custom lead time", () => {
    expect(ymd(dueDateForLoadDate(d("2026-07-22"), 1))).toBe("2026-07-21");
    expect(ymd(dueDateForLoadDate(d("2026-07-22"), 0))).toBe("2026-07-22");
  });
});

describe("subtractBusinessDays", () => {
  it("never lands on a weekend", () => {
    for (let n = 1; n <= 10; n++) {
      expect(isWeekend(subtractBusinessDays(d("2026-07-22"), n))).toBe(false);
    }
  });
});

describe("isOverdue", () => {
  const today = d("2026-07-21");
  it("is true only for due dates before today", () => {
    expect(isOverdue(d("2026-07-20"), today)).toBe(true);
    expect(isOverdue(d("2026-07-21"), today)).toBe(false); // due today isn't late
    expect(isOverdue(d("2026-07-22"), today)).toBe(false);
  });

  it("treats a missing due date as not overdue", () => {
    expect(isOverdue(null, today)).toBe(false);
  });
});
