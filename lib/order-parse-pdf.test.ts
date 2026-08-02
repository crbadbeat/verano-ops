import { describe, it, expect } from "vitest";
import { parseFsaRows, type FsaDocument } from "./order-parse-pdf";
import { deriveOrder } from "./order-derive";
import { parseConfiguratorUrl } from "./order-parse-url";
import { billingDiffersFromDelivery } from "./order-payments";
import { FSA_14454_SKUS, FSA_14454_URL } from "./__fixtures__/fsa-14454-url";
import twoIslands from "./__fixtures__/fsa-two-islands.json";
import accessoriesOnly from "./__fixtures__/fsa-accessories-only.json";

// The fixtures are the positioned text of two real Final Sales Agreements, with
// the customer's name, address, email and phone replaced. They keep the terms
// pages that used to hijack the header fields, so that regression stays covered.
const TWO_ISLANDS = twoIslands as FsaDocument;
const ACCESSORIES = accessoriesOnly as FsaDocument;

const qtyOf = (lines: { label: string; qty: number }[], label: string): number =>
  lines
    .filter((l) => l.label.toLowerCase() === label.toLowerCase())
    .reduce((sum, l) => sum + l.qty, 0);

describe("parseFsaRows — a two-island agreement", () => {
  const parsed = parseFsaRows(TWO_ISLANDS);

  it("reads the order number off the cover page", () => {
    expect(parsed.header.posOrderNo).toBe("14454");
    expect(parsed.header.purchasedAt).toBe("2026-07-20");
  });

  it("reads the gallery and both employee ids", () => {
    expect(parsed.header.gallery).toBe("Testville, FL");
    expect(parsed.header.gtlId).toBe("D-0001");
    expect(parsed.header.repId).toBe("D-0002");
    expect(parsed.header.salesRepName).toBe("Sample Rep");
  });

  it("does not let the terms pages overwrite the customer fields", () => {
    // The boilerplate contains lines beginning "last two pages of the Monaco
    // Packet", "Address verification required prior to delivery" and "state
    // Customers must accept delivery". Without a required colon each of those
    // lands in LAST / Address / STATE.
    expect(parsed.header.customerLast).toBe("Testcustomer");
    expect(parsed.header.customerFirst).toBe("Pat");
    expect(parsed.header.delivery?.address).toBe("2 Test Avenue");
    expect(parsed.header.delivery?.state).toBe("FL");
  });

  it("keeps the billing address apart from the delivery address", () => {
    // This order really was billed to one address and delivered to another,
    // which is what sends it for a manual fraud check.
    expect(parsed.header.billing?.address).toBe("1 Test Street");
    expect(parsed.header.billing?.zip).toBe("00000");
    expect(parsed.header.delivery?.zip).toBe("00001");
    expect(
      billingDiffersFromDelivery(parsed.header.billing ?? {}, parsed.header.delivery ?? {})
    ).toBe(true);
  });

  it("reads the sales totals as integer cents", () => {
    expect(parsed.header.totals).toEqual({
      orderTotalCents: 3_718_900,
      tradeInCreditCents: 0,
      tradeInFeeCents: 0,
      storageFeeCents: 0,
      subtotalCents: 3_718_900,
      salesTaxCents: 228_134,
      freightCents: 139_500,
      totalCents: 4_086_534,
      downPaymentCents: 4_086_534,
      balanceDueCents: 0,
    });
  });

  it("reads the requested delivery timeframe", () => {
    expect(parsed.header.requestedTimeframe).toBe("3-6 WEEKS");
  });

  it("splits the sections into a grill island and a bar island", () => {
    expect(parsed.islands.map((i) => i.role)).toEqual(["GRILL", "BAR"]);
    expect(parsed.islands[0].styleLabel).toBe("GX10");
    expect(parsed.islands[0].grillPosition).toBe("double");
    expect(parsed.islands[1].styleLabel).toBe("MAUI 10");
  });

  it("defaults a bar island with no printed position to no grill head", () => {
    // "MAUI 10" is printed without a parenthetical because the model offers
    // only one arrangement.
    expect(parsed.islands[1].grillPosition).toBe("hide");
  });

  it("picks the foot rail length from the island it is bolted to", () => {
    // Every length is printed as "Professional Stainless Steel Foot Rail";
    // option 6 is the Maui 10 rail.
    const rail = parsed.islands[1].options.find((o) => o.param === "FOOTREST");
    expect(rail?.code).toBe("6");
  });

  it("rejoins an item that wrapped onto a second line", () => {
    // "Stereo Marine Grade Speakers w/LED" + "Lighting" is one option.
    const audio = parsed.extras.find((e) => e.param === "HAPPY" && e.code === "10");
    expect(audio).toBeDefined();
    expect(parsed.items.find((i) => /^Lighting$/i.test(i.label))).toBeUndefined();
  });

  it("lifts stone and siding to the order, without duplicating them", () => {
    // Both are printed under each island but chosen once for the whole order.
    expect(parsed.extras.filter((e) => e.param === "STONE")).toHaveLength(1);
    expect(parsed.extras.filter((e) => e.param === "SIDING")).toHaveLength(1);
  });

  it("takes the stool count from the trailing (8)", () => {
    expect(parsed.extras.find((e) => e.param === "STOOLS")).toMatchObject({
      code: "7",
      qty: 8,
    });
  });

  it("does not turn the quantity column into an item", () => {
    // The configuration's quantity is set vertically centred, so it lands on a
    // row of its own with no item beside it.
    expect(parsed.items).toEqual([]);
  });

  it("parses with nothing left unexplained", () => {
    expect(parsed.warnings).toEqual([]);
  });
});

