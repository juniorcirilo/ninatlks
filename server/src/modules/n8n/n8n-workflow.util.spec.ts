import type { N8nConnections, N8nNode, N8nWorkflow } from './n8n-client.service';
import {
  appendNodeConnection,
  calculateNodePosition,
  deepEqual,
  findLastNode,
  generateUniqueNodeName,
  sanitizeWorkflowForUpdate,
  validateIncrementalUpdate,
} from './n8n-workflow.util';

function makeNode(
  name: string,
  position: [number, number],
  overrides: Partial<N8nNode> = {},
): N8nNode {
  return {
    id: `id-${name}`,
    name,
    type: 'n8n-nodes-base.noOp',
    typeVersion: 1,
    position,
    parameters: {},
    ...overrides,
  };
}

function makeWorkflow(nodes: N8nNode[], connections: N8nConnections = {}): N8nWorkflow {
  return {
    id: 'wf-1',
    name: 'Utalks',
    active: true,
    nodes,
    connections,
    settings: { executionOrder: 'v1' },
  };
}

describe('generateUniqueNodeName', () => {
  it('devolve o nome pedido quando ele ainda não existe', () => {
    const nodes = [makeNode('A', [0, 0])];
    expect(generateUniqueNodeName(nodes, 'Webhook Call')).toBe('Webhook Call');
  });

  it('sufixa " 2" quando o nome já existe', () => {
    const nodes = [makeNode('Webhook Call', [0, 0])];
    expect(generateUniqueNodeName(nodes, 'Webhook Call')).toBe('Webhook Call 2');
  });

  it('avança o sufixo até achar um nome livre', () => {
    const nodes = [
      makeNode('Webhook Call', [0, 0]),
      makeNode('Webhook Call 2', [0, 64]),
      makeNode('Webhook Call 3', [0, 128]),
    ];
    expect(generateUniqueNodeName(nodes, 'Webhook Call')).toBe('Webhook Call 4');
  });

  it('nunca renomeia os nós existentes — só decide o nome do novo', () => {
    const nodes = [makeNode('Webhook Call', [0, 0])];
    const before = structuredClone(nodes);
    generateUniqueNodeName(nodes, 'Webhook Call');
    expect(nodes).toEqual(before);
  });
});

describe('findLastNode', () => {
  it('devolve null para workflow vazio', () => {
    expect(findLastNode([], 'vertical')).toBeNull();
  });

  it('direção vertical: nó de maior Y', () => {
    const a = makeNode('A', [100, 0]);
    const b = makeNode('B', [0, 500]);
    const c = makeNode('C', [50, 200]);
    expect(findLastNode([a, b, c], 'vertical')).toBe(b);
  });

  it('direção horizontal: nó de maior X', () => {
    const a = makeNode('A', [100, 0]);
    const b = makeNode('B', [500, 10]);
    const c = makeNode('C', [50, 200]);
    expect(findLastNode([a, b, c], 'horizontal')).toBe(b);
  });
});

describe('calculateNodePosition', () => {
  it('workflow vazio (lastNode null) => [0, 0]', () => {
    expect(calculateNodePosition(null, { spacing: 64, direction: 'vertical' })).toEqual([0, 0]);
  });

  it('vertical desloca 64px no eixo Y, mantendo X', () => {
    const last = makeNode('Last', [500, 300]);
    expect(calculateNodePosition(last, { spacing: 64, direction: 'vertical' })).toEqual([
      500, 364,
    ]);
  });

  it('horizontal desloca no eixo X, mantendo Y', () => {
    const last = makeNode('Last', [500, 300]);
    expect(calculateNodePosition(last, { spacing: 64, direction: 'horizontal' })).toEqual([
      564, 300,
    ]);
  });

  it('respeita um spacing customizado', () => {
    const last = makeNode('Last', [0, 0]);
    expect(calculateNodePosition(last, { spacing: 300, direction: 'vertical' })).toEqual([
      0, 300,
    ]);
  });
});

