import { Toaster as Sonner } from "sonner";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="dark"
      gap={12}
      offset={20}
      duration={3500}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "!bg-slate-900/95 !backdrop-blur-xl !border !border-white/10 !text-slate-100 !rounded-xl !shadow-2xl !shadow-black/40 !font-sans",
          title: "!text-slate-100 !text-sm !font-semibold",
          description: "!text-slate-400 !text-xs",
          actionButton:
            "!bg-amber-500 hover:!bg-amber-400 !text-slate-950 !font-semibold !rounded-lg !text-xs !px-3",
          cancelButton: "!bg-white/5 hover:!bg-white/10 !text-slate-300 !rounded-lg !text-xs !px-3",
          closeButton:
            "!bg-slate-800 hover:!bg-slate-700 !border !border-white/10 !text-slate-300 hover:!text-white",
          success: "!border-emerald-500/30",
          error: "!border-rose-500/30",
          warning: "!border-amber-500/30",
          info: "!border-cyan-500/30",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };
