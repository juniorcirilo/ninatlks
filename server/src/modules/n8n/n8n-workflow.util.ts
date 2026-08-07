import type { N8nConnectionEndpoint, N8nConnections, N8nNode, N8nWorkflow } from './n8n-client.service';

/**
 * Funções puras da atualização incremental de workflow: nenhuma faz I/O, nenhuma
 * depende de NestJS. É o que deixa `addNodeToWorkflow` (em n8n-workflow.service.ts)
 * fino — só orquestra GET → validar entrada → montar localmente → validar saída → PUT
 * — e o que deixa estas funções testáveis sem servidor HTTP nem mock: dado o mesmo
 * workflow de entrada, sempre o mesmo resultado.
 */

/** O que o chamador pede para adicionar — sem `accountId`: é o N8nWorkflowService que sabe de contas. */
export interface AddNodeToWorkflowInput {
  workflowId: string;
  node: {
    name: string;
    type: string;
    typeVersion: number;
    /** Ausente vira `{}` — nem todo nó precisa de parâmetro nenhum para existir. */
    parameters?: Record<string, unknown>;
  };
  /** Conecta a saída principal do último nó existente ao novo nó. Padrão: false — só quem pede explicitamente encadeia. */
  connectToLastNode?: boolean;
  /** Distância em pixels entre o último nó e o novo. Padrão: 64. */
  spacing?: number;
  /** Eixo em que o novo nó é posicionado a partir do último. Padrão: "vertical". */
  direction?: 'horizontal' | 'vertical';
}

export const DEFAULT_SPACING = 64;
export const DEFAULT_DIRECTION: 'horizontal' | 'vertical' = 'vertical';

/**
 * Igualdade estrutural recursiva. Não usa `JSON.stringify(a) === JSON.stringify(b)`
 * porque duas chamadas de `JSON.stringify` em objetos com as MESMAS chaves em ordens
 * diferentes dão strings diferentes — inofensivo aqui (nunca reconstruímos os nós
 * originais, só clonamos), mas escrever a comparação de verdade custa pouco e não
 * fica refém dessa premissa se o código mudar depois.
 */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== 'object' || typeof b !== 'object') return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const aKeys = Object.keys(a as Record<string, unknown>);
  const bKeys = Object.keys(b as Record<string, unknown>);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) =>
    deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key]),
  );
}

/**
 * Nome único para o novo nó: se `desiredName` já existe, sufixa " 2", " 3"... até
 * achar um livre. Nunca sobrescreve nem renomeia o nó existente — o desvio é sempre
 * no nome do NOVO nó.
 */
export function generateUniqueNodeName(nodes: N8nNode[], desiredName: string): string {
  const taken = new Set(nodes.map((n) => n.name));
  if (!taken.has(desiredName)) return desiredName;
  let suffix = 2;
  while (taken.has(`${desiredName} ${suffix}`)) suffix++;
  return `${desiredName} ${suffix}`;
}

/**
 * O "último nó" é o de maior posição no eixo da direção escolhida — X para
 * horizontal, Y para vertical. `null` quando o workflow está vazio (não há
 * "último" possível).
 */
export function findLastNode(
  nodes: N8nNode[],
  direction: 'horizontal' | 'vertical',
): N8nNode | null {
  if (nodes.length === 0) return null;
  const axis = direction === 'horizontal' ? 0 : 1;
  return nodes.reduce((max, n) => (n.position[axis] > max.position[axis] ? n : max), nodes[0]);
}

/**
 * Posição do novo nó a partir do último. Sem nó nenhum no workflow, `[0, 0]`
 * (não há referência para deslocar a partir de nada).
 */
export function calculateNodePosition(
  lastNode: N8nNode | null,
  opts: { spacing: number; direction: 'horizontal' | 'vertical' },
): [number, number] {
  if (!lastNode) return [0, 0];
  return opts.direction === 'horizontal'
    ? [lastNode.position[0] + opts.spacing, lastNode.position[1]]
    : [lastNode.position[0], lastNode.position[1] + opts.spacing];
}

/**
 * Acrescenta uma conexão da saída principal (`main`, slot 0) de `fromNodeName`
 * para `toNodeName`, preservando tudo que já havia — inclusive conexões em
 * OUTROS slots de saída (ex.: o slot 1 de um nó IF, para o ramo "false") e
 * outros tipos de saída no mesmo nó (ex.: `ai_tool`). Não duplica: se a conexão
 * já existir, devolve o objeto original inalterado.
 *
 * Não muta `connections` — devolve um objeto novo. Quem chama decide se usa o
 * resultado ou descarta.
 */
export function appendNodeConnection(
  connections: N8nConnections,
  fromNodeName: string,
  toNodeName: string,
): N8nConnections {
  const fromEntry = connections[fromNodeName] ?? {};
  const mainSlots = fromEntry.main ?? [];
  const firstSlot = mainSlots[0] ?? [];

  const alreadyConnected = firstSlot.some(
    (c) => c.node === toNodeName && c.type === 'main' && c.index === 0,
  );
  if (alreadyConnected) return connections;

  const endpoint: N8nConnectionEndpoint = { node: toNodeName, type: 'main', index: 0 };
  const newFirstSlot = [...firstSlot, endpoint];
  const newMainSlots = [newFirstSlot, ...mainSlots.slice(1)];

  return {
    ...connections,
    [fromNodeName]: {
      ...fromEntry,
      main: newMainSlots,
    },
  };
}

