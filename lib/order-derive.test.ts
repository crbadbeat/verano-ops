import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { decodeSku } from "./sku";
import { GRAMMARS } from "./sku-grammar";
import { parseConfiguratorUrl } from "./order-parse-url";
import { burnerSideFor, deriveOrder, mergeLines, type DerivedLine } from "./order-derive";

// The reference order throughout: Final Sales Agreement #14454 and the saved
// configurator link that produced it. A GX10 grill island (double, two cocktail
// stations) beside a Maui 10 bar island, under a St. Barth pergola.
//
// The product owner confirmed what this must decode to, and three of the four
// SKUs were checked against the real product master:
//   GX10-D-NN-2-1-1-0-N-N-N-CA   a "Special" base — not stocked
//   VOLGX10DNNNNN                 must be cut from VOLGX10BLANK (which IS stocked)
//   MA10-N-NN-0-2-0-0-L-Y-Y-CA   a stocked Parent
//   VOLMA10NNNNNN                 a stocked top
export const FSA_14454_URL =
  "https://veranodirect.com/configurator_1/?ar=false&ISLAND=7%2Cdouble" +
  "&BAR_ISLAND=7%2Chide%2Cparallel&COMBO=5&SHADE=-1&GRILLS=0%2C3%3B1%2C3" +
  "&STAINLESS=0%2C2%2C0%3B1%2C4%2C0%3B5%2C4%2C1%3B6%2C4%2C1&TOP=&FOOTREST=0%2C6%2C1" +
  "&STONE=1&SIDING=0&HAPPY=2%2C4%2C7%2C10&PATIOS=&STOOLS=8%2C7" +
  "&ACCESS_DOORS=0%2C0%2C0%3B1%2C0%2C0";

const qtyOf = (lines: DerivedLine[], label: string): number =>
  lines
    .filter((l) => l.label.toLowerCase() === label.toLowerCase())
    .reduce((sum, l) => sum + l.qty, 0);

describe("burnerSideFor", () => {
  it("puts the burner opposite the grill hole", () => {
    expect(burnerSideFor("L")).toBe("R");
    expect(burnerSideFor("R")).toBe("L");
    expect(burnerSideFor("C")).toBe("R");
    expect(burnerSideFor("D")).toBe("L");
  });

  it("treats an XL hole the same as its base placement", () => {
    expect(burnerSideFor("RXL")).toBe("L");
    expect(burnerSideFor("DXL")).toBe("L");
    expect(burnerSideFor("CXL")).toBe("R");
  });

  it("has no side to offer when there is no grill hole", () => {
    expect(burnerSideFor("N")).toBeNull();
  });
});

// Neither the agreement nor the configurator link states which side a burner
// goes on, so the rule above has to carry the weight. This checks it against the
// product owner's own catalogue of every buildable base. The bar to clear is not
// "no exceptions" — it is that no exception is ever a STOCKED configuration.
describe("burnerSideFor, against the base lookup sheet", () => {
  const sheetPath = path.join(process.cwd(), "Base_Lookup_Advanced.xlsx");

  it.runIf(fs.existsSync(sheetPath))(
    "holds for every stocked base, and only Specials break it",
    async () => {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.readFile(sheetPath);
      const ws = wb.worksheets[0];

      let followed = 0;
      const exceptions: string[] = [];
      ws.eachRow((row, n) => {
        if (n === 1) return; // header
        // Decode the SKU with our own grammar rather than reading the sheet's
        // decomposition columns: those are spreadsheet formulas, and the glass
        // sheet's equivalents are known to be wrong.
        const sku = String(row.getCell(1).value ?? "");
        const buildCategory = String(row.getCell(13).value ?? "");
        if (!sku) return;

        const attrs = decodeSku(sku, GRAMMARS.BASE ?? null).attributes;
        const grillHole = attrs.find((a) => a.key === "grillHole")?.code ?? "";
        const burner = attrs.find((a) => a.key === "burner")?.code ?? "";
        if (!burner || burner === "NN") return;

        if (burner[1] === burnerSideFor(grillHole)) followed++;
        else exceptions.push(`${sku} (${buildCategory})`);
      });

      expect(followed).toBeGreaterThan(400);
      // Every exception is a one-off "Special" build. If a Parent or Child ever
      // shows up here, the rule is wrong and the SKU it composes is wrong too.
      expect(exceptions.filter((e) => !e.endsWith("(Special)"))).toEqual([]);
      expect(exceptions.length / (followed + exceptions.length)).toBeLessThan(0.1);
    },
    30_000
  );
});

