// Turn a parsed order (from a Final Sales Agreement, a configurator link, or the
// manual builder) into island configurations, composed SKUs and pickable lines.
//
// This is the piece that replaces the old external query stack. The old code had
// to RE-INFER the configuration from a wide spreadsheet — hard-coding a fridge
// count per style, deducing access doors from the grill hole, carrying per-order
// patches. Here the configuration arrives intact from the POS, so the SKUs are
// COMPOSED from it with `composeSku()` and nothing is guessed.
//
// Pure: no DB, no server-only imports. Runs in the browser and under Vitest.

import { composeSku } from "./sku";
import { GRAMMARS } from "./sku-grammar";
import {
  BURNER_SIDE_FOR_HOLE,
  CONFIGURATOR_CATALOGUE,
  GRILL_POSITION_TO_HOLE,
  LED_NEVER_STYLES,
  UMBRELLA_BY_STYLE,
  findOption,
  type CatalogueLine,
  type CatalogueOption,
  type ConfigParam,
} from "./configurator-catalogue";

// ---- the shape both parsers produce ----------------------------------------

export type OrderSourceKind =
  | "POS_PDF"
  | "CONFIGURATOR_URL"
  | "MANUAL"
  | "LEGACY_IMPORT";
export type IslandRoleKind = "GRILL" | "BAR";
export type LineOrigin =
  | "CONFIG_BASE"
  | "CONFIG_TOP"
  | "CONFIG_ITEM"
  | "COMBO_BOM"
  | "MANUAL";
export type GasType = "LP" | "NG";

export interface ParsedOption {
  param: ConfigParam;
  /** Set by the URL parser (an index or enum word). */
  code?: string;
  /** Set by both — what the source actually said. */
  label?: string;
  /** STOOLS quantity, or a "(8)" suffix on an agreement line. */
  qty?: number;
}

export interface ParsedIsland {
  role: IslandRoleKind;
  /** The configurator's ISLAND / BAR_ISLAND index, when the source is a link. */
  styleCode?: string;
  /** How the source named the style: "GX10", "MAUI 10". */
  styleLabel?: string;
  /** left | right | center | double | hide */
  grillPosition?: string;
  options: ParsedOption[];
  qty?: number;
  gasType?: GasType;
}

export interface ParsedAddress {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
}

export interface ParsedTotals {
  orderTotalCents?: number;
  tradeInCreditCents?: number;
  tradeInFeeCents?: number;
  storageFeeCents?: number;
  subtotalCents?: number;
  salesTaxCents?: number;
  freightCents?: number;
  totalCents?: number;
  downPaymentCents?: number;
  balanceDueCents?: number;
}

export interface ParsedOrderHeader {
  /** The bare POS number ("14454"); the "P" prefix is added when it is saved. */
  posOrderNo?: string;
  purchasedAt?: string; // ISO yyyy-MM-dd
  gallery?: string;
  gtlId?: string;
  repId?: string;
  salesRepName?: string;
  customerFirst?: string;
  customerLast?: string;
  email?: string;
  phone?: string;
  cell?: string;
  billing?: ParsedAddress;
  delivery?: ParsedAddress;
  requestedTimeframe?: string;
  totals?: ParsedTotals;
  /** From "Fuel type: ..." — picks the LP/NG variant of every gas appliance. */
  gasType?: GasType;
  /** A lifetime membership, not something the warehouse ships. */
  veranoForLife?: boolean;
  veranoForLifeTier?: string;
}

export interface ParsedOrder {
  source: OrderSourceKind;
  header: ParsedOrderHeader;
  islands: ParsedIsland[];
  /** Order-level choices: COMBO, SHADE, HAPPY, STOOLS, PATIOS. */
  extras: ParsedOption[];
  /** Items with no configurator origin — an accessory-only agreement is all of these. */
  items: { label: string; qty: number }[];
  warnings: string[];
}

// ---- what comes out ---------------------------------------------------------

