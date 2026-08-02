import { describe, it, expect } from "vitest";
import { employeeName, commissionThroughDate, commissionsActiveOn } from "./employees";

describe("employeeName", () => {
  it("prefers the full name, then first+last, then a dash", () => {
    expect(employeeName({ name: "Jane Rep" })).toBe("Jane Rep");
    expect(employeeName({ name: "", firstName: "Jane", lastName: "Rep" })).toBe("Jane Rep");
    expect(employeeName({ name: null, firstName: "Jane", lastName: null })).toBe("Jane");
    expect(employeeName({})).toBe("—");
  });

  it("uses the preferredName override above the legal name when set", () => {
    expect(employeeName({ preferredName: "John Smith Jr.", name: "John Smith" })).toBe("John Smith Jr.");
    // Blank/whitespace override falls back to the legal name.
    expect(employeeName({ preferredName: "  ", name: "John Smith" })).toBe("John Smith");
    expect(employeeName({ preferredName: null, name: "John Smith" })).toBe("John Smith");
  });
});

describe("commissionThroughDate", () => {
  const end = new Date("2026-06-01T00:00:00.000Z");

  it("is null while still employed (no end date)", () => {
    expect(commissionThroughDate({ endDate: null, separationType: null })).toBeNull();
  });

  it("stops on the end date when they quit with no notice", () => {
    const t = commissionThroughDate({ endDate: end, separationType: "QUIT_NO_NOTICE" });
    expect(t?.toISOString().slice(0, 10)).toBe("2026-06-01");
  });

  it("continues 30 days for a termination or two-weeks notice", () => {
    for (const sep of ["TERMINATED", "QUIT_WITH_NOTICE"] as const) {
      const t = commissionThroughDate({ endDate: end, separationType: sep });
      expect(t?.toISOString().slice(0, 10)).toBe("2026-07-01"); // +30 days
    }
  });

  it("treats a missing separation type (but with an end date) as the 30-day case", () => {
    const t = commissionThroughDate({ endDate: end, separationType: null });
    expect(t?.toISOString().slice(0, 10)).toBe("2026-07-01");
  });
});

describe("commissionsActiveOn", () => {
  const end = new Date("2026-06-01T00:00:00.000Z");

  it("is always active while employed", () => {
    expect(commissionsActiveOn({ endDate: null, separationType: null }, new Date("2030-01-01"))).toBe(true);
  });

  it("honors the no-notice cutoff on the end date", () => {
    const e = { endDate: end, separationType: "QUIT_NO_NOTICE" as const };
    expect(commissionsActiveOn(e, new Date("2026-06-01T00:00:00.000Z"))).toBe(true);
    expect(commissionsActiveOn(e, new Date("2026-06-02T00:00:00.000Z"))).toBe(false);
  });

  it("honors the 30-day window for a termination", () => {
    const e = { endDate: end, separationType: "TERMINATED" as const };
    expect(commissionsActiveOn(e, new Date("2026-07-01T00:00:00.000Z"))).toBe(true);
    expect(commissionsActiveOn(e, new Date("2026-07-02T00:00:00.000Z"))).toBe(false);
  });
});
