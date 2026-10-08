import { Injectable, Logger, Scope } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { N8nClientService, type N8nNode, type N8nWorkflow, type N8nConnections } from './n8n-client.service';

/** Nome padrão do workflow quando `N8N_WORKFLOW_NAME` não está definida. */
const DEFAULT_WORKFLOW_NAME = 'Utalks';

/**
 * Nome do workflow que concentra as fontes de recebimento por agente.
 * Configurável por `N8N_WORKFLOW_NAME` (mesma instância pode servir mais de
 * uma instalação, cada uma com seu workflow) — lido a cada chamada, não
 * congelado num `const` no topo do módulo, porque o valor pode mudar entre
 * um boot e outro do processo sem precisar recompilar nada.
 *
 * É o que permite achar "o" workflow sem guardar o id em lugar nenhum do
 * nosso banco — se o usuário apagar e recriar do zero, a próxima chamada acha
 * (ou recria) do mesmo jeito.
 */
function workflowName(): string {
  return process.env.N8N_WORKFLOW_NAME?.trim() || DEFAULT_WORKFLOW_NAME;
}

/**
 * Método HTTP padrão dos webhooks do n8n. Usa `N8N_HTTP_METHOD` quando
 * definido; caso contrário, cai para POST. Aceita apenas GET ou POST.
 */
function n8nHttpMethod(): 'GET' | 'POST' {
  const raw = process.env.N8N_HTTP_METHOD?.trim().toUpperCase();
  if (raw === 'GET') return 'GET';
  return 'POST';
}

export interface EnsureNodeResult {
  /** false quando o nó já existia — nada foi tocado. */
  created: boolean;
  url: string;
  workflowId: string;
  nodeName: string;
}

/**
 * Ponte entre "fonte de dados de um agente" (agent_inbound_sources) e "nó
 * Webhook dentro do workflow Utalks no n8n do cliente".
 *
 * A identidade que decide "já existe?" é o NOME do nó
 * (`Webhook call — <agente>`), não a URL nem o id da fonte — de propósito:
 * o nó pode nascer antes da fonte existir no nosso banco (fluxo de "clicar em
 * Configurar" pré-preenche a URL, e só ao salvar a fonte é criada). Amarrar
 * pelo nome do agente também é o que deixa o backfill idempotente: rodar de
 * novo não duplica nó nenhum.
 */
@Injectable({ scope: Scope.REQUEST })
export class N8nIntegrationService {
  private readonly logger = new Logger(N8nIntegrationService.name);

  constructor(private readonly client: N8nClientService) {}

  async isConfigured(accountId: string): Promise<boolean> {
    return this.client.isConfigured(accountId);
  }

  nodeNameFor(agentName: string): string {
    return `Webhook call — ${agentName}`;
  }

  /** Acha o workflow (nome de `N8N_WORKFLOW_NAME`, ou "Utalks"); cria vazio na primeira vez. */
  async ensureWorkflow(
    accountId: string,
  ): Promise<{ id: string; name: string }> {
    const name = workflowName();
    const workflows = await this.client.listWorkflows(accountId);
    const existing = workflows.find((w) => w.name === name);
    if (existing) return { id: existing.id, name: existing.name };

    const created = await this.client.createWorkflow(accountId, {
      name,
      nodes: [],
      connections: {},
      settings: { executionOrder: 'v1' },
    });
    this.logger.log(`workflow "${name}" criado (account=${accountId})`);
    return { id: created.id, name: created.name };
  }

  /**
   * Garante o nó Webhook do agente dentro do workflow Utalks. Idempotente por
   * nome — se já existir, devolve a URL dele sem mexer em nada
   * (`created: false`); "se existir não mexa" é literal aqui.
   *
   * O path do webhook é um UUID novo, sem relação com o id da fonte no nosso
   * banco — de propósito: no fluxo de "Configurar" o nó nasce ANTES da fonte
   * existir, então não há id de fonte para amarrar ainda.
   */
  async ensureAgentNode(
    accountId: string,
    input: { agentName: string; method: 'GET' | 'POST' },
  ): Promise<EnsureNodeResult> {
    const wf = await this.ensureWorkflow(accountId);
    const full = await this.client.getWorkflow(accountId, wf.id);
    const nodes = Array.isArray(full.nodes) ? full.nodes : [];
    const nodeName = this.nodeNameFor(input.agentName);
    const baseUrl = await this.client.requireBaseUrl(accountId);

    const desiredMethod = n8nHttpMethod();
    const existingNode = nodes.find(
      (n) => n.name === nodeName && n.type === 'n8n-nodes-base.webhook',
    );
    if (existingNode) {
      const currentMethod = String(existingNode.parameters?.httpMethod ?? 'GET');
      if (currentMethod !== desiredMethod) {
        const updatedNodes = nodes.map((n) =>
          n.name === nodeName && n.type === 'n8n-nodes-base.webhook'
            ? { ...n, parameters: { ...n.parameters, httpMethod: desiredMethod } }
            : n,
        );
        await this.client.updateWorkflow(accountId, wf.id, {
          name: full.name,
          nodes: updatedNodes,
          connections: full.connections ?? {},
          settings: full.settings ?? { executionOrder: 'v1' },
        });
        this.logger.log(
          `nó "${nodeName}" atualizado para ${desiredMethod} no workflow ${wf.id} (account=${accountId})`,
        );
      }
      const path = String(existingNode.parameters?.path ?? '');
      return {
        created: false,
        url: `${baseUrl}/webhook/${path}`,
        workflowId: wf.id,
        nodeName,
      };
    }

    const path = randomUUID();
    const newNode: N8nNode = {
      id: randomUUID(),
      name: nodeName,
      type: 'n8n-nodes-base.webhook',
      typeVersion: 2,
      position: nextPosition(nodes),
      webhookId: randomUUID(),
      parameters: {
        httpMethod: desiredMethod,
        path,
        // "lastNode": o que os nós seguintes (a consulta ao ERP que o usuário
        // monta depois) devolverem vira a resposta HTTP — é o que deixa o
        // Utalks receber o JSON de verdade, não um eco vazio do webhook.
        responseMode: 'lastNode',
        options: {},
      },
    };

    await this.client.updateWorkflow(accountId, wf.id, {
      name: full.name,
      nodes: [...nodes, newNode],
      connections: full.connections ?? {},
      settings: full.settings ?? { executionOrder: 'v1' },
    });

    // Melhor esforço: sem isto o path fica só em /webhook-test/ (expira).
    await this.client.activateWorkflow(accountId, wf.id);

    this.logger.log(
      `nó "${nodeName}" criado no workflow ${wf.id} (account=${accountId})`,
    );
    return {
      created: true,
      url: `${baseUrl}/webhook/${path}`,
      workflowId: wf.id,
      nodeName,
    };
  }

