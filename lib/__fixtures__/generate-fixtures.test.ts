import { it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { extractFsaRows, type FsaRow } from "../order-parse-pdf";

// Regenerates the Final Sales Agreement fixtures from real PDFs, REDACTING the
// customer's name, address, email, phone and the rep's name on the way through
// so the suite never carries anyone's personal data.
//
// Skipped unless you ask for it, because it reads PDFs that only exist on the
// machine that produced them:
//
//   REGENERATE_FSA_FIXTURES=1 FSA_TWO_ISLANDS=/path/a.pdf FSA_ACCESSORIES=/path/b.pdf \
//     npx vitest run lib/__fixtures__/generate-fixtures.test.ts

const ENABLED = process.env.REGENERATE_FSA_FIXTURES === "1";

const SOURCES: [envVar: string, output: string][] = [
  ["FSA_TWO_ISLANDS", "fsa-two-islands.json"],
  ["FSA_ACCESSORIES", "fsa-accessories-only.json"],
];

const REDACTIONS: [RegExp, string][] = [
  [/^(LAST\s*:\s*).*$/i, "$1Testcustomer"],
  [/^(FIRST\s*:\s*).*$/i, "$1Pat"],
  [/^(EMAIL\s*:\s*).*$/i, "$1pat@example.com"],
  [/^(PHONE\s*:\s*).*$/i, "$15555550100"],
  [/^(CELL\s*:\s*).*$/i, "$1"],
  [/^(GTL ID\s*:\s*).*$/i, "$1D-0001"],
  [/^(REP ID\s*:\s*).*$/i, "$1D-0002"],
  [/^(Gallery\s*:\s*).*$/i, "$1Testville, FL"],
];

/**
 * Addresses are redacted per BLOCK, not with one value, because whether the
 * billing address matches the delivery address is exactly what sends an order
 * for a manual fraud check. Collapsing both to the same fake street would make
 * the fixture stop exercising that.
 */
const ADDRESS_BY_BLOCK = {
  billing: { address: "1 Test Street", city: "Testville", zip: "00000" },
  delivery: { address: "2 Test Avenue", city: "Testburg", zip: "00001" },
};

function redactAddresses(rows: FsaRow[]): void {
  let block: keyof typeof ADDRESS_BY_BLOCK | null = null;
  for (const row of rows) {
    for (const cell of row.cells) {
      if (/^BILLING ADDRESS/i.test(cell.text)) block = "billing";
      else if (/^DELIVERY ADDRESS/i.test(cell.text)) block = "delivery";
      if (!block) continue;
      const fake = ADDRESS_BY_BLOCK[block];
      cell.text = cell.text
        .replace(/^(Address\s*:\s*).*$/i, `$1${fake.address}`)
        .replace(/^(CITY\s*:\s*).*$/i, `$1${fake.city}`)
        .replace(/^(ZIP\s*:\s*).*$/i, `$1${fake.zip}`);
    }
  }
}

/** The rep's name appears bare under a "Sales rep" label, so redact by position. */
function redactRepName(rows: FsaRow[]): void {
  for (const [index, row] of rows.entries()) {
    for (const cell of row.cells) {
      if (!/^Sales rep$/i.test(cell.text)) continue;
      for (const later of rows.slice(index + 1, index + 8)) {
        for (const c of later.cells) {
          if (Math.abs(c.x - cell.x) < 40 && /^[A-Za-z][A-Za-z.'\- ]+$/.test(c.text)) {
            c.text = "Sample Rep";
          }
        }
      }
    }
  }
}

// Terms-page prose that used to hijack the header fields. Kept on purpose so the
// regression stays covered.
const ADVERSARIAL = [
  /^last two pages/i,
  /^Address verification required/i,
  /^state Customers must accept/i,
];

it.runIf(ENABLED)("regenerates the redacted FSA fixtures", async () => {
  const dir = path.join(process.cwd(), "lib", "__fixtures__");

  for (const [envVar, output] of SOURCES) {
    const source = process.env[envVar];
    expect(source, `set ${envVar} to the source PDF`).toBeTruthy();

    const doc = await extractFsaRows(new Uint8Array(fs.readFileSync(source!)));
    const pageOf = (re: RegExp): number | undefined =>
      doc.rows.find((r) => r.cells.some((c) => re.test(c.text)))?.page;

    const itemPage = pageOf(/^ITEM PURCHASED AND QUANTITY$/i) ?? 1;
    // Every page the parser actually reads, plus the lines that once broke it.
    const keepPages = new Set(
      [
        ...Array.from({ length: itemPage }, (_, i) => i + 1),
        pageOf(/^REQUESTED DELIVERY TIMEFRAME$/i),
        pageOf(/^Order total$/i),
        pageOf(/^Sales rep$/i),
      ].filter((p): p is number => p != null)
    );

    const rows = doc.rows
      .filter(
        (r) =>
          keepPages.has(r.page) ||
          r.cells.some((c) => ADVERSARIAL.some((re) => re.test(c.text)))
      )
      .map((r) => ({
        ...r,
        cells: r.cells.map((c) => {
          let text = c.text;
          for (const [re, to] of REDACTIONS) text = text.replace(re, to);
          return { ...c, text };
        }),
      }));

    redactAddresses(rows);
    redactRepName(rows);
    const text = rows.map((r) => r.cells.map((c) => c.text).join("\t")).join("\n");
    fs.writeFileSync(path.join(dir, output), `${JSON.stringify({ rows, text }, null, 1)}\n`);
  }
}, 60_000);
