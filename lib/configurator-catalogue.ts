// The Verano configurator's option tables, recovered from the site's own
// bundle (`configurator_1/js/app.5d52d277.js` — every catalogue is baked into
// the app; there is no JSON endpoint). This file is the SEED for the editable
// `ConfigOption` table; nothing reads it at runtime once the DB is populated.
//
// Two kinds of effect, and most options have BOTH:
//
//   attrKey/attrValue/attrDelta — folds into the island's configuration, and so
//     into the composed base/top SKU. `attrValue` sets a segment outright
//     (style, siding, audio); `attrDelta` increments a count (fridges,
//     drawerTrash). These are the high-confidence half: they come from the
//     configurator's own tables cross-checked against the product owner's Power
//     BI queries, and they are what replaces that whole M-code stack.
//
//   lines — the pickable items the option adds. Deliberately LABELS, not SKUs:
//     only 3 of the 29 shade-kit part names exist as products today, and the
//     agreement words several options differently from the configurator. Lines
//     resolve at derive time (product master -> PickAlias -> unmatched), so an
//     unknown one surfaces for a human to map once instead of being guessed.
//
// RULE OF THUMB used throughout: emit ONE line per item the source document
// lists, worded as the source words it. The only deliberate explosions are the
// shade kits (straight from the product owner's own ShadeBOM in `Kits Query`)
// and "... - Stainless Trim Kit" options, where the name itself names two parts.
//
// `{GAS}` in a line label is substituted with the island's gas type (LP/NG).
// Neither the FSA nor the configurator states it, so it defaults to LP and is
// editable per island — see `lib/order-derive.ts`.

export type ConfigParam =
  | "ISLAND"
  | "BAR_ISLAND"
  | "GRILLS"
  | "STAINLESS"
  | "TOP"
  | "FOOTREST"
  | "ACCESS_DOORS"
  | "COMBO"
  | "SHADE"
  | "HAPPY"
  | "STOOLS"
  | "STONE"
  | "SIDING"
  | "PATIOS";

export interface CatalogueLine {
  label: string;
  qty: number;
}

export interface CatalogueOption {
  param: ConfigParam;
  /** The raw URL token: an index ("7") or an enum word ("double"). */
  code: string;
  /** The configurator's own wording. */
  label: string;
  /** Wordings the Final Sales Agreement uses instead. */
  aliases?: string[];
  attrKey?: string;
  attrValue?: string;
  attrDelta?: number;
  lines?: CatalogueLine[];
  /** Parts a kit explodes into. Kept apart from `lines` so the pergola itself
   *  reads as an ordered item and its hardware reads as the kit it came from. */
  kit?: CatalogueLine[];
}

// ---- island geometry --------------------------------------------------------

/** Grill-position token -> the grill-hole segment of both SKUs. */
export const GRILL_POSITION_TO_HOLE: Record<string, string> = {
  left: "L",
  right: "R",
  center: "C",
  double: "D",
  hide: "N",
};

/**
 * Burner side is the side the grill hole is NOT on. Verified against all 1024
 * rows of the product owner's `Base_Lookup_Advanced.xlsx`: 428 of the 455
 * burner-bearing rows follow this, and every one of the 27 exceptions is a
 * "Special" build — never a stocked Parent or Child. So: derive, and treat an
 * override as the Special it is.
 */
export const BURNER_SIDE_FOR_HOLE: Record<string, string> = {
  L: "R",
  R: "L",
  C: "R",
  D: "L",
};

/**
 * `GRILLS` entries are `slotId,grillHeadId` with no island flag — the slot id
 * is what says which island it belongs to.
 */
export const GRILL_SLOT_IS_BAR: Record<string, boolean> = {
  "0": false, // Right Grill Island Position
  "1": false, // Left Grill Island Position
  "4": false, // Center Grill Island Position
  "2": true, // Right Island Bar Position
  "3": true, // Left Island Bar Position
  "5": true, // Center Island Bar Position
};

/**
 * The rail is one product per island length, but the agreement calls every one
 * of them "Professional Stainless Steel Foot Rail" — so the length has to come
 * from the island it is bolted to. From the configurator's per-model rules.
 */