export type IslandAttributes = Record<string, string>;

export interface DerivedIsland {
  position: number;
  role: IslandRoleKind;
  styleCode: string;
  grillPosition: string | null;
  attributes: IslandAttributes;
  baseSku: string | null;
  topSku: string | null;
  /** Uncut tops this one could be cut from, best first. Visibility only — glass
   *  is not cut until the customer is scheduled, so no GlassMod is raised. */
  topBlankCandidates: string[];
  qty: number;
}

export interface DerivedLine {
  origin: LineOrigin;
  /** Index into `islands`, or null for an order-level line. */
  islandIndex: number | null;
  label: string;
  /** Set for the base and top; other lines resolve by label. */
  sku: string | null;
  qty: number;
}

export interface DerivedOrder {
  islands: DerivedIsland[];
  lines: DerivedLine[];
  warnings: string[];
}

// ---- helpers ----------------------------------------------------------------

/** Burner side is whichever side the grill hole is not on. See the catalogue. */
export function burnerSideFor(grillHole: string): string | null {
  return BURNER_SIDE_FOR_HOLE[grillHole.replace("XL", "")] ?? null;
}

/** Tops over 10ft ship in two pieces, so only those blanks carry a seam. */
const SEAMED_STYLES = ["GX12", "GX14", "MA12", "MA14"];

function baseAttributes(): IslandAttributes {
  return {
    style: "",
    grillHole: "N",
    burner: "NN",
    accessDoors: "0",
    fridges: "0",
    drawerTrash: "0",
    warming: "0",
    audio: "N",
    led: "N",
    footRail: "N",
    siding: "CA",
    color: "",
    tiki: "N",
    sink: "N",
    umbrella: "N",
    gasType: "LP",
  };
}

function bump(attrs: IslandAttributes, key: string, delta: number): void {
  attrs[key] = String((Number(attrs[key]) || 0) + delta);
}

function expandLines(
  lines: CatalogueLine[] | undefined,
  multiplier: number,
  gasType: string
): CatalogueLine[] {
  return (lines ?? []).map((l) => ({
    label: l.label.replace("{GAS}", gasType),
    qty: l.qty * multiplier,
  }));
}

/** Resolve a parsed option against the catalogue, by code first then by label. */
function resolve(
  catalogue: CatalogueOption[],
  opt: ParsedOption
): CatalogueOption | null {
  if (opt.code != null) {
    const byCode = findOption(catalogue, opt.param, opt.code);
    if (byCode) return byCode;
  }
  if (opt.label) {
    const want = opt.label.trim().toLowerCase().replace(/\s+/g, " ");
    const pool = catalogue.filter((o) => o.param === opt.param);
    return (
      pool.find((o) => o.label.trim().toLowerCase().replace(/\s+/g, " ") === want) ??
      pool.find((o) =>
        (o.aliases ?? []).some(
          (a) => a.trim().toLowerCase().replace(/\s+/g, " ") === want
        )
      ) ??
      null
    );
  }
  return null;
}

// ---- derivation -------------------------------------------------------------

