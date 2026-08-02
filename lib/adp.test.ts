import { describe, it, expect } from "vitest";
import {
  divisionFromPayroll,
  salaryAllowedForTitle,
  salesLevelFromTitle,
  separationFrom,
  moneyToCents,
  inScope,
  mapAdpRow,
  supervisorCodeFromName,
} from "./adp";

describe("supervisorCodeFromName", () => {
  it("parses the payroll code+file in the parenthetical to a D/I code", () => {
    expect(supervisorCodeFromName("Kotorri, Endri (OSC000340)")).toBe("D340");
    expect(supervisorCodeFromName("Letson, Kelsey (41N000117)")).toBe("I117");
  });
  it("returns null when there is no code", () => {
    expect(supervisorCodeFromName("Jane Manager")).toBeNull();
    expect(supervisorCodeFromName(null)).toBeNull();
  });
});

describe("divisionFromPayroll (ID rule)", () => {
  it("41N -> I<file>, OSC -> D<file>, leading zeros stripped", () => {
    expect(divisionFromPayroll("41N", "000689")).toEqual({ division: "PGI", divisionCode: "I689" });
    expect(divisionFromPayroll("OSC", "001303")).toEqual({ division: "PGD", divisionCode: "D1303" });
  });
  it("returns null for an unknown payroll code", () => {
    expect(divisionFromPayroll("", "0001")).toBeNull();
    expect(divisionFromPayroll("XYZ", "0001")).toBeNull();
  });
});

describe("salary gate", () => {
  it("allows only the listed roles (incl. the ADP typo)", () => {
    expect(salaryAllowedForTitle("Sales Associate")).toBe(true);
    expect(salaryAllowedForTitle("Comissioned Sales")).toBe(true);
    expect(salaryAllowedForTitle("Delivery Driver")).toBe(true);
    expect(salaryAllowedForTitle("Prod - Aluminum Cutter")).toBe(true);
  });
  it("blocks everyone else", () => {
    expect(salaryAllowedForTitle("CFO")).toBe(false);
    expect(salaryAllowedForTitle("Sales Manager")).toBe(false);
    expect(salaryAllowedForTitle("Customer Service Representative")).toBe(false);
    expect(salaryAllowedForTitle("VP of Sales")).toBe(false);
  });
  it("drops salary to null for a blocked title in mapAdpRow", () => {
    const cfo = mapAdpRow({
      "Payroll Company Code": "41N",
      "File Number": "000001",
      "Job Title Description": "CFO",
      "Annual Salary": "500000",
      "Regular Pay Rate Amount": "240.38",
      "Position Status": "Active",
      "Legal First Name": "Big",
      "Legal Last Name": "Boss",
    });
    expect(cfo?.annualSalaryCents).toBeNull();
    expect(cfo?.payRateCents).toBeNull();
  });
  it("keeps salary for an allow-listed title", () => {
    const rep = mapAdpRow({
      "Payroll Company Code": "OSC",
      "File Number": "001303",
      "Job Title Description": "Sales Associate",
      "Annual Salary": "45,000",
      "Position Status": "Active",
    });
    expect(rep?.annualSalaryCents).toBe(4500000);
    expect(rep?.divisionCode).toBe("D1303");
  });
});

describe("salesLevelFromTitle", () => {
  it("maps the hierarchy", () => {
    expect(salesLevelFromTitle("Gallery Team Leader")).toBe("GTL");
    expect(salesLevelFromTitle("VP of Sales")).toBe("VP");
    expect(salesLevelFromTitle("Regional Team Leader")).toBe("REGIONAL");
    expect(salesLevelFromTitle("Sales Associate")).toBe("REP");
    expect(salesLevelFromTitle("Commissioned Sales Rep")).toBe("REP");
    expect(salesLevelFromTitle("Warehouse Worker")).toBeNull();
  });
});

describe("separationFrom", () => {
  it("no separation while still employed", () => {
    expect(separationFrom("Active", "", "")).toBeNull();
  });
  it("involuntary -> terminated (30-day commission)", () => {
    expect(separationFrom("Terminated", "Involuntary", "Performance")).toBe("TERMINATED");
  });
  it("no-show / abandoned -> quit no notice (commission cutoff)", () => {
    expect(separationFrom("Terminated", "Voluntary", "No-show")).toBe("QUIT_NO_NOTICE");
    expect(separationFrom("Terminated", "Voluntary", "Abandoned Job")).toBe("QUIT_NO_NOTICE");
  });
  it("other voluntary -> quit with notice (30-day commission)", () => {
    expect(separationFrom("Terminated", "Voluntary", "Voluntary")).toBe("QUIT_WITH_NOTICE");
  });
});

describe("moneyToCents", () => {
  it("parses money forms", () => {
    expect(moneyToCents("45,000")).toBe(4500000);
    expect(moneyToCents("$15.50")).toBe(1550);
    expect(moneyToCents("")).toBeNull();
  });
});

describe("inScope", () => {
  const now = new Date("2026-07-28T00:00:00.000Z");
  it("keeps the current roster", () => {
    expect(inScope({ "Position Status": "Active" }, now)).toBe(true);
    expect(inScope({ "Position Status": "Leave" }, now)).toBe(true);
  });
  it("keeps terminations within the last 12 months, drops older", () => {
    expect(inScope({ "Position Status": "Terminated", "Termination Date": "3/1/2026" }, now)).toBe(true);
    expect(inScope({ "Position Status": "Terminated", "Termination Date": "1/1/2024" }, now)).toBe(false);
  });
});