export const FOOTREST_OPTION_BY_STYLE: Record<string, string> = {
  ARB6: "0",
  ARB8: "0",
  STT7: "1",
  STC8: "2",
  STT9: "3",
  STC9: "4",
  MA08: "5",
  PRT7: "5",
  PRT9: "5",
  MA10: "6",
  MA12: "7",
  MA14: "8",
  GX14: "7",
};

/**
 * Where the grill sits when the agreement does not say. The configurator only
 * offers a choice on the larger models; on the rest there is exactly one
 * position and it is left unprinted. Bar islands default to `hide` — most bars
 * take no grill head at all.
 */
export const DEFAULT_GRILL_POSITION: Record<string, string> = {
  GX03: "center",
  GX04: "right",
  GX05: "right",
  GX06: "right",
  GX07: "right",
  GX08: "center",
  GX09: "center",
  GX10: "center",
  GX12: "center",
  GX14: "center",
  MA12: "center",
  MA14: "center",
};

export const DEFAULT_BAR_POSITION: Record<string, string> = {
  ARB6: "left",
  ARB8: "left",
  MA12: "center",
  MA14: "center",
};

/** STAINLESS option ids that are a refrigeration unit (the `fridges` segment). */
export const FRIDGE_STAINLESS_IDS = ["0", "1", "4", "5", "6", "7", "8", "9", "11", "12", "13"];

/** STAINLESS option ids that are a drawer (the `drawerTrash` segment). */
export const DRAWER_STAINLESS_IDS = ["2", "3"];

/**
 * Umbrella hole is a property of the style, not of a chosen option — carried
 * over from the product owner's Glass Query, which is the authority here.
 * Anything not listed follows the `SHADE` parameter.
 */
export const UMBRELLA_BY_STYLE: Record<string, string> = {
  ARB6: "Y",
  ARB8: "Y",
  STC8: "Y",
  GX03: "N",
  GX04: "N",
  GX05: "N",
  GX06: "N",
  GX07: "N",
  GX08: "N",
  GX09: "N",
  GX10: "N",
  GX12: "N",
  GX14: "N",
  MA10: "N",
  MA12: "N",
  MA14: "N",
  STC9: "N",
  STT7: "N",
  STT9: "N",
};

/** LED lighting is never fitted to a GX base — from the Base Query's LED rule. */
export const LED_NEVER_STYLES = [
  "GX03",
  "GX04",
  "GX05",
  "GX06",
  "GX07",
  "GX08",
  "GX09",
  "GX10",
  "GX12",
  "GX14",
];

// ---- shade kits -------------------------------------------------------------
// Transcribed verbatim from the product owner's `ShadeBOM` table in
// `Kits Query.txt`. These are scan-alias names, so most resolve through
// PickAlias rather than being SKUs. Portofino has no kit in that table.

const ABACO_COMMON: CatalogueLine[] = [
  { label: "Abaco Galvanized Poles", qty: 4 },
  { label: "Tiki Pole A", qty: 2 },
  { label: "Tiki Pole B", qty: 1 },
  { label: "Tiki Pole C", qty: 1 },
  { label: "Long Pins", qty: 4 },
  { label: "Short Pins", qty: 4 },
  { label: "PVC Connectors - Male", qty: 4 },
  { label: "PVC Connectors - Female", qty: 4 },
  { label: "LED Remote", qty: 2 },
  { label: "LED Power Supply", qty: 2 },
  { label: "Dual TV Mount", qty: 1 },
  { label: "15' Extension Cord", qty: 2 },
  { label: "Bluetooth LED 15", qty: 2 },
  { label: "Speaker Wire (Feet)", qty: 30 },
  { label: 'Box of 1" Self Tapping Screws', qty: 1 },
  { label: '3" TV Mount Bolts', qty: 2 },
  { label: "Brown Spray Paint (Can)", qty: 1 },
  { label: "1\" X 10' Galvanized Pole", qty: 2 },
  { label: '18" Zip Ties', qty: 50 },
];

