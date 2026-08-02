// Read a signed Final Sales Agreement into a ParsedOrder.
//
// The agreement is the product owner's first-choice input: it exists for every
// order (a configurator link does not), it carries the customer, the money and
// the order number, and it is what an addendum re-issues.
//
// Extraction is POSITIONAL, not line-based. `pdftotext`-style flattening mangles
// this document — the "Temporary / Stock List" column header collapses onto the
// first item row, and a long item wraps into what looks like a second item. The
// x coordinate is what actually carries the meaning, and it is very consistent:
//
//   x < 74    top level: "OWN CONFIGURATION", or an item on an accessory-only
//             agreement ("Briquettes w/ Flame tamer GSL (1 piece)")
//   74..86    a section heading: "Grill Island:", "Bar Island:", "Combo:",
//             "Happy Hours:"
//   x >= 86   an item inside the current section
//   x >= 470  the Quantity column
//
// `extractFsaRows` does the I/O; `parseFsaRows` is pure, so the whole parse is
// unit-testable from a handful of literal rows.

import {
  CONFIGURATOR_CATALOGUE,
  DEFAULT_BAR_POSITION,
  DEFAULT_GRILL_POSITION,
  FOOTREST_OPTION_BY_STYLE,
  findOptionByLabel,
  type CatalogueOption,
  type ConfigParam,
} from "./configurator-catalogue";
import type {
  ParsedIsland,
  ParsedOption,
  ParsedOrder,
  ParsedOrderHeader,
  ParsedTotals,
} from "./order-derive";

export interface FsaCell {
  x: number;
  text: string;
}

export interface FsaRow {
  page: number;
  y: number;
  cells: FsaCell[];
}

export interface FsaDocument {
  rows: FsaRow[];
  /** A stable flattening, stored on OrderDocument so addendums can be diffed. */
  text: string;
}

// ---- extraction -------------------------------------------------------------

/** Pull positioned text out of a PDF. Node/serverless safe (no canvas). */
export async function extractFsaRows(data: Uint8Array): Promise<FsaDocument> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(data);
  const rows: FsaRow[] = [];

  for (let page = 1; page <= pdf.numPages; page++) {
    const content = await (await pdf.getPage(page)).getTextContent();
    const byY = new Map<number, FsaCell[]>();
    for (const item of content.items as { str: string; transform: number[] }[]) {
      if (!item.str || !item.str.trim()) continue;
      const y = Math.round(item.transform[5]);
      const cell = { x: Math.round(item.transform[4]), text: item.str.trim() };
      const existing = byY.get(y);
      if (existing) existing.push(cell);
      else byY.set(y, [cell]);
    }
    for (const [y, cells] of [...byY.entries()].sort((a, b) => b[0] - a[0])) {
      rows.push({ page, y, cells: cells.sort((a, b) => a.x - b.x) });
    }
  }

  const text = rows.map((r) => r.cells.map((c) => c.text).join("\t")).join("\n");
  return { rows, text };
}

// ---- small helpers ----------------------------------------------------------

const CHECKBOX = /^[☐☑☒□■✓✔xX]$/;

/** A checked "As is" / "Cash & Carry" / "Temporary Stock List" box. */
const CHECKED = /^[☑☒✓✔xX]$/;

const COLUMN_HEADINGS = [
  "item",
  "as is",
  "cash & carry",
  "temporary",
  "stock list",
  "quantity",
  "own configuration",
  "item purchased and quantity",
];

/**
 * The letterhead, which reappears at the top of every page — including a
 * continuation of the item block. It sits in the same x range as the marker
 * columns, so it has to be recognised by its text.
 */
const PAGE_FURNITURE = [
  /^Verano Direct,?$/i,
  /Ocoee Business Parkway/i,
  /^CUSTOMER SERVICE/i,
  /DEPOSIT FSA$/i,
];

const isPageFurniture = (text: string): boolean =>
  PAGE_FURNITURE.some((re) => re.test(text));

/** Right edge of the Item column. Past this are the marker columns. */
const ITEM_COLUMN_MAX_X = 280;
/** Left edge of the Temporary Stock List column. */
const STOCK_LIST_COLUMN_MIN_X = 400;
/** Left edge of the Quantity column. */
const QTY_COLUMN_MIN_X = 470;

/**
 * Where the item block stops.
 *
 * It does NOT stop at a page break — a long order runs onto a second page,
 * which repeats the letterhead and the column headers and then carries straight
 * on with the configuration. Stopping at the page boundary silently dropped
 * every island on such an order.
 *
 * Note the exact anchor on "Verano for Life": that is the footer, whereas
 * "Verano For Life Lifetime Membership" is an item and must not end the block.
 */
