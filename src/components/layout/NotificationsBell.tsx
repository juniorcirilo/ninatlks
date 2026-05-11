import { useEffect, useState } from "react";
import { Bell, Check, CheckCheck, ExternalLink, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from "@/lib/auth-context";
import { useAccount } from "@/lib/account-context";
import {
  fetchNotifications,
  fetchUnreadCount,
  markAllRead,
  markNotificationRead,
  type Notification,
} from "@/lib/notifications";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

export function NotificationsBell() {
  const { user } = useAuth();
  const { accountId } = useAccount();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(false);

  const userId = user?.id;

  const refresh = async () => {
    if (!userId) return;
    const count = await fetchUnreadCount(userId);
    setUnread(count);
  };

  useEffect(() => {
    if (!userId) return;
    refresh();
    const id = setInterval(() => {
      fetchUnreadCount(userId).then(setUnread).catch(() => {});
    }, 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  // Realtime
  useEffect(() => {
    if (!userId || !accountId) return;
    const channel = supabase
      .channel(`notifs:${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
        (payload) => {
          setItems((prev) => [payload.new as Notification, ...prev].slice(0, 30));
          setUnread((u) => u + 1);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, accountId]);

  const handleOpen = async (next: boolean) => {
    setOpen(next);
    if (next) {
      setLoading(true);
      try {
        if (!userId) return;
        const [list, count] = await Promise.all([
          fetchNotifications(userId),
          fetchUnreadCount(userId),
        ]);
        setItems(list);
        setUnread(count);
      } finally {
        setLoading(false);
      }
    }
  };

  const handleMarkOne = async (n: Notification) => {
    if (!n.read_at) {
      await markNotificationRead(n.id);
      setItems((prev) =>
        prev.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)),
      );
      setUnread((u) => Math.max(0, u - 1));
    }
  };

  const handleMarkAll = async () => {
    if (!userId) return;
    await markAllRead(userId);
    setItems((prev) => prev.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    setUnread(0);
  };

  return (
    <Popover open={open} onOpenChange={handleOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Notificações"
          className="relative inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card/40 text-muted-foreground transition-colors hover:text-foreground"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <span className="absolute -right-1 -top-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white tabular-nums">
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between border-b border-border px-3 py-2">
          <div className="text-[13px] font-semibold">Notificações</div>
          {unread > 0 && (
            <button
              type="button"
              onClick={handleMarkAll}
              className="inline-flex items-center gap-1 text-[10px] font-medium text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="h-3 w-3" />
              Marcar tudo como lido
            </button>
          )}
        </div>
        <ScrollArea className="max-h-[420px]">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="px-4 py-10 text-center text-[12px] text-muted-foreground">
              Nenhuma notificação ainda.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((n) => (
                <li
                  key={n.id}
                  className={cn(
                    "group flex gap-2 px-3 py-2.5 transition-colors hover:bg-white/[0.03]",
                    !n.read_at && "bg-violet-500/[0.04]",
                  )}
                >
                  <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400" style={{ visibility: n.read_at ? "hidden" : "visible" }} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-[12px] font-medium leading-tight">{n.title}</div>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {timeAgo(n.created_at)}
                      </span>
                    </div>
                    {n.body && (
                      <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-2">{n.body}</div>
                    )}
                    <div className="mt-1.5 flex items-center gap-2">
                      {n.link_to && (
                        <Link
                          to={n.link_to}
                          onClick={() => {
                            setOpen(false);
                            handleMarkOne(n);
                          }}
                          className="inline-flex items-center gap-1 text-[10px] font-medium text-violet-300 hover:text-violet-200"
                        >
                          Ver <ExternalLink className="h-2.5 w-2.5" />
                        </Link>
                      )}
                      {!n.read_at && (
                        <button
                          type="button"
                          onClick={() => handleMarkOne(n)}
                          className="inline-flex items-center gap-1 text-[10px] text-muted-foreground opacity-0 transition-opacity hover:text-foreground group-hover:opacity-100"
                        >
                          <Check className="h-2.5 w-2.5" />
                          Marcar lida
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}