const TAHITI_KIT: CatalogueLine[] = [
  { label: "Tahiti Galvanized Poles", qty: 3 },
  { label: "Tiki Pole A", qty: 1 },
  { label: "Tiki Pole B", qty: 1 },
  { label: "Tiki Pole C", qty: 1 },
  { label: "Short Pins", qty: 3 },
  { label: '1 1/2" U-Bolts', qty: 2 },
  { label: "PVC Connectors - Male", qty: 3 },
  { label: "PVC Connectors - Female", qty: 3 },
  { label: "LED Remote", qty: 1 },
  { label: "LED Power Supply", qty: 1 },
  { label: "15' Extension Cord", qty: 1 },
  { label: "Bluetooth LED 15", qty: 1 },
  { label: "Blue Wire Nuts", qty: 4 },
];

const MONACO_KIT: CatalogueLine[] = [
  { label: "Logan Review", qty: 1 },
  { label: "Single TV Mount", qty: 1 },
  { label: "Monaco Fan with Remote", qty: 1 },
  { label: "Monaco Electrical Box", qty: 1 },
];

const MYKONOS_KIT: CatalogueLine[] = [
  { label: "Single TV Mount", qty: 2 },
  { label: "Mykonos Electrical Box", qty: 1 },
  { label: "Mykonos Fan", qty: 1 },
];

const ST_BARTHS_KIT: CatalogueLine[] = [
  { label: "Single TV Mount", qty: 1 },
  { label: "Monaco Fan with Remote", qty: 1 },
  { label: "St. Barths Electrical Box", qty: 1 },
];

function combo(
  code: string,
  label: string,
  tiki: string,
  kit: CatalogueLine[]
): CatalogueOption {
  return {
    param: "COMBO",
    code,
    label,
    attrKey: "tiki",
    attrValue: tiki,
    // The pergola/hut itself, worded as the agreement words it...
    lines: [{ label, qty: 1 }],
    // ...and the hardware it explodes into.
    kit,
  };
}

// ---- the catalogue ----------------------------------------------------------

const ISLANDS: CatalogueOption[] = [
  ["0", "GX3", "GX03"],
  ["1", "GX4", "GX04"],
  ["2", "GX5", "GX05"],
  ["3", "GX6", "GX06"],
  ["4", "GX7", "GX07"],
  ["5", "GX8", "GX08"],
  ["6", "GX9", "GX09"],
  ["7", "GX10", "GX10"],
  ["8", "GX12", "GX12"],
  ["9", "GX14", "GX14"],
  ["10", "MAUI 12 (Front)", "MA12"],
  ["11", "MAUI 14 (Front)", "MA14"],
].map(([code, label, style]) => ({
  param: "ISLAND" as const,
  code,
  label,
  // The agreement prints the style plainly; a GX9 order says "GX9", not "GX09".
  aliases: [style, label.replace(" (Front)", "")],
  attrKey: "style",
  attrValue: style,
  // Every island is pre-wired with one. A real product, but marked
  // `pickable = false` in the product master because it is built into the base
  // — it belongs on the order, never on the pick list.
  lines: [{ label: "Outlet", qty: 1 }],
}));

const BAR_ISLANDS: CatalogueOption[] = [
  ["0", "ARUBA 6", "ARB6"],
  ["1", "ARUBA 8", "ARB8"],
  ["2", "ST. THOMAS 7", "STT7"],
  ["3", "ST. THOMAS 9", "STT9"],
  ["4", "ST. CROIX 8", "STC8"],
  ["5", "ST. CROIX 9", "STC9"],
  ["6", "ST. TROPEZ", "STR9"],
  ["7", "MAUI 10", "MA10"],
  ["8", "MAUI 12", "MA12"],
  ["9", "MAUI 14", "MA14"],
  ["11", "MAUI 8", "MA08"],
  ["12", "PORTOFINO 7", "PRT7"],
  ["13", "PORTOFINO 9", "PRT9"],
].map(([code, label, style]) => ({
  param: "BAR_ISLAND" as const,
  code,
  label,
  aliases: [style],
  attrKey: "style",
  attrValue: style,
  lines: [{ label: "Outlet", qty: 1 }],
}));

