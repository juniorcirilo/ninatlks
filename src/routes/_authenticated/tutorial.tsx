import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  BookOpen,
  LayoutDashboard,
  Gauge,
  KanbanSquare,
  Users,
  Radio,
  Phone,
  CalendarDays,
  PhoneCall,
  Bot,
  Sparkles,
  BarChart3,
  UserPlus,
  Settings,
  ShieldAlert,
  ListChecks,
  Search,
  ChevronRight,
  CheckCircle2,
  Megaphone,
  Target,
  RefreshCw,
  ShieldCheck,
  Clock,
  Ban,
  TrendingUp,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { cn } from "@/lib/utils";
import painelImg from "@/assets/tutorial/painel.png";
import pipelineImg from "@/assets/tutorial/pipeline.png";
import aoVivoImg from "@/assets/tutorial/ao-vivo.png";
import agentesImg from "@/assets/tutorial/agentes.png";
import configuracoesImg from "@/assets/tutorial/configuracoes.png";
import equipeImg from "@/assets/tutorial/equipe.png";

export const Route = createFileRoute("/_authenticated/tutorial")({
  head: () => ({
    meta: [
      { title: "Tutorial — Nina Talks" },
      {
        name: "description",
        content:
          "Aprenda como funciona cada parte da plataforma e como configurar passo a passo.",
      },
    ],
  }),
  component: TutorialPage,
});

type Step = string;

type Topic = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  what: string;
  use: string;
  steps: Step[];
  route?: { to: string; label: string };
  image?: string;
};

type Section = {
  id: string;
  title: string;
  description: string;
  topics: Topic[];
};

