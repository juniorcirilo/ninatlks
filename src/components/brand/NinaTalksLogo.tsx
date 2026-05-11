import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  size?: "sm" | "md" | "lg";
  className?: string;
};

const sizes = {
  sm: "h-7 w-7 rounded-lg",
  md: "h-8 w-8 rounded-xl",
  lg: "h-10 w-10 rounded-2xl",
} as const;

const iconSizes = {
  sm: "h-3.5 w-3.5",
  md: "h-4 w-4",
  lg: "h-5 w-5",
} as const;

export function NinaTalksLogo({ size = "md", className }: Props) {
  return (
    <div
      className={cn(
        "flex items-center justify-center bg-gradient-primary shadow-glow",
        sizes[size],
        className,
      )}
    >
      <Zap className={cn("text-primary-foreground", iconSizes[size])} />
    </div>
  );
}
