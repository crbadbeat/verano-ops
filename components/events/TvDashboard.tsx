"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { moneyFloor, moneyCompact, pctFloor } from "@/lib/reporting/format";
import { goalColor, GoalRing, SalesBars } from "./dashboard-ui";
import RepAvatar from "@/components/employees/RepAvatar";

// -----------------------------------------------------------------------------
// Verano Outdoor Living — LIVE SALES executive wall board. Engineered to FIT ONE SCREEN
// with no scroll for 1–8 active shows and any order count, at any TV size:
//   • A grid-rows shell (header / main / YTD footer) at h-[100dvh] with overflow
//     hidden + min-h-0 at every level — nothing can overflow or overlap.
//   • The show grid uses equal 1fr cells whose count adapts to the show count.
//   • Each card MEASURES its own box (ResizeObserver) and adapts: ring size, daily
//     bars on/off, and how many order rows fit ("+N more" / none when tight).
//   • The sidebar's two feeds split the remaining height and each shows what fits.
// New sales flash + chime, milestones throw confetti, records take over the screen.
// -----------------------------------------------------------------------------

export interface TvPace {
  dayIndex: number;
  totalDays: number;
  projectedCents: number | null;
  onTrack: boolean | null;
}
export interface TvSale { id: string; repId: string; repName: string; showLabel: string; location: string | null; product: string; customer: string; amountCents: number; createdAt: string }
export interface TvCardSale { id: string; repId: string; repName: string; customer: string; product: string; amountCents: number }
export interface TvShow {
  showId: string;
  name: string;
  shortName: string | null;
  leaderName: string | null;
  city: string | null;
  state: string | null;
  status: string;
  salesCents: number;
  goalCents: number | null;
  pctToGoal: number | null;
  count: number;
  pace: TvPace | null;
  spark: number[];
  topRep: { repId: string; name: string; salesCents: number; count: number } | null;
  sales: TvCardSale[];
  weather: { tempF: number; emoji: string; label: string } | null;
}
export interface TvRep { repId: string; repName: string; salesCents: number; count: number }
export interface TvLeader { leaderId: string; name: string; pctToGoal: number | null; salesCents: number }

/** A sale queued for its full-screen celebration (one plays at a time). */
interface QueuedSale {
  id: string;
  repId: string;
  repName: string;
  amountCents: number;
  product: string;
  showLabel: string;
  location: string | null;
  customer: string;
  isRecord: boolean; // beat the day's previous biggest → gold "sale of the day" flourish
}

interface Props {
  shows: TvShow[];
  reps: TvRep[];
  latest: TvSale[];
  biggest: TvSale | null;
  ytdLeaders: TvLeader[];
  avatars: Record<string, number>;
  totalSalesCents: number;
  goalCents: number;
  pctToGoal: number | null;
  ordersCount: number;
}

const mix = (c: string, pct: number) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;

/** Columns × rows for N shows across a 16:9 area (equal 1fr cells). */
function gridForN(n: number): { cols: number; rows: number } {
  if (n <= 1) return { cols: 1, rows: 1 };
  if (n === 2) return { cols: 2, rows: 1 };
  if (n === 3) return { cols: 3, rows: 1 };
  if (n === 4) return { cols: 2, rows: 2 };
  if (n <= 6) return { cols: 3, rows: 2 };
  return { cols: 4, rows: 2 }; // 7–8
}

/** Track an element's content box size (drives all the fit math). */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

/** Eased count-up for headline figures. */
function useCountUp(value: number, ms = 900): number {
  const [display, setDisplay] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    const from = prev.current;
    const to = value;
    prev.current = value;
    if (from === to) return;
    let raf = 0;
    const start = performance.now();
    const step = (t: number) => {
      const p = Math.min(1, (t - start) / ms);
      setDisplay(Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value, ms]);
  return display;
}