const END_OF_ITEMS = [
  /^REQUESTED DELIVERY TIMEFRAME$/i,
  /^Verano for Life$/i,
  /^Customer is not purchasing/i,
  /TERMS & CONDITIONS/i,
  /^FINAL SALES? AGREEMENT/i,
];

/**
 * Read "LABEL: value". The colon is REQUIRED — the terms pages are full of
 * prose that starts with these words ("last two pages of the Monaco Packet",
 * "Address verification required prior to delivery", "state Customers must
 * accept delivery"), and without the colon each one overwrites a real field.
 */
function afterLabel(text: string, label: string): string | null {
  const m = text.match(new RegExp(`^${label}\\s*:\\s*(.*)$`, "i"));
  if (!m) return null;
  const v = m[1].trim();
  return v === "" ? null : v;
}

function moneyToCents(text: string): number | undefined {
  const m = text.replace(/,/g, "").match(/-?\$?\s*(-?\d+(?:\.\d{1,2})?)/);
  if (!m) return undefined;
  return Math.round(Number(m[1]) * 100);
}

/** MM/DD/YY or MM/DD/YYYY -> ISO yyyy-MM-dd. */
function toIsoDate(text: string): string | undefined {
  const m = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (!m) return undefined;
  const [, mm, dd, yy] = m;
  const year = yy.length === 2 ? 2000 + Number(yy) : Number(yy);
  return `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

// ---- header -----------------------------------------------------------------

const TOTAL_FIELDS: [RegExp, keyof ParsedTotals][] = [
  [/^order total$/i, "orderTotalCents"],
  [/^pfl trade-in credit$/i, "tradeInCreditCents"],
  [/^pfl trade-in fee$/i, "tradeInFeeCents"],
  [/^storage fee$/i, "storageFeeCents"],
  [/^subtotal$/i, "subtotalCents"],
  [/^sales tax$/i, "salesTaxCents"],
  [/^delivery\/freight$/i, "freightCents"],
  [/^total purchase price$/i, "totalCents"],
  [/^down payment$/i, "downPaymentCents"],
  [/^balance due$/i, "balanceDueCents"],
];

function parseHeader(
  rows: FsaRow[],
  itemPage: number,
  warnings: string[]
): ParsedOrderHeader {
  const header: ParsedOrderHeader = {};
  const totals: ParsedTotals = {};
  let addressTarget: "billing" | "delivery" | null = null;

  for (const [index, row] of rows.entries()) {
    // Customer details live on the pages up to and including the item block;
    // everything after is boilerplate terms, the signature and the totals.
    const inCustomerBlock = row.page <= itemPage;
    for (const cell of row.cells) {
      const t = cell.text;

      const orderNo = t.match(/^ORDER\s*#\s*([A-Za-z0-9-]+)/i);
      if (orderNo && !header.posOrderNo) header.posOrderNo = orderNo[1];

      // The cover page stamps "07/20/26 03:39 PM (EDT)" — the moment of sale.
      if (!header.purchasedAt && /\d{1,2}:\d{2}\s*(AM|PM)/i.test(t)) {
        header.purchasedAt = toIsoDate(t);
      }

      if (inCustomerBlock) {
        const gallery = afterLabel(t, "Gallery");
        if (gallery) header.gallery = gallery;
        const gtl = afterLabel(t, "GTL ID");
        if (gtl) header.gtlId = gtl;
        const rep = afterLabel(t, "REP ID");
        if (rep) header.repId = rep;

        const last = afterLabel(t, "LAST");
        if (last) header.customerLast = last;
        const first = afterLabel(t, "FIRST");
        if (first) header.customerFirst = first;
        const email = afterLabel(t, "EMAIL");
        if (email) header.email = email;
        const phone = afterLabel(t, "PHONE");
        if (phone) header.phone = phone;
        const cell2 = afterLabel(t, "CELL");
        if (cell2) header.cell = cell2;

        if (/^BILLING ADDRESS/i.test(t)) addressTarget = "billing";
        else if (/^DELIVERY ADDRESS/i.test(t)) addressTarget = "delivery";

        if (addressTarget) {
          const bucket = (header[addressTarget] ??= {});
          const address = afterLabel(t, "Address");
          if (address) bucket.address = address;
          const city = afterLabel(t, "CITY");
          if (city) bucket.city = city;
          const state = afterLabel(t, "STATE");
          if (state) bucket.state = state;
          const zip = afterLabel(t, "ZIP");
          if (zip) bucket.zip = zip;
        }
      }

      // "REQUESTED DELIVERY TIMEFRAME" then, a row or two later, "3-6 WEEKS".
      if (/^REQUESTED DELIVERY TIMEFRAME$/i.test(t)) {
        const next = rows.slice(index + 1, index + 4).find((r) =>
          /\d\s*-\s*\d+\s*(WEEK|DAY|MONTH)/i.test(r.cells[0]?.text ?? "")
        );
        if (next) header.requestedTimeframe = next.cells[0].text;
      }

      // The rep's name sits under a "Sales rep" label, roughly beneath it.
      if (/^Sales rep$/i.test(t) && !header.salesRepName) {
        const below = rows
          .slice(index + 1, index + 8)
          .flatMap((r) => r.cells)
          .find((c) => Math.abs(c.x - cell.x) < 40 && /^[A-Za-z][A-Za-z.'\- ]+$/.test(c.text));
        if (below) header.salesRepName = below.text;
      }

      for (const [re, key] of TOTAL_FIELDS) {
        if (!re.test(t)) continue;
        const value = row.cells.find((c) => c.x > cell.x && /\$|\d/.test(c.text));
        if (value) totals[key] = moneyToCents(value.text);
      }
    }
  }

  if (Object.keys(totals).length) header.totals = totals;
  if (!header.posOrderNo) {
    warnings.push(
      "No order number on this agreement — the short print does not carry one. Enter it before saving."
    );
  }
  return header;
}

// ---- items ------------------------------------------------------------------

interface RawItem {
  label: string;
  qty: number | null;
}

/** Which catalogue params an item under this heading is allowed to resolve to. */
function paramsForSection(heading: string): ConfigParam[] {
  const h = heading.toLowerCase();
  if (h.startsWith("combo")) return ["COMBO"];
  if (h.startsWith("happy")) return ["HAPPY"];
  if (h.startsWith("shade") || h.startsWith("umbrella")) return ["SHADE"];
  if (h.startsWith("patio")) return ["PATIOS"];
  return ["GRILLS", "STAINLESS", "TOP", "FOOTREST", "ACCESS_DOORS", "STONE", "SIDING"];
}

/**
 * Rejoin an item that wrapped onto a second line. Tried longest-first: if a line
 * plus the one after it names something in the catalogue, that is the item.
 * ("Stereo Marine Grade Speakers w/LED" + "Lighting" is one option, not two.)
 */
function healWrappedItems(
  items: RawItem[],
  params: ConfigParam[],
  catalogue: CatalogueOption[]
): RawItem[] {
  const out: RawItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const joined = `${items[i].label} ${items[i + 1]?.label ?? ""}`.trim();
    if (
      items[i + 1] &&
      findOptionByLabel(catalogue, joined, params) &&
      !findOptionByLabel(catalogue, items[i + 1].label, params)
    ) {
      out.push({ label: joined, qty: items[i].qty ?? items[i + 1].qty });
      i++;
      continue;
    }
    out.push(items[i]);
  }
  return out;
}

/** A trailing bare "(8)" is a quantity; "(1 piece)" is part of the name. */
function splitTrailingQty(label: string): { label: string; qty: number | null } {
  const m = label.match(/^(.*?)\s*\((\d+)\)\s*$/);
  if (!m) return { label, qty: null };
  return { label: m[1].trim(), qty: Number(m[2]) };
}

/** "GX10 ( double )" -> style "GX10", position "double". */
function splitStyleLine(label: string): { style: string; position: string | null } {
  const m = label.match(/^(.*?)\s*\(\s*([A-Za-z]+)\s*\)\s*$/);
  if (!m) return { style: label.trim(), position: null };
  return { style: m[1].trim(), position: m[2].toLowerCase() };
}

/**
 * Lines the agreement prints that are not items being ordered — they state a
 * fact about the sale. The fuel type decides which variant of every gas
 * appliance is needed; Verano For Life is a lifetime membership. Both belong
 * on the order header.
 *
 * Note what is NOT here: an outlet. That is a real product, and it stays on the
 * order — it is simply never picked, which is recorded as `Product.pickable`
 * rather than as a rule in this parser.
 */
type HeaderFact = (header: ParsedOrderHeader, value: string) => void;

const HEADER_FACTS: [RegExp, HeaderFact][] = [
  [
    /^fuel type\s*:\s*(.+)$/i,
    (header, value) => {
      header.gasType = /natural|(^|\W)ng(\W|$)/i.test(value) ? "NG" : "LP";
    },
  ],
  [
    /^verano\s*for\s*life\b(.*)$/i,
    (header, value) => {
      header.veranoForLife = true;
      const tier = value.match(/\b(platinum|gold|silver|bronze)\b/i);
      if (tier) header.veranoForLifeTier = tier[1];
    },
  ],
];

/** Consume a line that states a fact rather than orders an item. */
function takeHeaderFact(header: ParsedOrderHeader, label: string): boolean {
  for (const [re, apply] of HEADER_FACTS) {
    const m = label.match(re);
    if (!m) continue;
    apply(header, (m[1] ?? "").trim());
    return true;
  }
  return false;
}

/**
 * Items the island already contributes, so the printed line would double them.
 * Every island is pre-wired with an outlet and the agreement lists it for the
 * reader; the island's own catalogue entry is what puts it on the order.
 */
const SUPPLIED_BY_ISLAND = [/^outlets?(\s*\/\s*switch\s*combo)?$/i];

export function parseFsaRows(
  doc: FsaDocument,
  catalogue: CatalogueOption[] = CONFIGURATOR_CATALOGUE
): ParsedOrder {
  const warnings: string[] = [];

  const start = doc.rows.findIndex((r) =>
    r.cells.some((c) => /^ITEM PURCHASED AND QUANTITY$/i.test(c.text))
  );
  const header = parseHeader(doc.rows, doc.rows[start]?.page ?? 1, warnings);

  if (start < 0) {
    return {
      source: "POS_PDF",
      header,
      islands: [],
      extras: [],
      items: [],
      warnings: [
        ...warnings,
        'Could not find the "ITEM PURCHASED AND QUANTITY" block — is this a Final Sales Agreement?',
      ],
    };
  }

  // Collect raw rows, grouped by the heading they sit under.
  const sections: { heading: string | null; items: RawItem[] }[] = [
    { heading: null, items: [] },
  ];
  let configQty: number | null = null;
  let asIs = false;
  let stockListNote: string | null = null;

  for (const rawRow of doc.rows.slice(start + 1)) {
    const row = {
      ...rawRow,
      cells: rawRow.cells.filter((c) => !isPageFurniture(c.text)),
    };
    if (row.cells.length === 0) continue;

    // Only the Item column names an item. Everything to the right is one of the
    // marker columns — As is, Cash & Carry, Temporary Stock List, Quantity.
    const labelCells = row.cells.filter((c) => c.x < ITEM_COLUMN_MAX_X);
    const qtyCell = row.cells.find((c) => c.x >= QTY_COLUMN_MIN_X && /^\d+$/.test(c.text));
    const qty = qtyCell ? Number(qtyCell.text) : null;

    if (labelCells.length === 0) {
      // A row of markers: the quantity (set vertically centred against the whole
      // block, so it lands on a line of its own), the tick boxes, or the
      // letterhead of a continuation page.
      if (qty != null) configQty ??= qty;
      if (row.cells.some((c) => CHECKED.test(c.text))) asIs = true;
      const marker = row.cells.find(
        (c) =>
          c.x >= STOCK_LIST_COLUMN_MIN_X &&
          c.x < QTY_COLUMN_MIN_X &&
          !CHECKBOX.test(c.text) &&
          !COLUMN_HEADINGS.includes(c.text.toLowerCase())
      );
      if (marker) stockListNote ??= marker.text;
      continue;
    }

    const first = labelCells[0];
    const text = first.text;

    if (END_OF_ITEMS.some((re) => re.test(text))) break;
    if (COLUMN_HEADINGS.includes(text.toLowerCase())) {
      // "OWN CONFIGURATION" also carries the configuration's own quantity.
      if (qty != null) configQty ??= qty;
      continue;
    }

    if (first.x >= 74 && first.x < 86 && text.endsWith(":")) {
      sections.push({ heading: text.replace(/:$/, "").trim(), items: [] });
      if (qty != null) configQty ??= qty;
      continue;
    }

    // Anything else is an item — indented under a heading, or at the left
    // margin on an accessory-only agreement.
    //
    // The quantity is split off HERE, before anything else looks at the label.
    // A wrapped item carries it on the continuation line ("Lighting (2)"), so
    // leaving it attached would stop the two halves rejoining.
    const inline = splitTrailingQty(text);
    sections[sections.length - 1].items.push({
      label: inline.label,
      qty: inline.qty ?? qty,
    });
  }

  if (stockListNote) {
    warnings.push(
      `The Temporary Stock List column says "${stockListNote}" — recorded here because its meaning is not yet wired up.`
    );
  }

  if (asIs) {
    warnings.push(
      'This agreement has an "As is" box ticked — confirm whether it should be picked as a show good.'
    );
  }

  // ---- turn the sections into islands and extras ----
  const islands: ParsedIsland[] = [];
  const extras: ParsedOption[] = [];
  const items: { label: string; qty: number }[] = [];
  const seenExtra = new Set<string>();

  const addExtra = (opt: ParsedOption): void => {
    const key = `${opt.param}|${opt.code ?? opt.label ?? ""}`;
    if (seenExtra.has(key)) return;
    seenExtra.add(key);
    extras.push(opt);
  };

  for (const section of sections) {
    const heading = section.heading;
    const params = paramsForSection(heading ?? "");
    const healed = healWrappedItems(section.items, params, catalogue);

    // Not under a heading: a plain accessory agreement.
    if (!heading) {
      for (const item of healed) {
        if (takeHeaderFact(header, item.label)) continue;
        items.push({ label: item.label, qty: item.qty ?? 1 });
      }
      continue;
    }

    const isIsland = /^(grill|bar)\s+island$/i.test(heading);
    if (!isIsland) {
      for (const item of healed) {
        const { label } = item;
        const qty = item.qty ?? 1;
        if (takeHeaderFact(header, label)) continue;
        const found = findOptionByLabel(catalogue, label, params);
        if (!found) {
          warnings.push(`"${label}" under ${heading} is not a known option — kept as a line.`);
          items.push({ label, qty });
          continue;
        }
        addExtra({ param: found.param, code: found.code, label, qty });
        // A stool option is also the stool ORDER: its quantity lives here.
        if (found.param === "HAPPY" && ["0", "7", "8"].includes(found.code)) {
          addExtra({ param: "STOOLS", code: found.code, qty });
        }
      }
      continue;
    }

    // ---- an island ----
    const role = /^grill/i.test(heading) ? "GRILL" : "BAR";
    if (healed.length === 0) {
      warnings.push(`The ${heading} section is empty.`);
      continue;
    }
    const [styleLine, ...rest] = healed;
    const { style, position } = splitStyleLine(styleLine.label);
    const styleOpt = findOptionByLabel(catalogue, style, [
      role === "GRILL" ? "ISLAND" : "BAR_ISLAND",
    ]);
    const styleCode = styleOpt?.attrValue ?? "";

    const island: ParsedIsland = {
      role,
      styleLabel: style,
      grillPosition:
        position ??
        (role === "GRILL"
          ? DEFAULT_GRILL_POSITION[styleCode] ?? "center"
          : DEFAULT_BAR_POSITION[styleCode] ?? "hide"),
      options: [],
      qty: styleLine.qty ?? configQty ?? 1,
    };

    for (const item of rest) {
      const { label } = item;
      const qty = item.qty ?? 1;
      if (takeHeaderFact(header, label)) continue;
      if (SUPPLIED_BY_ISLAND.some((re) => re.test(label))) continue;

      const found = findOptionByLabel(catalogue, label, params);
      if (!found) {
        warnings.push(`"${label}" under ${heading} is not a known option — kept as a line.`);
        items.push({ label, qty });
        continue;
      }

      // Stone and siding are chosen once for the whole order but printed under
      // every island, so they belong in extras — and must not be duplicated.
      if (found.param === "STONE" || found.param === "SIDING") {
        addExtra({ param: found.param, code: found.code, label });
        continue;
      }

      // Every foot rail is printed with the same name; the island's style is
      // what says which length it is.
      if (found.param === "FOOTREST") {
        const code = FOOTREST_OPTION_BY_STYLE[styleCode];
        if (!code) {
          warnings.push(`No foot rail length is known for ${styleCode || style} — set it by hand.`);
        }
        island.options.push({ param: "FOOTREST", code: code ?? found.code, label });
        continue;
      }

      island.options.push({
        param: found.param,
        code: found.code,
        label,
        qty,
      });
    }

    islands.push(island);
  }

  return { source: "POS_PDF", header, islands, extras, items, warnings };
}

/** Convenience: extract and parse in one call. */
export async function parseFsaPdf(
  data: Uint8Array,
  catalogue: CatalogueOption[] = CONFIGURATOR_CATALOGUE
): Promise<{ parsed: ParsedOrder; document: FsaDocument }> {
  const document = await extractFsaRows(data);
  return { parsed: parseFsaRows(document, catalogue), document };
}
