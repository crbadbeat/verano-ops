"use client";

import { useActionState } from "react";
import { createEvent, type EventFormState } from "@/app/events/actions";

export default function NewEventForm() {
  const [state, action, pending] = useActionState<EventFormState, FormData>(createEvent, {});
  return (
    <form action={action} className="card p-4 flex items-end gap-3 flex-wrap">
      <label className="text-sm flex-1 min-w-[14rem]">
        <span className="text-muted">New show name *</span>
        <input name="name" required className="input mt-1" placeholder="e.g. Novi Home & Garden Show" />
      </label>
      <label className="text-sm">
        <span className="text-muted">Status</span>
        <select name="status" defaultValue="PLANNED" className="input mt-1">
          <option value="PLANNED">Planned</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="ACTIVE">Active</option>
          <option value="COMPLETED">Completed</option>
        </select>
      </label>
      <button className="btn btn-primary text-sm" disabled={pending}>
        {pending ? "Creating…" : "Create show"}
      </button>
      {state.message && !state.ok && <p className="text-sm text-danger w-full">{state.message}</p>}
    </form>
  );
}
