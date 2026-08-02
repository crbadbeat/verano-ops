import type { SkuCategory, SkuGrammar, SkuSegment, SkuSegmentOption } from "./sku";

// Verano Outdoor Living smart-SKU grammars, from the product owner's structure sheets
// and rulings, validated against the whole product master (see sku-grammar.test.ts).
//
//   BASE  — dash-delimited, 11 segments:
//           Style-GrillHole-Burner-AccessDoors-Fridges-Drawer/Trash-Warming-Audio-LED-FootRail-Siding
//           e.g. GX10-CXL-PR-D1-1-2-0-N-N-N-DG
//
//   GLASS — sequential, three forms:
//           configured  Color Style GrillHole Burner Tiki Sink Umbrella [-MC]
//                       e.g. ISLARB6LNNNNY, ISLGX08RXLDLNNN (XL hole = 3 chars)
//           blank       Color Style [Seam] BLANK
//                       e.g. ISLGX08BLANK, ISLGX12CBLANK
//           bare        Color Style          e.g. ISLFIREPIT
//
// Unknown codes still decode — they come back with `known: false` so oddities in
// the source data surface instead of being silently mislabelled.

const yesNo = (yes: string, no: string): SkuSegmentOption[] => [
  { code: "Y", label: yes },
  { code: "N", label: no },
];

/** 0..max hole counts, e.g. "No fridges" / "1 fridge" / "2 fridges". */
function counts(
  singular: string,
  plural: string,
  max = 4,
  extra: SkuSegmentOption[] = []
): SkuSegmentOption[] {
  const out: SkuSegmentOption[] = [];
  for (let i = 0; i <= max; i++) {
    out.push({
      code: String(i),
      label: i === 0 ? `No ${plural}` : `${i} ${i === 1 ? singular : plural}`,
    });
  }
  return [...out, ...extra];
}

// Island styles and their names, from the `Style_Lookup` tab of Glass_Lookup.xlsx
// — the product owner's own authority, so these codes and names are canonical.
const STYLES: SkuSegmentOption[] = [
  { code: "ARB6", label: "Aruba 6" },
  { code: "ARB8", label: "Aruba 8" },
  { code: "EASY", label: "Speakeasy" },
  { code: "FIREPIT", label: "Fire Pit" },
  { code: "GX03", label: "GX-03" },
  { code: "GX04", label: "GX-04" },
  { code: "GX05", label: "GX-05" },
  { code: "GX06", label: "GX-06" },
  { code: "GX07", label: "GX-07" },
  { code: "GX08", label: "GX-08" },
  { code: "GX09", label: "GX-09" },
  { code: "GX10", label: "GX-10" },
  { code: "GX12", label: "GX-12" },
  { code: "GX14", label: "GX-14" },
  { code: "MA08", label: "Maui 08" },
  { code: "MA10", label: "Maui 10" },
  { code: "MA12", label: "Maui 12" },
  { code: "MA14", label: "Maui 14" },
  { code: "PRT7", label: "Portofino 7" },
  { code: "PRT9", label: "Portofino 9" },
  { code: "STC8", label: "St. Croix 8" },
  { code: "STC9", label: "St. Croix 9" },
  { code: "STR9", label: "St. Tropez" },
  { code: "STT7", label: "St. Thomas 7" },
  { code: "STT9", label: "St. Thomas 9" },
];

// Bases additionally carry a 26" fire pit; no glass top exists for it.
const BASE_STYLES: SkuSegmentOption[] = [
  ...STYLES,
  { code: "26FIREPIT", label: "26\" Fire Pit" },
];
const GLASS_STYLES: SkuSegmentOption[] = STYLES;

// Grill-hole placement. The *XL codes are the same placement cut larger for the
// XL grill — 3 characters, so Glass reads this segment at variable width.
const GRILL_HOLE: SkuSegmentOption[] = [
  { code: "N", label: "No grill hole" },
  { code: "L", label: "Grill left" },
  { code: "R", label: "Grill right" },
  { code: "C", label: "Grill center" },
  { code: "D", label: "Double grill" },
  { code: "CXL", label: "Grill center (XL)" },
  { code: "DXL", label: "Double grill (XL)" },
  { code: "LXL", label: "Grill left (XL)" },
  { code: "RXL", label: "Grill right (XL)" },
];

// Burner: first letter = type (D/P/S), second = side relative to the grill hole.
// ALWAYS two characters — a lone `N` is malformed data, not "no burner".
const BURNER: SkuSegmentOption[] = [
  { code: "NN", label: "No burner" },
  { code: "DR", label: "Double burner right" },
  { code: "DL", label: "Double burner left" },
  { code: "PR", label: "Power burner right" },
  { code: "PL", label: "Power burner left" },
  { code: "SR", label: "Single burner right" },
  { code: "SL", label: "Single burner left" },
];

const AUDIO: SkuSegmentOption[] = [
  { code: "N", label: "No audio" },
  { code: "Y", label: "Audio package" },
  { code: "SPO", label: "Speakers only" },
  { code: "LSPO", label: "LED speakers only" },
  { code: "L", label: "LED audio package" },
];

const SIDING: SkuSegmentOption[] = [
  { code: "CA", label: "Stucco siding" }, // the standard
  { code: "BR", label: "Brown siding" },
  { code: "DG", label: "Dark grey siding" },
];

