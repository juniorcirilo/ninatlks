import { cn } from "@/lib/utils";

type StatCardProps = {
  label: string;
  value: string;
  delta?: string;
  trend?: "up" | "down" | "neutral";
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
};

export function StatCard({
  label,
  value,
  delta,
  trend = "neutral",
  icon: Icon,
  className,
}: StatCardProps) {
  return (
    <div className={cn("glass relative overflow-hidden rounded-xl p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
        {Icon && (
          <div className="shrink-0 text-slate-400 dark:text-slate-500">
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <div className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{value}</div>
      {delta && (
        <div
          className={cn(
            "mt-1 text-xs font-medium",
            trend === "up" && "text-success",
            trend === "down" && "text-destructive",
            trend === "neutral" && "text-muted-foreground",
          )}
        >
          {delta}
        </div>
      )}
    </div>
  );
}
