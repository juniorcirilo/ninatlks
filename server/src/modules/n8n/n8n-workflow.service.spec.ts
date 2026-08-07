import type { N8nClientService, N8nWorkflow } from './n8n-client.service';
import { N8nWorkflowService } from './n8n-workflow.service';
import type { AddNodeToWorkflowInput } from './n8n-workflow.util';

/**
 * Fake determinístico em memória, não um mock — mesma superfície pública que
 * `N8nWorkflowService` chama de `N8nClientService` (getWorkflow/updateWorkflow),
 * guardando estado real num Map. Não usa `jest.fn()`/mocking automático: o
 * comportamento é código de verdade, só que sem HTTP.
 */
class FakeN8nClient {
  workflows = new Map<string, N8nWorkflow>();
  getCalls = 0;
  updateCalls = 0;
  lastUpdatePayload: Record<string, unknown> | null = null;
  failGetWith: Error | null = null;
  failUpdateWith: Error | null = null;

  seed(id: string, workflow: N8nWorkflow): void {
    this.workflows.set(id, workflow);
  }

  async getWorkflow(_accountId: string, id: string): Promise<N8nWorkflow> {
    this.getCalls++;
    if (this.failGetWith) throw this.failGetWith;
    const wf = this.workflows.get(id);
    if (!wf) throw new Error(`n8n: recurso não encontrado (/workflows/${id}).`);
    // Devolve uma cópia — como um GET HTTP de verdade, o chamador nunca
    // recebe a mesma referência que este fake guarda internamente.
    return structuredClone(wf);
  }

  async updateWorkflow(
    _accountId: string,
    id: string,
    payload: Record<string, unknown>,
  ): Promise<N8nWorkflow> {
    this.updateCalls++;
    this.lastUpdatePayload = payload;
    if (this.failUpdateWith) throw this.failUpdateWith;
    const stored = { ...(payload as object), id } as N8nWorkflow;
    this.workflows.set(id, stored);
    return structuredClone(stored);
  }
}

function makeWorkflow(overrides: Partial<N8nWorkflow> = {}): N8nWorkflow {
  return {
    id: 'wf-1',
    name: 'Utalks',
    active: true,
    nodes: [],
    connections: {},
    settings: { executionOrder: 'v1' },
    ...overrides,
  };
}

const HTTP_NODE_SPEC: AddNodeToWorkflowInput['node'] = {
  name: 'Webhook Call',
  type: 'n8n-nodes-base.httpRequest',
  typeVersion: 4.2,
  parameters: {
    method: 'POST',
    url: 'https://api.exemplo.com/webhook',
    sendBody: true,
    specifyBody: 'json',
    jsonBody: '={{ $json }}',
  },
};

