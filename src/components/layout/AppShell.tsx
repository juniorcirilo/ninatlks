import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Bot,
  Phone,
  Settings,
  Bell,
  LogOut,
  TrendingUp,
  Users,
  PhoneCall,
  Radio,
  UserPlus,
  KanbanSquare,
  CalendarDays,
  ShieldAlert,
  ListChecks,
  Sparkles,
  BarChart3,
  Gauge,
  BookOpen,
  Rocket,
  ClipboardList,
  MessageCircle,
  Receipt,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth-context";
import { useAccount } from "@/lib/account-context";
import { NinaTalksLogo } from "@/components/brand/NinaTalksLogo";
import { KeyboardShortcuts } from "@/components/layout/KeyboardShortcuts";
import { NotificationToasts } from "@/components/layout/NotificationToasts";
import { NotificationsBell } from "@/components/layout/NotificationsBell";
import { UsageAlerts } from "@/components/layout/UsageAlerts";
import { SetupChecklist } from "@/components/onboarding/SetupChecklist";

type NavLeaf = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
};

type NavSection = {
  title: string;
  items: NavLeaf[];
};

const NAV_SECTIONS: NavSection[] = [
  {
    title: "Início",
    items: [
      { to: "/", label: "Painel", icon: LayoutDashboard },
      { to: "/mission-control", label: "Mission Control", icon: Gauge },
    ],
  },
  {
    title: "SDR",
    items: [
      { to: "/central", label: "Central de Contatos", icon: Users },
      { to: "/pipeline", label: "Pipeline", icon: KanbanSquare },
      { to: "/contacts", label: "Leads", icon: Users },
      { to: "/chat", label: "Ao vivo", icon: Radio },
      { to: "/inbox", label: "Mensagens", icon: MessageCircle },
      { to: "/calls", label: "Ligações", icon: Phone },
      { to: "/reunioes", label: "Reuniões", icon: CalendarDays },
      { to: "/follow-ups", label: "Follow-ups", icon: PhoneCall },
      { to: "/listas", label: "Listas operacionais", icon: ClipboardList },
      { to: "/campanhas", label: "Campanhas IA", icon: Rocket },
      { to: "/agents", label: "Agentes de voz", icon: Bot },
      { to: "/agents-playground", label: "Playground IA", icon: Sparkles },
      { to: "/orcamentos", label: "Orçamentos", icon: Receipt },
      { to: "/agents-analytics", label: "Analytics IA", icon: BarChart3 },
    ],
  },
  {
    title: "Configuração",
    items: [
      { to: "/phone-numbers", label: "Números de telefone", icon: Phone },
      { to: "/equipe", label: "Equipe", icon: UserPlus, adminOnly: true },
      { to: "/admin-registro", label: "Registro", icon: ShieldAlert },
      { to: "/admin-filas", label: "Filas", icon: ListChecks, adminOnly: true },
      { to: "/settings", label: "Configurações", icon: Settings },
      { to: "/tutorial", label: "Tutorial", icon: BookOpen },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const showDeferred = useDeferredGlobalUi();

  return (
    <div className="flex min-h-screen w-full bg-background text-foreground">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar />
        {showDeferred && <UsageAlerts />}
        <main className="flex-1 overflow-y-auto">{children}</main>
      </div>
      <KeyboardShortcuts />
      {showDeferred && <NotificationToasts />}
      {showDeferred && <SetupChecklist />}
    </div>
  );
}

function useDeferredGlobalUi() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const win = window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
      cancelIdleCallback?: (id: number) => void;
    };
    if (win.requestIdleCallback) {
      const id = win.requestIdleCallback(() => setReady(true), { timeout: 1_500 });
      return () => win.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(() => setReady(true), 350);
    return () => window.clearTimeout(id);
  }, []);

  return ready;
}

function isActiveLeaf(pathname: string, to: string) {
  if (to === "/") return pathname === "/";
  return pathname === to || pathname.startsWith(`${to}/`);
}

function Sidebar() {
  const { pathname } = useLocation();
  const { role } = useAccount();
  const isAdmin = role === "admin";

  return (
    <aside className="sticky top-0 flex h-screen w-[248px] shrink-0 flex-col border-r border-white/[0.06] bg-[#0a0a0f]">
      <div className="flex h-16 items-center gap-3 px-6">
        <NinaTalksLogo size="md" />
        <div className="leading-tight">
          <div className="text-sm font-semibold tracking-tight text-slate-300">Nina Talks</div>
          <div className="text-[9px] uppercase tracking-wider text-slate-500">Agente de SDR</div>
        </div>
      </div>

      <nav className="flex-1 space-y-6 overflow-y-auto px-4 py-4">
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((i) => !i.adminOnly || isAdmin);
          if (items.length === 0) return null;
          return (
            <div key={section.title}>
              <div className="px-3 pb-2 text-[9px] font-semibold uppercase tracking-[0.15em] text-slate-600">
                {section.title}
              </div>
              <div className="space-y-1">
                {items.map((item) => (
                  <NavLink key={item.to} item={item} pathname={pathname} />
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      <SidebarFooter />
    </aside>
  );
}

function NavLink({ item, pathname }: { item: NavLeaf; pathname: string }) {
  const Icon = item.icon;
  const isActive = isActiveLeaf(pathname, item.to);
  return (
    <Link
      to={item.to}
      className={cn(
        "group flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors",
        isActive
          ? "bg-white/[0.08] font-medium text-white"
          : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-200",
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-violet-400" : "")} />
      <span className="flex-1 truncate">{item.label}</span>
    </Link>
  );
}

function SidebarFooter() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const displayName = user?.displayName ?? user?.name ?? user?.email?.split("@")[0] ?? "Você";
  const initials = displayName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const handleSignOut = async () => {
    await signOut();
    navigate({ to: "/auth", replace: true });
  };

  return (
    <div className="border-t border-white/[0.06] p-4">
      <button
        type="button"
        className="mb-2 flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-slate-400 transition-colors hover:bg-white/[0.04] hover:text-slate-200"
      >
        <Bell className="h-4 w-4" />
        <span>Notificações</span>
      </button>
      <div className="flex items-center gap-2.5 rounded-xl p-2.5">
        <Avatar className="h-8 w-8">
          <AvatarFallback className="bg-gradient-to-br from-violet-500 to-fuchsia-500 text-[11px] font-semibold text-white">
            {initials || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-xs font-semibold text-foreground">{displayName}</div>
          <div className="truncate text-[10px] text-slate-500">{user?.email}</div>
        </div>
        <button
          type="button"
          onClick={handleSignOut}
          aria-label="Sair"
          className="rounded p-1.5 text-slate-500 transition-colors hover:bg-white/[0.04] hover:text-rose-400"
        >
          <LogOut className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

function Topbar() {
  const showDeferred = useDeferredGlobalUi();

  return (
    <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-4 border-b border-border bg-background px-6">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
        <span>Conectado</span>
      </div>
      <div className="flex items-center gap-3">{showDeferred && <NotificationsBell />}</div>
    </header>
  );
}
