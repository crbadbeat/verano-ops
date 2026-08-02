import type { Division, SalesLevel, SeparationType } from "@prisma/client";

// -----------------------------------------------------------------------------
// ADP employee-master mapping — pure, unit-tested, no DB. Turns raw ADP export
// rows into the WMS employee shape and encodes the business rules that ride on
// the file:
//  - ID: payroll code 41N -> "I"+file, OSC -> "D"+file, leading zeros stripped.
//    The code also fixes the division: 41N = PGI, OSC = PGD.
//  - SALARY GATE: pay is mapped ONLY for an allow-list of roles; every other
//    title's salary is dropped to null by policy (confidentiality).
//  - Row filter: current roster (Active/Leave/Retired) + terminations within the
//    last 12 months.
// The DB upsert + location/manager resolution live in the import action; this
// file never touches Prisma so it stays testable.
// -----------------------------------------------------------------------------

// ---- CSV parse (RFC-4180: quotes, embedded commas + newlines) ----------------
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      /* skip */
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Parse the ADP CSV to header-keyed row objects. */
export function parseAdpRows(text: string): Record<string, string>[] {
  const grid = parseCsv(text);
  if (grid.length === 0) return [];
  const header = grid[0].map((h) => h.trim());
  return grid
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => {
      const o: Record<string, string> = {};
      header.forEach((h, i) => (o[h] = (r[i] ?? "").trim()));
      return o;
    });
}

// ---- ID + division ----------------------------------------------------------
const CODE_TO_DIVISION: Record<string, Division> = { "41N": "PGI", OSC: "PGD" };
const CODE_TO_PREFIX: Record<string, string> = { "41N": "I", OSC: "D" };

/** Build the {division, divisionCode} from payroll company code + file number. */
export function divisionFromPayroll(
  payrollCode: string,
  fileNumber: string
): { division: Division; divisionCode: string } | null {
  const code = payrollCode.trim().toUpperCase();
  const division = CODE_TO_DIVISION[code];
  const prefix = CODE_TO_PREFIX[code];
  if (!division || !prefix) return null;
  const stripped = fileNumber.trim().replace(/^0+/, "") || "0";
  return { division, divisionCode: `${prefix}${stripped}` };
}

// ---- supervisor → manager (deterministic) -----------------------------------
// The ADP "Supervisor Legal Name" is "Last, First (CODEfile)" where CODEfile is
// the supervisor's payroll code + file number, e.g. "(OSC000340)" -> D340. That
// parenthetical is an EXACT id, so the org chart resolves with zero name-guessing.
export function supervisorCodeFromName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const m = raw.match(/\(([0-9A-Za-z]*?[A-Za-z])(\d+)\)/);
  if (!m) return null;
  const div = divisionFromPayroll(m[1], m[2]);
  return div?.divisionCode ?? null;
}

// ---- salary gate ------------------------------------------------------------
function normTitle(t: string): string {
  return t.trim().toLowerCase().replace(/\s+/g, " ");
}

// The ONLY roles whose salary may be imported (exact ADP spellings, incl. the
// "Comissioned Sales" typo). Everyone else keeps null pay.
export const SALARY_ALLOWED_TITLES = new Set(
  [
    "Warehouse",
    "Delivery Manager",
    "Delivery Driver",
    "Warehouse Worker",
    "Gallery Team Leader",
    "Prod - Aluminum Cutter",
    "Inventory Supervisor",
    "Production Worker",
    "Sales Associate",
    "Production",
    "Production - Electric",
    "Production Boarding",
    "Production Stucco",
    "Production Welder",
    "Commissioned Sales Person",
    "Commissioned Sales Rep",
    "Comissioned Sales",
  ].map(normTitle)
);

export function salaryAllowedForTitle(title: string): boolean {
  return SALARY_ALLOWED_TITLES.has(normTitle(title));
}

