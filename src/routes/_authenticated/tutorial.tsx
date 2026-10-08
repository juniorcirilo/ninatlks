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
      { title: "Tutorial — Utalks" },
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
    id: "operacao-ia",
    title: "Operação IA — Funcionários IA",
    description:
      "Listas operacionais e campanhas de discagem com IA para SDR, Cobrança, Pós-venda e Retenção.",
    topics: [
      {
        id: "listas",
        label: "Listas operacionais",
        icon: ListChecks,
        what:
          "Central para preparar e gerenciar listas de contatos que entram em campanhas de ligação automática com IA. Aqui também ficam as regras de retenção, janelas de horário (LGPD) e a blocklist (DNC).",
        use:
          "Use para subir uma planilha de leads, configurar quando a IA pode ligar e bloquear números que não devem ser chamados.",
        steps: [
          "Abra 'Listas' no menu lateral.",
          "Aba 'Listas': importe contatos via CSV ou cole telefones.",
          "Aba 'Regras de retenção': defina após quantos dias de inatividade a IA reativa o lead.",
          "Aba 'Janelas & LGPD': configure horários permitidos por dia e o aviso de gravação.",
          "Aba 'DNC / Blocklist': cadastre números que nunca devem ser ligados.",
        ],
        route: { to: "/listas", label: "Abrir Listas" },
      },
      {
        id: "campanhas",
        label: "Campanhas de discagem IA",
        icon: Megaphone,
        what:
          "Campanhas executam ligações automáticas para uma lista usando uma persona de IA (SDR, Cobrança, Pós-venda ou Retenção). O sistema disca, classifica o resultado e reagenda sozinho.",
        use:
          "Use para rodar prospecção em massa, cobranças, pesquisas CSAT pós-venda ou recuperação de clientes inativos.",
        steps: [
          "Abra 'Campanhas' no menu.",
          "Veja o painel com KPIs globais (conexão, escalonamentos, falhas) e ranking por tipo de operação.",
          "Clique em 'Nova campanha' para criar uma.",
          "Escolha o tipo (SDR / Cobrança / Pós-venda / Retenção) e a persona IA correspondente.",
          "Selecione a lista de contatos e ajuste as regras de retry por resultado.",
          "Ative a campanha — o discador respeita janelas de horário e DNC automaticamente.",
        ],
        route: { to: "/campanhas", label: "Abrir Campanhas" },
      },
      {
        id: "personas-verticais",
        label: "Personas verticais de IA",
        icon: Target,
        what:
          "4 funcionários IA prontos: Sofia (SDR — qualifica e agenda), Diego (Cobrança — negocia com tom CDC/LGPD), Carla (Pós-venda — CSAT e onboarding) e Elena (Retenção — reativa inativos).",
        use:
          "Selecione a persona ideal na criação da campanha. Cada uma tem prompt, tom de voz e outcomes próprios.",
        steps: [
          "Abra 'Agentes de voz'.",
          "Filtre pelas personas Sofia, Diego, Carla e Elena.",
          "Clique para revisar o script e ajustar o prompt se necessário.",
          "Use no wizard de Nova Campanha conforme o objetivo da operação.",
        ],
        route: { to: "/agents", label: "Ver Personas" },
      },
      {
        id: "retry-inteligente",
        label: "Retry inteligente",
        icon: RefreshCw,
        what:
          "Cada resultado de ligação (não atendeu, ocupado, caixa postal, prometeu pagar etc.) tem sua própria regra de reagendamento. Outcomes terminais (não tem interesse, DNC) encerram o contato.",
        use:
          "Configure dentro da campanha em 'Regras de retry' para definir delays diferentes por outcome e número máximo de tentativas.",
        steps: [
          "Abra a campanha desejada em 'Campanhas'.",
          "Vá em 'Regras de retry'.",
          "Para cada outcome, defina o delay (em minutos/horas) até a próxima tentativa.",
          "Defina também o número máximo de tentativas total.",
        ],
        route: { to: "/campanhas", label: "Abrir Campanhas" },
      },
      {
        id: "promessas-cobranca",
        label: "Follow-up de promessas (Cobrança)",
        icon: Clock,
        what:
          "Quando a IA de Cobrança identifica que o cliente prometeu pagar, o sistema agenda automaticamente uma ligação de follow-up em D+3 para confirmar.",
        use:
          "Funciona automático — não precisa configurar nada por contato. Acompanhe os resultados na campanha de cobrança.",
        steps: [
          "Crie uma campanha do tipo Cobrança com a persona Diego.",
          "O cron de hora em hora detecta o outcome 'prometeu_pagar'.",
          "Um novo contato é enfileirado na mesma campanha com data alvo D+3.",
          "Acompanhe pelo histórico de ligações do contato.",
        ],
        route: { to: "/campanhas", label: "Ver Campanhas" },
      },
      {
        id: "retencao-inativos",
        label: "Retenção de inativos",
        icon: TrendingUp,
        what:
          "Cron diário varre os contatos e identifica quem está inativo (sem interação há X dias, com tags ou em estágios específicos do pipeline). Eles entram automaticamente na campanha de retenção.",
        use:
          "Configure as regras uma vez em Listas → Regras de Retenção. A operação roda sozinha todo dia.",
        steps: [
          "Abra 'Listas' → aba 'Regras de retenção'.",
          "Defina o limite de inatividade (ex: 60 dias).",
          "Escolha a campanha de retenção que receberá esses contatos.",
          "Defina o limite máximo de matrículas por dia.",
          "Salve — o cron diário cuida do resto.",
        ],
        route: { to: "/listas", label: "Configurar Retenção" },
      },
      {
        id: "compliance-lgpd",
        label: "Compliance, LGPD e DNC",
        icon: ShieldCheck,
        what:
          "Janelas de horário evitam ligações fora do permitido por lei. O DNC (Do Not Call) bloqueia números específicos. Toda ligação inclui o aviso obrigatório de gravação.",
        use:
          "Configure uma vez em Listas. O discador e os crons respeitam essas regras automaticamente em todas as campanhas.",
        steps: [
          "Em 'Listas' → aba 'Janelas & LGPD', defina os horários permitidos por dia da semana.",
          "Ajuste o intervalo mínimo entre tentativas para o mesmo contato.",
          "Personalize o aviso de gravação que a IA fala no início da ligação.",
          "Em 'DNC / Blocklist', adicione números que nunca devem ser chamados.",
        ],
        route: { to: "/listas", label: "Abrir Listas" },
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
          <div className="rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 p-4">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar…"
                className="h-9 w-full rounded-md border border-gray-200 dark:border-slate-800 bg-background pl-8 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
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
                          className="flex items-center gap-2 rounded px-2 py-1 text-[13px] text-foreground/80 hover:bg-foreground/[0.04] hover:text-foreground"
                        >
                          <t.icon className="h-3.5 w-3.5 text-cyan-400" />
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
                      className="scroll-mt-20 overflow-hidden rounded-xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/40"
                    >
                      <button
                        type="button"
                        onClick={() => setActiveId(open ? null : t.id)}
                        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-foreground/[0.03]"
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/20 text-cyan-400">
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
                        <div className="space-y-4 border-t border-gray-200 dark:border-slate-800 bg-background/40 px-4 py-4">
                          {t.image && (
                            <a
                              href={t.image}
                              target="_blank"
                              rel="noreferrer"
                              className="block overflow-hidden rounded-lg border border-gray-200 dark:border-slate-800 bg-black/20"
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
                                  className="mt-4 inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-xs font-semibold text-white hover:opacity-90"
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
