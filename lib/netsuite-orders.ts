// -----------------------------------------------------------------------------
// Pure mapping layer for the NetSuite order pull. Turns raw SuiteQL `transaction`
// + `transactionline` rows into a normalized order shape the importer can upsert.
// No DB, no network — unit-tested in isolation (Vitest can't import anything that
// reaches Prisma). Product resolution (item id -> Product) and cost live in the
// importer, not here.
//
// Shape learned from Phase-0 discovery (see the netsuite-orders-sync memo):
//   * A sales order's real customer order is `type='SalesOrd'`, `intercompany='F'`.
//   * `subsidiary` lives on the LINES, not the header (OneWorld) — 3=PGI, 2=PGD.
//   * ONE top-level Assembly carries the price; the other top-level lines are the
//     $0 bundled components = the pick list. Deep BOM lines carry `kitmemberof`
//     and must be skipped. `ShipItem` = freight, `TaxItem` = sales tax.
//   * Quantities/amounts are stored NEGATIVE (GL sign) — take the absolute value.
// -----------------------------------------------------------------------------

export type NsRow = Record<string, unknown>;

export type Division = "PGI" | "PGD";

/** NetSuite subsidiary internal id -> WMS division. Unknown -> null (skip). */
export const SUBSIDIARY_DIVISION: Record<string, Division> = {
  "3": "PGI",
  "2": "PGD",
};

export type OrderLineKind = "ITEM" | "FREIGHT" | "TAX";

export interface NetsuiteOrderLine {
  netsuiteLineId: string; // stable per-line key (uniquekey), for idempotent upsert
  itemId: string; // transactionline.item internal id -> Product.netsuiteNumber
  itemType: string; // Assembly | InvtPart | NonInvtPart | Kit | ShipItem | TaxItem
  qty: number; // absolute
  rateCents: number | null;
  amountCents: number | null; // absolute netamount
  memo: string | null;
  kind: OrderLineKind;
}

export interface NetsuiteOrder {
  netsuiteTransactionId: string; // transaction.id — the unique idempotency anchor
  tranid: string; // "SO48924" — becomes the WMS orderNo
  division: Division;
  subsidiaryId: string;
  entityId: string | null; // customer internal id
  trandate: string | null;
  lastModified: string | null; // lastmodifieddate — incremental watermark
  status: string | null; // A=Pending Approval, B=Pending Fulfillment, ...
  intercompany: boolean;
  totalCents: number | null;
  freightCents: number | null;
  salesTaxCents: number | null;
  depositReceivedCents: number | null; // custbody_total_deposit_paid — deposit toward this order
  employeeId: string | null; // sales rep (present on PGD, often absent on PGI)
  salesCenterId: string | null; // cseg_sales_center — selling showroom -> gallery
  salesRep1Id: string | null; // custbody_pg_sales_rep_1
  salesRep2Id: string | null; // custbody_pg_sales_rep_2
  gtlId: string | null; // custbody_pg_gtl
  vpId: string | null; // custbody_pg_vp
  regionalId: string | null; // custbody_pg_regional
  shipAddressText: string | null; // formatted delivery address (ready to store)
  billAddressText: string | null; // formatted billing address
  billingAddressId: string | null;
  shippingAddressId: string | null;
  fraudMismatch: boolean; // billing address id !== shipping address id
  itemLines: NetsuiteOrderLine[]; // pickable products only
}

function str(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

// US state full-name -> 2-letter, for parsing a NetSuite ship address whose
// city/state/zip line may spell the state out ("Boynton Beach Florida 33473").
const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL",
  indiana: "IN", iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA",
  maine: "ME", maryland: "MD", massachusetts: "MA", michigan: "MI", minnesota: "MN",
  mississippi: "MS", missouri: "MO", montana: "MT", nebraska: "NE", nevada: "NV",
  "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
  "north carolina": "NC", "north dakota": "ND", ohio: "OH", oklahoma: "OK",
  oregon: "OR", pennsylvania: "PA", "rhode island": "RI", "south carolina": "SC",
  "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT", vermont: "VT",
  virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI", wyoming: "WY",
};

export interface ParsedShipAddress {
  address: string | null; // street line(s)
  city: string | null;
  state: string | null; // 2-letter
  zip: string | null;
  raw: string | null; // the full original text (nothing is lost)
}

/**
 * Parse a NetSuite formatted ship address into street / city / state / zip.
 * Real formats vary: an optional name line, then street, then a
 * "City STATE ZIP" line (state may be 2-letter, any case, or spelled out), then
 * a country line. Best-effort — the review queue lets a human correct it, and
 * `raw` always carries the original.
 */
export function parseShipAddress(text: string | null | undefined): ParsedShipAddress {
  const raw = str(text) || null;
  const empty: ParsedShipAddress = { address: null, city: null, state: null, zip: null, raw };
  if (!raw) return empty;

  const lines = raw.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  while (lines.length && /^(united states|usa|u\.?s\.?a\.?|u\.?s\.?|canada)$/i.test(lines[lines.length - 1])) {
    lines.pop();
  }
  if (lines.length === 0) return empty;

  const csz = lines.pop()!;
  let streetLines = lines;
  // Drop a leading name-only line (no digits) when real street content follows.
  if (streetLines.length > 1 && !/\d/.test(streetLines[0])) streetLines = streetLines.slice(1);
  const address = streetLines.join(", ") || null;

  const zipM = csz.match(/(\d{5})(?:-\d{4})?\s*$/);
  const zip = zipM ? zipM[1] : null;
  const rest = (zipM ? csz.slice(0, zipM.index).trim() : csz).replace(/[,\s]+$/, "");

  let state: string | null = null;
  let city: string | null = rest || null;
  const lower = rest.toLowerCase();
  const fullName = Object.keys(US_STATES).find((n) => lower.endsWith(n) && (lower.length === n.length || /[\s,]/.test(lower[lower.length - n.length - 1])));
  if (fullName) {
    state = US_STATES[fullName];
    city = rest.slice(0, rest.length - fullName.length).replace(/[,\s]+$/, "").trim() || null;
  } else {
    const twoM = rest.match(/^(.*?)[,\s]+([A-Za-z]{2})$/);
    if (twoM) {
      state = twoM[2].toUpperCase();
      city = twoM[1].trim() || null;
    }
  }

  return { address, city, state, zip, raw };
}

