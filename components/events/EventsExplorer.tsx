"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FocusEvent, type MouseEvent } from "react";
import { useSearchParams } from "next/navigation";
import { EVENT_STATUS_LABEL, formatDateSpan, usd } from "@/lib/events";
import { moneyFloor } from "@/lib/reporting/format";
import {
  parseISO, toISO, addDays, startOfWeek, startOfMonth, daysInMonth,
  coversDay, firstStartMs, lastEndMs, layoutWeek,
} from "@/lib/calendar";

// -----------------------------------------------------------------------------
// Shows & events explorer — instant client-side search + List / Month / Week
// views over the full show set (a bounded list, so filtering + calendar layout
// run in the browser for a zero-latency feel). Calendar math (lib/calendar, unit
// tested) is UTC to match the @db.Date show dates; `todayIso` comes from the
// server so SSR and hydration agree on "today".
// -----------------------------------------------------------------------------

export interface ExplorerShow {
  id: string;
  name: string;
  status: string;
  city: string | null;
  state: string | null;
  venueName: string | null;
  promoterName: string | null;
  leaderName: string | null;
  staffCount: number;
  repsNeeded: number | null;
  goalCents: number | null;
  salesCents: number; // self-reported PGI sales logged against this show
  budgetCents: number;
  actualCents: number;
  spans: { start: string; end: string }[]; // yyyy-mm-dd, UTC
}

/** "42%" of goal, or null when there is no goal. */
function pctToGoal(salesCents: number, goalCents: number | null): number | null {
  return goalCents && goalCents > 0 ? salesCents / goalCents : null;
}
function pctLabel(p: number | null): string {
  return p == null ? "—" : `${Math.floor(p * 100)}%`;
}

type View = "list" | "month" | "week";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // Monday-first columns
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]; // label by Date.getUTCDay()
const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const firstStart = (s: ExplorerShow) => firstStartMs(s.spans);
const lastEnd = (s: ExplorerShow) => lastEndMs(s.spans);
const onDay = (s: ExplorerShow, dayMs: number) => coversDay(s.spans, dayMs);

/** Status accent colour (CSS var) — one language across chips, dots and bars. */
function accent(status: string): string {
  switch (status) {
    case "CONFIRMED": return "var(--teal)";
    case "ACTIVE": return "var(--ember)";
    case "CANCELLED": return "var(--danger)";
    case "COMPLETED": return "var(--showgood)";
    default: return "var(--muted)"; // PLANNED
  }
}
const tint = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

function StatusDot({ status }: { status: string }) {
  return <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: accent(status) }} />;
}

function spanLabel(spans: { start: string; end: string }[]): string {
  if (spans.length === 0) return "No dates set";
  let first = parseISO(spans[0].start);
  let last = parseISO(spans[0].end);
  for (const s of spans) {
    const a = parseISO(s.start), b = parseISO(s.end);
    if (a < first) first = a;
    if (b > last) last = b;
  }
  return formatDateSpan(first, last) + (spans.length > 1 ? ` · ${spans.length} spans` : "");
}