describe("parseConfiguratorUrl", () => {
  const parsed = parseConfiguratorUrl(FSA_14454_URL);

  it("finds both islands, in grill-then-bar order", () => {
    expect(parsed.islands.map((i) => i.role)).toEqual(["GRILL", "BAR"]);
    expect(parsed.islands[0].styleCode).toBe("7");
    expect(parsed.islands[0].grillPosition).toBe("double");
    expect(parsed.islands[1].styleCode).toBe("7");
    expect(parsed.islands[1].grillPosition).toBe("hide");
  });

  it("routes grill heads by slot id, since they carry no island flag", () => {
    const heads = parsed.islands[0].options.filter((o) => o.param === "GRILLS");
    expect(heads).toHaveLength(2);
    expect(heads.every((h) => h.code === "3")).toBe(true);
    expect(parsed.islands[1].options.filter((o) => o.param === "GRILLS")).toHaveLength(0);
  });

  it("routes stainless by the isBar flag", () => {
    const grill = parsed.islands[0].options.filter((o) => o.param === "STAINLESS");
    const bar = parsed.islands[1].options.filter((o) => o.param === "STAINLESS");
    expect(grill.map((o) => o.code)).toEqual(["2", "4"]);
    expect(bar.map((o) => o.code)).toEqual(["4", "4"]);
  });

  it("reads ACCESS_DOORS as flags, not as slot/option pairs", () => {
    // "0,0,0;1,0,0" is "neither island has double doors or warming drawers" —
    // NOT "slot 0 option 0" twice. Getting this wrong invents two options.
    for (const isl of parsed.islands) {
      expect(isl.options.filter((o) => o.param === "ACCESS_DOORS")).toHaveLength(0);
    }
  });

  it("keeps the stool quantity with the stool type", () => {
    const stools = parsed.extras.find((e) => e.param === "STOOLS");
    expect(stools).toMatchObject({ code: "7", qty: 8 });
  });

  it("drops the -1 sentinels and the empty parameters", () => {
    expect(parsed.extras.find((e) => e.param === "SHADE")).toBeUndefined();
    expect(parsed.extras.find((e) => e.param === "PATIOS")).toBeUndefined();
    expect(parsed.extras.find((e) => e.param === "TOP")).toBeUndefined();
  });

  it("decodes with no warnings", () => {
    expect(parsed.warnings).toEqual([]);
  });
});