const GRILL_HEADS: CatalogueOption[] = [
  {
    param: "GRILLS",
    code: "0",
    label: "GS-32 Premium",
    aliases: ["GS-32", "GS-32 Premium Grill"],
    lines: [{ label: "GS-32 {GAS} 4B", qty: 1 }],
  },
  {
    param: "GRILLS",
    code: "1",
    label: "GSL-32 Professional",
    aliases: ["GSL-32", "GSL-32 Professional Grill"],
    lines: [{ label: "GSL-32 Pro {GAS} 4B", qty: 1 }],
  },
  {
    param: "GRILLS",
    code: "2",
    label: "HSL-32 Hibachi Griddle Station",
    aliases: ["HSL-32", "HIBACHI", "HSL-32 HIBACHI", "Hibachi Griddle Station"],
    lines: [{ label: "Verano HSL-32 Hibachi Griddle Station {GAS}", qty: 1 }],
  },
  {
    param: "GRILLS",
    code: "3",
    label: "CSL-32 Cocktail Station",
    aliases: ["CSL-32", "Cocktail Station"],
    lines: [{ label: "Verano Professional CSL-32 Cocktail Station", qty: 1 }],
  },
  {
    // The XL grill is cut larger, which is the `*XL` grill-hole suffix on both
    // SKUs — the Base Query's `if [GXL] <> null then [GRILL HOLE] & "XL"`.
    param: "GRILLS",
    code: "4",
    label: "GXL-45",
    aliases: ["GXL-45 Professional"],
    attrKey: "grillHoleXl",
    attrValue: "Y",
    lines: [{ label: "GXL-45 Professional LP", qty: 1 }],
  },
];

function stainless(
  code: string,
  label: string,
  lines: CatalogueLine[],
  aliases?: string[]
): CatalogueOption {
  const isFridge = FRIDGE_STAINLESS_IDS.includes(code);
  return {
    param: "STAINLESS",
    code,
    label,
    aliases,
    attrKey: isFridge ? "fridges" : "drawerTrash",
    attrDelta: 1,
    lines,
  };
}

const STAINLESS: CatalogueOption[] = [
  stainless("0", "Wine Fridge", [{ label: "Verano Wine Fridge", qty: 1 }]),
  stainless("1", "Fridge", [{ label: "Verano Bar Fridge", qty: 1 }], ["Bar Fridge"]),
  stainless("2", "Double Drawer", [{ label: "Stainless Double Drawer", qty: 1 }]),
  stainless("3", "Trash Drawer", [{ label: "Stainless Trash Drawer", qty: 1 }], ["Trash"]),
  stainless(
    "4",
    "Fridge - Stainless Trim Kit",
    [
      { label: "Verano Bar Fridge", qty: 1 },
      { label: "Fridge Trim Kit", qty: 1 },
    ],
    ["Bar Fridge - Stainless Trim Kit"]
  ),
  stainless("5", "Wine Fridge - Stainless Trim Kit", [
    { label: "Verano Wine Fridge", qty: 1 },
    { label: "Fridge Trim Kit", qty: 1 },
  ]),
  stainless("6", "Ice Maker", [{ label: "Professional Ice Maker", qty: 1 }]),
  stainless("7", "Ice Maker + Stainless Trim Kit", [
    { label: "Professional Ice Maker", qty: 1 },
    { label: "Fridge Trim Kit", qty: 1 },
  ]),
  stainless("8", "Fridge Freezer", [{ label: "Freezer Fridge Combo", qty: 1 }]),
  stainless("9", "Fridge Freezer + Stainless Trim Kit", [
    { label: "Freezer Fridge Combo", qty: 1 },
    { label: "Fridge Trim Kit", qty: 1 },
  ]),
  stainless("11", "Liquor Shelf + Stainless Trim Kit", [
    { label: "Professional Locking Liquor Cabinet", qty: 1 },
    { label: "Fridge Trim Kit", qty: 1 },
  ]),
  stainless("12", "Outdoor Fridge", [{ label: "Outdoor Bar Fridge", qty: 1 }]),
  stainless("13", "Outdoor Fridge + Stainless Trim Kit", [
    { label: "Outdoor Bar Fridge", qty: 1 },
    { label: "Fridge Trim Kit", qty: 1 },
  ]),
];

