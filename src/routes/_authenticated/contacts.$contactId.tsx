// Detalhe do contato com timeline cross-canal (Fase 2 — Omnichannel+).
//
// Mostra todas as interações (mensagens, chamadas, reuniões) numa única linha
// do tempo, independente do canal de origem. Permite filtrar por canal/tipo.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  ArrowLeft,
  MessageSquare,
  Phone,
  CalendarDays,
  Mail,
  Loader2,
  Instagram,
} from "lucide-react";
import { getContactTimeline, type TimelineItem } from "@/lib/contact-timeline.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/layout/PageHeader";
import { EmptyState } from "@/components/layout/EmptyState";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/contacts/$contactId")({
  component: ContactDetailPage,
});

function channelIcon(channel: string) {
  switch (channel) {
    case "whatsapp":
    case "evolution":
      return <MessageSquare className="h-4 w-4 text-emerald-500" />;
    case "instagram":
      return <Instagram className="h-4 w-4 text-pink-500" />;
    case "voice":
      return <Phone className="h-4 w-4 text-indigo-500" />;
    case "email":
      return <Mail className="h-4 w-4 text-amber-500" />;
    default:
      return <MessageSquare className="h-4 w-4 text-muted-foreground" />;
  }
}

function kindIcon(kind: TimelineItem["kind"]) {
  switch (kind) {
    case "call":
      return <Phone className="h-4 w-4" />;
    case "meeting":
      return <CalendarDays className="h-4 w-4" />;
    default:
      return <MessageSquare className="h-4 w-4" />;
  }
}

function ContactDetailPage() {
  const { contactId } = Route.useParams();
  const fetchTimeline = useServerFn(getContactTimeline);
  const { data, isLoading, error } = useQuery({
    queryKey: ["contact-timeline", contactId],
    queryFn: () => fetchTimeline({ data: { contactId } }),
  });

  const [filter, setFilter] = useState<"all" | TimelineItem["kind"]>("all");
  const filtered = useMemo(
    () => (data?.items ?? []).filter((i: TimelineItem) => filter === "all" || i.kind === filter),
    [data, filter],
  );

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <EmptyState
        icon={MessageSquare}
        title="Contato não encontrado"
        description={error instanceof Error ? error.message : "Sem dados"}
      />
    );
  }

  const c = data.contact;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/contacts">
            <ArrowLeft className="mr-1 h-4 w-4" /> Contatos
          </Link>
        </Button>
      </div>

      <PageHeader
        title={c.name || c.phone || c.email || "Sem nome"}
        description={[c.email, c.phone].filter(Boolean).join(" · ") || "—"}
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <Card className="p-4">
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <FilterBtn current={filter} value="all" onClick={setFilter} label="Tudo" />
            <FilterBtn current={filter} value="message" onClick={setFilter} label="Mensagens" />
            <FilterBtn current={filter} value="call" onClick={setFilter} label="Chamadas" />
            <FilterBtn current={filter} value="meeting" onClick={setFilter} label="Reuniões" />
            <span className="ml-auto text-xs text-muted-foreground">
              {filtered.length} de {data.items.length} eventos
            </span>
          </div>

          {filtered.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Nenhum evento neste filtro.
            </div>
          ) : (
            <ol className="relative space-y-4 border-l border-border pl-6">
              {filtered.map((item: TimelineItem) => (
                <li key={item.id} className="relative">
                  <span className="absolute -left-[31px] flex h-6 w-6 items-center justify-center rounded-full border bg-background">
                    {kindIcon(item.kind)}
                  </span>
                  <div className="rounded-md border bg-card p-3 shadow-sm">
                    <div className="mb-1 flex items-center gap-2">
                      {channelIcon(item.channel)}
                      <span className="text-sm font-medium">{item.title}</span>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {new Date(item.at).toLocaleString("pt-BR")}
                      </span>
                    </div>
                    {item.preview && (
                      <p className="line-clamp-3 text-sm text-muted-foreground">
                        {item.preview}
                      </p>
                    )}
                    {item.conversationId && (
                      <div className="mt-2">
                        <Link
                          to="/chat"
                          search={{ conversationId: item.conversationId } as never}
                          className="text-xs text-primary hover:underline"
                        >
                          Abrir conversa →
                        </Link>
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Card>

        <Card className="p-4">
          <h3 className="mb-3 text-sm font-semibold">Conversas ({data.conversations.length})</h3>
          {data.conversations.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sem conversas ainda.</p>
          ) : (
            <ul className="space-y-2">
              {data.conversations.map((cv: { id: string; inboxName: string | null; channelType: string | null; status: number; lastActivityAt: string; messageCount: number }) => (
                <li
                  key={cv.id}
                  className="flex items-center justify-between rounded-md border p-2 text-sm"
                >
                  <div className="flex items-center gap-2">
                    {channelIcon(cv.channelType ?? "system")}
                    <div>
                      <div className="font-medium">{cv.inboxName ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {cv.messageCount} msgs ·{" "}
                        {new Date(cv.lastActivityAt).toLocaleDateString("pt-BR")}
                      </div>
                    </div>
                  </div>
                  <Badge variant="outline">{cv.status === 0 ? "aberta" : "resolvida"}</Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function FilterBtn({
  current,
  value,
  onClick,
  label,
}: {
  current: string;
  value: "all" | TimelineItem["kind"];
  onClick: (v: "all" | TimelineItem["kind"]) => void;
  label: string;
}) {
  return (
    <Button
      size="sm"
      variant={current === value ? "default" : "outline"}
      onClick={() => onClick(value)}
      className={cn("h-7 px-3 text-xs")}
    >
      {label}
    </Button>
  );
}