describe('appendNodeConnection', () => {
  it('cria a conexão quando o nó de origem não tinha nenhuma', () => {
    const result = appendNodeConnection({}, 'A', 'B');
    expect(result).toEqual({
      A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
    });
  });

  it('preserva conexões existentes no mesmo slot e acrescenta a nova', () => {
    const existing: N8nConnections = {
      A: { main: [[{ node: 'X', type: 'main', index: 0 }]] },
    };
    const result = appendNodeConnection(existing, 'A', 'B');
    expect(result.A.main[0]).toEqual([
      { node: 'X', type: 'main', index: 0 },
      { node: 'B', type: 'main', index: 0 },
    ]);
    // não muta o original
    expect(existing.A.main[0]).toEqual([{ node: 'X', type: 'main', index: 0 }]);
  });

  it('preserva outros slots de saída (ex.: ramo "false" de um IF) intocados', () => {
    const existing: N8nConnections = {
      A: {
        main: [
          [{ node: 'TrueBranch', type: 'main', index: 0 }],
          [{ node: 'FalseBranch', type: 'main', index: 0 }],
        ],
      },
    };
    const result = appendNodeConnection(existing, 'A', 'NewNode');
    expect(result.A.main[1]).toEqual([{ node: 'FalseBranch', type: 'main', index: 0 }]);
    expect(result.A.main[0]).toEqual([
      { node: 'TrueBranch', type: 'main', index: 0 },
      { node: 'NewNode', type: 'main', index: 0 },
    ]);
  });

  it('preserva outros tipos de saída no mesmo nó (ex.: ai_tool)', () => {
    const existing: N8nConnections = {
      A: { ai_tool: [[{ node: 'Tool', type: 'ai_tool', index: 0 }]] },
    };
    const result = appendNodeConnection(existing, 'A', 'B');
    expect(result.A.ai_tool).toEqual([[{ node: 'Tool', type: 'ai_tool', index: 0 }]]);
    expect(result.A.main).toEqual([[{ node: 'B', type: 'main', index: 0 }]]);
  });

  it('não duplica quando a conexão já existe', () => {
    const existing: N8nConnections = {
      A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
    };
    const result = appendNodeConnection(existing, 'A', 'B');
    expect(result).toBe(existing); // devolve o mesmo objeto — nada mudou
    expect(result.A.main[0]).toHaveLength(1);
  });

  it('preserva as conexões de outros nós de origem, não só o alvo', () => {
    const existing: N8nConnections = {
      A: { main: [[{ node: 'X', type: 'main', index: 0 }]] },
      Z: { main: [[{ node: 'Y', type: 'main', index: 0 }]] },
    };
    const result = appendNodeConnection(existing, 'A', 'B');
    expect(result.Z).toEqual(existing.Z);
  });
});

