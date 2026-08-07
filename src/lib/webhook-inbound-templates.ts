/**
 * Templates de recebimento por agente.
 *
 * O que o cliente precisa mandar para automatizar um agente: um contato por
 * chamada, com o telefone como chave. Chegar de novo com o mesmo telefone
 * atualiza o contato e mescla as variáveis — não cria um segundo contato nem
 * uma segunda ligação.
 */

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

/** Rota de recebimento (ver IngestController.agentContact no servidor). */
export const INBOUND_ENDPOINT = `${API_URL.replace(/\/$/, "")}/ingest/agent-contact`;

/** Carga de lista operacional (ver IngestController.operationalList). */
export const OPERATIONAL_LIST_ENDPOINT = `${API_URL.replace(/\/$/, "")}/ingest/operational-list`;

export interface TemplateField {
  field: string;
  required: boolean;
  desc: string;
  example: unknown;
}

/** Campos comuns a todo agente. `phone` é a chave do upsert. */
const BASE_FIELDS: TemplateField[] = [
  {
    field: "agent",
    required: true,
    desc: "Id da persona que vai trabalhar o contato. Já vem preenchido no template.",
    example: "",
  },
  {
    field: "phone",
    required: true,
    desc: "Chave principal. Aceita DDD local ou E.164 — normalizamos para E.164.",
    example: "+5511999998888",
  },
  {
    field: "name",
    required: false,
    desc: "Nome do contato. Só preenche o que estiver vazio.",
    example: "Maria Silva",
  },
  {
    field: "email",
    required: false,
    desc: "E-mail. Descartado se já pertencer a outro contato.",
    example: "maria.silva@exemplo.com",
  },
  {
    field: "externalId",
    required: false,
    desc: "Código no seu sistema. Enriquecimento, nunca chave.",
    example: "CRM-40312",
  },
  {
    field: "campaignKind",
    required: false,
    desc: "Tipo da lista operacional criada para o agente. Só preenche, nunca apaga.",
    example: "",
  },
];

/**
 * Tipo de operação de cada agente embutido. É o que a lista operacional recebe
 * em `campaign_kind`, e o que a tela /listas usa no badge.
 */
const AGENT_CAMPAIGN_KIND: Record<string, string> = {
  ana: "sdr",
  bruno: "custom",
  carla: "pos_venda",
};

/**
 * Variáveis por agente. É o conteúdo que chega até a fala da agente, então a
 * lista acompanha o que cada um faz — SDR não precisa de espessura de vidro.
 */
const AGENT_VARIABLES: Record<string, TemplateField[]> = {
  ana: [
    { field: "origem", required: false, desc: "Canal de onde o lead veio.", example: "formulario_site" },
    { field: "interesse", required: false, desc: "O que o lead pediu.", example: "Orçamento de fachada de vidro" },
    { field: "empresa", required: false, desc: "Empresa do lead.", example: "Construtora Aurora" },
    { field: "cargo", required: false, desc: "Cargo de quem preencheu.", example: "Gerente de obras" },
    { field: "orcamento_estimado", required: false, desc: "Faixa de investimento declarada.", example: "25000.00" },
    { field: "melhor_horario", required: false, desc: "Janela preferida de contato.", example: "manhã" },
  ],
  bruno: [
    { field: "tipo_vidro", required: false, desc: "Categoria do vidro pedido.", example: "temperado_incolor" },
    { field: "espessura_mm", required: false, desc: "Espessura em milímetros.", example: 10 },
    { field: "largura_cm", required: false, desc: "Largura da peça em centímetros.", example: 180 },
    { field: "altura_cm", required: false, desc: "Altura da peça em centímetros.", example: 210 },
    { field: "quantidade", required: false, desc: "Quantidade de peças.", example: 2 },
    { field: "ferragens", required: false, desc: "Ferragens desejadas.", example: "kit box deslizante" },
    { field: "prazo_desejado", required: false, desc: "Data-alvo da entrega.", example: "2026-08-20" },
    { field: "cidade_obra", required: false, desc: "Cidade da obra, para frete e prazo.", example: "Fortaleza" },
  ],
  carla: [
    { field: "pedido_id", required: false, desc: "Pedido que originou o contato.", example: "PED-88213" },
    { field: "produto", required: false, desc: "Produto ou serviço entregue.", example: "Box de vidro temperado" },
    { field: "data_entrega", required: false, desc: "Quando foi entregue.", example: "2026-07-22" },
    { field: "status_pedido", required: false, desc: "Situação atual no seu sistema.", example: "entregue" },
    { field: "motivo_contato", required: false, desc: "Por que falar com o cliente agora.", example: "pesquisa_csat" },
    { field: "nota_csat_anterior", required: false, desc: "Última nota registrada, se houver.", example: 4 },
  ],
};

