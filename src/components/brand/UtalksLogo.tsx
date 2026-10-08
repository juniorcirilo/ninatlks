import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  size?: "sm" | "md" | "lg" | "xl";
  className?: string;
};

// Mesmo tratamento visual do LiveChatLogo: glow azul + tile slate arredondado,
// com o símbolo branco dentro.
const tile = {
  sm: "h-9 w-9",
  md: "h-10 w-10",
  lg: "h-11 w-11",
  xl: "h-20 w-20",
} as const;

const bubble = {
  sm: "h-[22px] w-[22px]",
  md: "h-6 w-6",
  lg: "h-7 w-7",
  xl: "h-12 w-12",
} as const;

const icon = {
  sm: "h-3 w-3",
  md: "h-3.5 w-3.5",
  lg: "h-4 w-4",
  xl: "h-7 w-7",
} as const;

export function UtalksLogo({ size = "md", className }: Props) {
  return (
    <div
      className={cn("relative flex shrink-0 items-center justify-center", tile[size], className)}
    >
      <div className="absolute inset-0 rounded-[28%] bg-blue-500/30 blur-xl" />
      <div
        className={cn(
          "relative flex items-center justify-center rounded-[28%] bg-gradient-to-br from-slate-800 to-slate-900 shadow-2xl",
          tile[size],
        )}
      >
        <div
          className={cn("flex items-center justify-center rounded-[40%] bg-white", bubble[size])}
        >
          <Zap className={cn("text-slate-900", icon[size])} fill="currentColor" />
        </div>
      </div>
    </div>
  );
}
