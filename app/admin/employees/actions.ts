"use server";

import { redirect } from "next/navigation";
import { requireCan } from "@/lib/rbac";
import { getViewer } from "@/lib/permissions/engine";
import { revalidatePath } from "next/cache";
import { randomBytes } from "node:crypto";
import type { Prisma, PrismaClient, SalesLevel, SeparationType, Division } from "@prisma/client";
import { prisma } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { ASSIGNABLE_ROLES } from "@/lib/roles";
import { importAdpEmployees } from "@/lib/adp-import";
import { supervisorCodeFromName } from "@/lib/adp";

export interface ActionState {
  ok?: boolean;
  message?: string;
  /** A one-time temp password, shown once so the manager can hand it over. */
  tempPassword?: string;
}

const SALES_LEVELS: SalesLevel[] = ["REP", "GTL", "REGIONAL", "VP"];
const SEPARATIONS: SeparationType[] = ["TERMINATED", "QUIT_WITH_NOTICE", "QUIT_NO_NOTICE"];
const DIVISIONS: Division[] = ["PGI", "PGD"];

function str(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}
function nullable(v: FormDataEntryValue | null): string | null {
  const s = str(v);
  return s === "" ? null : s;
}
/** Parse a yyyy-mm-dd form value to a Date (midnight UTC), or null. */
function dateOrNull(v: FormDataEntryValue | null): Date | null {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00.000Z`);
}
function salesLevelOrNull(v: FormDataEntryValue | null): SalesLevel | null {
  const s = str(v);
  return SALES_LEVELS.includes(s as SalesLevel) ? (s as SalesLevel) : null;
}

type Tx = Prisma.TransactionClient | PrismaClient;

/**
 * Refresh an employee's cached org fields to the effective assignment as of
 * `asOf` (the latest row with effectiveDate <= asOf). The Employee row is a
 * convenience cache over the dated EmployeeAssignment history.
 */
async function recomputeAssignmentCache(tx: Tx, employeeId: string, asOf: Date): Promise<void> {
  const eff = await tx.employeeAssignment.findFirst({
    where: { employeeId, effectiveDate: { lte: asOf } },
    orderBy: [{ effectiveDate: "desc" }, { createdAt: "desc" }],
  });
  await tx.employee.update({
    where: { id: employeeId },
    data: {
      salesLevel: eff?.salesLevel ?? null,
      homeLocationId: eff?.homeLocationId ?? null,
      managerId: eff?.managerId ?? null,
      regionId: eff?.regionId ?? null,
    },
  });
}

/** True if making `managerId` the manager of `employeeId` would form a cycle. */
async function wouldCycle(employeeId: string, managerId: string | null): Promise<boolean> {
  if (!managerId) return false;
  if (managerId === employeeId) return true;
  let cur: string | null = managerId;
  const seen = new Set<string>();
  while (cur) {
    if (cur === employeeId) return true;
    if (seen.has(cur)) break; // pre-existing cycle; stop
    seen.add(cur);
    const row: { managerId: string | null } | null = await prisma.employee.findUnique({
      where: { id: cur },
      select: { managerId: true },
    });
    cur = row?.managerId ?? null;
  }
  return false;
}

async function requireAdmin() {
  const user = await getViewer();
  requireCan(user, "admin.employees:view");
  return user!;
}

// ---- create -----------------------------------------------------------------

/** Create a person. Identity only; org/division/login are set on the detail page. */
export async function createEmployee(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const user = await getViewer();
  try {
    requireCan(user, "admin.employees:view");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const name = str(formData.get("name"));
  if (!name) return { ok: false, message: "A name is required." };

  let id: string;
  try {
    const created = await prisma.employee.create({
      data: {
        name,
        firstName: nullable(formData.get("firstName")),
        lastName: nullable(formData.get("lastName")),
        preferredName: nullable(formData.get("preferredName")),
        code: nullable(formData.get("code")),
        adpId: nullable(formData.get("adpId")),
        title: nullable(formData.get("title")),
        email: nullable(formData.get("email")),
        phone: nullable(formData.get("phone")),
        cell: nullable(formData.get("cell")),
        hireDate: dateOrNull(formData.get("hireDate")),
        active: true,
      },
      select: { id: true },
    });
    id = created.id;
  } catch (e) {
    return { ok: false, message: uniqueMessage(e) };
  }

  redirect(`/admin/employees/${id}`);
}

// ---- identity ---------------------------------------------------------------

export async function updateEmployeeIdentity(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = str(formData.get("employeeId"));
  if (!id) return;
  const name = str(formData.get("name"));
  if (!name) return;

  try {
    await prisma.employee.update({
      where: { id },
      data: {
        name,
        firstName: nullable(formData.get("firstName")),
        lastName: nullable(formData.get("lastName")),
        preferredName: nullable(formData.get("preferredName")),
        code: nullable(formData.get("code")),
        adpId: nullable(formData.get("adpId")),
        title: nullable(formData.get("title")),
        email: nullable(formData.get("email")),
        phone: nullable(formData.get("phone")),
        cell: nullable(formData.get("cell")),
        hireDate: dateOrNull(formData.get("hireDate")),
        active: formData.get("active") === "on" || formData.get("active") === "1",
      },
    });
  } catch {
    redirect(`/admin/employees/${id}?error=unique`);
  }
  revalidatePath(`/admin/employees/${id}`);
}

// ---- separation (drives commission continuation) ----------------------------

export async function updateEmployeeSeparation(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = str(formData.get("employeeId"));
  if (!id) return;

  const endDate = dateOrNull(formData.get("endDate"));
  const sepRaw = str(formData.get("separationType"));
  const separationType = SEPARATIONS.includes(sepRaw as SeparationType)
    ? (sepRaw as SeparationType)
    : null;

  await prisma.employee.update({
    where: { id },
    // Separating an employee deactivates them; clearing the end date reactivates.
    data: { endDate, separationType: endDate ? separationType : null, active: !endDate },
  });
  revalidatePath(`/admin/employees/${id}`);
}

// ---- effective-dated org assignment -----------------------------------------

/**
 * Record an org change with a backdatable Active Date. Writes an immutable
 * EmployeeAssignment row and refreshes the cached fields if this is the newest
 * assignment on or before today.
 */
export async function saveAssignment(formData: FormData): Promise<void> {
  const admin = await requireAdmin();
  const id = str(formData.get("employeeId"));
  if (!id) return;

  const effectiveDate = dateOrNull(formData.get("effectiveDate"));
  if (!effectiveDate) redirect(`/admin/employees/${id}?error=date`);

  const managerId = nullable(formData.get("managerId"));
  if (await wouldCycle(id, managerId)) redirect(`/admin/employees/${id}?error=cycle`);

  const salesLevel = salesLevelOrNull(formData.get("salesLevel"));
  const homeLocationId = nullable(formData.get("homeLocationId"));
  const regionId = nullable(formData.get("regionId"));

  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.employeeAssignment.create({
      data: {
        employeeId: id,
        effectiveDate: effectiveDate!,
        salesLevel,
        homeLocationId,
        managerId,
        regionId,
        note: nullable(formData.get("note")),
        createdById: admin.id,
      },
    });
    await recomputeAssignmentCache(tx, id, now);
  });
  revalidatePath(`/admin/employees/${id}`);
}

// ---- division membership + NetSuite ids -------------------------------------

export async function setDivision(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = str(formData.get("employeeId"));
  const divRaw = str(formData.get("division"));
  if (!id || !DIVISIONS.includes(divRaw as Division)) return;
  const division = divRaw as Division;

  await prisma.employeeDivision.upsert({
    where: { employeeId_division: { employeeId: id, division } },
    create: {
      employeeId: id,
      division,
      netsuiteId: nullable(formData.get("netsuiteId")),
      effectiveDate: dateOrNull(formData.get("effectiveDate")),
    },
    update: {
      netsuiteId: nullable(formData.get("netsuiteId")),
      effectiveDate: dateOrNull(formData.get("effectiveDate")),
    },
  });
  revalidatePath(`/admin/employees/${id}`);
}

export async function removeDivision(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = str(formData.get("employeeId"));
  const divRaw = str(formData.get("division"));
  if (!id || !DIVISIONS.includes(divRaw as Division)) return;
  await prisma.employeeDivision.deleteMany({
    where: { employeeId: id, division: divRaw as Division },
  });
  revalidatePath(`/admin/employees/${id}`);
}

// ---- login linkage + temp password ------------------------------------------

/** A readable temp password a manager can read out (no ambiguous chars). */
function generateTempPassword(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(10);
  const body = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `${body.slice(0, 4)}-${body.slice(4, 8)}`;
}

/**
 * Create a login for an email-less (or any) employee and set a temp password the
 * manager reads out. The user must change it on first sign-in. A real email is
 * used verbatim; a bare handle becomes a synthetic no-reply address for login.
 */
export async function createLoginForEmployee(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getViewer();
  try {
    requireCan(user, "admin.employees:view");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const id = str(formData.get("employeeId"));
  const emp = id ? await prisma.employee.findUnique({ where: { id } }) : null;
  if (!emp) return { ok: false, message: "Employee not found." };
  if (emp.userId) return { ok: false, message: "This employee already has a login." };

  const role = str(formData.get("role"));
  if (!(ASSIGNABLE_ROLES as readonly string[]).includes(role)) {
    return { ok: false, message: "Choose a role for the login." };
  }

  const handle = str(formData.get("loginEmail")) || emp.email || "";
  if (!handle) return { ok: false, message: "Enter a login email or handle." };
  // A bare handle (no @) becomes a synthetic login address — reps with no real
  // inbox still get a stable username, and reset is manager-driven, not email.
  const login = handle.includes("@") ? handle.toLowerCase() : `${handle.toLowerCase()}@noemail.verano.local`;

  const existing = await prisma.user.findUnique({ where: { email: login } });
  if (existing) return { ok: false, message: "A login with that email/handle already exists." };

  const temp = generateTempPassword();
  try {
    await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: login,
          name: emp.name,
          role: role as (typeof ASSIGNABLE_ROLES)[number],
          active: true,
          mustResetPassword: true,
          passwordHash: await hashPassword(temp),
          homeWarehouseId: emp.homeLocationId,
          // Invariant: a login's assignment set always includes its primary role.
          roleAssignments: { create: { role: role as (typeof ASSIGNABLE_ROLES)[number] } },
        },
        select: { id: true },
      });
      await tx.employee.update({ where: { id }, data: { userId: created.id } });
    });
  } catch (e) {
    return { ok: false, message: uniqueMessage(e) };
  }

  revalidatePath(`/admin/employees/${id}`);
  return {
    ok: true,
    message: `Login created for ${login}. Give them this temporary password — they must change it at first sign-in.`,
    tempPassword: temp,
  };
}

/** Reset a linked login's password to a fresh temp password, shown once. */
export async function resetEmployeePassword(
  _prev: ActionState,
  formData: FormData
): Promise<ActionState> {
  const user = await getViewer();
  try {
    requireCan(user, "admin.employees:view");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const id = str(formData.get("employeeId"));
  const emp = id ? await prisma.employee.findUnique({ where: { id }, select: { userId: true } }) : null;
  if (!emp?.userId) return { ok: false, message: "This employee has no login." };

  const temp = generateTempPassword();
  await prisma.$transaction([
    prisma.passwordResetToken.deleteMany({ where: { userId: emp.userId, usedAt: null } }),
    prisma.user.update({
      where: { id: emp.userId },
      data: { passwordHash: await hashPassword(temp), mustResetPassword: true },
    }),
  ]);

  revalidatePath(`/admin/employees/${id}`);
  return {
    ok: true,
    message: "Temporary password set — the old one no longer works.",
    tempPassword: temp,
  };
}

/** Detach the login from the employee (does not delete the User account). */
export async function unlinkLogin(formData: FormData): Promise<void> {
  await requireAdmin();
  const id = str(formData.get("employeeId"));
  if (!id) return;
  await prisma.employee.update({ where: { id }, data: { userId: null } });
  revalidatePath(`/admin/employees/${id}`);
}

// ---- org chart: resolve managers from ADP supervisor codes ------------------

/**
 * Populate managerId from the ADP supervisor field. That field carries the
 * supervisor's exact payroll code+file (e.g. "(OSC000340)" -> D340), so this is a
 * deterministic id match — no name guessing. Only fills EMPTY managerId (never
 * overwrites a manager set by hand), and never links a person to themselves or in
 * a way that forms a cycle.
 */
export async function resolveManagersFromAdp(): Promise<ActionState> {
  const user = await getViewer();
  try {
    requireCan(user, "admin.employees:view");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  // One read of everyone; resolve + cycle-check entirely in memory, then write in
  // batches. (A per-row DB cycle walk would be hundreds of sequential reads — too
  // slow for a request.)
  const all = await prisma.employee.findMany({
    select: { id: true, code: true, managerId: true, supervisorName: true },
  });
  const idByCode = new Map(all.filter((e) => e.code).map((e) => [e.code!, e.id]));

  // Proposed parent for each employee that still needs one.
  const proposed = new Map<string, string>();
  let unmatched = 0;
  for (const e of all) {
    if (e.managerId || !e.supervisorName) continue;
    const code = supervisorCodeFromName(e.supervisorName);
    const managerId = code ? idByCode.get(code) : undefined;
    if (!managerId || managerId === e.id) {
      unmatched++;
      continue;
    }
    proposed.set(e.id, managerId);
  }

  // Effective parent = existing manager, else the proposal. Drop any proposed edge
  // that would form a cycle (walk the chain in memory).
  const parentOf = new Map<string, string | null>();
  for (const e of all) parentOf.set(e.id, e.managerId ?? proposed.get(e.id) ?? null);
  const formsCycle = (start: string): boolean => {
    const seen = new Set<string>();
    let cur: string | null | undefined = start;
    while (cur) {
      if (seen.has(cur)) return true;
      seen.add(cur);
      cur = parentOf.get(cur);
    }
    return false;
  };

  const updates: { id: string; managerId: string }[] = [];
  for (const [id, managerId] of proposed) {
    if (formsCycle(id)) {
      parentOf.set(id, null); // reject the edge
      unmatched++;
      continue;
    }
    updates.push({ id, managerId });
  }

  for (let i = 0; i < updates.length; i += 100) {
    await prisma.$transaction(
      updates.slice(i, i + 100).map((u) =>
        prisma.employee.update({ where: { id: u.id }, data: { managerId: u.managerId } })
      )
    );
  }
  const resolved = updates.length;

  revalidatePath("/admin/employees/org");
  revalidatePath("/admin/employees");
  return {
    ok: true,
    message: `Linked ${resolved} report→manager edges from ADP. ${unmatched} left unresolved (supervisor not in scope, or would loop).`,
  };
}

// ---- manual identity linking (same person, two payroll companies) -----------

/** Link `aliasId` as the same person as `primaryId` (alias points at the primary). */
export async function linkIdentity(formData: FormData): Promise<void> {
  await requireAdmin();
  const primaryId = str(formData.get("primaryId"));
  const aliasId = str(formData.get("aliasId"));
  if (!primaryId || !aliasId || primaryId === aliasId) return;

  const [primary, alias, aliasHasAliases] = await Promise.all([
    prisma.employee.findUnique({ where: { id: primaryId }, select: { primaryId: true } }),
    prisma.employee.findUnique({ where: { id: aliasId }, select: { id: true } }),
    prisma.employee.count({ where: { primaryId: aliasId } }),
  ]);
  // The primary must be a top-level record, and the alias must not itself be a
  // primary of others — keep links one level deep, no chains.
  if (!primary || !alias || primary.primaryId || aliasHasAliases > 0) {
    redirect(`/admin/employees/${aliasId}?error=link`);
  }

  await prisma.employee.update({ where: { id: aliasId }, data: { primaryId } });
  revalidatePath(`/admin/employees/${primaryId}`);
  revalidatePath(`/admin/employees/${aliasId}`);
}

/** Unlink an alias from its primary. */
export async function unlinkIdentity(formData: FormData): Promise<void> {
  await requireAdmin();
  const aliasId = str(formData.get("aliasId"));
  if (!aliasId) return;
  await prisma.employee.update({ where: { id: aliasId }, data: { primaryId: null } });
  revalidatePath(`/admin/employees/${aliasId}`);
}

// ---- ADP import / daily sync ------------------------------------------------

export interface ImportState {
  ok?: boolean;
  message?: string;
  summary?: {
    created: number;
    updated: number;
    withSalary: number;
    inScope: number;
    unmatched: { name: string; count: number }[];
  };
}

/**
 * Import / re-sync employees from an ADP master export (CSV). Idempotent: upserts
 * by the D/I division code, so uploading a fresh export daily keeps the roster
 * current. Salary is imported only for the allow-listed roles (enforced in
 * lib/adp); the org cache is preserved on re-sync (see lib/adp-import).
 */
export async function uploadAdpEmployees(
  _prev: ImportState,
  formData: FormData
): Promise<ImportState> {
  const user = await getViewer();
  try {
    requireCan(user, "admin.employees:view");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, message: "Choose the ADP export .csv to upload." };
  }
  if (!/\.csv$/i.test(file.name)) {
    return { ok: false, message: "Upload the ADP export as a .csv file." };
  }

  let summary;
  try {
    const text = await file.text();
    summary = await importAdpEmployees(text, new Date());
  } catch (e) {
    return { ok: false, message: `Import failed: ${(e as Error).message}` };
  }

  revalidatePath("/admin/employees");
  return {
    ok: true,
    message: `Synced ${summary.inScope} in-scope rows: ${summary.created} created, ${summary.updated} updated. Salary loaded for ${summary.withSalary} allow-listed roles.`,
    summary: {
      created: summary.created,
      updated: summary.updated,
      withSalary: summary.withSalary,
      inScope: summary.inScope,
      unmatched: summary.unmatchedLocations,
    },
  };
}

function uniqueMessage(e: unknown): string {
  const err = e as { code?: string; meta?: { target?: string[] } };
  if (err.code === "P2002") {
    const t = err.meta?.target?.join(", ") ?? "a unique field";
    const field = t.includes("email")
      ? "email"
      : t.includes("adpId")
      ? "ADP id"
      : t.includes("code")
      ? "employee code"
      : t;
    return `That ${field} already belongs to another record.`;
  }
  return (e as Error).message;
}