  /**
   * Verifica se cada agente tem um nó MSSQL com query preenchida em sua
   * cadeia. Se não tiver, desativa todos os nós da cadeia daquele agente.
   * Idempotente: rodar de novo não desativa quem já está válido.
   */
  async validateAndDisableIncompleteAgentChains(
    accountId: string,
    agentNames: string[],
  ): Promise<{ disabled: string[]; errors: string[] }> {
    const wf = await this.ensureWorkflow(accountId);
    const full = await this.client.getWorkflow(accountId, wf.id);
    const nodes = Array.isArray(full.nodes) ? full.nodes : [];
    const connections = (full.connections ?? {}) as N8nConnections;

    const nodesToDisable = new Set<string>();
    const disabled: string[] = [];
    const errors: string[] = [];

    for (const agentName of agentNames) {
      const webhookName = this.nodeNameFor(agentName);
      const webhookNode = nodes.find(
        (n) => n.name === webhookName && n.type === 'n8n-nodes-base.webhook',
      );
      if (!webhookNode) continue;

      const chain = traceChain(webhookName, connections, nodes);
      if (!hasValidMssqlQuery(chain, nodes)) {
        chain.forEach((name) => nodesToDisable.add(name));
        disabled.push(agentName);
      }
    }

    if (nodesToDisable.size > 0) {
      const updatedNodes = nodes.map((n) =>
        nodesToDisable.has(n.name) ? { ...n, disabled: true } : n,
      );
      try {
        await this.client.updateWorkflow(accountId, wf.id, {
          name: full.name,
          nodes: updatedNodes,
          connections: full.connections ?? {},
          settings: full.settings ?? { executionOrder: 'v1' },
        });
        for (const agentName of disabled) {
          this.logger.warn(
            `Cadeia do agente "${agentName}" no workflow ${wf.id} não tem nó MSSQL com query — nós desativados.`,
          );
        }
      } catch (err) {
        errors.push((err as Error).message);
      }
    }

    return { disabled, errors };
  }
}

/**
 * Percorre a cadeia de conexões a partir de um nó e devolve o conjunto de
 * todos os nomes alcançáveis. Usado para validar se um agente tem um nó
 * MSSQL com query não-vazia em seu fluxo.
 */
function traceChain(
  startName: string,
  connections: N8nConnections,
  nodes: N8nNode[],
): Set<string> {
  const visited = new Set<string>();
  const queue = [startName];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const outgoing = connections[current]?.main ?? [];
    for (const slot of outgoing) {
      for (const endpoint of slot) {
        if (!visited.has(endpoint.node) && nodes.some((n) => n.name === endpoint.node)) {
          queue.push(endpoint.node);
        }
      }
    }
  }
  return visited;
}

/** Nó MSSQL com query preenchida? */
function isMssqlNodeWithQuery(node: N8nNode): boolean {
  if (node.type !== 'n8n-nodes-base.mssql') return false;
  const query = node.parameters?.query;
  if (typeof query !== 'string') return false;
  return query.trim().length > 0;
}

/** Há pelo menos um nó MSSQL com query no conjunto de nomes? */
function hasValidMssqlQuery(nodeNames: Set<string>, nodes: N8nNode[]): boolean {
  return nodes.some((n) => nodeNames.has(n.name) && isMssqlNodeWithQuery(n));
}

/** Empilha o próximo nó à direita do mais à direita — evita sobrepor nós existentes. */
function nextPosition(nodes: N8nNode[]): [number, number] {
  if (nodes.length === 0) return [240, 300];
  const maxX = Math.max(
    ...nodes.map((n) => (Array.isArray(n.position) ? n.position[0] : 240)),
  );
  return [maxX + 280, 300];
}
