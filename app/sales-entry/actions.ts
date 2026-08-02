"use server";

import { redirect } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { can, requireCan } from "@/lib/rbac";
import {
  parseCents,
  isOneOf,
  DEAL_TYPES,
  ALL_SALE_TYPES,
  ENABLE_GRILL_ISLAND,
  ENABLE_ISLAND_BAR,
  ENABLE_ADDITIONAL_ISLAND,
  ENABLE_SHADES,
} from "@/lib/sales-entry";

export interface ActionState {
  ok?: boolean;
  message?: string;
}

function str(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}
function nullable(v: FormDataEntryValue | null): string | null {
  const s = str(v);
  return s === "" ? null : s;
}
/** yyyy-mm-dd → Date at UTC midnight, or null. */
function dateOrNull(v: FormDataEntryValue | null): Date | null {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00.000Z`);
}

interface ParsedEntry {
  showEventId: string;
  salesRepId: string;
  isSplitDeal: boolean;
  secondSalesRepId: string | null;
  customerFirst: string;
  customerLast: string;
  dealType: string;
  saleType: string;
  priceList: string;
  grillIsland: string | null;
  islandBar: string | null;
  additionalIsland: string | null;
  shadesOfVerano: string | null;
  productTotalCents: number;
  pflFeeCents: number | null;
}

/**
 * Validate + normalize the form. Island/shades fields only survive if the sale
 * type actually enables them (so an off-rule value can't slip in). The show
 * leader is NOT taken from the form — it is derived from the show (see below).
 */
function parseForm(form: FormData): { data: ParsedEntry } | { error: string } {
  const showEventId = str(form.get("showEventId"));
  const salesRepId = str(form.get("salesRepId"));
  const customerFirst = str(form.get("customerFirst"));
  const customerLast = str(form.get("customerLast"));
  const dealType = str(form.get("dealType"));
  const saleType = str(form.get("saleType"));
  const priceList = str(form.get("priceList"));
  const productTotalCents = parseCents(str(form.get("productTotal")));
  const isSplitDeal = str(form.get("isSplitDeal")) === "on";
  const secondSalesRepId = nullable(form.get("secondSalesRepId"));

  if (!showEventId) return { error: "Choose a show." };
  if (!salesRepId) return { error: "Sales rep is required." };
  if (!customerFirst) return { error: "Customer's first name is required." };
  if (!customerLast) return { error: "Customer's last name is required." };
  if (!isOneOf(dealType, DEAL_TYPES)) return { error: "Choose a valid deal type." };
  if (!isOneOf(saleType, ALL_SALE_TYPES)) return { error: "Choose a valid sale type." };
  if (!priceList) return { error: "Choose a price list." };
  if (productTotalCents == null) return { error: "Enter a valid product total." };
  if (isSplitDeal && !secondSalesRepId) {
    return { error: "A split deal needs a second sales rep." };
  }
  if (isSplitDeal && secondSalesRepId === salesRepId) {
    return { error: "The second sales rep must be a different person." };
  }

  // Only keep an island/shades value if this sale type enables that field.
  const keep = (v: string | null, enabledFor: readonly string[]) =>
    enabledFor.includes(saleType) ? v : null;

  return {
    data: {
      showEventId,
      salesRepId,
      isSplitDeal,
      secondSalesRepId: isSplitDeal ? secondSalesRepId : null,
      customerFirst,
      customerLast,
      dealType,
      saleType,
      priceList,
      grillIsland: keep(nullable(form.get("grillIsland")), ENABLE_GRILL_ISLAND),
      islandBar: keep(nullable(form.get("islandBar")), ENABLE_ISLAND_BAR),
      additionalIsland: keep(nullable(form.get("additionalIsland")), ENABLE_ADDITIONAL_ISLAND),
      shadesOfVerano: keep(nullable(form.get("shadesOfVerano")), ENABLE_SHADES),
      productTotalCents,
      pflFeeCents: parseCents(str(form.get("pflFee"))),
    },
  };
}

/** The show's leader is the source of truth — never a form field. */
async function leaderForShow(showEventId: string): Promise<string | null> {
  const show = await prisma.showEvent.findUnique({
    where: { id: showEventId },
    select: { leaderEmployeeId: true },
  });
  return show?.leaderEmployeeId ?? null;
}

export async function createSalesEntry(
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const user = await getViewer();
  requireCan(user, "salesentry:edit");

  const parsed = parseForm(form);
  if ("error" in parsed) return { ok: false, message: parsed.error };
  const d = parsed.data;

  await prisma.salesEntry.create({
    data: {
      division: "PGI",
      ...d,
      showLeaderId: await leaderForShow(d.showEventId), // derived from the show
      soldAt: new Date(), // the submitter never sets the date; admin can fix on edit
      enteredById: user!.id,
    },
  });

  revalidatePath("/sales-entry");
  redirect("/sales-entry?created=1");
}

export async function updateSalesEntry(
  _prev: ActionState,
  form: FormData
): Promise<ActionState> {
  const user = await getViewer();
  requireCan(user, "salesentry:edit");

  const id = str(form.get("id"));
  if (!id) return { ok: false, message: "Missing entry id." };

  const existing = await prisma.salesEntry.findUnique({
    where: { id },
    select: { enteredById: true },
  });
  if (!existing) return { ok: false, message: "Entry not found." };
  // Reps may only edit their own; managers/admins may edit any.
  if (existing.enteredById !== user!.id && !can(user, "salesentry:manage_all")) {
    return { ok: false, message: "You can only edit your own entries." };
  }

  const parsed = parseForm(form);
  if ("error" in parsed) return { ok: false, message: parsed.error };

  // The sale date is only editable by a manager/admin correcting an entry.
  const canManage = can(user, "salesentry:manage_all");
  const soldRaw = str(form.get("soldAt"));
  const soldAt = canManage && soldRaw ? dateOrNull(form.get("soldAt")) : undefined;

  await prisma.salesEntry.update({
    where: { id },
    data: {
      ...parsed.data,
      showLeaderId: await leaderForShow(parsed.data.showEventId),
      ...(soldAt !== undefined ? { soldAt } : {}),
    },
  });

  revalidatePath("/sales-entry");
  redirect("/sales-entry?updated=1");
}

export async function deleteSalesEntry(form: FormData): Promise<void> {
  const user = await getViewer();
  requireCan(user, "salesentry:edit");

  const id = str(form.get("id"));
  if (!id) return;

  const existing = await prisma.salesEntry.findUnique({
    where: { id },
    select: { enteredById: true },
  });
  if (!existing) return;
  if (existing.enteredById !== user!.id && !can(user, "salesentry:manage_all")) {
    throw new Error("You can only delete your own entries.");
  }

  await prisma.salesEntry.delete({ where: { id } });
  revalidatePath("/sales-entry");
}