describe('sanitizeWorkflowForUpdate', () => {
  it('remove os campos somente-leitura e preserva o resto, sem mutar a entrada', () => {
    const wf: N8nWorkflow = {
      id: 'wf-1',
      name: 'Utalks',
      nodes: [makeNode('A', [0, 0])],
      connections: {},
      settings: { executionOrder: 'v1' },
      staticData: { foo: 'bar' },
      pinData: { A: [{ json: {} }] },
      meta: { templateId: 'x' },
      tags: ['prod'],
      versionId: 'v-123',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    };
    const payload = sanitizeWorkflowForUpdate(wf);

    // somente-leitura: nunca vão no corpo do PUT
    expect(payload.id).toBeUndefined();
    expect(payload.createdAt).toBeUndefined();
    expect(payload.updatedAt).toBeUndefined();
    expect(payload.versionId).toBeUndefined();
    // confirmado contra instância real: a API rejeita estes dois campos no
    // PUT ("read-only") mesmo devolvendo-os no GET — não fazem parte do que
    // este endpoint aceita de volta.
    expect(payload.meta).toBeUndefined();
    expect(payload.tags).toBeUndefined();

    // o PUT aceita estes campos — confirmado por sonda direta na API real
    expect(payload.name).toBe('Utalks');
    expect(payload.nodes).toEqual(wf.nodes);
    expect(payload.settings).toEqual({ executionOrder: 'v1' });
    expect(payload.staticData).toEqual({ foo: 'bar' });
    expect(payload.pinData).toEqual({ A: [{ json: {} }] });

    // não mutou o original
    expect(wf.id).toBe('wf-1');
  });

  it('não envia campos que o workflow original não tinha', () => {
    const wf: N8nWorkflow = {
      id: 'wf-1',
      name: 'Utalks',
      nodes: [],
      connections: {},
    };
    const payload = sanitizeWorkflowForUpdate(wf);
    expect(Object.keys(payload).sort()).toEqual(['connections', 'name', 'nodes']);
  });

  it('descarta campos desconhecidos — o schema do PUT real é estrito (additionalProperties: false)', () => {
    const wf = {
      id: 'wf-1',
      name: 'Utalks',
      nodes: [],
      connections: {},
      triggerCount: 3,
      isArchived: false,
    } as unknown as N8nWorkflow;
    const payload = sanitizeWorkflowForUpdate(wf);
    expect(payload.triggerCount).toBeUndefined();
    expect(payload.isArchived).toBeUndefined();
  });
});

describe('deepEqual', () => {
  it('true para objetos estruturalmente iguais, mesmo com chaves em ordens diferentes', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('false quando um valor aninhado difere', () => {
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
  });

  it('compara arrays por posição', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2, 3], [1, 3, 2])).toBe(false);
  });
});