export function deriveOrder(
  parsed: ParsedOrder,
  catalogue: CatalogueOption[] = CONFIGURATOR_CATALOGUE
): DerivedOrder {
  const warnings = [...parsed.warnings];
  const lines: DerivedLine[] = [];

  // Order-level options first: their attribute effects have to be in place
  // before an island's SKU is composed.
  const orderAttrs: IslandAttributes = {};
  const orderLines: { line: CatalogueLine; origin: LineOrigin }[] = [];

  for (const opt of parsed.extras) {
    const found = resolve(catalogue, opt);
    if (!found) {
      warnings.push(
        `Unknown ${opt.param} option ${opt.code ?? ""} "${opt.label ?? ""}" — left as an unmatched line.`
      );
      if (opt.label) {
        orderLines.push({
          line: { label: opt.label, qty: opt.qty ?? 1 },
          origin: "CONFIG_ITEM",
        });
      }
      continue;
    }
    if (found.attrKey && found.attrValue) orderAttrs[found.attrKey] = found.attrValue;
    // STOOLS carries its own quantity and multiplies its lines by it.
    const multiplier = found.param === "STOOLS" ? (opt.qty ?? 1) : 1;
    for (const line of expandLines(found.lines, multiplier, "LP")) {
      orderLines.push({ line, origin: "CONFIG_ITEM" });
    }
    for (const line of expandLines(found.kit, 1, "LP")) {
      orderLines.push({ line, origin: "COMBO_BOM" });
    }
  }
  // ---- islands ----
  let needsGasType = false;

  const islands: DerivedIsland[] = parsed.islands.map((isl, index) => {
    const attrs = baseAttributes();
    // A property has one gas supply, so the agreement states it once for the
    // whole order; an island can still override it.
    const gasType = isl.gasType ?? parsed.header.gasType ?? "LP";
    attrs.gasType = gasType;

    // Style.
    const styleOpt = resolve(catalogue, {
      param: isl.role === "GRILL" ? "ISLAND" : "BAR_ISLAND",
      code: isl.styleCode,
      label: isl.styleLabel,
    });
    if (styleOpt?.attrValue) {
      attrs.style = styleOpt.attrValue;
    } else {
      warnings.push(`Could not identify the ${isl.role.toLowerCase()} island "${isl.styleLabel ?? "?"}".`);
    }
    for (const line of expandLines(styleOpt?.lines, 1, gasType)) {
      lines.push({ origin: "CONFIG_ITEM", islandIndex: index, ...line, sku: null });
    }

    // Grill hole from the position token.
    const position = isl.grillPosition ?? "hide";
    attrs.grillHole = GRILL_POSITION_TO_HOLE[position] ?? "N";

    // Island options.
    let grillHeadCount = 0;
    let burnerType: string | null = null;
    // A link carries FLAGS ("this island has double doors / warming drawers")
    // and leaves the count to be worked out; an agreement PRINTS each door.
    // Both are collected here and reconciled below.
    let doubleDoorFlag = false;
    let warmingFlag = false;
    let listedStorage = 0;
    let listedDouble = 0;
    let listedWarming = 0;

    for (const opt of isl.options) {
      if (opt.param === "ACCESS_DOORS") {
        const n = opt.qty ?? 1;
        if (opt.code === "double") doubleDoorFlag = true;
        else if (opt.code === "warming") warmingFlag = true;
        else if (opt.code === "0") listedStorage += n;
        else if (opt.code === "1") listedDouble += n;
        else if (opt.code === "3") listedWarming += n;
        continue;
      }

      const found = resolve(catalogue, opt);
      if (!found) {
        warnings.push(
          `Unknown ${opt.param} option ${opt.code ?? ""} "${opt.label ?? ""}" on the ${isl.role.toLowerCase()} island — left as an unmatched line.`
        );
        if (opt.label) {
          lines.push({
            origin: "CONFIG_ITEM",
            islandIndex: index,
            label: opt.label,
            sku: null,
            qty: opt.qty ?? 1,
          });
        }
        continue;
      }

      // Gas appliances are stocked as separate LP and NG items, so a line that
      // needs the fuel type must not be resolved by guessing it.
      if ((found.lines ?? []).some((l) => l.label.includes("{GAS}"))) {
        needsGasType = true;
      }

      if (found.param === "GRILLS") grillHeadCount += opt.qty ?? 1;
      if (found.attrKey === "burnerType") burnerType = found.attrValue ?? null;
      else if (found.attrKey === "grillHoleXl") attrs.grillHoleXl = "Y";
      else if (found.attrKey && found.attrDelta) bump(attrs, found.attrKey, found.attrDelta * (opt.qty ?? 1));
      else if (found.attrKey && found.attrValue) attrs[found.attrKey] = found.attrValue;

      for (const line of expandLines(found.lines, opt.qty ?? 1, gasType)) {
        lines.push({ origin: "CONFIG_ITEM", islandIndex: index, ...line, sku: null });
      }
    }

    // The XL grill is cut larger — same placement, wider hole.
    if (attrs.grillHoleXl === "Y" && attrs.grillHole !== "N") {
      attrs.grillHole = `${attrs.grillHole}XL`;
    }

    // Burner: type from the chosen top option, side opposite the grill hole.
    if (burnerType) {
      const side = burnerSideFor(attrs.grillHole);
      if (side) {
        attrs.burner = `${burnerType}${side}`;
      } else {
        attrs.burner = "NN";
        warnings.push(
          `A burner was ordered on the ${isl.role.toLowerCase()} island but there is no grill hole to place it against — set the side by hand.`
        );
      }
    }

    // Access doors and warming drawers. Every occupied grill-head slot gets one
    // door-ish item: a warming drawer if warming is on, otherwise a double or a
    // plain storage door. That is the first-principles version of the old
    // "2 - [Warming Drawer]" rule, and it reproduces it exactly.
    let storage = listedStorage;
    let doubles = listedDouble;
    let warming = listedWarming;
    if (storage + doubles + warming === 0) {
      if (warmingFlag) warming = grillHeadCount;
      else if (doubleDoorFlag) doubles = grillHeadCount;
      else storage = grillHeadCount;
    }

    attrs.warming = String(warming);
    if (doubles > 0) {
      attrs.accessDoors = `D${doubles + storage}`;
      if (storage > 0) {
        warnings.push(
          `The ${isl.role.toLowerCase()} island lists both plain and double access doors — check the access-door code.`
        );
      }
    } else {
      attrs.accessDoors = String(storage);
    }

    for (const [code, count] of [
      ["0", storage],
      ["1", doubles],
      ["3", warming],
    ] as [string, number][]) {
      if (count <= 0) continue;
      const doorOption = findOption(catalogue, "ACCESS_DOORS", code);
      for (const line of expandLines(doorOption?.lines, count, gasType)) {
        lines.push({ origin: "CONFIG_ITEM", islandIndex: index, ...line, sku: null });
      }
    }

    // Order-level attributes (stone, siding, tiki from a combo, audio/LED from
    // Happy Hours) land on the island last so an island-specific choice wins.
    for (const [k, v] of Object.entries(orderAttrs)) {
      if (k === "audio" || k === "led") continue; // placed below — bar island only
      attrs[k] = v;
    }

    // Umbrella is a property of the style, per the product owner's Glass Query;
    // only styles it does not name follow the SHADE parameter.
    const styleUmbrella = UMBRELLA_BY_STYLE[attrs.style];
    if (styleUmbrella) attrs.umbrella = styleUmbrella;
    else if (orderAttrs.umbrella) attrs.umbrella = orderAttrs.umbrella;

    return {
      position: index,
      role: isl.role,
      styleCode: attrs.style,
      grillPosition: isl.grillPosition ?? null,
      attributes: attrs,
      baseSku: null,
      topSku: null,
      topBlankCandidates: [],
      qty: isl.qty ?? 1,
    };
  });

  if (needsGasType && !parsed.header.gasType && !parsed.islands.some((i) => i.gasType)) {
    warnings.push(
      "This order has gas appliances but no fuel type — LP was assumed. Confirm whether it is liquid propane or natural gas."
    );
  }

  // Audio and LED belong to the bar island — the stereo and the lights are in
  // the bar. With no bar island they fall to the grill island, where the GX
  // guard below turns them off again anyway.
  const audioTarget =
    islands.find((i) => i.role === "BAR") ?? islands[0] ?? null;
  if (audioTarget) {
    if (orderAttrs.audio) audioTarget.attributes.audio = orderAttrs.audio;
    if (orderAttrs.led) audioTarget.attributes.led = orderAttrs.led;
  }

  // A GX base never carries audio or LED. Verified against the product owner's
  // base sheet: all 688 GX rows are audio "N", and every one but a single
  // outlier is LED "N".
  for (const isl of islands) {
    if (LED_NEVER_STYLES.includes(isl.styleCode)) {
      isl.attributes.audio = "N";
      isl.attributes.led = "N";
    }
  }

  // Two Mauis on one order: one gets the full audio package and the other gets
  // speakers only. Straight from the Base Query's MA12-count rule, and the base
  // sheet confirms SPO/LSPO appear on nothing but MA12/MA14 with a double hole.
  const mauis = islands.filter((i) => i.styleCode === "MA12" || i.styleCode === "MA14");
  if (mauis.length > 1) {
    for (const isl of mauis) {
      if (!isl.attributes.grillHole.startsWith("D")) continue;
      if (isl.attributes.audio === "L") isl.attributes.audio = "LSPO";
      else if (isl.attributes.audio === "Y") isl.attributes.audio = "SPO";
    }
  }

  // ---- compose the SKUs ----
  const baseGrammar = GRAMMARS.BASE;
  const glassGrammar = GRAMMARS.GLASS;

  for (const [index, isl] of islands.entries()) {
    if (!isl.styleCode) continue;
    const a = isl.attributes;

    if (baseGrammar) {
      isl.baseSku = composeSku(baseGrammar, a);
      lines.push({
        origin: "CONFIG_BASE",
        islandIndex: index,
        label: `${isl.role === "GRILL" ? "Grill" : "Bar"} island base — ${isl.styleCode}`,
        sku: isl.baseSku,
        qty: isl.qty,
      });
    }

    if (glassGrammar) {
      if (a.color) {
        isl.topSku = composeSku(glassGrammar, a);
        lines.push({
          origin: "CONFIG_TOP",
          islandIndex: index,
          label: `${isl.role === "GRILL" ? "Grill" : "Bar"} island top — ${isl.styleCode}`,
          sku: isl.topSku,
          qty: isl.qty,
        });
        // Which uncut top it could come from. A 12/14ft top ships in two pieces
        // and so carries a seam; the seam letter is not knowable from the order,
        // so offer both and let the caller keep whichever exists.
        const seamless = composeSku(
          glassGrammar,
          { color: a.color, style: a.style, blank: "BLANK" },
          "blank"
        );
        isl.topBlankCandidates = SEAMED_STYLES.includes(a.style)
          ? [
              composeSku(
                glassGrammar,
                { color: a.color, style: a.style, seam: "C", blank: "BLANK" },
                "blank"
              ),
              composeSku(
                glassGrammar,
                { color: a.color, style: a.style, seam: "D", blank: "BLANK" },
                "blank"
              ),
              seamless,
            ]
          : [seamless];
      } else {
        warnings.push(
          `No stone colour on the ${isl.role.toLowerCase()} island — its glass top could not be composed.`
        );
      }
    }
  }

  // ---- order-level and plain lines ----
  for (const { line, origin } of orderLines) {
    lines.push({ origin, islandIndex: null, label: line.label, sku: null, qty: line.qty });
  }
  for (const item of parsed.items) {
    lines.push({
      origin: "CONFIG_ITEM",
      islandIndex: null,
      label: item.label,
      sku: null,
      qty: item.qty,
    });
  }

  return { islands, lines: mergeLines(lines), warnings };
}

/** Collapse identical lines so the pick list shows one row with a total. */
export function mergeLines(lines: DerivedLine[]): DerivedLine[] {
  const out: DerivedLine[] = [];
  for (const line of lines) {
    const key = (l: DerivedLine) =>
      `${l.origin}|${l.islandIndex ?? ""}|${l.sku ?? ""}|${l.label.toLowerCase()}`;
    const existing = out.find((o) => key(o) === key(line));
    if (existing) existing.qty += line.qty;
    else out.push({ ...line });
  }
  return out;
}
