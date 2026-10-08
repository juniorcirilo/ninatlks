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
  ChevronLeft,
  Menu,
  X,
  Users,
  PhoneCall,
  Radio,
  UserPlus,
  UserCheck,
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
  Building2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "@/components/layout/ThemeToggle";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth-context";
import { useAccount } from "@/lib/account-context";
import { UtalksLogo } from "@/components/brand/UtalksLogo";
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
      { to: "/empresas", label: "Empresas", icon: Building2 },
      { to: "/agents-analytics", label: "Analytics IA", icon: BarChart3 },
    ],
  },
  {
    title: "Configuração",
    items: [
      { to: "/phone-numbers", label: "Números de telefone", icon: Phone },
      { to: "/equipe", label: "Equipe", icon: UserPlus, adminOnly: true },
      { to: "/vendedores", label: "Vendedores", icon: UserCheck },
      { to: "/admin-registro", label: "Registro", icon: ShieldAlert },
      { to: "/admin-filas", label: "Filas", icon: ListChecks, adminOnly: true },
      { to: "/settings", label: "Configurações", icon: Settings },
      { to: "/tutorial", label: "Tutorial", icon: BookOpen },
    ],
  },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const showDeferred = useDeferredGlobalUi();
  const { pathname } = useLocation();
  // Telas "app-like" (chat) ocupam a viewport e rolam por dentro.
  const fullHeight = pathname.startsWith("/inbox");
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background text-foreground">
      {/* Glows de fundo (padrão livechat) */}
      <div className="pointer-events-none fixed left-0 top-0 z-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-[128px]" />
      <div className="pointer-events-none fixed bottom-0 right-0 z-0 h-[500px] w-[500px] translate-x-1/2 translate-y-1/2 rounded-full bg-accent/10 blur-[128px]" />

      <Sidebar />
      <MobileNav open={mobileOpen} onOpenChange={setMobileOpen} />

      <div className="relative z-10 flex h-full min-h-0 min-w-0 flex-1 flex-col pb-[calc(var(--mobile-nav-height,0px)+env(safe-area-inset-bottom,0px))] pt-[var(--mobile-top-height,0px)]">
        <div className="pointer-events-none absolute left-0 right-0 top-0 z-20 h-px bg-gradient-to-r from-transparent via-border to-transparent opacity-50" />
        {showDeferred && <UsageAlerts />}
        <main
          className={cn(
            "relative min-h-0 flex-1 custom-scrollbar",
            fullHeight ? "overflow-hidden" : "overflow-y-auto",
          )}
        >
          {children}
        </main>
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

const COLLAPSE_KEY = "nina-sidebar-collapsed";

function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);

  // Preferência por navegador; lida após montar para não divergir do SSR.
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem(COLLAPSE_KEY) === "1");
    } catch {
      /* sem storage: expandida */
    }
  }, []);

  const toggle = () =>
    setCollapsed((c) => {
      try {
        localStorage.setItem(COLLAPSE_KEY, c ? "0" : "1");
      } catch {
        /* ignore */
      }
      return !c;
    });

  return (
    <div
      className={cn(
        "relative hidden h-full shrink-0 transition-[width] duration-300 ease-in-out md:flex md:flex-col",
        collapsed ? "w-[84px]" : "w-[260px]",
      )}
    >
      <aside className="relative flex h-full flex-col justify-between gap-6 overflow-hidden border-r border-white/[0.06] bg-slate-950/95 px-3 py-4 backdrop-blur-xl">
        <SidebarAmbient />
        <SidebarContent collapsed={collapsed} />
      </aside>
      <button
        type="button"
        onClick={toggle}
        aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
        className="group absolute -right-3 top-1/2 z-50 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full border border-gray-300 bg-gray-200 shadow-lg transition-all hover:border-cyan-500/50 hover:bg-gray-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:bg-slate-700"
      >
        <ChevronLeft
          className={cn(
            "h-4 w-4 text-gray-500 transition-all duration-300 group-hover:text-cyan-400 dark:text-slate-400",
            collapsed && "rotate-180",
          )}
        />
      </button>
    </div>
  );
}

function SidebarAmbient() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      <div
        className="absolute inset-0 opacity-[0.18]"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(148,163,184,0.35) 1px, transparent 0)",
          backgroundSize: "18px 18px",
        }}
      />
      <div className="absolute -left-20 -top-32 h-64 w-64 rounded-full bg-cyan-500/15 blur-3xl" />
      <div className="absolute -right-20 top-1/3 h-56 w-56 rounded-full bg-violet-500/15 blur-3xl" />
      <div className="absolute -bottom-32 left-1/2 h-56 w-72 -translate-x-1/2 rounded-full bg-fuchsia-500/10 blur-3xl" />
    </div>
  );
}