describe('validateIncrementalUpdate', () => {
  it('aceita quando exatamente um nó novo foi acrescentado ao final', () => {
    const original = makeWorkflow([makeNode('A', [0, 0])]);
    const updated = makeWorkflow([makeNode('A', [0, 0]), makeNode('B', [0, 64])]);
    expect(() => validateIncrementalUpdate(original, updated)).not.toThrow();
  });

  it('rejeita quando um nó existente foi alterado', () => {
    const original = makeWorkflow([makeNode('A', [0, 0])]);
    const tampered = makeNode('A', [0, 0]);
    tampered.parameters = { changed: true };
    const updated = makeWorkflow([tampered, makeNode('B', [0, 64])]);
    expect(() => validateIncrementalUpdate(original, updated)).toThrow(/nó existente/);
  });

  it('rejeita quando um nó existente foi removido', () => {
    const original = makeWorkflow([makeNode('A', [0, 0]), makeNode('B', [0, 64])]);
    const updated = makeWorkflow([makeNode('A', [0, 0]), makeNode('C', [0, 128])]);
    expect(() => validateIncrementalUpdate(original, updated)).toThrow();
  });

  it('rejeita quando mais de um nó foi acrescentado', () => {
    const original = makeWorkflow([makeNode('A', [0, 0])]);
    const updated = makeWorkflow([
      makeNode('A', [0, 0]),
      makeNode('B', [0, 64]),
      makeNode('C', [0, 128]),
    ]);
    expect(() => validateIncrementalUpdate(original, updated)).toThrow(/esperava 2/);
  });

  it('rejeita id do novo nó igual a um id existente', () => {
    const original = makeWorkflow([makeNode('A', [0, 0])]);
    const clashing = makeNode('B', [0, 64], { id: 'id-A' });
    const updated = makeWorkflow([makeNode('A', [0, 0]), clashing]);
    expect(() => validateIncrementalUpdate(original, updated)).toThrow(/id do novo nó/);
  });

  it('rejeita nome do novo nó igual a um nome existente', () => {
    const original = makeWorkflow([makeNode('A', [0, 0])]);
    const clashing = makeNode('A', [0, 64], { id: 'id-outro' });
    const updated = makeWorkflow([makeNode('A', [0, 0]), clashing]);
    expect(() => validateIncrementalUpdate(original, updated)).toThrow(/nome do novo nó/);
  });

  it('rejeita posição inválida no novo nó', () => {
    const original = makeWorkflow([makeNode('A', [0, 0])]);
    const bad = makeNode('B', [NaN, 0]);
    const updated = makeWorkflow([makeNode('A', [0, 0]), bad]);
    expect(() => validateIncrementalUpdate(original, updated)).toThrow(/posição inválida/);
  });

  it('rejeita workflow atualizado sem array "nodes"', () => {
    const original = makeWorkflow([makeNode('A', [0, 0])]);
    const updated = { ...original, nodes: undefined } as unknown as N8nWorkflow;
    expect(() => validateIncrementalUpdate(original, updated)).toThrow(/"nodes"/);
  });

  it('rejeita workflow atualizado sem objeto "connections"', () => {
    const original = makeWorkflow([makeNode('A', [0, 0])]);
    const updated = {
      ...original,
      nodes: [...original.nodes, makeNode('B', [0, 64])],
      connections: undefined,
    } as unknown as N8nWorkflow;
    expect(() => validateIncrementalUpdate(original, updated)).toThrow(/"connections"/);
  });

  it('aceita quando uma conexão nova foi acrescentada sem remover as antigas', () => {
    const original = makeWorkflow(
      [makeNode('A', [0, 0])],
      { A: { main: [[{ node: 'X', type: 'main', index: 0 }]] } },
    );
    const updated = makeWorkflow(
      [makeNode('A', [0, 0]), makeNode('B', [0, 64])],
      {
        A: {
          main: [
            [
              { node: 'X', type: 'main', index: 0 },
              { node: 'B', type: 'main', index: 0 },
            ],
          ],
        },
      },
    );
    expect(() => validateIncrementalUpdate(original, updated)).not.toThrow();
  });

  it('rejeita quando uma conexão existente foi removida', () => {
    const original = makeWorkflow(
      [makeNode('A', [0, 0])],
      { A: { main: [[{ node: 'X', type: 'main', index: 0 }]] } },
    );
    const updated = makeWorkflow(
      [makeNode('A', [0, 0]), makeNode('B', [0, 64])],
      { A: { main: [[{ node: 'B', type: 'main', index: 0 }]] } }, // "X" sumiu
    );
    expect(() => validateIncrementalUpdate(original, updated)).toThrow(/existia antes e sumiu/);
  });

  it('as conexões anteriores continuam presentes depois da atualização válida', () => {
    const original = makeWorkflow(
      [makeNode('A', [0, 0]), makeNode('B', [0, 64])],
      {
        A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
      },
    );
    const updated = makeWorkflow(
      [...original.nodes, makeNode('C', [0, 128])],
      {
        A: { main: [[{ node: 'B', type: 'main', index: 0 }]] },
        B: { main: [[{ node: 'C', type: 'main', index: 0 }]] },
      },
    );
    expect(() => validateIncrementalUpdate(original, updated)).not.toThrow();
    for (const [from, entry] of Object.entries(original.connections)) {
      expect(updated.connections[from]).toBeDefined();
      for (const [type, slots] of Object.entries(entry)) {
        for (const conn of slots[0]) {
          expect(updated.connections[from][type][0]).toContainEqual(conn);
        }
      }
    }
  });

  it('comparação profunda: os nós anteriores continuam bit-a-bit iguais', () => {
    const original = makeWorkflow([
      makeNode('A', [0, 0]),
      makeNode('B', [200, 0], { notes: 'importante', disabled: false }),
    ]);
    const updated = makeWorkflow([...original.nodes, makeNode('C', [400, 0])]);
    expect(() => validateIncrementalUpdate(original, updated)).not.toThrow();
    expect(updated.nodes.slice(0, original.nodes.length)).toEqual(original.nodes);
  });
});