// The "top of island" slots: burners and the sink. Burner TYPE comes from here;
// the SIDE is derived from the grill hole (see BURNER_SIDE_FOR_HOLE).
const TOPS: CatalogueOption[] = [
  {
    param: "TOP",
    code: "0",
    label: "Single Burner",
    aliases: ["GS Single Side Burner"],
    attrKey: "burnerType",
    attrValue: "S",
    lines: [{ label: "Verano GS Premium Burner {GAS}", qty: 1 }],
  },
  {
    param: "TOP",
    code: "1",
    label: "Double Burner",
    aliases: ["GSL Double Side Burner"],
    attrKey: "burnerType",
    attrValue: "D",
    lines: [{ label: "Verano GSL Professional Double Side Burner {GAS}", qty: 1 }],
  },
  {
    param: "TOP",
    code: "2",
    label: "Sink",
    aliases: ["Professional Bar Sink"],
    attrKey: "sink",
    attrValue: "Y",
    lines: [{ label: "Stainless Professional Bar Sink", qty: 1 }],
  },
  {
    param: "TOP",
    code: "3",
    label: "Power Burner",
    attrKey: "burnerType",
    attrValue: "P",
    lines: [{ label: "Power Burner - {GAS}", qty: 1 }],
  },
];

// One rail, nine lengths. The id picks the length, so it picks the product.
const FOOTREST: CatalogueOption[] = [
  ["0", "Bar Rail Footrest Aruba 6"],
  ["1", "Bar Rail Footrest St Thomas 7"],
  ["2", "Bar Rail Footrest St Croix 8"],
  ["3", "Bar Rail Footrest St Thomas 9"],
  ["4", "Bar Rail Footrest St Croix 9"],
  ["5", "Bar Rail Footrest Maui 8"],
  ["6", "Bar Rail Footrest Maui 10"],
  ["7", "Bar Rail Footrest Maui 12"],
  ["8", "Bar Rail Footrest Maui 14"],
  ["10", "Bar Rail Footrest"],
].map(([code, product]) => ({
  param: "FOOTREST" as const,
  code,
  label: "Professional Stainless Steel Foot Rail",
  attrKey: "footRail",
  attrValue: "Y",
  lines: [{ label: product, qty: 1 }],
}));

// The URL carries flags, not slots (`isBar,doubleDoorsOn,warmingOn`); the
// configurator resolves them to one of these per occupied grill-head slot.
const ACCESS_DOORS: CatalogueOption[] = [
  {
    param: "ACCESS_DOORS",
    code: "0",
    label: "Storage Doors",
    aliases: ["Storage Door", "Access Doors", "Access Door"],
    lines: [{ label: 'Verano Stainless Access Door (Large) 17"X24"', qty: 1 }],
  },
  {
    param: "ACCESS_DOORS",
    code: "1",
    label: "Double Access Doors",
    aliases: ["Double Access Door"],
    lines: [{ label: "Double Access Door", qty: 1 }],
  },
  {
    param: "ACCESS_DOORS",
    code: "3",
    label: "Warming Drawer",
    lines: [{ label: "Warming Drawer", qty: 1 }],
  },
];

const COMBOS: CatalogueOption[] = [
  combo("0", "Abaco 16x16", "Y", ABACO_COMMON),
  combo("1", "Abaco 16x18", "Y", ABACO_COMMON),
  { ...combo("2", "Tahiti", "Y", TAHITI_KIT), aliases: ["Tahiti Pergola", "Tahiti Hut"] },
  combo("3", "Monaco - Espresso", "M", MONACO_KIT),
  combo("4", "Mykonos - Santorini White", "N", MYKONOS_KIT),
  combo("5", "St. Barth - Espresso", "N", ST_BARTHS_KIT),
  combo("6", "Portofino - Espresso", "N", []),
  combo("13", "Monaco - Santorini White", "M", MONACO_KIT),
  combo("14", "Mykonos - Espresso", "N", MYKONOS_KIT),
  combo("15", "St. Barth - Santorini White", "N", ST_BARTHS_KIT),
  combo("16", "Portofino - Santorini White", "N", []),
];