function SidebarContent({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const { pathname } = useLocation();
  const { role } = useAccount();
  const isAdmin = role === "admin";

  return (
    <>
      <div className="custom-scrollbar relative flex flex-1 flex-col overflow-y-auto overflow-x-hidden">
        <Link
          to="/"
          onClick={onNavigate}
          className={cn("group mb-6 flex items-center gap-3 py-1", collapsed && "justify-center")}
        >
          <UtalksLogo size={collapsed ? "md" : "lg"} />
          {!collapsed && (
            <div className="flex flex-col overflow-hidden">
              <span className="whitespace-nowrap text-[17px] font-bold leading-tight tracking-tight text-foreground">
                Utalks
              </span>
              <span className="mt-0.5 flex items-center gap-1 text-[9.5px] font-semibold uppercase tracking-[0.18em] text-cyan-400/90">
                <Sparkles className="h-2.5 w-2.5" /> Agente de SDR
              </span>
            </div>
          )}
        </Link>

        <nav className="flex flex-col gap-0.5">
          {NAV_SECTIONS.map((section) => {
            const items = section.items.filter((i) => !i.adminOnly || isAdmin);
            if (items.length === 0) return null;
            return (
              <div key={section.title}>
                {collapsed ? (
                  <div className="flex justify-center py-2">
                    <div className="flex flex-col items-center gap-1">
                      <span className="h-1 w-1 rounded-full bg-slate-600" />
                      <span className="h-1 w-1 rounded-full bg-slate-700" />
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-3 pb-2 pt-5 first:pt-2">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-500/80">
                      {section.title}
                    </span>
                    <span className="h-px flex-1 bg-gradient-to-r from-slate-700/40 to-transparent" />
                  </div>
                )}
                <div className="flex flex-col gap-0.5">
                  {items.map((item) => (
                    <NavLink
                      key={item.to}
                      item={item}
                      pathname={pathname}
                      collapsed={collapsed}
                      onNavigate={onNavigate}
                    />
                  ))}
                </div>
              </div>
            );
          })}
        </nav>
      </div>

      <SidebarFooter collapsed={collapsed} />
    </>
  );
}

function NavLink({
  item,
  pathname,
  collapsed,
  onNavigate,
}: {
  item: NavLeaf;
  pathname: string;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const isActive = isActiveLeaf(pathname, item.to);
  return (
    <Link
      to={item.to}
      onClick={onNavigate}
      title={collapsed ? item.label : undefined}
      className={cn(
        "group/sidebar relative flex items-center gap-3 overflow-hidden rounded-xl transition-all duration-300",
        collapsed ? "mx-auto h-11 w-11 justify-center" : "justify-start px-3 py-2.5",
        isActive
          ? "bg-gradient-to-r from-cyan-500/15 via-cyan-500/[0.07] to-transparent text-cyan-100 shadow-[0_0_24px_-4px_rgba(34,211,238,0.45)] ring-1 ring-cyan-400/40"
          : "text-slate-400 hover:bg-white/[0.03] hover:text-slate-100 hover:ring-1 hover:ring-white/5",
      )}
    >
      {isActive && (
        <span className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-r-full bg-gradient-to-b from-cyan-300 via-cyan-400 to-cyan-500 shadow-[0_0_10px_rgba(6,182,212,0.8)]" />
      )}
      {!isActive && (
        <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/[0.04] to-transparent transition-transform duration-700 group-hover/sidebar:translate-x-full" />
      )}
      <Icon
        className={cn(
          "h-[18px] w-[18px] shrink-0 transition-all duration-200",
          isActive
            ? "text-cyan-300 drop-shadow-[0_0_6px_rgba(34,211,238,0.6)]"
            : "text-slate-500 group-hover/sidebar:scale-105 group-hover/sidebar:text-slate-200",
        )}
      />
      {!collapsed && (
        <span
          className={cn(
            "flex-1 truncate text-[13.5px] font-medium tracking-tight transition-colors duration-200",
            isActive ? "text-cyan-50" : "text-slate-300 group-hover/sidebar:text-white",
          )}
        >
          {item.label}
        </span>
      )}
    </Link>
  );
}

function SidebarFooter({ collapsed }: { collapsed: boolean }) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const showDeferred = useDeferredGlobalUi();
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
    <div className="space-y-2 border-t border-white/[0.06] pt-3">
      <div
        className={cn("flex items-center gap-1", collapsed ? "flex-col" : "justify-between px-1")}
      >
        {!collapsed && (
          <span className="flex items-center gap-1.5 text-[11px] text-slate-500">
            <TrendingUp className="h-3 w-3 text-emerald-400" /> Conectado
          </span>
        )}
        <div className={cn("flex items-center gap-1", collapsed && "flex-col")}>
          <ThemeToggle />
          {showDeferred && <NotificationsBell />}
        </div>
      </div>

      <div
        className={cn(
          "relative flex items-center transition-all",
          collapsed
            ? "justify-center rounded-full p-1"
            : "gap-3 rounded-2xl bg-gradient-to-br from-white/[0.03] to-transparent p-2 ring-1 ring-white/[0.06] hover:ring-cyan-500/30",
        )}
      >
        <div className="relative shrink-0">
          <div className="absolute inset-0 -m-0.5 rounded-full bg-gradient-to-tr from-cyan-400 via-violet-500 to-fuchsia-500 opacity-80 blur-[1px]" />
          <div
            className={cn(
              "relative flex items-center justify-center rounded-full bg-slate-900 ring-2 ring-slate-950",
              collapsed ? "h-9 w-9" : "h-10 w-10",
            )}
          >
            <span className="bg-gradient-to-br from-cyan-400 to-violet-500 bg-clip-text text-[13px] font-extrabold text-transparent">
              {initials || "?"}
            </span>
          </div>
          <span
            className={cn(
              "absolute bottom-0 right-0 rounded-full bg-emerald-400 ring-2 ring-slate-950 shadow-[0_0_6px_rgba(52,211,153,0.8)]",
              collapsed ? "h-2.5 w-2.5" : "h-3 w-3",
            )}
          />
        </div>
        {!collapsed && (
          <>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[13px] font-semibold text-foreground">
                {displayName}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{user?.email}</div>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              aria-label="Sair"
              className="group/logout flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/[0.06] transition-all hover:bg-red-500/15 hover:ring-red-500/40"
            >
              <LogOut className="h-4 w-4 text-slate-400 group-hover/logout:text-red-400" />
            </button>
          </>
        )}
      </div>
      {collapsed && (
        <button
          type="button"
          onClick={handleSignOut}
          aria-label="Sair"
          title="Sair"
          className="group/logout mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.04] ring-1 ring-white/[0.06] transition-all hover:bg-red-500/15 hover:ring-red-500/40"
        >
          <LogOut className="h-4 w-4 text-slate-400 group-hover/logout:text-red-400" />
        </button>
      )}
    </div>
  );
}

