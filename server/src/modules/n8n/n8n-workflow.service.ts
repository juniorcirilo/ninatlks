import { BadRequestException, Injectable, Logger, Scope } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { N8nClientService, type N8nNode, type N8nWorkflow } from './n8n-client.service';
import {
  DEFAULT_DIRECTION,
  DEFAULT_SPACING,
  appendNodeConnection,
  calculateNodePosition,
  findLastNode,
  generateUniqueNodeName,
  sanitizeWorkflowForUpdate,
  validateIncrementalUpdate,
  type AddNodeToWorkflowInput,
} from './n8n-workflow.util';

/**
 * Adiciona nós a um workflow do n8n que já existe, sem alterar, remover ou
 * sobrescrever o que já está lá — nome dos nós, ids, posições, `connections`,
 * `settings`, `staticData`, `pinData`, `meta`, `tags`, tudo do jeito que veio
 * do GET, com só um nó a mais no fim.
 *
 * Fluxo: GET (workflow é a fonte da verdade) → monta a mudança numa cópia
 * local → `validateIncrementalUpdate` confere que só o esperado mudou → PUT.
 * Se a validação lançar, o PUT nunca roda.
 */
@Injectable({ scope: Scope.REQUEST })
export class N8nWorkflowService {
  private readonly logger = new Logger(N8nWorkflowService.name);

  constructor(private readonly client: N8nClientService) {}

  async addNodeToWorkflow(
    accountId: string,
    input: AddNodeToWorkflowInput,
  ): Promise<N8nWorkflow> {
    const { workflowId } = input;
    if (!input.node?.name?.trim()) {
      throw new BadRequestException('addNodeToWorkflow: o nó precisa de "name".');
    }
    if (!input.node?.type?.trim()) {
      throw new BadRequestException('addNodeToWorkflow: o nó precisa de "type".');
    }

    const spacing = input.spacing ?? DEFAULT_SPACING;
    const direction = input.direction ?? DEFAULT_DIRECTION;

    let original: N8nWorkflow;
    try {
      original = await this.client.getWorkflow(accountId, workflowId);
    } catch (err) {
      throw new Error(
        `Não foi possível buscar o workflow ${workflowId}: ${(err as Error).message}`,
      );
    }

    if (!Array.isArray(original.nodes)) {
      throw new BadRequestException(
        `Workflow ${workflowId} veio sem um array "nodes" — resposta inesperada da API do n8n.`,
      );
    }
    if (!original.connections || typeof original.connections !== 'object') {
      throw new BadRequestException(
        `Workflow ${workflowId} veio sem um objeto "connections" — resposta inesperada da API do n8n.`,
      );
    }

    // Cópia imutável: `updated` é onde a mudança é montada; `original` nunca
    // é tocado, e é contra ele que `validateIncrementalUpdate` compara no
    // final.
    const updated = structuredClone(original);

    const lastNode = findLastNode(updated.nodes, direction);
    const position = calculateNodePosition(lastNode, { spacing, direction });
    const name = generateUniqueNodeName(updated.nodes, input.node.name.trim());

    const newNode: N8nNode = {
      id: randomUUID(),
      name,
      type: input.node.type.trim(),
      typeVersion: input.node.typeVersion,
      position,
      parameters: input.node.parameters ?? {},
    };

    updated.nodes = [...updated.nodes, newNode];
    updated.connections =
      input.connectToLastNode && lastNode
        ? appendNodeConnection(updated.connections, lastNode.name, newNode.name)
        : updated.connections;

    // Nunca executa o PUT se isto lançar — validateIncrementalUpdate lança,
    // não devolve um booleano, então um throw aqui já interrompe o fluxo.
    validateIncrementalUpdate(original, updated);

    const payload = sanitizeWorkflowForUpdate(updated);

    let result: N8nWorkflow;
    try {
      result = await this.client.updateWorkflow(accountId, workflowId, payload);
    } catch (err) {
      throw new Error(
        `Não foi possível atualizar o workflow ${workflowId}: ${(err as Error).message}`,
      );
    }

    this.logger.log(
      `nó "${name}" adicionado ao workflow ${workflowId} (account=${accountId}, posição=[${position[0]},${position[1]}], conectado=${!!(input.connectToLastNode && lastNode)})`,
    );
    return result;
  }
}