/**
 * Conjuntos por tipo de operação, para as personas cadastradas na conta —
 * elas não têm chave fixa como os agentes embutidos, mas quase sempre são uma
 * dessas quatro operações, e o conjunto certo poupa o operador de digitar
 * oito campos à mão.
 */
const KIND_VARIABLE_FIELDS: Record<string, TemplateField[]> = {
  cobranca: [
    { field: "parcela", required: false, desc: "Parcela do título (ex.: 3/12).", example: "3/12" },
    { field: "data_vencimento", required: false, desc: "Vencimento da parcela.", example: "2026-07-10" },
    { field: "dias_em_atraso", required: false, desc: "Dias corridos desde o vencimento.", example: 20 },
    { field: "data_emissao", required: false, desc: "Emissão do título.", example: "2026-05-10" },
    { field: "valor_original_parcela", required: false, desc: "Valor original da parcela.", example: "1240.55" },
    { field: "valor_ja_pago", required: false, desc: "Quanto já foi pago desta parcela.", example: "240.00" },
    { field: "valor_devedor_saldo", required: false, desc: "Saldo devedor atual.", example: "1000.55" },
    { field: "status_titulo", required: false, desc: "Situação do título no seu sistema.", example: "em_atraso" },
  ],
  sdr: [
    { field: "origem", required: false, desc: "Canal de onde o lead veio.", example: "formulario_site" },
    { field: "interesse", required: false, desc: "O que o lead pediu.", example: "Fachada de vidro" },
    { field: "empresa", required: false, desc: "Empresa do lead.", example: "Construtora Aurora" },
    { field: "cargo", required: false, desc: "Cargo de quem preencheu.", example: "Gerente de obras" },
  ],
  pos_venda: [
    { field: "pedido_id", required: false, desc: "Pedido que originou o contato.", example: "PED-88213" },
    { field: "produto", required: false, desc: "Produto ou serviço entregue.", example: "Box de vidro temperado" },
    { field: "data_entrega", required: false, desc: "Quando foi entregue.", example: "2026-07-22" },
    { field: "motivo_contato", required: false, desc: "Por que falar agora.", example: "pesquisa_csat" },
  ],
  retencao: [
    { field: "plano", required: false, desc: "Plano ou contrato atual.", example: "Mensal" },
    { field: "vencimento_contrato", required: false, desc: "Quando o contrato vence.", example: "2026-08-31" },
    { field: "motivo_risco", required: false, desc: "Sinal de churn detectado.", example: "queda de uso" },
  ],
};

/** Sem operação identificada, um conjunto genérico que serve de ponto de partida. */
const CUSTOM_VARIABLES: TemplateField[] = [
  { field: "assunto", required: false, desc: "Assunto da abordagem.", example: "Renovação de contrato" },
  { field: "resumo", required: false, desc: "Contexto em uma frase, usado na fala.", example: "Contrato vence em 12 dias." },
  { field: "prioridade", required: false, desc: "Ordem de trabalho da lista.", example: "alta" },
];

/**
 * Deduz a operação de uma persona pelo nome ("Diego Cobrança" → cobranca).
 *
 * Nome em vez de id porque o id é por conta: fixar o uuid do Diego desta conta
 * deixaria qualquer outro cliente sem os campos. O nome é o que o operador
 * escolheu para descrever a operação, e é o sinal disponível.
 */
export function inferAgentKind(agent: { key: string; name?: string; kind?: string }): string {
  const builtin = AGENT_CAMPAIGN_KIND[agent.key];
  if (builtin) return builtin;
  const haystack = `${agent.name ?? ""} ${agent.kind ?? ""}`.toLowerCase();
  // Ordem importa: "pós-venda" contém "venda", então a regra de SDR precisa vir
  // depois — senão a Carla Pós-venda recebe as variáveis de prospecção.
  // Confirmado com os nomes reais das personas antes de fechar.
  if (/cobran|inadimpl|d[ií]vida|cart[eé]ira/.test(haystack)) return "cobranca";
  if (/p[óo]s.?venda|csat|sucesso|suporte|cs\b/.test(haystack)) return "pos_venda";
  if (/reten|churn|renova/.test(haystack)) return "retencao";
  if (/sdr|prospec|\bvendas?\b|lead/.test(haystack)) return "sdr";
  return "custom";
}