export default function EventsExplorer({
  shows,
  todayIso,
  initialView,
}: {
  shows: ExplorerShow[];
  todayIso: string;
  initialView: View; // resolved on the server from ?view= or the events_view cookie
}) {
  const today = parseISO(todayIso);
  const todayMs = today.getTime();

  // Persist view / anchor / search in the URL so the browser Back button (e.g.
  // returning from a show detail page) restores exactly what the user was viewing.
  // `view` also mirrors to a cookie (below) so a bare /events nav-menu visit
  // reopens the last-used view. `initialView` is resolved server-side.
  const sp = useSearchParams();
  const [view, setView] = useState<View>(initialView);
  const [query, setQuery] = useState(sp.get("q") ?? "");
  const [hover, setHover] = useState<{ show: ExplorerShow; x: number; y: number } | null>(null);

  // Hover / keyboard-focus a calendar item → full-detail tooltip (fewer clicks).
  const onHover = (show: ExplorerShow, e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => {
    if (e.type === "focus") {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      setHover({ show, x: r.left + r.width / 2, y: r.bottom });
    } else {
      const m = e as MouseEvent<HTMLElement>;
      setHover({ show, x: m.clientX, y: m.clientY });
    }
  };
  const onLeave = () => setHover(null);
  // Anchor from the URL if present, else the first upcoming show (or today).
  const [anchor, setAnchor] = useState<Date>(() => {
    const d = sp.get("d");
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) return parseISO(d);
    const upcoming = shows
      .map(firstStart)
      .filter((t): t is number => t != null && t >= todayMs)
      .sort((a, b) => a - b);
    return upcoming.length ? new Date(upcoming[0]) : today;
  });

  // Mirror the current view/anchor/search into the URL (replaceState = no refetch,
  // no history spam). Back navigation restores it via the initializers above.
  const anchorIso = toISO(anchor);
  useEffect(() => {
    const params = new URLSearchParams();
    if (view !== "list") {
      params.set("view", view);
      params.set("d", anchorIso);
    }
    if (query.trim()) params.set("q", query.trim());
    const qs = params.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [view, anchorIso, query]);

  // Remember the chosen view for a bare /events visit from the nav menu.
  useEffect(() => {
    document.cookie = `events_view=${view}; path=/; max-age=15552000; samesite=lax`;
  }, [view]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return shows;
    return shows.filter((s) =>
      [s.name, s.city, s.state, s.venueName, s.promoterName, s.leaderName]
        .filter(Boolean)
        .some((f) => (f as string).toLowerCase().includes(q))
    );
  }, [shows, query]);

  const summary = useMemo(() => {
    const goal = filtered.reduce((a, s) => a + (s.goalCents ?? 0), 0);
    const sales = filtered.reduce((a, s) => a + s.salesCents, 0);
    const confirmed = filtered.filter((s) => s.status === "CONFIRMED" || s.status === "ACTIVE").length;
    return { count: filtered.length, confirmed, goal, sales, pct: pctToGoal(sales, goal) };
  }, [filtered]);

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-col lg:flex-row lg:items-center gap-3">
        <SearchBox value={query} onChange={setQuery} count={filtered.length} />
        <div className="flex items-center gap-2 lg:ml-auto">
          <ViewToggle view={view} onChange={setView} />
          {view !== "list" && (
            <CalendarNav
              label={
                view === "month"
                  ? `${MONTHS[anchor.getUTCMonth()]} ${anchor.getUTCFullYear()}`
                  : formatDateSpan(startOfWeek(anchor), addDays(startOfWeek(anchor), 6))
              }
              onPrev={() => setAnchor((a) => addDays(a, view === "month" ? -daysInMonth(a, -1) : -7))}
              onNext={() => setAnchor((a) => addDays(a, view === "month" ? daysInMonth(a, 0) : 7))}
              onToday={() => setAnchor(today)}
            />
          )}
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label={query ? "Matching shows" : "Shows"} value={summary.count.toLocaleString()} />
        <Kpi label="Confirmed / active" value={summary.confirmed.toLocaleString()} tone="teal" />
        <Kpi label="Combined goal" value={moneyFloor(summary.goal)} tone="ember" />
        <Kpi
          label={`Self-reported sales · ${pctLabel(summary.pct)} of goal`}
          value={moneyFloor(summary.sales)}
          tone="teal"
        />
      </div>

      <Legend />

      {view === "list" && <ListView shows={filtered} todayMs={todayMs} />}
      {view === "month" && <MonthView shows={filtered} anchor={anchor} todayIso={todayIso} onHover={onHover} onLeave={onLeave} />}
      {view === "week" && <WeekView shows={filtered} anchor={anchor} todayIso={todayIso} onHover={onHover} onLeave={onLeave} />}

      {filtered.length === 0 && (
        <div className="card p-10 text-center text-muted text-sm">
          No shows match “{query}”. Try a different search.
        </div>
      )}

      <ShowTooltip hover={hover} />
    </div>
  );
}

type HoverHandlers = {
  onHover: (show: ExplorerShow, e: MouseEvent<HTMLElement> | FocusEvent<HTMLElement>) => void;
  onLeave: () => void;
};

function TooltipRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted w-16 shrink-0">{label}</span>
      <span className="text-foreground/90 min-w-0">{value}</span>
    </div>
  );
}

