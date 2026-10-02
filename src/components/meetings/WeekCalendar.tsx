import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MEETING_STATUS_LABEL, type Meeting } from "@/lib/meetings";

const HOURS = Array.from({ length: 13 }, (_, i) => 8 + i); // 8h..20h
const DAYS_LABEL = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

function startOfWeek(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  out.setDate(out.getDate() - out.getDay());
  return out;
}

export function WeekCalendar({
  meetings,
  weekStart,
  onWeekChange,
  onMeetingClick,
}: {
  meetings: Meeting[];
  weekStart: Date;
  onWeekChange: (d: Date) => void;
  onMeetingClick: (m: Meeting) => void;
}) {
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      return d;
    });
  }, [weekStart]);

  const byDay = useMemo(() => {
    const map = new Map<string, Meeting[]>();
    for (const m of meetings) {
      const d = new Date(m.starts_at);
      const key = d.toDateString();
      const arr = map.get(key) ?? [];
      arr.push(m);
      map.set(key, arr);
    }
    return map;
  }, [meetings]);

  function shiftWeek(weeks: number) {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + weeks * 7);
    onWeekChange(startOfWeek(d));
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const monthLabel = new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
  }).format(weekStart);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40">
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-gray-200 dark:border-slate-800 px-4 py-2.5">
        <div className="flex items-center gap-1.5">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => shiftWeek(-1)}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button size="sm" variant="outline" className="h-7" onClick={() => onWeekChange(startOfWeek(new Date()))}>
            Hoje
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => shiftWeek(1)}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <div className="text-sm font-medium capitalize">{monthLabel}</div>
        <div className="w-[120px]" />
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-[60px_repeat(7,minmax(0,1fr))] border-b border-gray-200 dark:border-slate-800">
        <div className="border-r border-gray-200 dark:border-slate-800" />
        {days.map((d) => {
          const isToday = d.toDateString() === today.toDateString();
          return (
            <div
              key={d.toISOString()}
              className={cn(
                "border-r border-gray-200 dark:border-slate-800 px-2 py-2 text-center text-xs",
                isToday && "bg-primary/5",
              )}
            >
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {DAYS_LABEL[d.getDay()]}
              </div>
              <div className={cn("mt-0.5 text-sm font-semibold", isToday && "text-primary")}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Hour grid */}
      <div className="relative grid grid-cols-[60px_repeat(7,minmax(0,1fr))]">
        {/* Hour labels column */}
        <div className="border-r border-gray-200 dark:border-slate-800">
          {HOURS.map((h) => (
            <div key={h} className="h-12 border-b border-gray-200 dark:border-slate-800 px-2 pt-0.5 text-right text-[10px] text-muted-foreground">
              {h.toString().padStart(2, "0")}:00
            </div>
          ))}
        </div>

        {/* Day columns */}
        {days.map((d) => {
          const dayMeetings = byDay.get(d.toDateString()) ?? [];
          const isToday = d.toDateString() === today.toDateString();
          return (
            <div
              key={d.toISOString()}
              className={cn(
                "relative border-r border-gray-200 dark:border-slate-800",
                isToday && "bg-primary/[0.02]",
              )}
            >
              {/* Hour cells */}
              {HOURS.map((h) => (
                <div key={h} className="h-12 border-b border-gray-200 dark:border-slate-800" />
              ))}

              {/* Meeting blocks */}
              {dayMeetings.map((m) => {
                const start = new Date(m.starts_at);
                const startMin = start.getHours() * 60 + start.getMinutes();
                const top = ((startMin - HOURS[0] * 60) / 60) * 48; // 48px per hour
                const dur = m.duration_minutes ?? 30;
                const height = Math.max(20, (dur / 60) * 48);
                const tone = MEETING_STATUS_LABEL[m.status];
                if (top < 0 || top > HOURS.length * 48) return null;

                return (
                  <button
                    key={m.id}
                    onClick={() => onMeetingClick(m)}
                    className={cn(
                      "absolute left-0.5 right-0.5 overflow-hidden rounded-md border px-1.5 py-1 text-left text-[10px] shadow-sm transition hover:z-10 hover:shadow-md",
                      tone.cls,
                    )}
                    style={{ top: `${top}px`, height: `${height}px` }}
                    title={`${m.invitee_name ?? "Lead"} · ${start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`}
                  >
                    <div className="truncate font-medium">
                      {m.invitee_name ?? m.invitee_phone ?? "Lead"}
                    </div>
                    <div className="truncate opacity-75">
                      {start.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export { startOfWeek };
