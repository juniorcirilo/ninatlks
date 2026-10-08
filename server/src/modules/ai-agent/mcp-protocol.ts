// Servidor MCP mínimo (JSON-RPC 2.0 sobre HTTP, "streamable HTTP" sem SSE):
// initialize, ping, tools/list e tools/call. Sem dependência do Nest para
// poder ser testado com o OpenCode CLI de verdade.

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolResult {
  text: string;
  isError?: boolean;
}

export interface McpBackend {
  listTools(): Promise<McpTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult>;
}

export interface McpHttpResponse {
  status: number;
  body?: unknown;
}

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05'];

const rpcError = (id: unknown, code: number, message: string) => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

/** Trata UMA mensagem JSON-RPC (ou um lote) e devolve a resposta HTTP. */
export async function handleMcp(
  payload: unknown,
  backend: McpBackend,
): Promise<McpHttpResponse> {
  if (Array.isArray(payload)) {
    const out = (await Promise.all(payload.map((m) => handleMcp(m, backend))))
      .map((r) => r.body)
      .filter((b) => b !== undefined);
    return out.length ? { status: 200, body: out } : { status: 202 };
  }
  if (!payload || typeof payload !== 'object')
    return { status: 400, body: rpcError(null, -32600, 'Invalid Request') };

  const msg = payload as {
    id?: string | number;
    method?: string;
    params?: Record<string, unknown>;
  };
  const isNotification = msg.id === undefined || msg.id === null;
  if (typeof msg.method !== 'string')
    return isNotification
      ? { status: 202 }
      : { status: 200, body: rpcError(msg.id, -32600, 'Invalid Request') };

  // Notificações (ex.: notifications/initialized) não têm resposta.
  if (isNotification) return { status: 202 };

  try {
    switch (msg.method) {
      case 'initialize': {
        const asked =
          typeof msg.params?.protocolVersion === 'string'
            ? msg.params.protocolVersion
            : '';
        return ok(msg.id, {
          protocolVersion: SUPPORTED.includes(asked) ? asked : SUPPORTED[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'utalks-tools', version: '1.0.0' },
        });
      }
      case 'ping':
        return ok(msg.id, {});
      case 'tools/list':
        return ok(msg.id, { tools: await backend.listTools() });
      case 'tools/call': {
        const name =
          typeof msg.params?.name === 'string' ? msg.params.name : '';
        const args =
          (msg.params?.arguments as Record<string, unknown> | undefined) ?? {};
        const r = await backend.callTool(name, args);
        return ok(msg.id, {
          content: [{ type: 'text', text: r.text }],
          isError: r.isError === true,
        });
      }
      default:
        return {
          status: 200,
          body: rpcError(msg.id, -32601, `Method not found: ${msg.method}`),
        };
    }
  } catch (err) {
    return {
      status: 200,
      body: rpcError(msg.id, -32603, (err as Error).message.slice(0, 300)),
    };
  }
}

function ok(id: unknown, result: unknown): McpHttpResponse {
  return { status: 200, body: { jsonrpc: '2.0', id, result } };
}
