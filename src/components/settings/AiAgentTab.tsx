// Configurações → Agente de IA (IA Agent), em quatro abas:
//  • Dashboard — uso e consumo (chamadas, tokens, custo, latência, fallbacks)
//  • Modelos   — modelo, fallback automático, temperatura, esforço, contexto e instruções
//  • Agentes   — agentes do sistema (os de /agents) com suas skills e skills-tool
//  • Skills    — skill global, skills gerais e ferramentas gerais
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { fetchAiAgent, updateAiAgentSettings } from "@/lib/ai-agent";
import { errMsg } from "./ai-agent/shared";
import { UsageDashboard } from "./ai-agent/UsageDashboard";
import { BehaviorCard, InstructionsCard } from "./ai-agent/ModelsPanel";
import { AgentsPanel } from "./ai-agent/AgentsPanel";
import { GeneralPanel } from "./ai-agent/GeneralPanel";

export function AiAgentTab({
  accountId,
  onOpenIntegrations,
}: {
  accountId: string;
  onOpenIntegrations?: () => void;
}) {
  const qc = useQueryClient();
  const key = ["ai-agent", accountId] as const;
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: key,
    queryFn: () => fetchAiAgent(accountId),
    retry: 1,
  });
  const [tab, setTab] = useState("dashboard");

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => updateAiAgentSettings(accountId, { enabled }),
    onSuccess: refresh,
    onError: (e) => toast.error(errMsg(e, "Não foi possível salvar")),
  });

  if (error && !data) {
    return (
      <div className="space-y-3 rounded-xl border border-destructive/40 bg-card p-5">
        <h3 className="font-semibold">Não foi possível carregar o Agente de IA</h3>
        <p className="text-sm text-muted-foreground">
          {errMsg(error, "Erro desconhecido")}. Se acabou de atualizar o sistema, confirme que as
          migrations do banco foram aplicadas (<code>npm run migration</code>).
        </p>
        <Button size="sm" variant="outline" disabled={isFetching} onClick={() => refetch()}>
          {isFetching && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
          Tentar de novo
        </Button>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const { settings, connection } = data;

  return (
    <div className="space-y-6">
      {data.migration_pending && (
        <div className="rounded-xl border border-amber-500/50 bg-card p-4 text-sm">
          <strong>Migrations pendentes no banco.</strong> Rode <code>npm run migration</code> para
          liberar fallback, temperatura, esforço e contexto; até lá, essas opções não salvam.
        </div>
      )}

      <section className="rounded-xl border bg-card p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="flex items-center gap-2 text-base font-semibold">
              <Bot className="h-4 w-4 text-primary" /> IA assume o atendimento
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Conversas novas começam com a IA respondendo. Quando um atendente responde, a IA sai
              daquela conversa; o botão no topo da conversa devolve para a IA.
            </p>
          </div>
          <Switch
            checked={settings.enabled}
            onCheckedChange={(v) => toggle.mutate(v)}
            aria-label="IA assume o atendimento"
          />
        </div>
      </section>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="models">Modelos</TabsTrigger>
          <TabsTrigger value="agents">Agentes</TabsTrigger>
          <TabsTrigger value="skills">Skills (Geral)</TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="mt-6">
          <UsageDashboard accountId={accountId} />
        </TabsContent>

        <TabsContent value="models" className="mt-6 space-y-6">
          <BehaviorCard
            key={`b|${connection.base_url}|${connection.has_key}|${connection.model_id}|${settings.fallback_models.join(",")}|${settings.temperature}|${settings.effort}|${settings.reply_language}|${settings.history_turns}`}
            accountId={accountId}
            connection={connection}
            settings={settings}
            onSaved={refresh}
          />
          <InstructionsCard
            accountId={accountId}
            value={settings.system_prompt}
            onSaved={refresh}
          />
        </TabsContent>

        <TabsContent value="agents" className="mt-6">
          <AgentsPanel
            accountId={accountId}
            data={data}
            onChanged={refresh}
            onOpenIntegrations={onOpenIntegrations}
          />
        </TabsContent>

        <TabsContent value="skills" className="mt-6">
          <GeneralPanel
            accountId={accountId}
            data={data}
            onChanged={refresh}
            onOpenIntegrations={onOpenIntegrations}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