/**
 * Campos que o corpo de `PUT /workflows/{id}` aceita nesta versão da API
 * pública do n8n. Lista de PERMISSÃO, não de bloqueio — decisão tomada depois
 * de testar contra uma instância real (n8n auto-hospedado): o schema do PUT é
 * estrito (`additionalProperties: false`), e campos como `tags` e `meta`, que
 * a primeira versão desta função tentava PRESERVAR, na verdade voltam
 * `HTTP 400 "read-only"` quando reenviados — mesmo aparecendo normalmente no
 * GET. `id`, `createdAt`, `updatedAt`, `versionId`, `active`, `isArchived`,
 * `triggerCount`, `nodeGroups`, `versionCounter`, `activeVersionId` e afins
 * caem na mesma categoria: geridos pelo servidor, nunca aceitos de volta.
 *
 * Confirmado por sonda direta (`curl -X PUT`) campo a campo:
 *   name/nodes/connections/settings → aceitos (base)
 *   staticData → aceito
 *   pinData → aceito
 *   tags → 400 "request/body/tags is read-only"
 *   meta → 400 "request/body/meta is read-only"
 *
 * Se uma versão futura do n8n mudar o que aceita, é aqui — só aqui — que se
 * ajusta.
 */
const WRITABLE_UPDATE_FIELDS = [
  'name',
  'nodes',
  'connections',
  'settings',
  'staticData',
  'pinData',
] as const;

/**
 * Prepara o payload do PUT a partir do workflow (já com o novo nó/conexão
 * aplicados localmente). Clona com `structuredClone` antes de filtrar — o
 * objeto passado nunca é mutado — e devolve só os campos que o PUT aceita,
 * na ordem de `WRITABLE_UPDATE_FIELDS`. Campo ausente no workflow original
 * (ex.: `staticData` nulo) simplesmente não aparece no payload.
 */
export function sanitizeWorkflowForUpdate(workflow: N8nWorkflow): Record<string, unknown> {
  const clone = structuredClone(workflow) as Record<string, unknown>;
  const payload: Record<string, unknown> = {};
  for (const field of WRITABLE_UPDATE_FIELDS) {
    if (field in clone) payload[field] = clone[field];
  }
  return payload;
}

/**
 * Última linha de defesa antes do PUT: confere que a mudança local foi
 * exatamente "todos os nós/conexões de antes, mais o novo" — nada a menos,
 * nada diferente. Lança no primeiro problema encontrado; quem chama não
 * executa o PUT se isto lançar.
 */
export function validateIncrementalUpdate(original: N8nWorkflow, updated: N8nWorkflow): void {
  if (!Array.isArray(updated.nodes)) {
    throw new Error('validação falhou: o workflow atualizado não tem um array "nodes".');
  }
  if (!updated.connections || typeof updated.connections !== 'object') {
    throw new Error('validação falhou: o workflow atualizado não tem um objeto "connections".');
  }

  if (updated.nodes.length !== original.nodes.length + 1) {
    throw new Error(
      `validação falhou: esperava ${original.nodes.length + 1} nó(s) (${original.nodes.length} existente(s) + 1 novo), recebeu ${updated.nodes.length}.`,
    );
  }

  const preserved = updated.nodes.slice(0, original.nodes.length);
  if (!deepEqual(preserved, original.nodes)) {
    // Isola qual nó mudou para a mensagem não obrigar quem lê a comparar os
    // dois arrays inteiros na mão.
    const changedIndex = original.nodes.findIndex(
      (n, i) => !deepEqual(n, preserved[i]),
    );
    const changed = original.nodes[changedIndex];
    throw new Error(
      changedIndex >= 0
        ? `validação falhou: o nó existente "${changed.name}" (posição ${changedIndex}) foi alterado — a atualização incremental não pode mexer em nó já existente.`
        : 'validação falhou: os nós existentes não foram preservados integralmente.',
    );
  }

  const newNode = updated.nodes[updated.nodes.length - 1];
  const originalIds = new Set(original.nodes.map((n) => n.id));
  if (originalIds.has(newNode.id)) {
    throw new Error(`validação falhou: o id do novo nó ("${newNode.id}") colide com um nó existente.`);
  }
  const originalNames = new Set(original.nodes.map((n) => n.name));
  if (originalNames.has(newNode.name)) {
    throw new Error(`validação falhou: o nome do novo nó ("${newNode.name}") colide com um nó existente.`);
  }

  if (
    !Array.isArray(newNode.position) ||
    newNode.position.length !== 2 ||
    !Number.isFinite(newNode.position[0]) ||
    !Number.isFinite(newNode.position[1])
  ) {
    throw new Error(
      `validação falhou: posição inválida para o novo nó — esperado [x, y] numérico, recebeu ${JSON.stringify(newNode.position)}.`,
    );
  }

  // Nenhuma conexão de origem que já existia pode ter perdido um destino que
  // já tinha. Checa por nó de origem, por slot: o que estava lá antes tem que
  // continuar lá (adicionar é permitido, remover não).
  for (const [fromName, fromEntryBefore] of Object.entries(original.connections ?? {})) {
    const fromEntryAfter = updated.connections?.[fromName];
    for (const [outputType, slotsBefore] of Object.entries(fromEntryBefore ?? {})) {
      const slotsAfter = fromEntryAfter?.[outputType];
      slotsBefore.forEach((slotBefore, slotIndex) => {
        const slotAfter = slotsAfter?.[slotIndex] ?? [];
        const missing = slotBefore.filter(
          (endpointBefore) =>
            !slotAfter.some(
              (endpointAfter) =>
                endpointAfter.node === endpointBefore.node &&
                endpointAfter.type === endpointBefore.type &&
                endpointAfter.index === endpointBefore.index,
            ),
        );
        if (missing.length > 0) {
          throw new Error(
            `validação falhou: a conexão de "${fromName}" (${outputType}[${slotIndex}]) para "${missing[0].node}" existia antes e sumiu — a atualização incremental não pode remover conexão existente.`,
          );
        }
      });
    }
  }
}
