// Validates a SKU against its category grammar and explains exactly what is
// wrong with it. This is the feed for the SKU review queue: anything that comes
// back `ok: false` is a row a human needs to look at, rather than something we
// silently import or guess at.
//
// Where a correction is unambiguous (the product owner has ruled on it) we
// attach a `suggestion` — but we never apply it automatically.
//
// Pure logic only — no DB imports — so it is Vitest-testable (sku-validate.test.ts).

import { decodeSku, type SkuGrammar } from "./sku";
import { getGrammar } from "./sku-grammar";

export type SkuProblemKind =
  | "UNKNOWN_CODE" // a segment holds a code the grammar doesn't recognise
  | "SEGMENT_COUNT" // a delimited SKU has the wrong number of segments
  | "MISSING_SEGMENT" // a required segment ran off the end of the SKU
  | "UNPARSED"; // characters left over that no segment claimed

export interface SkuProblem {
  kind: SkuProblemKind;
  /** Attribute key of the offending segment, when the problem is segment-local. */
  segment?: string;
  /** Human label of that segment, e.g. "Grill hole". */
  label?: string;
  /** The offending text. */
  code?: string;
  /** One-line explanation for the reviewer. */
  detail: string;
}

export interface SkuValidation {
  sku: string;
  category: string | null;
  ok: boolean;
  /** Which glass form matched (configured / blank / bare), when one did. */
  variant?: string;
  problems: SkuProblem[];
  /** A corrected SKU, only where the rule is unambiguous. Never auto-applied. */
  suggestion?: string;
}

/**
 * A style code whose number was not zero-padded, e.g. `GX9` for `GX09`.
 * Ruled a data error by the product owner, so it is safe to suggest the fix.
 */
function padStyle(code: string, known: Set<string>): string | undefined {
  const m = /^([A-Z]+)(\d+)$/.exec(code);
  if (!m) return undefined;
  const [, prefix, digits] = m;
  for (let width = digits.length + 1; width <= 4; width++) {
    const candidate = `${prefix}${digits.padStart(width, "0")}`;
    if (known.has(candidate)) return candidate;
  }
  return undefined;
}

function styleCodes(grammar: SkuGrammar): Set<string> {
  const seg = grammar.segments.find((s) => s.key === "style");
  return new Set((seg?.options ?? []).map((o) => o.code));
}

/**
 * The burner segment is always two characters, so a source row that typed `NN`
 * as `N-N` split into an extra segment. Rejoin it.
 */
function rejoinSplitBurner(
  parts: string[],
  expected: number
): string | undefined {
  if (parts.length !== expected + 1) return undefined;
  if (parts[2] !== "N" || parts[3] !== "N") return undefined;
  const fixed = [...parts];
  fixed.splice(2, 2, "NN");
  return fixed.join("-");
}

export function validateSku(
  sku: string,
  category: string | null | undefined
): SkuValidation {
  const clean = sku.trim();
  const grammar = getGrammar(category);
  const base = { sku: clean, category: category ?? null };

  // Appliances / raw goods are plain SKUs — nothing to validate against.
  if (!grammar) return { ...base, ok: true, problems: [] };

  const problems: SkuProblem[] = [];
  let suggestion: string | undefined;

  if (grammar.delimiter) {
    const parts = clean.split(grammar.delimiter);
    const expected = grammar.segments.length;

    if (parts.length !== expected) {
      // Every segment after the break reads as the wrong attribute, so reporting
      // per-segment errors here would just be noise. Report the shape only.
      problems.push({
        kind: "SEGMENT_COUNT",
        code: clean,
        detail: `Expected ${expected} dash-separated segments, found ${parts.length}.`,
      });
      return {
        ...base,
        ok: false,
        problems,
        suggestion: rejoinSplitBurner(parts, expected),
      };
    }
  }

  const decoded = decodeSku(clean, grammar);

  // A sequential grammar that matched a variant has explained the whole SKU.
  if (grammar.sequential && decoded.variant) {
    return { ...base, ok: true, variant: decoded.variant, problems: [] };
  }

  for (const attr of decoded.attributes) {
    if (attr.known) continue;
    if (!attr.code) {
      problems.push({
        kind: "MISSING_SEGMENT",
        segment: attr.key,
        label: attr.label,
        detail: `${attr.label} is missing — the SKU ends before it.`,
      });
      continue;
    }
    problems.push({
      kind: "UNKNOWN_CODE",
      segment: attr.key,
      label: attr.label,
      code: attr.code,
      detail: `${attr.label} "${attr.code}" is not a recognised code.`,
    });
    if (attr.key === "style" && !suggestion) {
      const padded = padStyle(attr.code, styleCodes(grammar));
      if (padded) suggestion = clean.replace(attr.code, padded);
    }
  }

  if (decoded.leftover) {
    problems.push({
      kind: "UNPARSED",
      code: decoded.leftover,
      detail: `"${decoded.leftover}" is left over after the last segment.`,
    });
  }

  return {
    ...base,
    ok: problems.length === 0,
    variant: decoded.variant,
    problems,
    suggestion,
  };
}