/**
 * Variáveis sugeridas para um agente — usado no template e no mapeamento da
 * fonte. Prioridade: campos cadastrados na própria persona (aba "Dados") >
 * catálogo dos três builtins de demonstração > palpite pelo tipo de operação.
 * Sem isso, todo agente cadastrado pelo cliente (Diego, Sofia, Larissa…)
 * caía sempre no mesmo conjunto genérico, mesmo tendo dados bem diferentes.
 */
export function variableFieldsForAgent(agent: {
  key: string;
  name?: string;
  kind?: string;
  variable_schema?: TemplateField[] | null;
}): TemplateField[] {
  if (agent.variable_schema && agent.variable_schema.length > 0) return agent.variable_schema;
  if (AGENT_VARIABLES[agent.key]) return AGENT_VARIABLES[agent.key];
  return KIND_VARIABLE_FIELDS[inferAgentKind(agent)] ?? CUSTOM_VARIABLES;
}

/**
 * Mesmo conjunto de `variableFieldsForAgent`, mas partindo direto do tipo de
 * operação (`campaignKind`) escolhido na tela — usado onde não existe um
 * agente ainda, só o tipo de lista (ex.: formulário de inserção manual de
 * variáveis no assistente de criar lista).
 */
export function fieldsForCampaignKind(kind: string): TemplateField[] {
  return KIND_VARIABLE_FIELDS[kind] ?? CUSTOM_VARIABLES;
}

export interface AgentTemplate {
  agentKey: string;
  agentName: string;
  /** O que vai no campo `agent` do payload: id da persona, ou o slug do builtin ainda não instalado. */
  agentId: string;
  /** false quando o builtin não tem persona nesta conta — o template cai no slug. */
  usesPersonaId: boolean;
  fields: TemplateField[];
  variableFields: TemplateField[];
  listKey: string;
  /** Corpo do POST — é isto que o n8n manda. */
  payload: Record<string, unknown>;
  /** Mesmo recebimento em lote: o endpoint aceita `[{…}, {…}]`. */
  batchPayload: Record<string, unknown>[];
  /** Arquivo baixado: endpoint, headers e corpo, prontos para colar no n8n. */
  template: Record<string, unknown>;
  batchTemplate: Record<string, unknown>;
  fileName: string;
  batchFileName: string;
}

export function buildAgentTemplate(agent: {
  key: string;
  name: string;
  kind?: string;
  persona_id?: string | null;
  variable_schema?: TemplateField[] | null;
}): AgentTemplate {
  const variableFields = variableFieldsForAgent(agent);
  // Id da persona quando existe: é o que identifica o agente no banco. Builtin
  // ainda não instalado na conta não tem persona, e aí o slug é o que sobra —
  // a tela avisa, porque o recebimento vai recusar.
  const agentId = agent.persona_id ?? agent.key;
  const campaignKind = inferAgentKind(agent);
  const fields = BASE_FIELDS.map((f) => {
    if (f.field === "agent") return { ...f, example: agentId };
    if (f.field === "campaignKind") return { ...f, example: campaignKind };
    return f;
  });

  const payload: Record<string, unknown> = {
    agent: agentId,
    phone: "+5511999998888",
    name: "Maria Silva",
    email: "maria.silva@exemplo.com",
    externalId: "CRM-40312",
    campaignKind,
    variables: Object.fromEntries(variableFields.map((v) => [v.field, v.example])),
  };

  const batchPayload: Record<string, unknown>[] = [
    payload,
    {
      ...payload,
      phone: "+5521988887777",
      name: "João Pereira",
      email: "joao.pereira@exemplo.com",
      externalId: "CRM-40318",
    },
  ];

  const listKey = `agent:${agentId}`;

  const meta = {
    agente: agent.name,
    agente_id: agentId,
    endpoint: INBOUND_ENDPOINT,
    metodo: "POST",
    headers: {
      Authorization: "Bearer ntk_SUA_CHAVE_DE_ACESSO",
      "Content-Type": "application/json",
    },
    upsert: {
      chave: "phone",
      comportamento:
        "Telefone novo cria o contato; telefone existente atualiza e mescla as variáveis. Nunca duplica.",
    },
    lista_operacional: {
      chave: listKey,
      nome: `Agente ${agent.name}`,
      tipo: campaignKind,
      observacao:
        "Criada na primeira carga e reaproveitada nas seguintes. Aponte a campanha de voz para ela; as variables viram dynamic_variables na fala da agente.",
    },
  };

  return {
    agentKey: agent.key,
    agentName: agent.name,
    agentId,
    usesPersonaId: Boolean(agent.persona_id),
    fields,
    variableFields,
    listKey,
    payload,
    batchPayload,
    template: { ...meta, body: payload },
    batchTemplate: {
      ...meta,
      lote: {
        limite_por_requisicao: 500,
        linha_invalida:
          "Telefone inválido volta como skipped na própria linha; as outras entram.",
      },
      body: batchPayload,
    },
    fileName: `recebimento-${agent.key}.json`,
    batchFileName: `recebimento-${agent.key}-lote.json`,
  };
}