const COLORS: SkuSegmentOption[] = [
  { code: "ISL", label: "Greek Isle" },
  { code: "TIT", label: "Titanium" },
  { code: "TRV", label: "Travertine" },
  { code: "VOL", label: "Volcanic Ash" },
];

// Monaco holes are square 5x5 cutouts in the same position as the tiki holes,
// which is why they share this segment.
const TIKI: SkuSegmentOption[] = [
  { code: "Y", label: "Tiki holes" },
  { code: "N", label: "No tiki" },
  { code: "M", label: "Monaco holes" },
];

// Tops over 10ft ship in two pieces. The seam is only ever recorded on a blank —
// once a top is configured the grill hole occupies this position instead.
const SEAM: SkuSegmentOption[] = [
  { code: "C", label: "Center seam (equal halves)" },
  { code: "D", label: "Offset seam" },
];

const BASE: SkuGrammar = {
  category: "BASE",
  delimiter: "-",
  segments: [
    { key: "style", label: "Style", index: 0, options: BASE_STYLES },
    { key: "grillHole", label: "Grill hole", index: 1, options: GRILL_HOLE },
    { key: "burner", label: "Burner", index: 2, options: BURNER },
    {
      key: "accessDoors",
      label: "Access doors",
      index: 3,
      // Mostly a hole count, but the source data also uses D1 / D2 / N.
      options: counts("access door", "access doors", 4, [
        { code: "D1", label: "D1 access door" },
        { code: "D2", label: "D2 access doors" },
        { code: "N", label: "No access doors" },
      ]),
    },
    { key: "fridges", label: "Fridges", index: 4, options: counts("fridge", "fridges") },
    {
      key: "drawerTrash",
      label: "Drawer / trash",
      index: 5,
      options: counts("drawer/trash", "drawer/trash"),
    },
    {
      key: "warming",
      label: "Warming drawer",
      index: 6,
      options: counts("warming drawer", "warming drawers"),
    },
    { key: "audio", label: "Audio", index: 7, options: AUDIO },
    { key: "led", label: "LED", index: 8, options: yesNo("LED lighting", "No LED") },
    {
      key: "footRail",
      label: "Foot rail",
      index: 9,
      options: yesNo("Foot rail", "No foot rail"),
    },
    { key: "siding", label: "Siding", index: 10, options: SIDING },
  ],
};

// Shared leading segments of every glass form.
const GLASS_COLOR: SkuSegment = {
  key: "color",
  label: "Color",
  length: 3,
  options: COLORS,
};
const GLASS_STYLE: SkuSegment = {
  key: "style",
  label: "Style",
  length: 4, // nominal; FIREPIT is longer and matches by option, not by width
  options: GLASS_STYLES,
};

/** A cut top: grill hole, burner and the hole flags. */
const GLASS_CONFIGURED: SkuSegment[] = [
  GLASS_COLOR,
  GLASS_STYLE,
  { key: "grillHole", label: "Grill hole", length: 1, options: GRILL_HOLE },
  { key: "burner", label: "Burner", length: 2, options: BURNER },
  { key: "tiki", label: "Tiki / Monaco", length: 1, options: TIKI },
  { key: "sink", label: "Sink", length: 1, options: yesNo("Sink cutout", "No sink") },
  {
    key: "umbrella",
    label: "Umbrella",
    length: 1,
    options: yesNo("Umbrella hole", "No umbrella"),
  },
  {
    key: "misconfigured",
    label: "Condition",
    length: 3,
    optional: true,
    options: [
      { code: "-MC", label: "Misconfigured — holes cut in the wrong location" },
    ],
  },
];

/** An uncut top. BLANK means zero cuts, so the seam is all that can precede it. */
const GLASS_BLANK: SkuSegment[] = [
  GLASS_COLOR,
  GLASS_STYLE,
  { key: "seam", label: "Seam", length: 1, optional: true, options: SEAM },
  {
    key: "blank",
    label: "Blank",
    length: 5,
    options: [{ code: "BLANK", label: "Blank (uncut)" }],
  },
];

/** A short code that carries no configuration at all, e.g. ISLFIREPIT. */
const GLASS_BARE: SkuSegment[] = [GLASS_COLOR, GLASS_STYLE];

const GLASS: SkuGrammar = {
  category: "GLASS",
  sequential: true,
  segments: GLASS_CONFIGURED,
  variants: [
    { key: "configured", label: "Configured top", segments: GLASS_CONFIGURED },
    { key: "blank", label: "Blank (uncut)", segments: GLASS_BLANK },
    { key: "bare", label: "Short code", segments: GLASS_BARE },
  ],
};

export const GRAMMARS: Partial<Record<SkuCategory, SkuGrammar>> = { BASE, GLASS };

/**
 * Grammar for a product category. Tolerant of the free-text categories in the
 * product master ("Base", "Glass", "Glass Tops", …); anything else gets null.
 */
export function getGrammar(
  category: string | null | undefined
): SkuGrammar | null {
  if (!category) return null;
  const c = category.toLowerCase();
  if (c.includes("glass")) return GRAMMARS.GLASS ?? null;
  if (c.includes("base")) return GRAMMARS.BASE ?? null;
  return null;
}

/** True once a real grammar exists for the category (configurator vs picker). */
export function hasGrammar(category: string | null | undefined): boolean {
  return getGrammar(category) != null;
}
