import { describe, it, expect } from "vitest";
import { salesCenterToShowroomName, matchSalesCenter } from "./sales-center";

const LOCS = [
  { id: "ftm", name: "Ft. Myers" },
  { id: "wood", name: "Woodlands" },
  { id: "boca", name: "Boca Raton" },
  { id: "clermont", name: "Clermont" },
];

describe("salesCenterToShowroomName", () => {
  it("strips the Showroom suffix and prefixes", () => {
    expect(salesCenterToShowroomName("Fort Myers Showroom")).toBe("Fort Myers");
    expect(salesCenterToShowroomName("Clermont Show Sale PGD")).toBe("Clermont");
    expect(salesCenterToShowroomName("Kennesaw GA Showroom")).toBe("Kennesaw");
  });
  it("returns null for non-showroom centers", () => {
    expect(salesCenterToShowroomName("6-Corporate FL PGD")).toBeNull();
  });
});

describe("matchSalesCenter", () => {
  it("matches via the ADP location aliases", () => {
    expect(matchSalesCenter("Fort Myers Showroom", LOCS)).toBe("ftm"); // Fort -> Ft.
    expect(matchSalesCenter("Woodlands Showroom", LOCS)).toBe("wood");
    expect(matchSalesCenter("Boca Raton Showroom", LOCS)).toBe("boca");
    expect(matchSalesCenter("Clermont Show Sale PGD", LOCS)).toBe("clermont");
  });
  it("returns null for a showroom not in the WMS or a non-showroom", () => {
    expect(matchSalesCenter("Houston Showroom", LOCS)).toBeNull();
    expect(matchSalesCenter("6-Corporate FL PGD", LOCS)).toBeNull();
  });
});
