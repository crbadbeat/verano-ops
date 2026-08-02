import { describe, it, expect } from "vitest";
import { normalizeCommissionId, resolveAttribution } from "./sales-attribution";

describe("normalizeCommissionId", () => {
  it("strips the hyphen so a NetSuite id matches an employee code", () => {
    expect(normalizeCommissionId("D-1703")).toBe("D1703");
    expect(normalizeCommissionId("I-689")).toBe("I689");
  });
  it("handles empties", () => {
    expect(normalizeCommissionId(null)).toBeNull();
    expect(normalizeCommissionId("")).toBeNull();
  });
});

describe("resolveAttribution", () => {
  const maps = {
    locationBySalesCenter: new Map([[14, { id: "ftm", regionId: "swfl" }]]),
    employeeByCode: new Map([
      ["D1703", "emp-gtl"],
      ["D1156", "emp-regional"],
    ]),
  };

  it("resolves showroom + region from the sales center and rep from the commission id", () => {
    const a = resolveAttribution(
      { division: "PGD", salesCenterId: 14, salesRep1Id: "D-1703", gtlId: "D-1703", regionalId: "D-1156", vpId: null },
      maps
    );
    expect(a).toEqual({
      division: "PGD",
      showroomId: "ftm",
      regionId: "swfl",
      repEmployeeId: "emp-gtl",
      gtlEmployeeId: "emp-gtl",
      regionalEmployeeId: "emp-regional",
      vpEmployeeId: null,
    });
  });

  it("leaves showroom/rep null when the sales center or code is unknown", () => {
    const a = resolveAttribution(
      { division: "PGI", salesCenterId: 999, salesRep1Id: "Z-1", gtlId: null, regionalId: null, vpId: null },
      maps
    );
    expect(a.showroomId).toBeNull();
    expect(a.regionId).toBeNull();
    expect(a.repEmployeeId).toBeNull();
    expect(a.division).toBe("PGI");
  });
});
