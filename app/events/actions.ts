"use server";

import { redirect } from "next/navigation";
import { getViewer } from "@/lib/permissions/engine";
import { revalidatePath } from "next/cache";
import type { ShowEventStatus, ShowCostType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireCan } from "@/lib/rbac";
import { EVENT_STATUS_ORDER, COST_TYPE_ORDER } from "@/lib/events";
import { geocode } from "@/lib/weather";

// ---- parsers ----------------------------------------------------------------
function str(v: FormDataEntryValue | null): string {
  return String(v ?? "").trim();
}
function nullable(v: FormDataEntryValue | null): string | null {
  const s = str(v);
  return s === "" ? null : s;
}
function dateOrNull(v: FormDataEntryValue | null): Date | null {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(`${s}T00:00:00.000Z`);
}
/** Dollars ("1,200.50", "$300") -> integer cents, or null. */
function centsOrNull(v: FormDataEntryValue | null): number | null {
  const s = str(v).replace(/[$,\s]/g, "");
  if (!s) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}
function intOrNull(v: FormDataEntryValue | null): number | null {
  const s = str(v);
  if (s === "") return null;
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 ? n : null;
}
function statusOrDefault(v: FormDataEntryValue | null): ShowEventStatus {
  const s = str(v) as ShowEventStatus;
  return EVENT_STATUS_ORDER.includes(s) ? s : "PLANNED";
}
function costType(v: FormDataEntryValue | null): ShowCostType | null {
  const s = str(v) as ShowCostType;
  return COST_TYPE_ORDER.includes(s) ? s : null;
}

async function requireEvents() {
  const user = await getViewer();
  requireCan(user, "events:edit");
  return user!;
}

export interface EventFormState {
  ok?: boolean;
  message?: string;
}

// ---- event ------------------------------------------------------------------
export async function createEvent(_prev: EventFormState, formData: FormData): Promise<EventFormState> {
  const user = await getViewer();
  try {
    requireCan(user, "events:edit");
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
  const name = str(formData.get("name"));
  if (!name) return { ok: false, message: "Give the show a name." };

  const created = await prisma.showEvent.create({
    data: { name, status: statusOrDefault(formData.get("status")), createdById: user!.id },
    select: { id: true },
  });
  redirect(`/events/${created.id}/edit?created=1`);
}

function eventData(formData: FormData): Prisma.ShowEventUpdateInput {
  return {
    name: str(formData.get("name")),
    shortName: nullable(formData.get("shortName")),
    status: statusOrDefault(formData.get("status")),
    venueName: nullable(formData.get("venueName")),
    address: nullable(formData.get("address")),
    city: nullable(formData.get("city")),
    state: nullable(formData.get("state")),
    zip: nullable(formData.get("zip")),
    boothNumber: nullable(formData.get("boothNumber")),
    boothSize: nullable(formData.get("boothSize")),
    goalCents: centsOrNull(formData.get("goal")),
    leadCount: intOrNull(formData.get("leadCount")),
    repsNeeded: intOrNull(formData.get("repsNeeded")),
    notes: nullable(formData.get("notes")),
    leader: relinkNullable(formData.get("leaderEmployeeId")),
    promoter: relinkNullable(formData.get("promoterId")),
    series: relinkNullable(formData.get("seriesId")),
  };
}

/** Connect/disconnect an optional relation from a select value. */
function relinkNullable(v: FormDataEntryValue | null) {
  const id = str(v);
  return id ? { connect: { id } } : { disconnect: true };
}

export async function updateEvent(formData: FormData): Promise<void> {
  await requireEvents();
  const id = str(formData.get("eventId"));
  if (!id || !str(formData.get("name"))) return;

  const before = await prisma.showEvent.findUnique({
    where: { id },
    select: { city: true, state: true, latitude: true },
  });
  await prisma.showEvent.update({ where: { id }, data: eventData(formData) });

  // The show leader counts as one of the reps a show needs, so keep them on the
  // staff roster automatically. Upsert (never overwrites an existing role).
  const leaderId = str(formData.get("leaderEmployeeId"));
  if (leaderId) {
    await prisma.showEventStaff.upsert({
      where: { eventId_employeeId: { eventId: id, employeeId: leaderId } },
      create: { eventId: id, employeeId: leaderId, role: "Show Leader" },
      update: {},
    });
  }

  // Geocode the venue for weather when the city/state changed (or was never
  // geocoded). Fail-soft — a geocoder hiccup must never block a save.
  const newCity = nullable(formData.get("city"));
  const newState = nullable(formData.get("state"));
  if (newCity && (before?.latitude == null || newCity !== before.city || newState !== before.state)) {
    try {
      const hit = await geocode(newCity, newState);
      await prisma.showEvent.update({
        where: { id },
        data: hit
          ? { latitude: hit.lat, longitude: hit.lng, weatherGeocodedAt: new Date() }
          : { latitude: null, longitude: null, weatherGeocodedAt: null },
      });
    } catch {
      // ignore geocoder errors
    }
  }

  revalidatePath(`/events/${id}`);
  revalidatePath(`/events/${id}/edit`);
  // Stay in the edit workspace after saving details — the dates / costs / staff /
  // shifts sections all live on the edit page, so bouncing to the read-only view
  // (forcing a re-open) interrupts setting up a brand-new show.
  redirect(`/events/${id}/edit?saved=1`);
}

export async function deleteEvent(formData: FormData): Promise<void> {
  await requireEvents();
  const id = str(formData.get("eventId"));
  if (!id) return;
  await prisma.showEvent.delete({ where: { id } });
  revalidatePath("/events");
  redirect("/events?deleted=1");
}

// ---- dates ------------------------------------------------------------------
export async function addEventDate(formData: FormData): Promise<void> {
  await requireEvents();
  const eventId = str(formData.get("eventId"));
  const start = dateOrNull(formData.get("startDate"));
  const end = dateOrNull(formData.get("endDate")) ?? start;
  if (!eventId || !start) return;
  await prisma.showEventDate.create({
    data: { eventId, startDate: start, endDate: end!, label: nullable(formData.get("label")) },
  });
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/edit`);
}

export async function removeEventDate(formData: FormData): Promise<void> {
  await requireEvents();
  const id = str(formData.get("dateId"));
  const eventId = str(formData.get("eventId"));
  if (!id) return;
  await prisma.showEventDate.delete({ where: { id } });
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/edit`);
}