/** Top bar + drawer + bottom nav no mobile (padrão livechat). */
function MobileNav({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const { pathname } = useLocation();
  const { role } = useAccount();
  const isAdmin = role === "admin";
  const quick = NAV_SECTIONS.flatMap((s) => s.items)
    .filter((i) => !i.adminOnly || isAdmin)
    .slice(0, 5);

  return (
    <div className="md:hidden">
      <div className="fixed left-0 right-0 top-0 z-50 flex h-14 items-center justify-between border-b border-gray-200/50 bg-white/80 px-4 backdrop-blur-xl dark:border-slate-800/50 dark:bg-slate-950/80">
        <Link to="/" className="flex items-center gap-2">
          <UtalksLogo size="sm" />
          <span className="text-sm font-bold tracking-tight">Utalks</span>
        </Link>
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          aria-label="Abrir menu"
          className="text-gray-700 hover:text-cyan-400 dark:text-slate-200"
        >
          <Menu className="h-5 w-5" />
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[100] flex flex-col justify-between bg-white p-6 dark:bg-slate-950">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            aria-label="Fechar menu"
            className="absolute right-6 top-6 text-gray-700 hover:text-cyan-400 dark:text-slate-200"
          >
            <X className="h-5 w-5" />
          </button>
          <SidebarContent collapsed={false} onNavigate={() => onOpenChange(false)} />
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-50 flex justify-around border-t border-gray-200/50 bg-white/95 p-2 dark:border-slate-800/50 dark:bg-slate-950/95 mobile-bottom-nav">
        {quick.map((item) => {
          const Icon = item.icon;
          const active = isActiveLeaf(pathname, item.to);
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                "flex flex-col items-center gap-1 rounded-md px-2 py-1 text-[11px]",
                active ? "text-cyan-400" : "text-gray-500 dark:text-slate-400",
              )}
            >
              <Icon className="h-5 w-5" />
              <span className="mt-0.5 text-[10px]">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