const SHADES: CatalogueOption[] = [
  {
    param: "SHADE",
    code: "1",
    label: "Bamboo Umbrella",
    attrKey: "umbrella",
    attrValue: "Y",
    lines: [{ label: "Verano 10FT Bamboo Umbrella Margaritaville", qty: 1 }],
  },
  {
    param: "SHADE",
    code: "2",
    label: "Umbrella",
    attrKey: "umbrella",
    attrValue: "Y",
    lines: [{ label: "Verano 9FT. Outdoor Umbrella", qty: 1 }],
  },
];

const HAPPY: CatalogueOption[] = [
  // Stool markers. The LINES come from STOOLS, which carries the quantity —
  // emitting them here too would double every stool order.
  { param: "HAPPY", code: "0", label: "Tatta Bar Stool - Espresso Cushion" },
  { param: "HAPPY", code: "7", label: "Tatta Bar Stool - Santorini White" },
  { param: "HAPPY", code: "8", label: "Milos Premium Bar Stool" },

  {
    param: "HAPPY",
    code: "1",
    label: "Stereo",
    attrKey: "audio",
    attrValue: "Y",
    lines: [{ label: "Verano Outdoor Living Marine Smart Stereo System", qty: 1 }],
  },
  {
    // The product owner's ruling: the marine-speaker package is the `L` (LED
    // audio) code, not plain `Y`.
    param: "HAPPY",
    code: "10",
    label: "Stereo Marine Grade Speakers w/LED Lighting",
    aliases: ["Stereo Marine Grade Speakers w/LED"],
    attrKey: "audio",
    attrValue: "L",
    lines: [{ label: "Stereo Marine Grade Speakers w/LED Lighting", qty: 1 }],
  },

  // LED lighting is purely a base-SKU flag — it is fitted during the build, so
  // it produces no pickable line. ("This is actually just for a flag ... that it
  // will have LED Y in the base configuration.")
  { param: "HAPPY", code: "2", label: "LED Lighting", attrKey: "led", attrValue: "Y" },
  { param: "HAPPY", code: "6", label: "LED Lighting", attrKey: "led", attrValue: "Y" },

  {
    param: "HAPPY",
    code: "3",
    label: "Motorized 50 inch TV Package",
    lines: [
      { label: '50" TV', qty: 1 },
      { label: "TV Motorized Lift", qty: 1 },
    ],
  },
  {
    // The mount comes with the pergola kit, so the package is the TV itself.
    param: "HAPPY",
    code: "4",
    label: "70 Inch TV Package",
    lines: [{ label: '70" TV', qty: 1 }],
  },
  {
    param: "HAPPY",
    code: "5",
    label: "2x 70 Inch TV Package",
    lines: [{ label: '70" TV', qty: 2 }],
  },
  {
    param: "HAPPY",
    code: "9",
    label: "2x 70 Inch TV Package",
    lines: [{ label: '70" TV', qty: 2 }],
  },
];

/**
 * STOOLS is `quantity,happyId`. The id names the stool AND its cushion colour,
 * so it is the thing that resolves to products; the quantity multiplies them.
 * `qty: 1` here means "one per stool ordered".
 */
const STOOLS: CatalogueOption[] = [
  {
    param: "STOOLS",
    code: "0",
    label: "Tatta Bar Stool - Espresso Cushion",
    lines: [
      { label: "Tatta Stackable Barstool", qty: 1 },
      { label: "Tatta Barstool Cushion - Espresso", qty: 1 },
    ],
  },
  {
    // NOTE: no Santorini White cushion exists in the product master (only
    // Coconut and Espresso). It will surface as an unmatched line, which is the
    // correct outcome — do not silently substitute a colour.
    param: "STOOLS",
    code: "7",
    label: "Tatta Bar Stool - Santorini White",
    lines: [
      { label: "Tatta Stackable Barstool", qty: 1 },
      { label: "Tatta Barstool Cushion - Santorini White", qty: 1 },
    ],
  },
  {
    param: "STOOLS",
    code: "8",
    label: "Milos Premium Bar Stool",
    lines: [{ label: "Premium Bar Stool - Milos", qty: 1 }],
  },
];

