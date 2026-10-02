import { createFileRoute } from "@tanstack/react-router";
import { UserPlus } from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatCard } from "@/components/layout/StatCard";
import { EmptyState } from "@/components/layout/EmptyState";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";

export const Route = createFileRoute("/_authenticated/agents/sofia")({
  head: () => ({ meta: [{ title: "Sofia — Nina Talks" }] }),
  component: SofiaPage,
});

export function SofiaPage() {
  return (
    <div className="w-full">
      <PageHeader
        eyebrow="SDR"
        title="Sofia"
        description="Contatos gerenciados pelo agente Sofia."
      />
      <div className="px-6 py-6">
        <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard label="Contatos importados" value="0" icon={UserPlus} />
        </div>
        <div className="mb-4 flex items-center gap-2">
          <Button variant="outline" size="sm" className="gap-1.5" disabled>
            <RefreshCw className="h-3.5 w-3.5" />
            Sincronizar
          </Button>
        </div>
        <EmptyState
          icon={UserPlus}
          title="Nenhum contato encontrado"
          description="Configure uma fonte de dados para o agente Sofia em Configurações > Webhooks > Fontes de Dados."
        />
      </div>
    </div>
  );
}
