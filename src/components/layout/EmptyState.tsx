import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon?: React.ComponentType<{ className?: string }>;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
};

export function EmptyState({ icon: Icon, title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-xl px-6 py-14 text-center text-gray-500 dark:text-slate-400",
        className,
      )}
    >
      {Icon && (
        <div className="mb-4 flex h-12 w-12 items-center justify-center opacity-50">
          <Icon className="h-12 w-12" />
        </div>
      )}
      <h3 className="text-lg font-medium text-gray-900 dark:text-slate-100">{title}</h3>
      {description && (
        <p className="mt-1 max-w-md text-sm text-gray-500 dark:text-slate-500">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
