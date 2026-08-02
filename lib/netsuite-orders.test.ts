import { describe, it, expect } from "vitest";
import {
  absCents,
  absQty,
  mapOrderLine,
  mapNetsuiteOrder,
  parseShipAddress,
  SUBSIDIARY_DIVISION,
  type NsRow,
} from "./netsuite-orders";

describe("absCents / absQty (NetSuite stores sale amounts negative)", () => {
  it("takes the absolute value into integer cents", () => {
    expect(absCents("-55743.5")).toBe(5574350);
    expect(absCents(-928.96)).toBe(92896);
    expect(absCents("$1,234.50")).toBe(123450);
    expect(absCents(0)).toBe(0);
    expect(absCents("")).toBeNull();
    expect(absCents(null)).toBeNull();
  });
  it("absQty normalizes the negative quantity", () => {
    expect(absQty("-1")).toBe(1);
    expect(absQty("-55.56")).toBe(55.56);
    expect(absQty(null)).toBe(0);
  });
});

describe("parseShipAddress (formats vary — lowercase/spelled-out state, optional name line)", () => {
  it("parses street + lowercase 2-letter state + zip, dropping the country line", () => {
    expect(parseShipAddress("123 Main St\nwayne pa 19087\nUnited States")).toMatchObject({
      address: "123 Main St",
      city: "wayne",
      state: "PA",
      zip: "19087",
    });
  });

  it("resolves a spelled-out state name", () => {
    expect(parseShipAddress("9 Oak Ave\nBoynton Beach Florida 33473\nUnited States")).toMatchObject({
      address: "9 Oak Ave",
      city: "Boynton Beach",
      state: "FL",
      zip: "33473",
    });
  });

  it("drops a leading name line when real street content follows", () => {
    expect(parseShipAddress("Buyer Name\n15 Copper Beech Rd\nSalem NH 03079\nUnited States")).toMatchObject({
      address: "15 Copper Beech Rd",
      city: "Salem",
      state: "NH",
      zip: "03079",
    });
  });

  it("works without a country line and keeps the raw text", () => {
    const p = parseShipAddress("PO Box 5\nAustin TX 78701");
    expect(p).toMatchObject({ address: "PO Box 5", city: "Austin", state: "TX", zip: "78701" });
    expect(p.raw).toBe("PO Box 5\nAustin TX 78701");
  });

  it("returns all-null (raw null) for empty input", () => {
    expect(parseShipAddress("")).toEqual({ address: null, city: null, state: null, zip: null, raw: null });
    expect(parseShipAddress(null)).toEqual({ address: null, city: null, state: null, zip: null, raw: null });
  });
});

describe("mapOrderLine", () => {
  const base: NsRow = { transaction: "999", subsidiary: "3", itemtype: "InvtPart", item: "387" };

  it("keeps a pickable product line and abs-normalizes qty/amount", () => {
    expect(mapOrderLine({ ...base, uniquekey: "L1", quantity: "-2", rate: "-10", netamount: "-20" })).toEqual({
      netsuiteLineId: "L1",
      itemId: "387",
      itemType: "InvtPart",
      qty: 2,
      rateCents: 1000,
      amountCents: 2000,
      memo: null,
      kind: "ITEM",
    });
  });

  it("classifies a ShipItem as FREIGHT and a TaxItem as TAX", () => {
    expect(mapOrderLine({ ...base, uniquekey: "S", itemtype: "ShipItem", item: "2471", netamount: "-2590" })?.kind).toBe("FREIGHT");
    expect(mapOrderLine({ ...base, uniquekey: "T", itemtype: "TaxItem", item: "3390", taxline: "T", netamount: "-928.96" })?.kind).toBe("TAX");
  });

  it("skips the mainline, BOM component lines, and non-item lines", () => {
    expect(mapOrderLine({ ...base, mainline: "T" })).toBeNull(); // header summary
    expect(mapOrderLine({ ...base, kitmemberof: "1" })).toBeNull(); // deep BOM explosion
    expect(mapOrderLine({ ...base, itemtype: "Discount", item: "" })).toBeNull();
  });
});