describe("deriveOrder — FSA #14454 from the configurator link", () => {
  const derived = deriveOrder(parseConfiguratorUrl(FSA_14454_URL));
  const [grill, bar] = derived.islands;

  it("composes the grill island's base and top", () => {
    expect(grill.styleCode).toBe("GX10");
    expect(grill.baseSku).toBe("GX10-D-NN-2-1-1-0-N-N-N-CA");
    expect(grill.topSku).toBe("VOLGX10DNNNNN");
  });

  it("composes the bar island's base and top", () => {
    expect(bar.styleCode).toBe("MA10");
    expect(bar.baseSku).toBe("MA10-N-NN-0-2-0-0-L-Y-Y-CA");
    expect(bar.topSku).toBe("VOLMA10NNNNNN");
  });

  it("counts one access door per occupied grill-head slot", () => {
    // Two cocktail stations sit in the GX10's double hole, so two storage doors
    // — which is what the agreement lists. The bar island has no heads, so none.
    expect(grill.attributes.accessDoors).toBe("2");
    expect(bar.attributes.accessDoors).toBe("0");
  });

  it("counts fridges and drawers from the stainless slots", () => {
    expect(grill.attributes.fridges).toBe("1");
    expect(grill.attributes.drawerTrash).toBe("1");
    expect(bar.attributes.fridges).toBe("2");
    expect(bar.attributes.drawerTrash).toBe("0");
  });

  it("puts audio and LED on the bar island, never on a GX base", () => {
    expect(bar.attributes.audio).toBe("L");
    expect(bar.attributes.led).toBe("Y");
    expect(grill.attributes.audio).toBe("N");
    expect(grill.attributes.led).toBe("N");
  });

  it("flags the foot rail only where one was ordered", () => {
    expect(bar.attributes.footRail).toBe("Y");
    expect(grill.attributes.footRail).toBe("N");
  });

  it("offers the uncut top a 10ft glass would be cut from", () => {
    // VOLGX10BLANK is in stock; the configured top is not a product at all.
    expect(grill.topBlankCandidates).toEqual(["VOLGX10BLANK"]);
    expect(bar.topBlankCandidates).toEqual(["VOLMA10BLANK"]);
  });

  it("produces the items the agreement lists", () => {
    const { lines } = derived;
    expect(qtyOf(lines, "Verano Professional CSL-32 Cocktail Station")).toBe(2);
    expect(qtyOf(lines, 'Verano Stainless Access Door (Large) 17"X24"')).toBe(2);
    expect(qtyOf(lines, "Stainless Double Drawer")).toBe(1);
    expect(qtyOf(lines, "Verano Bar Fridge")).toBe(3); // 1 grill island + 2 bar
    expect(qtyOf(lines, "Bar Rail Footrest Maui 10")).toBe(1);
    expect(qtyOf(lines, '70" TV')).toBe(1);
    expect(qtyOf(lines, "Tatta Stackable Barstool")).toBe(8);
    expect(qtyOf(lines, "Tatta Barstool Cushion - Santorini White")).toBe(8);
  });

  it("explodes the pergola into its kit", () => {
    const { lines } = derived;
    expect(qtyOf(lines, "St. Barth - Espresso")).toBe(1);
    expect(qtyOf(lines, "Single TV Mount")).toBe(1);
    expect(qtyOf(lines, "Monaco Fan with Remote")).toBe(1);
    expect(qtyOf(lines, "St. Barths Electrical Box")).toBe(1);
    expect(lines.filter((l) => l.origin === "COMBO_BOM")).toHaveLength(3);
  });

  it("puts one outlet on each island", () => {
    // An outlet is a real product and belongs on the order; it is kept OFF the
    // pick list by Product.pickable, not by being left out of the decode.
    expect(qtyOf(derived.lines, "Outlet")).toBe(2);
  });

  it("emits exactly one base and one top line per island", () => {
    expect(derived.lines.filter((l) => l.origin === "CONFIG_BASE")).toHaveLength(2);
    expect(derived.lines.filter((l) => l.origin === "CONFIG_TOP")).toHaveLength(2);
  });

  it("derives cleanly, with nothing left unexplained", () => {
    expect(derived.warnings).toEqual([]);
  });
});

describe("mergeLines", () => {
  it("totals identical lines and keeps distinct ones apart", () => {
    const merged = mergeLines([
      { origin: "CONFIG_ITEM", islandIndex: 0, label: "Outlet", sku: null, qty: 1 },
      { origin: "CONFIG_ITEM", islandIndex: 0, label: "Outlet", sku: null, qty: 2 },
      { origin: "CONFIG_ITEM", islandIndex: 1, label: "Outlet", sku: null, qty: 1 },
    ]);
    expect(merged).toHaveLength(2);
    expect(merged[0].qty).toBe(3);
    expect(merged[1].qty).toBe(1);
  });
});