function ShowTooltip({ hover }: { hover: { show: ExplorerShow; x: number; y: number } | null }) {
  if (!hover) return null;
  const { show: s, x, y } = hover;
  const c = accent(s.status);
  const vw = typeof window !== "undefined" ? window.innerWidth : 1280;
  const vh = typeof window !== "undefined" ? window.innerHeight : 800;
  const W = 288;
  const EST_H = 250;
  const left = Math.max(12, Math.min(x + 14, vw - W - 12));
  const top = y + 16 + EST_H > vh ? Math.max(12, y - EST_H - 12) : y + 16;
  return (
    <div
      className="fixed z-50 pointer-events-none w-72 card p-3.5 shadow-2xl"
      style={{ left, top, borderLeft: `3px solid ${c}` }}
    >
      <div className="flex items-center gap-2">
        <StatusDot status={s.status} />
        <span className="font-semibold text-sm leading-tight">{s.name}</span>
        <span className="badge ml-auto shrink-0" style={{ color: c, borderColor: tint(c, 40) }}>
          {EVENT_STATUS_LABEL[s.status as keyof typeof EVENT_STATUS_LABEL] ?? s.status}
        </span>
      </div>
      <div className="mt-2.5 space-y-1 text-xs">
        <TooltipRow label="Dates" value={spanLabel(s.spans)} />
        {(s.city || s.state) && <TooltipRow label="Location" value={[s.city, s.state].filter(Boolean).join(", ")} />}
        {s.venueName && <TooltipRow label="Venue" value={s.venueName} />}
        {s.promoterName && <TooltipRow label="Promoter" value={s.promoterName} />}
        {s.leaderName && <TooltipRow label="Leader" value={s.leaderName} />}
        <TooltipRow label="Staffing" value={`${s.staffCount} staff${s.repsNeeded != null ? ` / ${s.repsNeeded} needed` : ""}`} />
        {s.goalCents != null && <TooltipRow label="Goal" value={moneyFloor(s.goalCents)} />}
        <TooltipRow
          label="Sales"
          value={`${moneyFloor(s.salesCents)}${s.goalCents ? ` · ${pctLabel(pctToGoal(s.salesCents, s.goalCents))} of goal` : ""}`}
        />
        <TooltipRow label="Budget" value={`${usd(s.budgetCents)} · actual ${usd(s.actualCents)}`} />
      </div>
      <div className="mt-2.5 text-[11px] text-muted">Click to open →</div>
    </div>
  );
}

// ---- Toolbar bits -----------------------------------------------------------

function SearchBox({ value, onChange, count }: { value: string; onChange: (v: string) => void; count: number }) {
  return (
    <div className="relative flex-1 min-w-0 lg:max-w-md">
      <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" /><path d="m21 21-4.3-4.3" />
      </svg>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search shows, cities, venues, promoters, leaders…"
        className="input pl-11 pr-16"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted hover:text-foreground px-2 py-1"
        >
          {count} · clear
        </button>
      )}
    </div>
  );
}