const SECTIONS: Section[] = [
  {
    id: "primeiros-passos",
    title: "Primeiros passos",
    description: "O essencial para começar a usar a plataforma em minutos.",
    topics: [
      {
        id: "conta",
        label: "Sua conta e senha",
        icon: UserPlus,
        what:
          "Cada pessoa entra com o próprio e-mail e senha. O primeiro usuário que se cadastra vira administrador automaticamente.",
        use:
          "Para alterar sua senha ou pedir um link de redefinição, vá em Configurações → aba 'Conta & Equipe'.",
        steps: [
          "Abra Configurações no menu lateral.",
          "Clique na aba 'Conta & Equipe'.",
          "Em 'Alterar minha senha', digite sua senha atual e a nova.",
          "Ou clique em 'enviar link de redefinição' para receber por e-mail.",
        ],
        route: { to: "/settings", label: "Ir para Configurações" },
        image: configuracoesImg,
      },
      {
        id: "convidar",
        label: "Convidar colaboradores",
        icon: UserPlus,
        what:
          "Novos usuários só entram por convite. Você gera um link e envia para a pessoa, que cria a própria conta usando aquele link.",
        use:
          "Use para adicionar atendentes (agent) ou outros administradores ao workspace.",
        steps: [
          "Vá em 'Equipe' no menu lateral (visível só para admin).",
          "Digite o e-mail da pessoa e escolha o papel (agent ou admin).",
          "Clique em 'Gerar convite' e copie o link.",
          "Envie o link pelo canal de sua preferência. Expira em 7 dias.",
        ],
        route: { to: "/equipe", label: "Ir para Equipe" },
        image: equipeImg,
      },
      {
        id: "configuracoes",
        label: "Dados da empresa e integrações",
        icon: Settings,
        what:
          "Em Configurações você define o nome da empresa, e-mail de suporte, conecta WhatsApp/telefonia e ajusta o comportamento de discagem.",
        use:
          "Preencha logo no começo para que os agentes de IA usem as informações certas nas conversas.",
        steps: [
          "Configurações → 'Geral': preencha nome da empresa e e-mail de suporte.",
          "Aba 'Integrações': conecte WhatsApp, provedor de telefonia, etc.",
          "Aba 'Discagem': defina horários permitidos e cadência de tentativas.",
          "Aba 'Chaves de acesso' e 'Webhooks': para integrar com sistemas externos.",
        ],
        route: { to: "/settings", label: "Ir para Configurações" },
        image: configuracoesImg,
      },
    ],
  },
  {
    id: "dia-a-dia",
    title: "Dia a dia do atendimento",
    description: "As telas que você usa para acompanhar e atender clientes.",
    topics: [
      {
        id: "painel",
        label: "Painel inicial",
        icon: LayoutDashboard,
        what:
          "Visão geral do dia: conversas em aberto, ligações recentes, reuniões agendadas e indicadores de performance.",
        use:
          "Abra logo ao chegar para ver o que precisa de atenção imediata.",
        steps: [
          "Clique em 'Painel' no menu lateral.",
          "Cada card mostra um indicador. Clique para abrir o detalhe.",
          "Os números atualizam sozinhos enquanto a página está aberta.",
        ],
        route: { to: "/", label: "Abrir Painel" },
        image: painelImg,
      },
      {
        id: "mission-control",
        label: "Mission Control",
        icon: Gauge,
        what:
          "Tela de comando em tempo real para o supervisor: filas, agentes online, ligações ativas e alertas.",
        use:
          "Use durante o expediente para acompanhar a operação ao vivo.",
        steps: [
          "Abra 'Mission Control' no menu.",
          "Veja em tempo real quem está online e o que está acontecendo.",
          "Clique num item para tomar ação (assumir conversa, encerrar etc.).",
        ],
        route: { to: "/mission-control", label: "Abrir Mission Control" },
      },
      {
        id: "pipeline",
        label: "Pipeline de vendas",
        icon: KanbanSquare,
        what:
          "Kanban com os leads divididos por etapa (novo, em contato, qualificado, ganho, perdido).",
        use:
          "Arraste um card para mudar a etapa. Clique para abrir o histórico do lead.",
        steps: [
          "Abra 'Pipeline'.",
          "Arraste um card de uma coluna para outra para mover de etapa.",
          "Clique no card para ver dados do lead e abrir conversa.",
        ],
        route: { to: "/pipeline", label: "Abrir Pipeline" },
        image: pipelineImg,
      },
      {
        id: "leads",
        label: "Leads (contatos)",
        icon: Users,
        what:
          "Cadastro completo de quem entrou em contato: histórico de conversas, ligações, anotações e etiquetas.",
        use:
          "Use para procurar uma pessoa específica e ver tudo que já aconteceu com ela.",
        steps: [
          "Abra 'Leads'.",
          "Use a busca por nome, telefone ou e-mail.",
          "Clique para abrir a ficha do contato.",
        ],
        route: { to: "/contacts", label: "Abrir Leads" },
      },
      {
        id: "ao-vivo",
        label: "Atendimento ao vivo",
        icon: Radio,
        what:
          "Caixa de entrada estilo WhatsApp Web com todas as conversas abertas (WhatsApp, chamadas, web).",
        use:
          "Selecione uma conversa à esquerda e responda à direita. Você pode atribuir, marcar como resolvida e adicionar etiquetas.",
        steps: [
          "Abra 'Ao vivo' no menu.",
          "Clique numa conversa na lista da esquerda.",
          "Digite a resposta ou use uma resposta rápida.",
          "Mude status (aberta / pendente / resolvida) no topo.",
        ],
        route: { to: "/chat", label: "Abrir Ao vivo" },
        image: aoVivoImg,
      },
      {
        id: "ligacoes",
        label: "Ligações",
        icon: Phone,
        what:
          "Histórico de todas as ligações feitas e recebidas, com gravação, transcrição e resumo gerado por IA.",
        use:
          "Use para revisar uma ligação ou auditar a qualidade do atendimento.",
        steps: [
          "Abra 'Ligações'.",
          "Filtre por agente, data ou status.",
          "Clique numa ligação para ouvir, ver transcrição e resumo.",
        ],
        route: { to: "/calls", label: "Abrir Ligações" },
      },
      {
        id: "reunioes",
        label: "Reuniões",
        icon: CalendarDays,
        what:
          "Agenda de reuniões marcadas com leads, em formato calendário e kanban.",
        use:
          "Acompanhe quem confirmou, quem faltou e o que ficou combinado.",
        steps: [
          "Abra 'Reuniões'.",
          "Alterne entre visão de calendário e kanban no topo.",
          "Clique numa reunião para ver briefing e link de vídeo.",
        ],
        route: { to: "/reunioes", label: "Abrir Reuniões" },
      },
      {
        id: "follow-ups",
        label: "Follow-ups",
        icon: PhoneCall,
        what:
          "Lista de retornos programados (callbacks) que precisam ser feitos.",
        use:
          "Comece o dia pela lista e marque como concluído à medida que executa.",
        steps: [
          "Abra 'Follow-ups'.",
          "Trabalhe de cima para baixo, do mais antigo ao mais recente.",
          "Clique para abrir o lead ou marcar como feito.",
        ],
        route: { to: "/follow-ups", label: "Abrir Follow-ups" },
      },
    ],
  },
  {
    id: "ia",
    title: "Inteligência artificial",
    description: "Como os agentes de IA trabalham por você.",
    topics: [
      {
        id: "agentes",
        label: "Agentes de voz",
        icon: Bot,
        what:
          "Personas de IA (Bruno, Ana, Carla, Clara, Diego, Elena, Felipe) que atendem, qualificam, agendam e fazem follow-up.",
        use:
          "Cada uma tem uma especialidade. Você pode ativar, ajustar tom e definir quando ela entra em ação.",
        steps: [
          "Abra 'Agentes de voz'.",
          "Clique numa persona para ver o que ela faz.",
          "Use o botão de edição para ajustar prompt, tom e regras.",
          "Ative ou desative com o toggle no topo de cada card.",
        ],
        route: { to: "/agents", label: "Abrir Agentes" },
        image: agentesImg,
      },
      {
        id: "playground",
        label: "Playground IA",
        icon: Sparkles,
        what:
          "Ambiente de teste onde você conversa com a IA sem afetar leads reais.",
        use:
          "Use para validar prompts e respostas antes de colocar em produção.",
        steps: [
          "Abra 'Playground IA'.",
          "Escolha a persona que quer testar.",
          "Digite mensagens como se fosse um cliente.",
          "Ajuste o prompt e teste de novo até ficar bom.",
        ],
        route: { to: "/agents-playground", label: "Abrir Playground" },
      },
      {
        id: "analytics-ia",
        label: "Analytics IA",
        icon: BarChart3,
        what:
          "Métricas das conversas conduzidas pela IA: taxa de qualificação, agendamentos, motivos de perda.",
        use:
          "Use semanalmente para entender o que está funcionando e o que precisa ajustar.",
        steps: [
          "Abra 'Analytics IA'.",
          "Filtre por período e por persona.",
          "Olhe os gráficos de conversão e os principais motivos de perda.",
        ],
        route: { to: "/agents-analytics", label: "Abrir Analytics" },
      },
    ],
  },
  {
    id: "administracao",
    title: "Administração",
    description: "Itens para admin: telefonia, filas e auditoria.",
    topics: [
      {
        id: "telefones",
        label: "Números de telefone",
        icon: Phone,
        what:
          "Gestão dos números usados para fazer e receber ligações (DIDs).",
        use:
          "Cadastre os números contratados e diga em qual fila ou agente cada um cai.",
        steps: [
          "Abra 'Números de telefone'.",
          "Clique em adicionar e preencha o número e o provedor.",
          "Defina rota de entrada (qual fila ou agente recebe).",
        ],
        route: { to: "/phone-numbers", label: "Abrir Números" },
      },
      {
        id: "filas",
        label: "Filas",
        icon: ListChecks,
        what:
          "Filas distribuem conversas entre atendentes seguindo regras (round-robin, prioridade, horário).",
        use:
          "Crie uma fila por área (vendas, suporte, financeiro) e associe os agentes humanos.",
        steps: [
          "Abra 'Filas' (admin).",
          "Crie uma fila e dê um nome claro.",
          "Adicione os atendentes que devem receber dessa fila.",
          "Defina a regra de distribuição.",
        ],
        route: { to: "/admin-filas", label: "Abrir Filas" },
      },
      {
        id: "registro",
        label: "Registro de auditoria",
        icon: ShieldAlert,
        what:
          "Histórico de ações sensíveis: quem mudou o quê, quando e em qual tela.",
        use:
          "Use para investigar incidentes ou comprovar conformidade.",
        steps: [
          "Abra 'Registro'.",
          "Filtre por usuário, tipo de ação ou período.",
          "Clique numa linha para ver o detalhe completo.",
        ],
        route: { to: "/admin-registro", label: "Abrir Registro" },
      },
    ],
  },
];

  
function TutorialPage() {
  const [query, setQuery] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const filteredSections = SECTIONS.map((s) => ({
    ...s,
    topics: s.topics.filter((t) => {
      if (!q) return true;
      return (
        t.label.toLowerCase().includes(q) ||
        t.what.toLowerCase().includes(q) ||
        t.use.toLowerCase().includes(q)
      );
    }),
  })).filter((s) => s.topics.length > 0);

  return (
    <div className="flex flex-col">
      <PageHeader
        eyebrow="Ajuda"
        title="Tutorial"
        description="Aprenda o que cada tela faz e como configurar passo a passo. Sem complicação."
      />

      <div className="grid gap-6 px-6 py-6 lg:grid-cols-[260px_1fr]">
        {/* Índice lateral */}
        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="rounded-xl border border-border bg-card p-4">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar…"
                className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              />
            </div>
            <nav className="space-y-3 text-sm">
              {filteredSections.map((sec) => (
                <div key={sec.id}>
                  <a
                    href={`#${sec.id}`}
                    className="block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    {sec.title}
                  </a>
                  <ul className="mt-1 space-y-0.5">
                    {sec.topics.map((t) => (
                      <li key={t.id}>
                        <a
                          href={`#${t.id}`}
                          className="flex items-center gap-2 rounded px-2 py-1 text-[13px] text-foreground/80 hover:bg-white/[0.04] hover:text-foreground"
                        >
                          <t.icon className="h-3.5 w-3.5 text-violet-400" />
                          <span className="truncate">{t.label}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              {filteredSections.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nenhum tópico encontrado.
                </p>
              )}
            </nav>
          </div>
        </aside>

        {/* Conteúdo */}
        <div className="space-y-10">
          {filteredSections.map((sec) => (
            <section key={sec.id} id={sec.id} className="scroll-mt-20">
              <div className="mb-4">
                <h2 className="text-xl font-semibold text-foreground">
                  {sec.title}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {sec.description}
                </p>
              </div>

              <div className="space-y-3">
                {sec.topics.map((t) => {
                  const open = activeId === t.id;
                  return (
                    <article
                      key={t.id}
                      id={t.id}
                      className="scroll-mt-20 overflow-hidden rounded-xl border border-border bg-card"
                    >
                      <button
                        type="button"
                        onClick={() => setActiveId(open ? null : t.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-white/[0.03]"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-fuchsia-500/20 text-violet-400">
                          <t.icon className="h-4 w-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-foreground">
                            {t.label}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {t.what}
                          </div>
                        </div>
                        <ChevronRight
                          className={cn(
                            "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
                            open && "rotate-90",
                          )}
                        />
                      </button>

                      {open && (
                        <div className="space-y-4 border-t border-border bg-background/40 px-4 py-4">
                          {t.image && (
                            <a
                              href={t.image}
                              target="_blank"
                              rel="noreferrer"
                              className="block overflow-hidden rounded-lg border border-border bg-black/20"
                              title="Clique para abrir em tamanho real"
                            >
                              <img
                                src={t.image}
                                alt={`Tela de ${t.label}`}
                                loading="lazy"
                                className="block h-auto w-full"
                              />
                            </a>
                          )}
                          <div className="grid gap-4 sm:grid-cols-2">
                            <div>
                              <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                O que é
                              </h3>
                              <p className="text-sm text-foreground/90">
                                {t.what}
                              </p>
                              <h3 className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Quando usar
                              </h3>
                              <p className="text-sm text-foreground/90">
                                {t.use}
                              </p>
                            </div>
                            <div>
                              <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                                Passo a passo
                              </h3>
                              <ol className="space-y-1.5">
                                {t.steps.map((step, i) => (
                                  <li
                                    key={i}
                                    className="flex gap-2 text-sm text-foreground/90"
                                  >
                                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                                    <span>{step}</span>
                                  </li>
                                ))}
                              </ol>
                              {t.route && (
                                <Link
                                  to={t.route.to}
                                  className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-gradient-to-r from-violet-600 to-fuchsia-600 px-3 text-xs font-semibold text-white hover:opacity-90"
                                >
                                  {t.route.label}
                                  <ChevronRight className="h-3.5 w-3.5" />
                                </Link>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
