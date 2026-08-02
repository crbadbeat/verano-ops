import { describe, it, expect } from "vitest";
import {
  parseISO, toISO, addDays, startOfWeek, startOfMonth, daysInMonth,
  coversDay, firstStartMs, lastEndMs, layoutWeek,
} from "./calendar";

const s = (start: string, end: string) => ({ spans: [{ start, end }] });

describe("date helpers (UTC)", () => {
  it("startOfWeek snaps back to Monday (weeks end Sunday)", () => {
    expect(toISO(startOfWeek(parseISO("2026-08-01")))).toBe("2026-07-27"); // Aug 1 is a Sat → Mon Jul 27
    expect(toISO(startOfWeek(parseISO("2026-07-27")))).toBe("2026-07-27"); // a Monday maps to itself
    expect(toISO(startOfWeek(parseISO("2026-07-26")))).toBe("2026-07-20"); // Sunday → the prior Monday
  });
  it("startOfMonth + daysInMonth", () => {
    expect(toISO(startOfMonth(parseISO("2026-08-15")))).toBe("2026-08-01");
    expect(daysInMonth(parseISO("2026-08-15"), 0)).toBe(31);
    expect(daysInMonth(parseISO("2026-02-15"), 0)).toBe(28);
  });
  it("addDays crosses month boundaries", () => {
    expect(toISO(addDays(parseISO("2026-07-31"), 2))).toBe("2026-08-02");
  });
});

describe("coversDay / span extents", () => {
  const show = { spans: [{ start: "2026-08-08", end: "2026-08-09" }] };
  it("covers only the inclusive span days", () => {
    expect(coversDay(show.spans, parseISO("2026-08-07").getTime())).toBe(false);
    expect(coversDay(show.spans, parseISO("2026-08-08").getTime())).toBe(true);
    expect(coversDay(show.spans, parseISO("2026-08-09").getTime())).toBe(true);
    expect(coversDay(show.spans, parseISO("2026-08-10").getTime())).toBe(false);
  });
  it("firstStartMs / lastEndMs across multiple spans", () => {
    const multi = [{ start: "2026-08-20", end: "2026-08-21" }, { start: "2026-08-01", end: "2026-08-03" }];
    expect(firstStartMs(multi)).toBe(parseISO("2026-08-01").getTime());
    expect(lastEndMs(multi)).toBe(parseISO("2026-08-21").getTime());
  });
});

describe("layoutWeek lane assignment", () => {
  const weekStart = parseISO("2026-07-26"); // Sun, the week containing Aug 1

  it("places a single show at the right column + span", () => {
    const segs = layoutWeek([s("2026-07-31", "2026-08-02")], weekStart); // Fri..Sun (clamped to Sat)
    expect(segs).toHaveLength(1);
    expect(segs[0].col).toBe(5); // Friday
    expect(segs[0].span).toBe(2); // Fri, Sat (Sun 8/2 spills to next week)
    expect(segs[0].lane).toBe(0);
  });

  it("stacks overlapping shows into separate lanes but shares a lane when disjoint", () => {
    const segs = layoutWeek(
      [
        s("2026-07-27", "2026-07-28"), // Mon-Tue
        s("2026-07-28", "2026-07-29"), // Tue-Wed  (overlaps the first on Tue)
        s("2026-07-30", "2026-07-31"), // Thu-Fri  (disjoint from the first -> lane 0)
      ],
      weekStart
    );
    const byStart = [...segs].sort((a, b) => a.startMs - b.startMs);
    expect(byStart[0].lane).toBe(0); // Mon-Tue
    expect(byStart[1].lane).toBe(1); // Tue-Wed overlaps -> new lane
    expect(byStart[2].lane).toBe(0); // Thu-Fri fits back in lane 0
  });

  it("clamps a show that started before the week to column 0", () => {
    const segs = layoutWeek([s("2026-07-24", "2026-07-27")], weekStart); // starts prior Fri
    expect(segs[0].col).toBe(0); // clamped to the week's Sunday
    expect(segs[0].span).toBe(2); // Sun, Mon within this week
  });

  it("ignores shows entirely outside the week", () => {
    expect(layoutWeek([s("2026-09-01", "2026-09-03")], weekStart)).toHaveLength(0);
  });
});