describe("mapNetsuiteOrder", () => {
  // A synthetic order mirroring the discovered shape (no real PII):
  //  - mainline header line
  //  - a priced top-level Assembly (the base)
  //  - a $0 bundled component (top-level)
  //  - a BOM component (kitmemberof set -> skipped)
  //  - freight + tax lines
  const header: NsRow = {
    id: "587722",
    tranid: "SO48924",
    entity: "36080",
    trandate: "1/9/2026",
    lastmodifieddate: "1/14/2026",
    status: "B",
    total: "-58333.5",
    employee: "4554",
    cseg_sales_center: "39",
    shipaddress: "Buyer Name\n1 Main St\nTown NH 03079\nUnited States",
    billingaddress: "159935",
    shippingaddress: "159935",
    intercompany: "F",
  };
  const lines: NsRow[] = [
    { transaction: "587722", subsidiary: "3", mainline: "T", itemtype: "" },
    { transaction: "587722", subsidiary: "3", uniquekey: "A", itemtype: "Assembly", item: "1541", quantity: "-1", rate: "-55743.5", netamount: "-55743.5" },
    { transaction: "587722", subsidiary: "3", uniquekey: "B", itemtype: "InvtPart", item: "387", quantity: "-1", rate: "0", netamount: "0" },
    { transaction: "587722", subsidiary: "3", uniquekey: "C", itemtype: "InvtPart", item: "324", quantity: "-16225", kitmemberof: "1" }, // raw BOM -> skip
    { transaction: "587722", subsidiary: "3", uniquekey: "S", itemtype: "ShipItem", item: "2471", quantity: "-1", netamount: "-2590" },
    { transaction: "587722", subsidiary: "3", uniquekey: "T", itemtype: "TaxItem", item: "3390", taxline: "T", quantity: "-1", netamount: "-928.96" },
  ];

  it("assembles the normalized order, splitting item / freight / tax", () => {
    const o = mapNetsuiteOrder(header, lines)!;
    expect(o.netsuiteTransactionId).toBe("587722");
    expect(o.tranid).toBe("SO48924");
    expect(o.division).toBe("PGI"); // subsidiary 3, read from the lines
    expect(o.entityId).toBe("36080");
    expect(o.intercompany).toBe(false);
    expect(o.totalCents).toBe(5833350);
    expect(o.freightCents).toBe(259000);
    expect(o.salesTaxCents).toBe(92896);
    expect(o.employeeId).toBe("4554");
    expect(o.salesCenterId).toBe("39");
    expect(o.shipAddressText).toContain("1 Main St");
    // Only the two top-level pickable products survive as itemLines.
    expect(o.itemLines.map((l) => l.itemId)).toEqual(["1541", "387"]);
  });

  it("flags a fraud mismatch when billing != shipping address id", () => {
    const same = mapNetsuiteOrder(header, lines)!;
    expect(same.fraudMismatch).toBe(false);
    const diff = mapNetsuiteOrder({ ...header, shippingaddress: "160080" }, lines)!;
    expect(diff.fraudMismatch).toBe(true);
  });

  it("maps subsidiary 2 to PGD", () => {
    const pgdLines = lines.map((l) => ({ ...l, subsidiary: "2" }));
    expect(mapNetsuiteOrder(header, pgdLines)!.division).toBe("PGD");
  });

  it("returns null for a header with no id or an unsynced subsidiary", () => {
    expect(mapNetsuiteOrder({ ...header, id: "" }, lines)).toBeNull();
    const otherSub = lines.map((l) => ({ ...l, subsidiary: "1" })); // Consolidation
    expect(mapNetsuiteOrder(header, otherSub)).toBeNull();
  });

  it("subsidiary map is limited to PGI/PGD", () => {
    expect(SUBSIDIARY_DIVISION).toEqual({ "3": "PGI", "2": "PGD" });
  });
});
