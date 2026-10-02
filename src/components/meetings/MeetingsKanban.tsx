import { cn } from "@/lib/utils";
import { Calendar, CheckCircle2, X, RotateCcw, XCircle } from "lucide-react";
import { MEETING_STATUS_LABEL, formatMeetingTime, type Meeting, type MeetingStatus } from "@/lib/meetings";

const COLUMNS: { status: MeetingStatus; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { status: "scheduled",   label: "Agendadas",  icon: Calendar },
  { status: "attended",    label: "Realizadas", icon: CheckCircle2 },
  { status: "no_show",     label: "No-show",    icon: X },
  { status: "rescheduled", label: "Remarcadas", icon: RotateCcw },
  { status: "canceled",    label: "Canceladas", icon: XCircle },
];

export function MeetingsKanban({
  meetings,
  onCardClick,
}: {
  meetings: Meeting[];
  onCardClick: (m: Meeting) => void;
}) {
  const byStatus = new Map<MeetingStatus, Meeting[]>();
  for (const c of COLUMNS) byStatus.set(c.status, []);
  for (const m of meetings) {
    const arr = byStatus.get(m.status) ?? [];
    arr.push(m);
    byStatus.set(m.status, arr);
  }

  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {COLUMNS.map((col) => {
        const items = byStatus.get(col.status) ?? [];
        const tone = MEETING_STATUS_LABEL[col.status];
        const Icon = col.icon;
        return (
          <div key={col.status} className="flex w-[280px] shrink-0 flex-col rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40">
            <div className="flex items-center justify-between gap-2 border-b border-gray-200 dark:border-slate-800 px-3 py-2.5">
              <div className="flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-sm font-medium">{col.label}</span>
                <span className={cn("rounded-md px-1.5 py-0.5 text-[10px] ring-1", tone.cls)}>
                  {items.length}
                </span>
              </div>
            </div>
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {items.length === 0 ? (
                <div className="flex h-20 items-center justify-center rounded-md border border-dashed border-gray-200 dark:border-slate-800 text-[11px] text-muted-foreground">
                  Vazio
                </div>
              ) : (
                items.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => onCardClick(m)}
                    className="w-full rounded-lg border border-gray-200 dark:border-slate-800 bg-background p-2.5 text-left transition hover:border-primary/40 hover:bg-muted/50"
                  >
                    <div className="truncate text-sm font-medium">
                      {m.invitee_name ?? m.invitee_phone ?? "Lead"}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">
                      {formatMeetingTime(m.starts_at)}
                    </div>
                    {m.briefing?.dor && (
                      <p className="mt-1.5 line-clamp-2 text-[11px] text-muted-foreground">
                        {m.briefing.dor}
                      </p>
                    )}
                  </button>
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