/** Parse a money string ("45,000", "$15.50", "45000.00") to integer cents. */
export function moneyToCents(v: string): number | null {
  const s = v.replace(/[$,\s]/g, "").trim();
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

// ---- sales level from title -------------------------------------------------
export function salesLevelFromTitle(title: string): SalesLevel | null {
  const t = normTitle(title);
  if (t.includes("vp of sales") || t.includes("vp of show sales")) return "VP";
  if (t.includes("regional") || /\breg team lead\b/.test(t) || t.includes("national sales team"))
    return "REGIONAL";
  if (t.includes("gallery team leader")) return "GTL";
  if (
    t === "sales associate" ||
    t.includes("commissioned sales") ||
    t.includes("comissioned sales") ||
    t === "salesman" ||
    t === "sales" ||
    t.includes("professional sales")
  )
    return "REP";
  return null;
}

// ---- separation → commission rule -------------------------------------------
export function separationFrom(
  positionStatus: string,
  volFlag: string,
  reason: string
): SeparationType | null {
  if (normTitle(positionStatus) !== "terminated") return null; // active/leave/retired
  const r = normTitle(reason);
  if (r.includes("no-show") || r.includes("no show") || r.includes("abandon")) return "QUIT_NO_NOTICE";
  const v = normTitle(volFlag);
  if (v === "involuntary") return "TERMINATED";
  if (v === "voluntary") return "QUIT_WITH_NOTICE";
  return null;
}

// ---- home location matching -------------------------------------------------
/** Normalize a location name for tolerant matching (drop case + punctuation). */
export function normLocation(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// ADP location description -> WMS Location name, for the cases where the two
// spell the same place differently ("Fort" vs "Ft.", "The Woodlands" vs
// "Woodlands"). Genuinely-new sites (Humble, Houston, Kennesaw, …) are left out
// and reported by the importer for a human to create or map.
export const LOCATION_ALIASES: Record<string, string> = {
  "boynton beach": "Boynton",
  "fort lauderdale": "Ft. Lauderdale",
  "fort myers": "Ft. Myers",
  "fort worth": "Ft. Worth",
  "the woodlands": "Woodlands",
  mizner: "Mizner Park",
  "naples on 5th": "Naples",
  delray: "West Delray",
  "boca raton town center": "Boca Town Center",
  "indianapolis fashion mall": "Fashion Mall",
  "kierland commons": "Kierland",
  "bonita beach": "Bonita Springs",
};

/** ADP raw location that means "not a showroom" (no home site to assign). */
export function isNonShowroomLocation(raw: string): boolean {
  const n = normLocation(raw);
  return n === "" || n === normLocation("Corporate Office");
}

// ---- dates ------------------------------------------------------------------
/** Parse an ADP date (m/d/yyyy or yyyy-mm-dd) to a UTC-midnight Date, or null. */
export function adpDate(v: string): Date | null {
  const s = v.trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const [, mo, d, y] = m;
    return new Date(Date.UTC(+y, +mo - 1, +d));
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return new Date(`${s}T00:00:00.000Z`);
  return null;
}

// ---- the mapped record ------------------------------------------------------
export interface MappedEmployee {
  divisionCode: string;
  division: Division;
  name: string;
  firstName: string | null;
  lastName: string | null;
  preferredFirst: string | null;
  title: string | null;
  salesLevel: SalesLevel | null;
  homeLocationRaw: string | null;
  supervisorName: string | null;
  hireDate: Date | null;
  endDate: Date | null;
  separationType: SeparationType | null;
  active: boolean;
  annualSalaryCents: number | null;
  payRateCents: number | null;
  payClass: string | null;
  payStructure: string | null;
  email: string | null;
}

export interface SkippedRow {
  name: string;
  reason: string;
}

const ROSTER_STATUSES = new Set(["active", "leave", "retired"]);

/** Whether a row is in scope: roster, or terminated within the last 12 months. */
export function inScope(row: Record<string, string>, now: Date): boolean {
  const status = normTitle(row["Position Status"] ?? "");
  if (ROSTER_STATUSES.has(status)) return true;
  if (status === "terminated") {
    const term = adpDate(row["Termination Date"] ?? "");
    if (!term) return false;
    const cutoff = new Date(now);
    cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
    return term.getTime() >= cutoff.getTime();
  }
  return false;
}

/** Map one raw ADP row to a MappedEmployee, or null if the payroll code is unknown. */
export function mapAdpRow(row: Record<string, string>): MappedEmployee | null {
  const div = divisionFromPayroll(row["Payroll Company Code"] ?? "", row["File Number"] ?? "");
  if (!div) return null;

  const first = (row["Legal First Name"] ?? "").trim();
  const last = (row["Legal Last Name"] ?? "").trim();
  const preferred = (row["Preferred or Chosen First Name"] ?? "").trim();
  const payroll = (row["Payroll Name"] ?? "").trim();
  // Natural "First Last" (preferred first name wins); fall back to the raw payroll
  // name, then the id, so the display name is never empty.
  const name = [preferred || first, last].filter(Boolean).join(" ") || payroll || div.divisionCode;

  const title = (row["Job Title Description"] ?? "").trim() || null;
  const status = normTitle(row["Position Status"] ?? "");
  const allowSalary = title ? salaryAllowedForTitle(title) : false;

  const supervisor = (row["Supervisor Legal Name"] ?? "").trim();

  return {
    divisionCode: div.divisionCode,
    division: div.division,
    name,
    firstName: first || null,
    lastName: last || null,
    preferredFirst: (row["Preferred or Chosen First Name"] ?? "").trim() || null,
    title,
    salesLevel: title ? salesLevelFromTitle(title) : null,
    homeLocationRaw: (row["Location Description"] ?? "").trim() || null,
    supervisorName: supervisor || null,
    hireDate: adpDate(row["Hire Date"] ?? ""),
    endDate: adpDate(row["Termination Date"] ?? ""),
    separationType: separationFrom(
      row["Position Status"] ?? "",
      row["Voluntary/Involuntary Termination Flag"] ?? "",
      row["Termination Reason Description"] ?? ""
    ),
    // Currently employed = Active or on Leave. Retired/Terminated are inactive.
    active: status === "active" || status === "leave",
    // SALARY GATE — null unless the title is allow-listed.
    annualSalaryCents: allowSalary ? moneyToCents(row["Annual Salary"] ?? "") : null,
    payRateCents: allowSalary ? moneyToCents(row["Regular Pay Rate Amount"] ?? "") : null,
    payClass: (row["Pay Class"] ?? "").trim() || null,
    payStructure: (row["Pay Structure"] ?? "").trim() || null,
    email: null, // ADP export carries no work email column; set later / by hand
  };
}