/**
 * cURL pronto para colar no terminal. O corpo vai formatado (multi-linha entre
 * aspas simples é válido em bash) porque o valor aqui é ler o payload, não
 * caber em uma linha.
 */
export function buildCurl(
  payload: unknown,
  endpoint: string = INBOUND_ENDPOINT,
): string {
  const body = JSON.stringify(payload, null, 2)
    // Aspa simples dentro do corpo fecharia o argumento -d no shell.
    .replaceAll("'", `'\\''`);
  return [
    `curl -X POST '${endpoint}' \\`,
    `  -H 'Authorization: Bearer ntk_SUA_CHAVE_DE_ACESSO' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -d '${body}'`,
  ].join("\n");
}

/**
 * Variáveis de exemplo por tipo de operação. São o conteúdo que chega até a
 * fala da agente, então uma carga de cobrança mostra valor e vencimento, não
 * "interesse".
 */
const KIND_VARIABLES: Record<string, Record<string, unknown>> = {
  // Derivados do mesmo catálogo do template por agente, para a carga em lote e
  // o recebimento por contato não descreverem campos diferentes para a mesma
  // operação.
  ...Object.fromEntries(
    Object.entries(KIND_VARIABLE_FIELDS).map(([kind, fields]) => [
      kind,
      Object.fromEntries(fields.map((f) => [f.field, f.example])),
    ]),
  ),
  custom: Object.fromEntries(CUSTOM_VARIABLES.map((f) => [f.field, f.example])),
};

export interface OperationalListTemplate {
  listKey: string;
  /** Corpo do POST de carga da lista. */
  payload: Record<string, unknown>;
  /** Arquivo baixado: endpoint, headers, semântica e corpo. */
  template: Record<string, unknown>;
  curl: string;
  fileName: string;
}

/**
 * Carga da lista operacional inteira (`/ingest/operational-list`), que é o
 * webhook desta tela: várias linhas de uma vez, idempotente pelo `listKey`.
 *
 * `replaceMembers` é a diferença que importa no dia a dia: em `true` quem não
 * veio na carga sai da lista — é o modo certo para "carteira do dia", porque
 * título pago ontem para de ser ligado hoje. Em `false` a carga só acrescenta.
 */
export function buildOperationalListTemplate(
  list: { name: string; externalKey: string; campaignKind?: string | null },
  opts: { replaceMembers: boolean },
): OperationalListTemplate {
  const variables = KIND_VARIABLES[list.campaignKind ?? "custom"] ?? KIND_VARIABLES.custom;

  const payload: Record<string, unknown> = {
    listKey: list.externalKey,
    listName: list.name,
    ...(list.campaignKind ? { campaignKind: list.campaignKind } : {}),
    replaceMembers: opts.replaceMembers,
    rows: [
      {
        externalId: "CRM-40312",
        name: "Maria Silva",
        phone: "+5511999998888",
        email: "maria.silva@exemplo.com",
        variables,
      },
      {
        externalId: "CRM-40318",
        name: "João Pereira",
        phone: "+5521988887777",
        variables,
      },
    ],
  };

  return {
    listKey: list.externalKey,
    payload,
    template: {
      lista: list.name,
      endpoint: OPERATIONAL_LIST_ENDPOINT,
      metodo: "POST",
      headers: {
        Authorization: "Bearer ntk_SUA_CHAVE_DE_ACESSO",
        "Content-Type": "application/json",
      },
      carga: {
        idempotencia:
          "Rodar de novo com o mesmo listKey atualiza a mesma lista em vez de criar outra.",
        limite_por_requisicao: 5000,
        replace_members: opts.replaceMembers
          ? "true — quem não veio nesta carga sai da lista (carteira do dia). Ao paginar, mande true só na última página."
          : "false — a carga só acrescenta; ninguém sai da lista.",
        variaveis:
          "O objeto `variables` de cada linha vira dynamic_variables na fala da agente.",
      },
      body: payload,
    },
    curl: buildCurl(payload, OPERATIONAL_LIST_ENDPOINT),
    fileName: `lista-${list.externalKey}${opts.replaceMembers ? "-substitui" : "-incremental"}.json`,
  };
}

/** Baixa um JSON no navegador sem passar por servidor. */
export function downloadJson(fileName: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  // Revogar na hora vazaria o download em alguns navegadores; um tick basta.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