const STONE: CatalogueOption[] = [
  ["0", "Titanium", "TIT"],
  ["1", "Volcanic Ash", "VOL"],
  ["2", "Italian Travertine", "TRV"],
  ["3", "Greek Isle", "ISL"],
].map(([code, label, value]) => ({
  param: "STONE" as const,
  code,
  label,
  attrKey: "color",
  attrValue: value,
}));

const SIDING: CatalogueOption[] = [
  ["0", "Milano: Calce", "CA"],
  ["1", "Milano: Brunello", "BR"],
  ["2", "Milano: Carboné", "DG"],
].map(([code, label, value]) => ({
  param: "SIDING" as const,
  code,
  label,
  attrKey: "siding",
  attrValue: value,
}));

// Only Firepit is offered today; 0-9 are legacy but still appear in saved links.
const PATIOS: CatalogueOption[] = [
  ["0", "Sofa A", "SOFA W/ TABLE RIGHT"],
  ["1", "Sofa B", "SOFA W/ TABLE LEFT"],
  ["2", "Sofa Corner", "Sofa Corner"],
  ["3", "Chair", "Sofa Chair"],
  ["4", "Ottoman", "Ottoman"],
  ["5", "Coffee Table", "Coffee Table"],
  ["6", "Lounger", "Lounger"],
  ["7", "Lounger 2", "Lounger"],
  ["8", "Lap Over Table", "U Shape Table"],
  ["9", "Cantilever Umbrella", "Bamboo Cantilever"],
  ["10", "Firepit", "Firepit"],
].map(([code, label, product]) => ({
  param: "PATIOS" as const,
  code,
  label,
  lines: [{ label: product, qty: 1 }],
}));

export const CONFIGURATOR_CATALOGUE: CatalogueOption[] = [
  ...ISLANDS,
  ...BAR_ISLANDS,
  ...GRILL_HEADS,
  ...STAINLESS,
  ...TOPS,
  ...FOOTREST,
  ...ACCESS_DOORS,
  ...COMBOS,
  ...SHADES,
  ...HAPPY,
  ...STOOLS,
  ...STONE,
  ...SIDING,
  ...PATIOS,
];

// ---- lookup -----------------------------------------------------------------

/** Exact (param, code) lookup — how the URL parser resolves an option. */
export function findOption(
  catalogue: CatalogueOption[],
  param: ConfigParam,
  code: string
): CatalogueOption | null {
  return catalogue.find((o) => o.param === param && o.code === code) ?? null;
}

function normalizeLabel(s: string): string {
  return (
    s
      .trim()
      .toLowerCase()
      .replace(/\s+/g, " ")
      // The configurator writes "Ice Maker + Stainless Trim Kit" where the
      // agreement writes "Ice Maker - Stainless Trim Kit". Only a separator
      // WITH spaces around it is levelled, so "GS-32" and "HSL-32" survive.
      .replace(/ [-+] /g, " - ")
  );
}

/**
 * Label lookup — how the PDF parser resolves an option, since the agreement
 * prints words rather than indexes. `params` narrows the search to the section
 * the line appeared under, so "LED Lighting" under Happy Hours can't collide
 * with anything else. Duplicate labels (HAPPY 2 and 6 are both "LED Lighting")
 * resolve to the first, which is deliberate: they have identical effects.
 */
export function findOptionByLabel(
  catalogue: CatalogueOption[],
  label: string,
  params?: ConfigParam[]
): CatalogueOption | null {
  const want = normalizeLabel(label);
  const pool = params ? catalogue.filter((o) => params.includes(o.param)) : catalogue;
  return (
    pool.find((o) => normalizeLabel(o.label) === want) ??
    pool.find((o) => (o.aliases ?? []).some((a) => normalizeLabel(a) === want)) ??
    null
  );
}