describe("parseFsaRows — an accessory-only agreement", () => {
  const parsed = parseFsaRows(ACCESSORIES);

  it("reads a flat item list with its quantity", () => {
    expect(parsed.islands).toEqual([]);
    expect(parsed.items).toEqual([
      { label: "Briquettes w/ Flame tamer GSL (1 piece)", qty: 4 },
    ]);
  });

  it("keeps a parenthetical that is part of the name", () => {
    // "(1 piece)" is not a quantity; "(8)" would be.
    expect(parsed.items[0].label).toContain("(1 piece)");
  });

  it("still reads the customer and the totals", () => {
    expect(parsed.header.customerLast).toBe("Testcustomer");
    expect(parsed.header.totals?.totalCents).toBe(47_865);
  });

  it("says so when the short print carries no order number", () => {
    expect(parsed.header.posOrderNo).toBeUndefined();
    expect(parsed.warnings.join(" ")).toMatch(/no order number/i);
  });
});

describe("lines the agreement prints but the warehouse never picks", () => {
  // Built by hand rather than from a fixture: these lines vary by order, and the
  // x coordinates are the only thing that carries structure.
  function agreementWith(items: string[]): FsaDocument {
    let y = 400;
    const rows = [
      { page: 1, y: 470, cells: [{ x: 60, text: "ITEM PURCHASED AND QUANTITY" }] },
      { page: 1, y: 432, cells: [{ x: 68, text: "Item" }, { x: 496, text: "Quantity" }] },
      { page: 1, y: 398, cells: [{ x: 68, text: "OWN CONFIGURATION" }] },
      { page: 1, y: 387, cells: [{ x: 79, text: "Grill Island:" }] },
      { page: 1, y: 375, cells: [{ x: 90, text: "GX10 ( double )" }] },
      ...items.map((text) => ({ page: 1, y: (y -= 12), cells: [{ x: 90, text }] })),
    ];
    return { rows, text: "" };
  }

  it("reads the fuel type onto the order instead of picking it", () => {
    const lp = parseFsaRows(agreementWith(["Fuel type: Liquid Propane"]));
    expect(lp.header.gasType).toBe("LP");
    expect(lp.items).toEqual([]);

    const ng = parseFsaRows(agreementWith(["Fuel type: Natural Gas"]));
    expect(ng.header.gasType).toBe("NG");
    expect(ng.items).toEqual([]);
  });

  it("puts the Verano For Life membership on the header, with its tier", () => {
    const parsed = parseFsaRows(
      agreementWith(["Verano For Life Lifetime Membership - Platinum"])
    );
    expect(parsed.header.veranoForLife).toBe(true);
    expect(parsed.header.veranoForLifeTier).toBe("Platinum");
    expect(parsed.items).toEqual([]);
  });

  it("does not double the outlet the island already supplies", () => {
    // The agreement prints it for the reader; the island's own catalogue entry
    // is what puts it on the order, so the printed line is skipped rather than
    // added a second time.
    const parsed = parseFsaRows(agreementWith(["Outlet", "Outlet/ Switch Combo"]));
    expect(parsed.items).toEqual([]);
    expect(parsed.islands[0].options).toEqual([]);
    expect(parsed.warnings.filter((w) => /outlet/i.test(w))).toEqual([]);

    // ...and it still reaches the order exactly once.
    expect(qtyOf(deriveOrder(parsed).lines, "Outlet")).toBe(1);
  });

  it("still keeps a line it does not recognise", () => {
    // Silence is the failure mode to avoid: an unknown item must surface.
    const parsed = parseFsaRows(agreementWith(["Some Unheard Of Widget"]));
    expect(parsed.items).toEqual([{ label: "Some Unheard Of Widget", qty: 1 }]);
    expect(parsed.warnings.join(" ")).toMatch(/Some Unheard Of Widget/);
  });
});