export default function TvDashboard(props: Props) {
  const { shows, reps, latest, biggest, ytdLeaders, avatars, totalSalesCents, goalCents, pctToGoal, ordersCount } = props;
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement | null>(null);

  const [soundOn, setSoundOn] = useState(false);
  const [isFs, setIsFs] = useState(false);
  const [clock, setClock] = useState("");
  const [celebration, setCelebration] = useState<{ kind: "goal" | "milestone"; title: string; sub: string } | null>(null);
  // Every new sale gets a full-screen celebration. When several land between
  // refreshes they queue up and play one after another (oldest first).
  const [queue, setQueue] = useState<QueuedSale[]>([]);
  const [active, setActive] = useState<QueuedSale | null>(null);
  const [confettiKey, setConfettiKey] = useState(0);

  const audioRef = useRef<AudioContext | null>(null);
  const seenSaleIds = useRef<Set<string> | null>(null); // sale ids already on the board (null until first data)
  const prevPct = useRef<Record<string, number>>({});
  const prevBiggest = useRef(biggest?.amountCents ?? 0);
  const soundRef = useRef(soundOn);
  soundRef.current = soundOn;

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
    tick();
    const id = setInterval(tick, 15_000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const id = setInterval(() => {
      if (typeof document === "undefined" || document.visibilityState !== "hidden") router.refresh();
    }, 20_000);
    return () => clearInterval(id);
  }, [router]);

  useEffect(() => {
    const h = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time read of the saved preference
      if (localStorage.getItem("tv-sound") === "on") setSoundOn(true);
    } catch {
      /* storage unavailable */
    }
  }, []);

  function ensureAudio(): AudioContext | null {
    if (typeof window === "undefined") return null;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return null;
    if (!audioRef.current) audioRef.current = new AC();
    if (audioRef.current.state === "suspended") void audioRef.current.resume();
    return audioRef.current;
  }
  function playNotes(notes: [number, number][], dur: number) {
    const ctx = audioRef.current;
    if (!ctx) return;
    for (const [freq, at] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      osc.connect(gain);
      gain.connect(ctx.destination);
      const start = ctx.currentTime + at;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.3, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      osc.start(start);
      osc.stop(start + dur + 0.03);
    }
  }
  const chime = () => soundRef.current && playNotes([[880, 0], [1318.5, 0.09]], 0.16);
  const fanfare = () => soundRef.current && playNotes([[523.25, 0], [659.25, 0.11], [783.99, 0.22], [1046.5, 0.34], [1318.5, 0.46]], 0.22);

  useEffect(() => {
    const bigNow = biggest?.amountCents ?? 0;

    // ---- new-sale celebrations: enqueue every sale we haven't shown yet ----
    const seen = seenSaleIds.current;
    if (seen === null) {
      // First data load: remember what's already on the board, celebrate nothing.
      seenSaleIds.current = new Set(latest.map((s) => s.id));
    } else {
      const fresh: QueuedSale[] = [];
      // `latest` is newest-first; walk it oldest-first so they play in sold order.
      for (let i = latest.length - 1; i >= 0; i--) {
        const s = latest[i];
        if (seen.has(s.id)) continue;
        seen.add(s.id);
        fresh.push({
          id: s.id,
          repId: s.repId,
          repName: s.repName,
          amountCents: s.amountCents,
          product: s.product,
          showLabel: s.showLabel,
          location: s.location,
          customer: s.customer,
          // Only the sale that lifts the day's record earns the gold flourish.
          isRecord: prevBiggest.current > 0 && bigNow > prevBiggest.current && s.amountCents >= bigNow,
        });
      }
      if (fresh.length) setQueue((q) => [...q, ...fresh]);
    }

    // ---- goal / milestone banners (unchanged) ----
    for (const s of shows) {
      const before = prevPct.current[s.showId];
      const now = s.pctToGoal ?? 0;
      if (before != null) {
        if (before < 1 && now >= 1) {
          setCelebration({ kind: "goal", title: "🎉 Goal crushed!", sub: `${label(s)} hit ${pctFloor(s.pctToGoal)} of goal` });
          setConfettiKey((k) => k + 1);
          fanfare();
        } else if (before < 0.7 && now >= 0.7) {
          setCelebration({ kind: "milestone", title: "🔥 70% of goal!", sub: `${label(s)} is closing in` });
          setConfettiKey((k) => k + 1);
          chime();
        }
      }
      prevPct.current[s.showId] = now;
    }

    prevBiggest.current = bigNow;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latest, biggest, shows]);

  // Play each queued sale full-screen, then dismiss so the next can take over.
  useEffect(() => {
    if (!active) return;
    setConfettiKey((k) => k + 1);
    if (active.isRecord) fanfare();
    else chime();
    const ms = active.isRecord ? 8500 : 6500;
    const id = setTimeout(() => setActive(null), ms);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // Pump the queue: when the screen is clear, promote the next waiting sale.
  useEffect(() => {
    if (active || queue.length === 0) return;
    setActive(queue[0]);
    setQueue((q) => q.slice(1));
  }, [active, queue]);

  useEffect(() => {
    if (!soundOn) return;
    const unlock = () => ensureAudio();
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [soundOn]);

  useEffect(() => {
    if (!celebration) return;
    const id = setTimeout(() => setCelebration(null), 6000);
    return () => clearTimeout(id);
  }, [celebration]);

  function toggleFs() {
    if (!document.fullscreenElement) void rootRef.current?.requestFullscreen?.();
    else void document.exitFullscreen?.();
  }
  function toggleSound() {
    setSoundOn((v) => {
      const next = !v;
      if (next) ensureAudio();
      try {
        localStorage.setItem("tv-sound", next ? "on" : "off");
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }

  const totalUp = useCountUp(totalSalesCents);
  const ordersUp = useCountUp(ordersCount);
  const n = shows.length;
  const { cols, rows } = gridForN(n);
  const goalPctWidth = pctToGoal == null ? 0 : Math.max(1, Math.min(100, pctToGoal * 100));

  return (
    <div
      ref={rootRef}
      className="fixed inset-0 z-30 overflow-hidden bg-background text-foreground grid"
      style={{ gridTemplateRows: "auto minmax(0,1fr) auto", height: "100vh" }}
    >
      <Confetti fireKey={confettiKey} />
      {active && <SaleCelebration s={active} avatars={avatars} more={queue.length} />}
      {celebration && <CelebrationBanner c={celebration} />}

      {/* HEADER */}
      <header className="min-w-0 border-b border-border bg-background/85 backdrop-blur px-6 py-3">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-center gap-4 shrink-0">
            <Logo />
            <div className="leading-tight border-l border-border/60 pl-4">
              <div className="text-lg font-bold tracking-tight">Live sales</div>
              <div className="flex items-center gap-1.5 text-xs text-muted">
                <span className="inline-block h-2 w-2 rounded-full bg-danger tv-live" />
                LIVE {clock && `· ${clock}`}
              </div>
            </div>
          </div>

          <div className="flex-1 min-w-[16rem]">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-4xl sm:text-5xl font-black tabular-nums text-teal leading-none">{moneyFloor(totalUp)}</div>
                <div className="text-xs text-muted mt-0.5">total sales today · {ordersUp.toLocaleString()} {ordersCount === 1 ? "order" : "orders"}</div>
              </div>
              <div className="text-right">
                <div className="text-2xl font-bold tabular-nums text-ember leading-none">{pctFloor(pctToGoal)}</div>
                <div className="text-xs text-muted mt-0.5">of {moneyCompact(goalCents)} goal</div>
              </div>
            </div>
            <div className="mt-1.5 h-2.5 rounded-full bg-surface-2 overflow-hidden">
              <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${goalPctWidth}%`, background: goalColor(pctToGoal) }} />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={toggleSound} aria-label={soundOn ? "Mute" : "Enable sound"} className="btn btn-ghost text-sm">
              {soundOn ? "🔊 Sound on" : "🔈 Sound off"}
            </button>
            <button type="button" onClick={toggleFs} className="btn btn-ghost text-sm">
              {isFs ? "Exit full screen" : "⛶ Full screen"}
            </button>
          </div>
        </div>
      </header>

      {/* MAIN — shows grid + sidebar, both clip to the region */}
      <div className="min-h-0 min-w-0 overflow-hidden grid gap-4 p-4" style={{ gridTemplateColumns: "minmax(0,1fr) clamp(280px, 22vw, 340px)" }}>
        {n === 0 ? (
          <div className="col-span-2 flex flex-col items-center justify-center text-center">
            <div className="text-6xl mb-4">🌴</div>
            <div className="text-3xl font-bold">No shows live right now</div>
            <div className="text-muted mt-2 text-lg">The board lights up the moment a show goes active. The year so far is below.</div>
          </div>
        ) : (
          <>
            <div
              className="min-h-0 min-w-0 overflow-hidden grid gap-4"
              style={{ gridTemplateColumns: `repeat(${cols}, minmax(0,1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0,1fr))` }}
            >
              {shows.map((s, i) => (
                <TvShowCard key={s.showId} s={s} hero={i === 0} avatars={avatars} />
              ))}
            </div>
            <Sidebar reps={reps} latest={latest} biggest={biggest} avatars={avatars} />
          </>
        )}
      </div>

      {/* YTD FOOTER — a real grid row, so it never overlaps the board */}
      {ytdLeaders.length > 0 && (
        <div className="min-w-0 overflow-hidden border-t border-border bg-background px-4 py-2">
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-[11px] font-mono uppercase tracking-widest text-muted">🏅 YTD leaders · % to goal</h2>
          </div>
          <div className="flex gap-2 overflow-hidden">
            {ytdLeaders.map((l) => (
              <YtdChip key={l.leaderId} l={l} avatars={avatars} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const label = (s: { shortName: string | null; name: string }) => s.shortName?.trim() || s.name;

// ---- show card (measures itself, adapts content) ----------------------------

function TvShowCard({ s, hero, avatars }: { s: TvShow; hero: boolean; avatars: Record<string, number> }) {
  const [cardRef, card] = useSize<HTMLDivElement>();
  const [ordersRef, orders] = useSize<HTMLDivElement>();
  const H = card.h || 320; // sensible default for the first paint
  const ring = H >= 400 ? 150 : H >= 320 ? 122 : H >= 250 ? 100 : 78;
  const showBars = H >= 300 && s.spark.length >= 2;
  const bigType = H >= 360;
  const beat = s.pctToGoal != null && s.pctToGoal >= 1;
  const location = [s.city, s.state].filter(Boolean).join(", ");

  // How many order rows fit in the flexible orders region (reserve a row for "+N
  // more" when there's overflow). ROW ≈ one order line.
  const ROW = 30;
  const cap = Math.max(0, Math.floor((orders.h || 0) / ROW));
  const hasMore = s.count > Math.min(s.sales.length, cap);
  const shownN = cap === 0 ? 0 : hasMore ? Math.max(0, cap - 1) : Math.min(s.sales.length, cap);
  const shown = s.sales.slice(0, shownN);
  const moreN = s.count - shown.length;

  return (
    <div
      ref={cardRef}
      data-tvcard
      className={`card relative min-h-0 min-w-0 overflow-hidden flex flex-col p-4 ${hero ? "tv-hero" : ""}`}
      style={hero ? { borderColor: mix("var(--ember)", 65) } : undefined}
    >
      {/* header — show name with the current weather right-justified beside it */}
      <div className="shrink-0">
        <div className="flex items-baseline gap-2">
          <div className={`min-w-0 flex-1 font-bold leading-tight truncate ${bigType ? "text-xl" : "text-base"}`}>
            {hero && <span className="mr-1">👑</span>}
            {s.name}
          </div>
          {s.weather && (
            <span className={`shrink-0 whitespace-nowrap tabular-nums text-muted ${bigType ? "text-xl" : "text-base"}`}>
              {s.weather.emoji} {s.weather.tempF}°
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted">
          <span className="min-w-0 truncate">
            {s.leaderName ?? "No leader"}{location && ` · ${location}`}
          </span>
          {beat && (
            <span className="ml-auto shrink-0 badge" style={{ color: "var(--success)", borderColor: mix("var(--success)", 45) }}>Goal beat</span>
          )}
        </div>
      </div>

      {/* ring + figures */}
      <div className="shrink-0 mt-3 flex items-center gap-4">
        <GoalRing pct={s.pctToGoal} salesCents={s.salesCents} goalCents={s.goalCents} size={ring} />
        <div className="min-w-0">
          <div className={`font-black tabular-nums leading-none text-teal ${bigType ? "text-3xl" : "text-2xl"}`}>{moneyFloor(s.salesCents)}</div>
          <div className="text-xs text-muted mt-1">of {s.goalCents ? moneyCompact(s.goalCents) : "—"} goal · {s.count} {s.count === 1 ? "order" : "orders"}</div>
          {s.pace && (
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <span className="tabular-nums">Day {Math.max(s.pace.dayIndex, 0)}/{s.pace.totalDays}</span>
              {s.pace.dayIndex > 0 && s.pace.projectedCents != null && (
                <>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums">proj {moneyCompact(s.pace.projectedCents)}</span>
                  {s.pace.onTrack != null && (
                    <span className="badge" style={{ color: s.pace.onTrack ? "var(--success)" : "var(--ember)", borderColor: mix(s.pace.onTrack ? "var(--success)" : "var(--ember)", 40) }}>
                      {s.pace.onTrack ? "On track" : "Behind"}
                    </span>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {showBars && (
        <div className="shrink-0 mt-3">
          <div className="text-[11px] uppercase tracking-wide text-muted mb-1">Daily sales</div>
          <SalesBars points={s.spark} height={34} />
        </div>
      )}

      {/* orders — fills remaining space, shows exactly what fits */}
      <div ref={ordersRef} data-orders className="flex-1 min-h-0 overflow-hidden mt-3">
        {shown.length > 0 && (
          <ul className="space-y-1.5">
            {shown.map((o) => (
              <li key={o.id} className="flex items-center gap-2 text-sm h-[24px]">
                <RepAvatar id={o.repId} version={avatars[o.repId] ?? null} name={o.repName} size={22} />
                <span className="truncate min-w-0 flex-1">
                  {o.repName}
                  {o.product && <span className="text-muted"> · {o.product}</span>}
                </span>
                <span className="shrink-0 tabular-nums font-semibold text-teal">{moneyFloor(o.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
        {hasMore && moreN > 0 && cap >= 1 && <div className="text-xs text-muted mt-1.5">+{moreN} more {moreN === 1 ? "order" : "orders"}</div>}
      </div>

      {/* top rep — always visible */}
      {s.topRep && (
        <div className="shrink-0 mt-3 flex items-center gap-2.5 rounded-xl border border-border bg-surface-2/40 px-3 py-2">
          <RepAvatar id={s.topRep.repId} version={avatars[s.topRep.repId] ?? null} name={s.topRep.name} size={32} />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wide text-muted">🔥 Top rep</div>
            <div className="text-sm font-semibold truncate">{s.topRep.name}</div>
          </div>
          <span className="shrink-0 tabular-nums font-bold text-teal">{moneyFloor(s.topRep.salesCents)}</span>
        </div>
      )}
    </div>
  );
}

// ---- sidebar ----------------------------------------------------------------

function Sidebar({ reps, latest, biggest, avatars }: { reps: TvRep[]; latest: TvSale[]; biggest: TvSale | null; avatars: Record<string, number> }) {
  const [repsRef, repsCount] = useFit<HTMLOListElement>(34);
  const [feedRef, feedCount] = useFit<HTMLUListElement>(40);
  const topReps = reps.slice(0, Math.max(0, repsCount));
  const feed = latest.slice(0, Math.max(0, feedCount));
  const repTop = topReps.length ? topReps[0].salesCents : 0;

  return (
    <aside className="min-h-0 min-w-0 overflow-hidden grid gap-4" style={{ gridTemplateRows: "auto 1fr 1fr" }}>
      {biggest && biggest.amountCents > 0 && (
        <div className="card p-4 shrink-0" style={{ borderColor: mix("var(--ember)", 45) }}>
          <div className="text-[11px] font-mono uppercase tracking-widest text-muted">💥 Biggest sale today</div>
          <div className="mt-2 flex items-center gap-3">
            <RepAvatar id={biggest.repId} version={avatars[biggest.repId] ?? null} name={biggest.repName} size={52} />
            <div className="min-w-0">
              <div className="text-2xl font-black tabular-nums text-ember leading-none">{moneyFloor(biggest.amountCents)}</div>
              <div className="mt-1 text-sm truncate">{biggest.repName} <span className="text-muted">· {biggest.showLabel}</span></div>
            </div>
          </div>
        </div>
      )}

      <div className="card p-4 min-h-0 overflow-hidden flex flex-col">
        <h2 className="font-semibold mb-2 shrink-0">🏆 Top reps</h2>
        <ol ref={repsRef} className="flex-1 min-h-0 overflow-hidden space-y-2">
          {topReps.map((r, i) => {
            const w = repTop > 0 ? Math.max(4, Math.round((r.salesCents / repTop) * 100)) : 0;
            const leaderRow = i === 0;
            return (
              <li key={r.repId} className="flex items-center gap-2.5 h-[28px]">
                <span className="w-4 shrink-0 text-center text-sm tabular-nums text-muted">{leaderRow ? "🔥" : i + 1}</span>
                <RepAvatar id={r.repId} version={avatars[r.repId] ?? null} name={r.repName} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="truncate text-sm">{r.repName}</span>
                    <span className="shrink-0 tabular-nums text-sm font-semibold text-teal">{moneyFloor(r.salesCents)}</span>
                  </div>
                  <div className="mt-0.5 h-1 rounded-full bg-surface-2 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${w}%`, background: leaderRow ? "var(--ember)" : mix("var(--ember)", 55) }} />
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="card p-4 min-h-0 overflow-hidden flex flex-col">
        <h2 className="font-semibold mb-2 shrink-0">⚡ Latest sales</h2>
        <ul ref={feedRef} className="flex-1 min-h-0 overflow-hidden space-y-2.5">
          {feed.map((s) => (
            <li key={s.id} className="flex items-center gap-2.5 h-[32px]">
              <RepAvatar id={s.repId} version={avatars[s.repId] ?? null} name={s.repName} size={30} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm truncate">{s.repName}</span>
                  <span className="shrink-0 tabular-nums text-sm font-semibold text-teal">{moneyFloor(s.amountCents)}</span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-[11px] text-muted truncate">{[s.product, `${s.showLabel}${s.location ? ` - ${s.location}` : ""}`].filter(Boolean).join(" · ")}</span>
                  <span className="shrink-0 text-[11px] text-muted tabular-nums">{timeAgo(s.createdAt)}</span>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </aside>
  );
}

/** Measure a scroll region and return how many rowH-tall rows fit. */
function useFit<T extends HTMLElement>(rowH: number) {
  const [ref, size] = useSize<T>();
  return [ref, Math.max(0, Math.floor((size.h || 0) / rowH))] as const;
}

// ---- YTD footer chip --------------------------------------------------------

function YtdChip({ l, avatars }: { l: TvLeader; avatars: Record<string, number> }) {
  const color = goalColor(l.pctToGoal);
  const R = 20;
  const C = 2 * Math.PI * R;
  const p = l.pctToGoal == null ? 0 : Math.max(0, Math.min(1, l.pctToGoal));
  return (
    <div className="shrink-0 flex items-center gap-2 rounded-lg border border-border bg-surface-2/30 px-2.5 py-1.5" style={{ minWidth: 0 }}>
      <div className="relative shrink-0" style={{ width: 44, height: 44 }}>
        <svg viewBox="0 0 48 48" className="h-full w-full -rotate-90" aria-hidden="true">
          <circle cx="24" cy="24" r={R} fill="none" stroke="var(--surface-2)" strokeWidth="5" />
          <circle cx="24" cy="24" r={R} fill="none" stroke={color} strokeWidth="5" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - p)} />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center text-[11px] font-bold tabular-nums" style={{ color }}>{pctFloor(l.pctToGoal)}</div>
      </div>
      <div className="min-w-0">
        <div className="text-xs font-medium truncate max-w-[7rem]">{l.name}</div>
        <div className="text-[11px] tabular-nums text-teal">{moneyFloor(l.salesCents)}</div>
      </div>
    </div>
  );
}

// ---- celebration banner + sale takeover + confetti --------------------------

function CelebrationBanner({ c }: { c: { kind: "goal" | "milestone"; title: string; sub: string } }) {
  const accent = c.kind === "goal" ? "var(--success)" : "var(--ember)";
  return (
    <div className="fixed inset-x-0 top-0 z-50 flex justify-center pointer-events-none px-4 pt-4">
      <div className="tv-banner rounded-2xl border px-6 py-3 text-center shadow-2xl bg-surface" style={{ borderColor: accent, boxShadow: `0 0 50px ${mix(accent, 45)}` }}>
        <div className="text-xl font-black tracking-tight" style={{ color: accent }}>{c.title}</div>
        <div className="text-sm text-foreground/90 mt-0.5">{c.sub}</div>
      </div>
    </div>
  );
}

/** Full-screen takeover for a single sale — every sale gets one. Records add a
 *  gold "sale of the day" flourish; the rest celebrate in teal. */
function SaleCelebration({ s, avatars, more }: { s: QueuedSale; avatars: Record<string, number>; more: number }) {
  const accent = s.isRecord ? "var(--ember)" : "var(--teal)";
  const meta = [s.customer.trim(), [s.showLabel, s.location].filter(Boolean).join(" · ")].filter(Boolean).join(" · ");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/90 backdrop-blur-md pointer-events-none">
      <div className="tv-pop text-center px-8 max-w-[92vw]">
        <div className="text-base sm:text-lg font-mono uppercase tracking-[0.3em]" style={{ color: accent }}>
          {s.isRecord ? "🏆 New record — sale of the day" : "💰 New sale!"}
        </div>
        <div className="mt-5 flex justify-center">
          <RepAvatar id={s.repId} version={avatars[s.repId] ?? null} name={s.repName} size={132} />
        </div>
        <div className="mt-5 text-3xl sm:text-4xl font-bold">{s.repName}</div>
        <div className="mt-3 text-7xl sm:text-8xl md:text-9xl font-black tabular-nums leading-none text-teal">{moneyFloor(s.amountCents)}</div>
        {s.product && (
          <div
            className="mt-6 inline-block rounded-2xl border px-7 py-3 text-2xl sm:text-3xl font-semibold"
            style={{ borderColor: mix(accent, 55), background: mix(accent, 12) }}
          >
            {s.product}
          </div>
        )}
        {meta && <div className="mt-5 text-xl sm:text-2xl text-muted">{meta}</div>}
        {more > 0 && (
          <div className="mt-7 text-sm sm:text-base font-mono uppercase tracking-widest text-muted">
            ＋{more} more {more === 1 ? "sale" : "sales"} coming…
          </div>
        )}
      </div>
    </div>
  );
}

function Confetti({ fireKey }: { fireKey: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    if (fireKey === 0) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const W = (canvas.width = window.innerWidth * dpr);
    const H = (canvas.height = window.innerHeight * dpr);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    const colors = ["#ff7a29", "#2dd4bf", "#34d399", "#a78bfa", "#f5556c", "#eef2f9"];
    const parts = Array.from({ length: 170 }, () => ({
      x: W / 2 + (Math.random() - 0.5) * W * 0.5,
      y: H * 0.28 + (Math.random() - 0.5) * 120,
      vx: (Math.random() - 0.5) * 15 * dpr,
      vy: (Math.random() * -13 - 5) * dpr,
      g: 0.34 * dpr,
      size: (4 + Math.random() * 7) * dpr,
      rot: Math.random() * 6.28,
      vr: (Math.random() - 0.5) * 0.4,
      color: colors[Math.floor(Math.random() * colors.length)],
      life: 1,
    }));
    let raf = 0;
    let frame = 0;
    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      frame++;
      let alive = false;
      for (const p of parts) {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.006;
        if (p.y < H + 30 && p.life > 0) {
          alive = true;
          ctx.save();
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
          ctx.restore();
        }
      }
      if (alive && frame < 320) raf = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, W, H);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [fireKey]);
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[60]" />;
}

// ---- misc -------------------------------------------------------------------

function timeAgo(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return "now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

function Logo() {
  const [ok, setOk] = useState(true);
  if (ok) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src="/logo.png" alt="Verano Outdoor Living" className="h-9 w-auto" onError={() => setOk(false)} />;
  }
  return <span className="font-black tracking-tight text-lg">VERANO <span className="text-ember">GRILLS</span></span>;
}