function ViewToggle({ view, onChange }: { view: View; onChange: (v: View) => void }) {
  const opts: { key: View; label: string }[] = [
    { key: "list", label: "List" },
    { key: "month", label: "Month" },
    { key: "week", label: "Week" },
  ];
  return (
    <div className="inline-flex rounded-lg border border-border overflow-hidden shrink-0" role="tablist" aria-label="View">
      {opts.map((o) => (
        <button
          key={o.key}
          type="button"
          role="tab"
          aria-selected={view === o.key}
          onClick={() => onChange(o.key)}
          className={`px-3.5 py-1.5 text-sm transition-colors ${
            view === o.key ? "bg-surface-2 text-foreground" : "text-muted hover:bg-surface-2/60"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function CalendarNav({ label, onPrev, onNext, onToday }: { label: string; onPrev: () => void; onNext: () => void; onToday: () => void }) {
  return (
    <div className="flex items-center gap-2 shrink-0">
      <div className="inline-flex rounded-lg border border-border overflow-hidden">
        <button type="button" onClick={onPrev} aria-label="Previous" className="px-2.5 py-1.5 text-muted hover:bg-surface-2/60">‹</button>
        <button type="button" onClick={onToday} className="px-3 py-1.5 text-sm text-muted hover:bg-surface-2/60 border-x border-border">Today</button>
        <button type="button" onClick={onNext} aria-label="Next" className="px-2.5 py-1.5 text-muted hover:bg-surface-2/60">›</button>
      </div>
      <span className="text-sm font-semibold tabular-nums whitespace-nowrap min-w-[9rem]">{label}</span>
    </div>
  );
}

function Kpi({ label, value, tone = "default" }: { label: string; value: string; tone?: "default" | "teal" | "ember" }) {
  const color = tone === "teal" ? "text-teal" : tone === "ember" ? "text-ember" : "text-foreground";
  return (
    <div className="card px-4 py-3">
      <div className={`text-xl font-bold tabular-nums ${color}`}>{value}</div>
      <div className="text-xs text-muted mt-0.5">{label}</div>
    </div>
  );
}

function Legend() {
  const items = ["PLANNED", "CONFIRMED", "ACTIVE", "COMPLETED", "CANCELLED"];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
      {items.map((st) => (
        <span key={st} className="inline-flex items-center gap-1.5">
          <StatusDot status={st} /> {EVENT_STATUS_LABEL[st as keyof typeof EVENT_STATUS_LABEL]}
        </span>
      ))}
    </div>
  );
}

// ---- List view --------------------------------------------------------------

function ListView({ shows, todayMs }: { shows: ExplorerShow[]; todayMs: number }) {
  const live = new Set(["PLANNED", "CONFIRMED", "ACTIVE"]);
  const upcoming = shows
    .filter((s) => { const le = lastEnd(s); return le == null || le >= todayMs || live.has(s.status); })
    .sort((a, b) => (firstStart(a) ?? Infinity) - (firstStart(b) ?? Infinity));
  const upSet = new Set(upcoming);
  const past = shows
    .filter((s) => !upSet.has(s))
    .sort((a, b) => (lastEnd(b) ?? 0) - (lastEnd(a) ?? 0));

  return (
    <div className="space-y-6">
      {upcoming.length > 0 && <Section title={`Upcoming & active (${upcoming.length})`} shows={upcoming} />}
      {past.length > 0 && <Section title={`Past (${past.length})`} shows={past} dim />}
    </div>
  );
}

function Section({ title, shows, dim }: { title: string; shows: ExplorerShow[]; dim?: boolean }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-mono uppercase tracking-widest text-muted">{title}</h2>
      <div className={`grid sm:grid-cols-2 gap-3 ${dim ? "opacity-80" : ""}`}>
        {shows.map((s) => <ShowCard key={s.id} s={s} />)}
      </div>
    </div>
  );
}

function ShowCard({ s }: { s: ExplorerShow }) {
  const c = accent(s.status);
  return (
    <Link
      href={`/events/${s.id}`}
      className="card p-4 block transition-all hover:-translate-y-0.5 hover:border-ember/60 overflow-hidden"
      style={{ borderLeft: `3px solid ${c}` }}
    >
      <div className="flex items-center gap-2 flex-wrap">
        <StatusDot status={s.status} />
        <span className="font-semibold">{s.name}</span>
        <span className="badge ml-auto" style={{ color: c, borderColor: tint(c, 40) }}>
          {EVENT_STATUS_LABEL[s.status as keyof typeof EVENT_STATUS_LABEL] ?? s.status}
        </span>
      </div>
      <div className="text-sm text-muted flex flex-wrap gap-x-4 gap-y-1 mt-2">
        <span className="text-foreground/80">{spanLabel(s.spans)}</span>
        {(s.city || s.state) && <span>{[s.city, s.state].filter(Boolean).join(", ")}</span>}
        {s.venueName && <span>{s.venueName}</span>}
        {s.promoterName && <span>{s.promoterName}</span>}
      </div>
      <div className="text-sm text-muted flex flex-wrap gap-x-4 gap-y-1 mt-1">
        {s.leaderName && <span>Leader: <span className="text-foreground/80">{s.leaderName}</span></span>}
        <span>{s.staffCount} staff{s.repsNeeded != null && ` / ${s.repsNeeded} needed`}</span>
        {s.goalCents != null && <span>Goal <span className="text-foreground/80">{moneyFloor(s.goalCents)}</span></span>}
      </div>
      <div className="text-sm flex flex-wrap gap-x-4 gap-y-1 mt-1">
        <span className="text-muted">
          Sales <span className="text-teal font-semibold">{moneyFloor(s.salesCents)}</span>
        </span>
        {s.goalCents != null && s.goalCents > 0 && (
          <span className="text-muted">
            <span className="text-foreground/80 font-semibold">{pctLabel(pctToGoal(s.salesCents, s.goalCents))}</span> of goal
          </span>
        )}
      </div>
    </Link>
  );
}

// ---- Month view (spanning bars) --------------------------------------------

function MonthView({ shows, anchor, todayIso, onHover, onLeave }: { shows: ExplorerShow[]; anchor: Date; todayIso: string } & HoverHandlers) {
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart);
  const weeks = Array.from({ length: 6 }, (_, w) => addDays(gridStart, w * 7));
  const curMonth = anchor.getUTCMonth();

  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-border">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-2 text-xs font-medium text-muted text-center">{d}</div>
        ))}
      </div>
      {weeks.map((weekStart, wi) => {
        const segs = layoutWeek(shows, weekStart); // every overlapping show, all lanes
        const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
        return (
          <div key={wi} className="relative border-b border-border last:border-b-0">
            <div className="pointer-events-none absolute inset-0 grid grid-cols-7">
              {days.map((_, i) => <div key={i} className={i ? "border-l border-border/40" : ""} />)}
            </div>
            <div className="grid grid-cols-7">
              {days.map((d) => {
                const dayIso = toISO(d);
                const isToday = dayIso === todayIso;
                const otherMonth = d.getUTCMonth() !== curMonth;
                return (
                  <div key={dayIso} className="px-2 pt-1.5 h-7">
                    <span
                      className={`inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full text-xs tabular-nums ${
                        isToday ? "bg-ember text-[#1a1206] font-bold" : otherMonth ? "text-muted/50" : "text-muted"
                      }`}
                    >
                      {d.getUTCDate()}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-7 gap-y-1 px-1 pb-1.5 min-h-[68px]" style={{ gridAutoRows: "20px" }}>
              {segs.map((seg, i) => {
                const show = seg.item;
                const c = accent(show.status);
                return (
                  <Link
                    key={`${show.id}-${i}`}
                    href={`/events/${show.id}`}
                    onMouseEnter={(e) => onHover(show, e)}
                    onMouseMove={(e) => onHover(show, e)}
                    onMouseLeave={onLeave}
                    onFocus={(e) => onHover(show, e)}
                    onBlur={onLeave}
                    className="truncate text-[11px] leading-5 px-1.5 rounded-md transition-transform hover:scale-[1.02]"
                    style={{
                      gridColumn: `${seg.col + 1} / span ${seg.span}`,
                      gridRow: seg.lane + 1,
                      background: tint(c, 16),
                      color: c,
                      borderLeft: `2px solid ${c}`,
                    }}
                  >
                    {show.status === "CANCELLED" ? <s>{show.name}</s> : show.name}
                  </Link>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---- Week view --------------------------------------------------------------

function WeekView({ shows, anchor, todayIso, onHover, onLeave }: { shows: ExplorerShow[]; anchor: Date; todayIso: string } & HoverHandlers) {
  const weekStart = startOfWeek(anchor);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  return (
    <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
      {days.map((d) => {
        const dayIso = toISO(d);
        const isToday = dayIso === todayIso;
        const dayShows = shows
          .filter((s) => onDay(s, d.getTime()))
          .sort((a, b) => (firstStart(a) ?? 0) - (firstStart(b) ?? 0));
        return (
          <div key={dayIso} className={`card p-2 min-h-[9rem] ${isToday ? "border-ember/70" : ""}`}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted">{DOW[d.getUTCDay()]}</span>
              <span className={`inline-flex items-center justify-center h-6 min-w-6 px-1 rounded-full text-xs tabular-nums ${isToday ? "bg-ember text-[#1a1206] font-bold" : "text-foreground"}`}>
                {d.getUTCDate()}
              </span>
            </div>
            <div className="space-y-1.5">
              {dayShows.map((s) => {
                const c = accent(s.status);
                return (
                  <Link
                    key={s.id}
                    href={`/events/${s.id}`}
                    onMouseEnter={(e) => onHover(s, e)}
                    onMouseMove={(e) => onHover(s, e)}
                    onMouseLeave={onLeave}
                    onFocus={(e) => onHover(s, e)}
                    onBlur={onLeave}
                    className="block rounded-md p-2 text-xs transition-transform hover:scale-[1.01]"
                    style={{ background: tint(c, 14), borderLeft: `2px solid ${c}` }}
                  >
                    <div className="font-medium text-foreground/90 truncate" title={s.name}>{s.name}</div>
                    {(s.city || s.venueName) && (
                      <div className="text-muted truncate">{s.venueName ?? `${s.city}, ${s.state ?? ""}`}</div>
                    )}
                    {s.leaderName && <div className="text-muted truncate">{s.leaderName}</div>}
                  </Link>
                );
              })}
              {dayShows.length === 0 && <div className="text-[11px] text-muted/50 px-1">—</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