describe("an item block that runs onto a second page", () => {
  // A long order continues overleaf: the letterhead and the column headers are
  // reprinted, then the configuration carries straight on. Stopping at the page
  // break silently dropped every island on such an order.
  const ACROSS_PAGES: FsaDocument = {
    text: "",
    rows: [
      { page: 2, y: 470, cells: [{ x: 60, text: "ITEM PURCHASED AND QUANTITY" }] },
      { page: 2, y: 432, cells: [{ x: 68, text: "Item" }, { x: 496, text: "Quantity" }] },
      { page: 2, y: 396, cells: [{ x: 68, text: "Professional Bar Sink" }, { x: 514, text: "1" }] },
      { page: 2, y: 394, cells: [{ x: 295, text: "☐" }, { x: 352, text: "☐" }] },
      // --- page break: letterhead, then the headers again ---
      { page: 3, y: 762, cells: [{ x: 474, text: "Verano Direct," }] },
      {
        page: 3,
        y: 753,
        cells: [{ x: 370, text: "640 Ocoee Business Parkway, Suite 80, Ocoee, FL 34761" }],
      },
      { page: 3, y: 744, cells: [{ x: 420, text: "CUSTOMER SERVICE (800) 604-2023" }] },
      { page: 3, y: 736, cells: [{ x: 462, text: "FLORIDA DEPOSIT FSA" }] },
      { page: 3, y: 700, cells: [{ x: 413, text: "Temporary" }] },
      { page: 3, y: 694, cells: [{ x: 68, text: "Item" }, { x: 496, text: "Quantity" }] },
      { page: 3, y: 688, cells: [{ x: 415, text: "Stock List" }] },
      { page: 3, y: 661, cells: [{ x: 68, text: "OWN CONFIGURATION" }] },
      { page: 3, y: 649, cells: [{ x: 79, text: "Grill Island:" }] },
      { page: 3, y: 637, cells: [{ x: 90, text: "GX14 ( double )" }] },
      { page: 3, y: 614, cells: [{ x: 90, text: "CSL-32 Cocktail Station" }] },
      { page: 3, y: 545, cells: [{ x: 90, text: "Ice Maker - Stainless Trim Kit" }] },
      { page: 3, y: 522, cells: [{ x: 90, text: "Milano: Calce" }] },
      { page: 3, y: 510, cells: [{ x: 90, text: "Titanium" }] },
      { page: 3, y: 499, cells: [{ x: 79, text: "Bar Island:" }] },
      { page: 3, y: 487, cells: [{ x: 90, text: "MAUI 12 ( center )" }] },
      // The Temporary Stock List column, alongside no item at all.
      { page: 3, y: 481, cells: [{ x: 419, text: "specialty" }, { x: 514, text: "1" }] },
      { page: 3, y: 476, cells: [{ x: 90, text: "HSL-32 HIBACHI" }] },
      { page: 3, y: 360, cells: [{ x: 79, text: "Happy Hours:" }] },
      { page: 3, y: 337, cells: [{ x: 90, text: "Stereo Marine Grade Speakers w/LED" }] },
      { page: 3, y: 325, cells: [{ x: 90, text: "Lighting (2)" }] },
      { page: 3, y: 302, cells: [{ x: 79, text: "Fuel type: Natural Gas" }] },
      { page: 3, y: 267, cells: [{ x: 60, text: "Verano for Life" }] },
      { page: 3, y: 210, cells: [{ x: 60, text: "REQUESTED DELIVERY TIMEFRAME" }] },
    ],
  };

  const parsed = parseFsaRows(ACROSS_PAGES);

  it("keeps reading past the page break", () => {
    expect(parsed.islands.map((i) => i.styleLabel)).toEqual(["GX14", "MAUI 12"]);
    expect(parsed.islands[0].grillPosition).toBe("double");
    expect(parsed.islands[1].grillPosition).toBe("center");
  });

  it("keeps the item from before the break", () => {
    const sink = parsed.islands.flatMap((i) => i.options).find((o) => o.param === "TOP");
    expect(sink ?? parsed.items.find((i) => /bar sink/i.test(i.label))).toBeDefined();
  });

  it("does not take the reprinted letterhead for items", () => {
    const all = [...parsed.items.map((i) => i.label), ...parsed.warnings].join(" ");
    expect(all).not.toMatch(/Verano Direct/);
    expect(all).not.toMatch(/Ocoee Business Parkway/);
    expect(all).not.toMatch(/CUSTOMER SERVICE/);
  });

  it("reads the Temporary Stock List column as a column, not an item", () => {
    expect(parsed.items.find((i) => i.label === "specialty")).toBeUndefined();
    expect(parsed.warnings.join(" ")).toMatch(/Temporary Stock List column says "specialty"/);
  });

  it("matches an option the agreement words differently", () => {
    // "HSL-32 HIBACHI" for "HSL-32 Hibachi Griddle Station", and the agreement
    // writes "- Stainless Trim Kit" where the configurator writes "+".
    const grill = parsed.islands[0].options;
    expect(grill.find((o) => o.param === "GRILLS" && o.code === "3")).toBeDefined();
    expect(grill.find((o) => o.param === "STAINLESS" && o.code === "7")).toBeDefined();
    expect(parsed.islands[1].options.find((o) => o.param === "GRILLS" && o.code === "2")).toBeDefined();
  });

  it("rejoins a wrapped item whose quantity sits on the second line", () => {
    // "Stereo Marine Grade Speakers w/LED" + "Lighting (2)" is one option, ×2.
    expect(parsed.extras.find((e) => e.param === "HAPPY" && e.code === "10")).toMatchObject({
      qty: 2,
    });
    expect(parsed.items.find((i) => /^Lighting/i.test(i.label))).toBeUndefined();
  });

  it("reads the fuel type printed at the end of the block", () => {
    expect(parsed.header.gasType).toBe("NG");
  });
});

