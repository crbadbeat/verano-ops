// Config-driven smart-SKU decoder for configured products (Bases and Glass).
// The SKU string encodes the configuration by position (or by delimiter). A
// grammar (see lib/sku-grammar.ts) maps segments <-> attribute values so we can
// (a) render a human label for any SKU, and (b) let counters build a SKU from
// cascading dropdowns. Appliances / raw goods are plain SKUs and bypass this.
//
// Three reading modes:
//   delimited  — split on a delimiter, one segment per index (Bases).
//   fixed      — every segment has an absolute start + length.
//   sequential — segments consume left-to-right, each taking the LONGEST option
//                code that matches at the cursor. Needed where a segment's width
//                varies (Glass: grill hole is `C` or `CXL`, style is `GX08` or
//                `FIREPIT`). Unknown codes fall back to the nominal `length` so
//                the segments after them still line up.
//
// A sequential grammar may also declare `variants` — genuinely different whole-
// SKU forms. Glass has three: a configured top, a blank, and a bare short code.
// The first variant that consumes the whole SKU with every code known wins.
//
// Pure logic only — no DB / server-only imports — so it runs in the browser
// (the configurator) and under Vitest (see lib/sku.test.ts).

export type SkuCategory = "BASE" | "GLASS";

export interface SkuSegmentOption {
  code: string;
  label: string;
}

export interface SkuSegment {
  key: string; // attribute key, e.g. "style"
  label: string; // human label, e.g. "Style"
  /** Fixed grammars: 0-based start. */
  start?: number;
  /** Fixed grammars: exact width. Sequential grammars: nominal width, used only
   *  as the fallback consumption when no option code matches. */
  length?: number;
  /** Delimited read: which split index this segment occupies. */
  index?: number;
  /** Allowed codes -> human labels. Order is preserved for dropdowns. */
  options: SkuSegmentOption[];
  optional?: boolean;
}

/** A whole alternative SKU form (sequential grammars only). */
export interface SkuVariant {
  key: string; // e.g. "blank"
  label: string; // e.g. "Blank (uncut)"
  segments: SkuSegment[];
}

export interface SkuGrammar {
  category: SkuCategory;
  /** If set, the SKU is split on this delimiter; otherwise segments are positional. */
  delimiter?: string;
  /** Positional grammars only: consume left-to-right instead of by absolute start. */
  sequential?: boolean;
  /** The primary form. Also the best-effort fallback when no variant matches. */
  segments: SkuSegment[];
  /** Alternative forms, tried in order before falling back to `segments`. */
  variants?: SkuVariant[];
}

export interface DecodedAttribute {
  key: string;
  label: string;
  code: string;
  value: string; // human label for the code (falls back to the raw code)
  known: boolean; // false if the code wasn't in the grammar's options
}

export interface DecodedSku {
  sku: string;
  attributes: DecodedAttribute[];
  /** Human-friendly one-line description, e.g. "Grand · 2 Burner · Sink". */
  label: string;
  /** Which variant matched, when a sequential grammar declares variants. */
  variant?: string;
  /** Characters a sequential parse could not consume. "" when it read cleanly. */
  leftover?: string;
}

/** Segments in read order (by start for fixed, by index for delimited). */
export function segmentsFor(grammar: SkuGrammar): SkuSegment[] {
  if (grammar.sequential) return [...grammar.segments]; // already in read order
  const copy = [...grammar.segments];
  return grammar.delimiter
    ? copy.sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    : copy.sort((a, b) => (a.start ?? 0) - (b.start ?? 0));
}

function readSegment(sku: string, grammar: SkuGrammar, seg: SkuSegment): string {
  if (grammar.delimiter) {
    const parts = sku.split(grammar.delimiter);
    return (seg.index != null ? parts[seg.index] ?? "" : "").trim();
  }
  if (seg.start != null && seg.length != null) {
    return sku.slice(seg.start, seg.start + seg.length).trim();
  }
  return "";
}

/** For a fixed positional grammar, the shortest SKU its segments can describe. */
function positionalMinLength(grammar: SkuGrammar): number {
  let min = 0;
  for (const s of grammar.segments) {
    if (s.start != null && s.length != null) min = Math.max(min, s.start + s.length);
  }
  return min;
}