// ---- costs ------------------------------------------------------------------
export async function addEventCost(formData: FormData): Promise<void> {
  await requireEvents();
  const eventId = str(formData.get("eventId"));
  const type = costType(formData.get("type"));
  if (!eventId || !type) return;
  await prisma.showEventCost.create({
    data: {
      eventId,
      type,
      label: nullable(formData.get("label")),
      budgetCents: centsOrNull(formData.get("budget")),
      actualCents: centsOrNull(formData.get("actual")),
      dueDate: dateOrNull(formData.get("dueDate")),
      paid: formData.get("paid") === "on" || formData.get("paid") === "1",
    },
  });
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/edit`);
}

export async function updateEventCost(formData: FormData): Promise<void> {
  await requireEvents();
  const id = str(formData.get("costId"));
  const eventId = str(formData.get("eventId"));
  if (!id) return;
  await prisma.showEventCost.update({
    where: { id },
    data: {
      label: nullable(formData.get("label")),
      budgetCents: centsOrNull(formData.get("budget")),
      actualCents: centsOrNull(formData.get("actual")),
      dueDate: dateOrNull(formData.get("dueDate")),
      paid: formData.get("paid") === "on" || formData.get("paid") === "1",
    },
  });
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/edit`);
}

export async function removeEventCost(formData: FormData): Promise<void> {
  await requireEvents();
  const id = str(formData.get("costId"));
  const eventId = str(formData.get("eventId"));
  if (!id) return;
  await prisma.showEventCost.delete({ where: { id } });
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/edit`);
}

// ---- staff ------------------------------------------------------------------
export async function addEventStaff(formData: FormData): Promise<void> {
  await requireEvents();
  const eventId = str(formData.get("eventId"));
  const employeeId = str(formData.get("employeeId"));
  if (!eventId || !employeeId) return;
  await prisma.showEventStaff.upsert({
    where: { eventId_employeeId: { eventId, employeeId } },
    create: { eventId, employeeId, role: nullable(formData.get("role")) },
    update: { role: nullable(formData.get("role")) },
  });
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/edit`);
}

export async function removeEventStaff(formData: FormData): Promise<void> {
  await requireEvents();
  const id = str(formData.get("staffId"));
  const eventId = str(formData.get("eventId"));
  if (!id) return;
  await prisma.showEventStaff.delete({ where: { id } });
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/edit`);
}

// ---- shifts -----------------------------------------------------------------
export async function addEventShift(formData: FormData): Promise<void> {
  await requireEvents();
  const eventId = str(formData.get("eventId"));
  const employeeId = str(formData.get("employeeId"));
  const date = dateOrNull(formData.get("date"));
  if (!eventId || !employeeId || !date) return;
  await prisma.showEventShift.create({
    data: {
      eventId,
      employeeId,
      date,
      startTime: nullable(formData.get("startTime")),
      endTime: nullable(formData.get("endTime")),
      note: nullable(formData.get("note")),
    },
  });
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/edit`);
}

export async function removeEventShift(formData: FormData): Promise<void> {
  await requireEvents();
  const id = str(formData.get("shiftId"));
  const eventId = str(formData.get("eventId"));
  if (!id) return;
  await prisma.showEventShift.delete({ where: { id } });
  revalidatePath(`/events/${eventId}`);
  revalidatePath(`/events/${eventId}/edit`);
}

// ---- promoters + series -----------------------------------------------------
export async function createPromoter(formData: FormData): Promise<void> {
  await requireEvents();
  const name = str(formData.get("name"));
  if (!name) return;
  try {
    await prisma.promoter.create({
      data: {
        name,
        contactName: nullable(formData.get("contactName")),
        phone: nullable(formData.get("phone")),
        email: nullable(formData.get("email")),
        website: nullable(formData.get("website")),
        notes: nullable(formData.get("notes")),
      },
    });
  } catch {
    // unique name clash — ignore
  }
  revalidatePath("/events/promoters");
}

export async function updatePromoter(formData: FormData): Promise<void> {
  await requireEvents();
  const id = str(formData.get("promoterId"));
  const name = str(formData.get("name"));
  if (!id || !name) return;
  try {
    await prisma.promoter.update({
      where: { id },
      data: {
        name,
        contactName: nullable(formData.get("contactName")),
        phone: nullable(formData.get("phone")),
        email: nullable(formData.get("email")),
        website: nullable(formData.get("website")),
        notes: nullable(formData.get("notes")),
        active: formData.get("active") === "on" || formData.get("active") === "1",
      },
    });
  } catch {
    // unique clash — ignore
  }
  revalidatePath("/events/promoters");
}

export async function createSeries(formData: FormData): Promise<void> {
  await requireEvents();
  const name = str(formData.get("name"));
  if (!name) return;
  try {
    await prisma.showSeries.create({ data: { name, notes: nullable(formData.get("notes")) } });
  } catch {
    // unique clash — ignore
  }
  revalidatePath("/events/series");
}