describe("the fuel type reaches the gas appliances", () => {
  function withGrill(gas: string | null) {
    const parsed = parseFsaRows(TWO_ISLANDS);
    // The reference order has cocktail stations; swap one for a real grill so a
    // {GAS} line is produced.
    parsed.islands[0].options = [{ param: "GRILLS", code: "1" }];
    if (gas) parsed.header.gasType = gas as "LP" | "NG";
    return deriveOrder(parsed);
  }

  it("picks the LP or NG variant of the grill", () => {
    expect(withGrill("LP").lines.some((l) => l.label === "GSL-32 Pro LP 4B")).toBe(true);
    expect(withGrill("NG").lines.some((l) => l.label === "GSL-32 Pro NG 4B")).toBe(true);
  });

  it("says so when no fuel type was stated rather than silently guessing", () => {
    const derived = withGrill(null);
    expect(derived.warnings.join(" ")).toMatch(/no fuel type/i);
  });

  it("stays quiet when nothing on the order burns gas", () => {
    // The reference order is two cocktail stations and no burner.
    expect(deriveOrder(parseFsaRows(TWO_ISLANDS)).warnings).toEqual([]);
  });
});

describe("the PDF and the configurator link describe the same order", () => {
  const fromPdf = deriveOrder(parseFsaRows(TWO_ISLANDS));
  const fromUrl = deriveOrder(parseConfiguratorUrl(FSA_14454_URL));

  it("composes the same four SKUs from either input", () => {
    const skus = (d: typeof fromPdf) => ({
      grillBase: d.islands[0].baseSku,
      grillTop: d.islands[0].topSku,
      barBase: d.islands[1].baseSku,
      barTop: d.islands[1].topSku,
    });
    expect(skus(fromPdf)).toEqual(FSA_14454_SKUS);
    expect(skus(fromUrl)).toEqual(FSA_14454_SKUS);
  });

  it("derives the same island configuration from either input", () => {
    for (const [i, island] of fromPdf.islands.entries()) {
      expect(island.attributes).toEqual(fromUrl.islands[i].attributes);
    }
  });

  it("produces the same pickable lines from either input", () => {
    const sig = (d: typeof fromPdf) =>
      d.lines
        .map((l) => `${l.origin}|${l.islandIndex ?? ""}|${l.sku ?? l.label}|${l.qty}`)
        .sort();
    expect(sig(fromPdf)).toEqual(sig(fromUrl));
  });

  it("derives cleanly from the PDF", () => {
    expect(fromPdf.warnings).toEqual([]);
  });
});