function attributeFor(seg: SkuSegment, code: string): DecodedAttribute {
  const opt = seg.options.find((o) => o.code === code);
  return {
    key: seg.key,
    label: seg.label,
    code,
    value: opt?.label ?? code,
    known: !!opt,
  };
}

function labelFor(attributes: DecodedAttribute[], fallback: string): string {
  return (
    attributes
      .filter((a) => a.code)
      .map((a) => a.value)
      .join(" · ") || fallback
  );
}

interface SequentialRead {
  attributes: DecodedAttribute[];
  leftover: string;
  /** Every required segment matched a known option code. */
  clean: boolean;
}

/** Consume `segments` left-to-right, each taking the longest option that fits. */
function readSequential(sku: string, segments: SkuSegment[]): SequentialRead {
  let cursor = 0;
  const attributes: DecodedAttribute[] = [];
  let clean = true;

  for (const seg of segments) {
    const rest = sku.slice(cursor);

    let match: string | null = null;
    for (const { code } of seg.options) {
      if (!code || !rest.startsWith(code)) continue;
      if (match === null || code.length > match.length) match = code;
    }

    if (match !== null) {
      attributes.push(attributeFor(seg, match));
      cursor += match.length;
      continue;
    }

    // An optional segment simply isn't present.
    if (seg.optional) continue;

    // Unknown (or missing) code: take the nominal width so the segments after
    // this one still line up, and let the caller see it was not understood.
    const code = rest.slice(0, seg.length ?? 0);
    attributes.push(attributeFor(seg, code));
    cursor += code.length;
    clean = false;
  }

  return { attributes, leftover: sku.slice(cursor), clean };
}

/** A variant only wins if it explains the SKU completely. */
function isCompleteRead(read: SequentialRead): boolean {
  return read.clean && read.leftover === "" && read.attributes.every((a) => a.code);
}

/** Decode a SKU into its configuration attributes using a grammar (null = raw). */
export function decodeSku(sku: string, grammar: SkuGrammar | null): DecodedSku {
  const clean = sku.trim();
  if (!grammar) return { sku: clean, attributes: [], label: clean };

  if (grammar.sequential) {
    const forms: SkuVariant[] = grammar.variants?.length
      ? grammar.variants
      : [{ key: "default", label: "", segments: grammar.segments }];

    for (const form of forms) {
      const read = readSequential(clean, form.segments);
      if (isCompleteRead(read)) {
        return {
          sku: clean,
          attributes: read.attributes,
          label: labelFor(read.attributes, clean),
          variant: form.key,
          leftover: "",
        };
      }
    }

    // Nothing explained it. Report a best-effort read of the primary form so
    // callers can see exactly which segment went wrong.
    const read = readSequential(clean, grammar.segments);
    return {
      sku: clean,
      attributes: read.attributes,
      label: labelFor(read.attributes, clean),
      leftover: read.leftover,
    };
  }

  // A fixed positional SKU shorter than the grammar needs (e.g. a short-form
  // code) would slice into nonsense — hand it back raw instead.
  if (!grammar.delimiter && clean.length < positionalMinLength(grammar)) {
    return { sku: clean, attributes: [], label: clean };
  }

  const attributes: DecodedAttribute[] = [];
  for (const seg of grammar.segments) {
    const code = readSegment(clean, grammar, seg);
    if (!code && seg.optional) continue;
    attributes.push(attributeFor(seg, code));
  }
  return { sku: clean, attributes, label: labelFor(attributes, clean) };
}

/**
 * Build a SKU from a set of segment selections (attribute key -> code).
 * `variantKey` picks an alternative form on a sequential grammar.
 */
export function composeSku(
  grammar: SkuGrammar,
  selections: Record<string, string>,
  variantKey?: string
): string {
  const variant = variantKey
    ? grammar.variants?.find((v) => v.key === variantKey)
    : undefined;
  const ordered = variant ? variant.segments : segmentsFor(grammar);
  const codes: string[] = [];
  for (const seg of ordered) {
    const code = selections[seg.key] ?? "";
    if (!code && seg.optional) continue; // an omitted optional segment
    codes.push(code);
  }
  return grammar.delimiter ? codes.join(grammar.delimiter) : codes.join("");
}