describe('N8nWorkflowService.addNodeToWorkflow', () => {
  let client: FakeN8nClient;
  let service: N8nWorkflowService;

  beforeEach(() => {
    client = new FakeN8nClient();
    service = new N8nWorkflowService(client as unknown as N8nClientService);
  });

  it('adiciona nó em workflow vazio, na posição [0, 0]', async () => {
    client.seed('wf-1', makeWorkflow({ nodes: [], connections: {} }));

    const result = await service.addNodeToWorkflow('acc-1', {
      workflowId: 'wf-1',
      node: HTTP_NODE_SPEC,
    });

    expect(result.nodes).toHaveLength(1);
    expect(result.nodes[0].name).toBe('Webhook Call');
    expect(result.nodes[0].position).toEqual([0, 0]);
    expect(result.nodes[0].type).toBe('n8n-nodes-base.httpRequest');
    expect(result.nodes[0].typeVersion).toBe(4.2);
    expect(result.nodes[0].parameters).toEqual(HTTP_NODE_SPEC.parameters);
  });

  it('adiciona nó em workflow com nós existentes, preservando-os', async () => {
    const existing = makeWorkflow({
      nodes: [
        {
          id: 'id-A',
          name: 'Start',
          type: 'n8n-nodes-base.manualTrigger',
          typeVersion: 1,
          position: [100, 200],
          parameters: {},
        },
      ],
      connections: {},
    });
    client.seed('wf-1', existing);

    const result = await service.addNodeToWorkflow('acc-1', {
      workflowId: 'wf-1',
      node: HTTP_NODE_SPEC,
      direction: 'vertical',
      spacing: 64,
    });

    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0]).toEqual(existing.nodes[0]); // nó existente intocado
    expect(result.nodes[1].name).toBe('Webhook Call');
    expect(result.nodes[1].position).toEqual([100, 264]); // Y + 64, X igual
  });

  it('gera um id novo (UUID) para o nó, diferente a cada chamada', async () => {
    client.seed('wf-1', makeWorkflow());
    const r1 = await service.addNodeToWorkflow('acc-1', {
      workflowId: 'wf-1',
      node: HTTP_NODE_SPEC,
    });
    client.seed('wf-2', makeWorkflow({ id: 'wf-2' }));
    const r2 = await service.addNodeToWorkflow('acc-1', {
      workflowId: 'wf-2',
      node: HTTP_NODE_SPEC,
    });

    const id1 = r1.nodes[0].id;
    const id2 = r2.nodes[0].id;
    expect(id1).toMatch(/^[0-9a-f-]{36}$/i);
    expect(id2).toMatch(/^[0-9a-f-]{36}$/i);
    expect(id1).not.toBe(id2);
  });

  it('connectToLastNode: true conecta a saída do último nó ao novo', async () => {
    client.seed(
      'wf-1',
      makeWorkflow({
        nodes: [
          {
            id: 'id-A',
            name: 'Start',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [0, 0],
            parameters: {},
          },
        ],
        connections: {},
      }),
    );

    const result = await service.addNodeToWorkflow('acc-1', {
      workflowId: 'wf-1',
      node: HTTP_NODE_SPEC,
      connectToLastNode: true,
    });

    expect(result.connections.Start).toEqual({
      main: [[{ node: 'Webhook Call', type: 'main', index: 0 }]],
    });
  });

  it('connectToLastNode: false (padrão) não cria conexão nenhuma', async () => {
    client.seed(
      'wf-1',
      makeWorkflow({
        nodes: [
          {
            id: 'id-A',
            name: 'Start',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [0, 0],
            parameters: {},
          },
        ],
        connections: {},
      }),
    );

    const result = await service.addNodeToWorkflow('acc-1', {
      workflowId: 'wf-1',
      node: HTTP_NODE_SPEC,
    });

    expect(result.connections).toEqual({});
  });

  it('preserva conexões existentes ao acrescentar a nova', async () => {
    client.seed(
      'wf-1',
      makeWorkflow({
        nodes: [
          { id: 'id-A', name: 'A', type: 'x', typeVersion: 1, position: [0, 0], parameters: {} },
          { id: 'id-B', name: 'B', type: 'x', typeVersion: 1, position: [0, 64], parameters: {} },
        ],
        connections: {
          A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
        },
      }),
    );

    const result = await service.addNodeToWorkflow('acc-1', {
      workflowId: 'wf-1',
      node: HTTP_NODE_SPEC,
      connectToLastNode: true,
    });

    // conexão antiga (A -> B) continua exatamente como era
    expect(result.connections.A).toEqual({ main: [[{ node: 'B', type: 'main', index: 0 }]] });
    // a nova (B -> Webhook Call, já que B é o último nó na vertical) foi somada
    expect(result.connections.B).toEqual({
      main: [[{ node: 'Webhook Call', type: 'main', index: 0 }]],
    });
  });

  it('nome duplicado no novo nó ganha sufixo numérico, sem tocar o nó existente', async () => {
    client.seed(
      'wf-1',
      makeWorkflow({
        nodes: [
          {
            id: 'id-existing',
            name: 'Webhook Call',
            type: 'n8n-nodes-base.httpRequest',
            typeVersion: 4.2,
            position: [0, 0],
            parameters: { url: 'https://original.example.com' },
          },
        ],
      }),
    );

    const result = await service.addNodeToWorkflow('acc-1', {
      workflowId: 'wf-1',
      node: HTTP_NODE_SPEC,
    });

    expect(result.nodes[0].name).toBe('Webhook Call');
    expect(result.nodes[0].parameters).toEqual({ url: 'https://original.example.com' });
    expect(result.nodes[1].name).toBe('Webhook Call 2');
  });

  it('rejeita nó de entrada sem nome', async () => {
    client.seed('wf-1', makeWorkflow());
    await expect(
      service.addNodeToWorkflow('acc-1', {
        workflowId: 'wf-1',
        node: { ...HTTP_NODE_SPEC, name: '' },
      }),
    ).rejects.toThrow(/precisa de "name"/);
    expect(client.updateCalls).toBe(0);
  });

  it('rejeita nó de entrada sem type', async () => {
    client.seed('wf-1', makeWorkflow());
    await expect(
      service.addNodeToWorkflow('acc-1', {
        workflowId: 'wf-1',
        node: { ...HTTP_NODE_SPEC, type: '' },
      }),
    ).rejects.toThrow(/precisa de "type"/);
    expect(client.updateCalls).toBe(0);
  });

  it('propaga falha no GET com contexto, sem chamar o PUT', async () => {
    client.failGetWith = new Error('workflow não encontrado');
    await expect(
      service.addNodeToWorkflow('acc-1', { workflowId: 'wf-inexistente', node: HTTP_NODE_SPEC }),
    ).rejects.toThrow(/Não foi possível buscar o workflow wf-inexistente/);
    expect(client.updateCalls).toBe(0);
  });

  it('propaga falha no PUT com contexto', async () => {
    client.seed('wf-1', makeWorkflow());
    client.failUpdateWith = new Error('n8n respondeu HTTP 500');
    await expect(
      service.addNodeToWorkflow('acc-1', { workflowId: 'wf-1', node: HTTP_NODE_SPEC }),
    ).rejects.toThrow(/Não foi possível atualizar o workflow wf-1: n8n respondeu HTTP 500/);
  });

  it('rejeita workflow sem array "nodes" (resposta inesperada da API)', async () => {
    client.seed('wf-1', { id: 'wf-1', name: 'X', connections: {} } as unknown as N8nWorkflow);
    await expect(
      service.addNodeToWorkflow('acc-1', { workflowId: 'wf-1', node: HTTP_NODE_SPEC }),
    ).rejects.toThrow(/sem um array "nodes"/);
    expect(client.updateCalls).toBe(0);
  });

  it('rejeita workflow sem objeto "connections" (resposta inesperada da API)', async () => {
    client.seed('wf-1', { id: 'wf-1', name: 'X', nodes: [] } as unknown as N8nWorkflow);
    await expect(
      service.addNodeToWorkflow('acc-1', { workflowId: 'wf-1', node: HTTP_NODE_SPEC }),
    ).rejects.toThrow(/sem um objeto "connections"/);
    expect(client.updateCalls).toBe(0);
  });

  it('nunca chama o PUT quando a validação incremental falharia', async () => {
    // Um workflow com dois nós de MESMO nome já é um estado que, se
    // replicado ingenuamente, faria o novo nó colidir por acidente — este
    // teste garante que isso nunca chega a acontecer na prática (o gerador
    // de nome sempre desvia), mantendo updateCalls em 1 (sucesso normal).
    client.seed(
      'wf-1',
      makeWorkflow({
        nodes: [
          { id: 'id-A', name: 'A', type: 'x', typeVersion: 1, position: [0, 0], parameters: {} },
        ],
      }),
    );
    await service.addNodeToWorkflow('acc-1', { workflowId: 'wf-1', node: HTTP_NODE_SPEC });
    expect(client.updateCalls).toBe(1);
  });

  it('envia ao n8n um payload sem os campos somente-leitura', async () => {
    client.seed(
      'wf-1',
      makeWorkflow({
        // Simula o que uma API real devolveria no GET, com metadados que
        // nunca devem voltar no corpo do PUT.
        versionId: 'v-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      }),
    );
    await service.addNodeToWorkflow('acc-1', { workflowId: 'wf-1', node: HTTP_NODE_SPEC });

    expect(client.lastUpdatePayload).not.toBeNull();
    expect(client.lastUpdatePayload!.id).toBeUndefined();
    expect(client.lastUpdatePayload!.createdAt).toBeUndefined();
    expect(client.lastUpdatePayload!.updatedAt).toBeUndefined();
    expect(client.lastUpdatePayload!.versionId).toBeUndefined();
    expect(client.lastUpdatePayload!.nodes).toHaveLength(1);
  });

  it('exemplo de uso: adiciona o nó HTTP Request "Webhook Call" descrito no pedido', async () => {
    client.seed(
      'wf-1',
      makeWorkflow({
        nodes: [
          {
            id: 'id-start',
            name: 'Start',
            type: 'n8n-nodes-base.manualTrigger',
            typeVersion: 1,
            position: [500, 300],
            parameters: {},
          },
        ],
      }),
    );

    const result = await service.addNodeToWorkflow('acc-1', {
      workflowId: 'wf-1',
      connectToLastNode: true,
      spacing: 64,
      direction: 'vertical',
      node: {
        name: 'Webhook Call',
        type: 'n8n-nodes-base.httpRequest',
        typeVersion: 4.2,
        parameters: {
          method: 'POST',
          url: 'https://api.exemplo.com/webhook',
          sendBody: true,
          specifyBody: 'json',
          jsonBody: '={{ $json }}',
        },
      },
    });

    const newNode = result.nodes[1];
    expect(newNode).toMatchObject({
      name: 'Webhook Call',
      type: 'n8n-nodes-base.httpRequest',
      typeVersion: 4.2,
      position: [500, 364],
      parameters: {
        method: 'POST',
        url: 'https://api.exemplo.com/webhook',
        sendBody: true,
        specifyBody: 'json',
        jsonBody: '={{ $json }}',
      },
    });
    expect(typeof newNode.id).toBe('string');
    expect(newNode.id.length).toBeGreaterThan(0);
    expect(result.connections.Start.main[0]).toContainEqual({
      node: 'Webhook Call',
      type: 'main',
      index: 0,
    });
  });
});