function orNull(v: unknown): string | null {
  const s = str(v);
  return s === "" ? null : s;
}

/** Absolute integer cents from a NetSuite dollar amount (which may be negative). */
export function absCents(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.abs(n) * 100);
}

/** Absolute quantity (NetSuite stores sales quantities negative). */
export function absQty(v: unknown): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[,\s]/g, ""));
  return Number.isFinite(n) ? Math.abs(n) : 0;
}

const FREIGHT_TYPES = new Set(["ShipItem"]);
const TAX_TYPES = new Set(["TaxItem"]);
// Item types the WMS treats as pickable products.
const PICK_TYPES = new Set(["Assembly", "InvtPart", "NonInvtPart", "Kit", "Group"]);

/**
 * Map one `transactionline` row. Returns null for lines the WMS ignores:
 * the mainline (header summary), BOM component lines (`kitmemberof` set), and
 * anything that isn't a pickable product / freight / tax (discounts, subtotals).
 */
export function mapOrderLine(row: NsRow): NetsuiteOrderLine | null {
  if (str(row.mainline) === "T") return null;
  if (str(row.kitmemberof) !== "") return null; // deep BOM explosion — skip
  const itemType = str(row.itemtype);
  const itemId = str(row.item);

  let kind: OrderLineKind;
  if (TAX_TYPES.has(itemType) || str(row.taxline) === "T") kind = "TAX";
  else if (FREIGHT_TYPES.has(itemType)) kind = "FREIGHT";
  else if (PICK_TYPES.has(itemType) && itemId !== "") kind = "ITEM";
  else return null;

  return {
    netsuiteLineId: str(row.uniquekey) || str(row.id),
    itemId,
    itemType,
    qty: absQty(row.quantity),
    rateCents: absCents(row.rate),
    amountCents: absCents(row.netamount),
    memo: orNull(row.memo),
    kind,
  };
}

/** Sum a set of line amounts (amountCents, falling back to rateCents), or null. */
function sumLineCents(lines: NetsuiteOrderLine[]): number | null {
  if (lines.length === 0) return null;
  let total = 0;
  for (const l of lines) total += l.amountCents ?? l.rateCents ?? 0;
  return total;
}

/**
 * Assemble a normalized order from a `transaction` header row and its
 * `transactionline` rows. Returns null if the header has no id, or if the lines'
 * subsidiary is not a division we sync. `subsidiary` is read from the lines
 * (it is not on the header in OneWorld).
 */
export function mapNetsuiteOrder(header: NsRow, lineRows: NsRow[]): NetsuiteOrder | null {
  const netsuiteTransactionId = str(header.id) || str(header.internalid);
  if (!netsuiteTransactionId) return null;

  // subsidiary comes off the lines; take the first non-empty one.
  let subsidiaryId = "";
  for (const r of lineRows) {
    const s = str(r.subsidiary);
    if (s !== "") {
      subsidiaryId = s;
      break;
    }
  }
  const division = SUBSIDIARY_DIVISION[subsidiaryId];
  if (!division) return null;

  const mapped: NetsuiteOrderLine[] = [];
  for (const r of lineRows) {
    const m = mapOrderLine(r);
    if (m) mapped.push(m);
  }
  const itemLines = mapped.filter((l) => l.kind === "ITEM");
  const freightCents = sumLineCents(mapped.filter((l) => l.kind === "FREIGHT"));
  const salesTaxCents = sumLineCents(mapped.filter((l) => l.kind === "TAX"));

  const billingAddressId = orNull(header.billingaddress);
  const shippingAddressId = orNull(header.shippingaddress);

  return {
    netsuiteTransactionId,
    tranid: str(header.tranid) || netsuiteTransactionId,
    division,
    subsidiaryId,
    entityId: orNull(header.entity),
    trandate: orNull(header.trandate),
    lastModified: orNull(header.lastmodifieddate),
    status: orNull(header.status),
    intercompany: str(header.intercompany) === "T",
    totalCents: absCents(header.total) ?? absCents(header.foreigntotal),
    freightCents,
    salesTaxCents,
    depositReceivedCents: absCents(header.custbody_total_deposit_paid),
    employeeId: orNull(header.employee),
    salesCenterId: orNull(header.cseg_sales_center) || orNull(header.custbody_header_sales_center_select),
    salesRep1Id: orNull(header.custbody_pg_sales_rep_1),
    salesRep2Id: orNull(header.custbody_pg_sales_rep_2),
    gtlId: orNull(header.custbody_pg_gtl),
    vpId: orNull(header.custbody_pg_vp),
    regionalId: orNull(header.custbody_pg_regional),
    shipAddressText: orNull(header.shipaddress),
    billAddressText: orNull(header.billaddress),
    billingAddressId,
    shippingAddressId,
    fraudMismatch: !!billingAddressId && !!shippingAddressId && billingAddressId !== shippingAddressId,
    itemLines,
  };
}
