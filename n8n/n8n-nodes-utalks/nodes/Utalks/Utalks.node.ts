import type {
  IDataObject,
  IExecuteFunctions,
  IHttpRequestOptions,
  INodeExecutionData,
  INodeProperties,
  INodeType,
  INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';
import { OPERATIONS, RESOURCES } from './operations';

const CUSTOM = 'custom';

const PATH_PARAM_LABEL: Record<string, string> = {
  id: 'ID',
  batchId: 'ID do lote',
  listId: 'ID da lista',
  contactId: 'ID do contato',
  conversationId: 'ID da conversa',
  voiceId: 'ID da voz',
  agentId: 'ID do agente na ElevenLabs',
  channelId: 'ID do canal',
  provider: 'Provedor',
  keyName: 'Nome da chave',
};

function labelOf(param: string): string {
  return PATH_PARAM_LABEL[param] ?? param;
}

/** Um campo por parâmetro de caminho, só nas operações que o usam. */
function buildProperties(): INodeProperties[] {
  const props: INodeProperties[] = [
    {
      displayName: 'Recurso',
      name: 'resource',
      type: 'options',
      noDataExpression: true,
      options: [...RESOURCES, { name: 'Requisição personalizada', value: CUSTOM }],
      default: 'contact',
    },
  ];

  for (const resource of RESOURCES) {
    const ops = OPERATIONS.filter((o) => o.resource === resource.value);
    props.push({
      displayName: 'Operação',
      name: 'operation',
      type: 'options',
      noDataExpression: true,
      displayOptions: { show: { resource: [resource.value] } },
      options: ops.map((o) => ({
        name: o.name,
        value: o.value,
        description: `${o.method} /accounts/{conta}${o.path === '/' ? '' : o.path}`,
        action: o.name,
      })),
      default: ops[0].value,
    });
  }

  // Parâmetros de caminho
  const pathParams = new Set(OPERATIONS.flatMap((o) => o.pathParams));
  for (const param of pathParams) {
    const using = OPERATIONS.filter((o) => o.pathParams.includes(param));
    const byResource = new Map<string, string[]>();
    for (const o of using) {
      byResource.set(o.resource, [...(byResource.get(o.resource) ?? []), o.value]);
    }
    for (const [resource, operations] of byResource) {
      props.push({
        displayName: labelOf(param),
        name: `p_${param}`,
        type: 'string',
        required: true,
        default: '',
        displayOptions: { show: { resource: [resource], operation: operations } },
      });
    }
  }

  // Query string e corpo
  for (const resource of RESOURCES) {
    const queryOps = OPERATIONS.filter((o) => o.resource === resource.value && o.query).map(
      (o) => o.value,
    );
    if (queryOps.length) {
      props.push({
        displayName: 'Parâmetros de consulta',
        name: 'query',
        type: 'fixedCollection',
        typeOptions: { multipleValues: true },
        placeholder: 'Adicionar parâmetro',
        default: {},
        description: 'Filtros e paginação, ex.: limit, direction, contactId',
        displayOptions: { show: { resource: [resource.value], operation: queryOps } },
        options: [
          {
            name: 'items',
            displayName: 'Parâmetro',
            values: [
              { displayName: 'Nome', name: 'name', type: 'string', default: '' },
              { displayName: 'Valor', name: 'value', type: 'string', default: '' },
            ],
          },
        ],
      });
    }
    const bodyOps = OPERATIONS.filter((o) => o.resource === resource.value && o.body).map(
      (o) => o.value,
    );
    if (bodyOps.length) {
      props.push({
        displayName: 'Corpo (JSON)',
        name: 'body',
        type: 'json',
        default: '{}',
        description: 'Campos enviados ao utalks, no formato da API',
        displayOptions: { show: { resource: [resource.value], operation: bodyOps } },
      });
    }
  }

  // Requisição personalizada: qualquer rota sob /accounts/{conta}
  props.push(
    {
      displayName: 'Método',
      name: 'customMethod',
      type: 'options',
      options: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].map((m) => ({ name: m, value: m })),
      default: 'GET',
      displayOptions: { show: { resource: [CUSTOM] } },
    },
    {
      displayName: 'Caminho',
      name: 'customPath',
      type: 'string',
      default: '/contacts',
      placeholder: '/contacts',
      description: 'Relativo a /accounts/{conta}. Use / para a própria conta.',
      displayOptions: { show: { resource: [CUSTOM] } },
    },
    {
      displayName: 'Parâmetros de consulta',
      name: 'customQuery',
      type: 'json',
      default: '{}',
      displayOptions: { show: { resource: [CUSTOM] } },
    },
    {
      displayName: 'Corpo (JSON)',
      name: 'customBody',
      type: 'json',
      default: '{}',
      displayOptions: {
        show: { resource: [CUSTOM], customMethod: ['POST', 'PATCH', 'PUT'] },
      },
    },
  );

  props.push({
    displayName: 'Opções',
    name: 'options',
    type: 'collection',
    placeholder: 'Adicionar opção',
    default: {},
    options: [
      {
        displayName: 'ID da conta (substitui a da credencial)',
        name: 'accountId',
        type: 'string',
        default: '',
      },
      {
        displayName: 'Retornar um item por elemento da lista',
        name: 'splitArray',
        type: 'boolean',
        default: true,
        description:
          'Quando a resposta é uma lista, devolve cada elemento como um item separado',
      },
    ],
  });

  return props;
}

export class Utalks implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'utalks',
    name: 'utalks',
    icon: 'file:utalks.svg',
    group: ['transform'],
    version: 1,
    subtitle: '={{$parameter["resource"] + ": " + ($parameter["operation"] ?? $parameter["customPath"])}}',
    description:
      'Contatos, ligações, campanhas, agentes, reuniões, mensagens, cadências e pipeline do utalks',
    defaults: { name: 'utalks' },
    inputs: ['main'],
    outputs: ['main'],
    usableAsTool: true,
    credentials: [{ name: 'utalksApi', required: true }],
    properties: buildProperties(),
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const out: INodeExecutionData[] = [];
    const creds = await this.getCredentials('utalksApi');
    const baseUrl = String(creds.baseUrl ?? '').replace(/\/+$/, '');

    for (let i = 0; i < items.length; i++) {
      try {
        const resource = this.getNodeParameter('resource', i) as string;
        const options = this.getNodeParameter('options', i, {}) as IDataObject;
        const accountId = String(options.accountId || creds.accountId || '').trim();
        if (!accountId) {
          throw new NodeOperationError(
            this.getNode(),
            'Informe o ID da conta na credencial ou nas opções do node',
            { itemIndex: i },
          );
        }

        let method: IHttpRequestOptions['method'];
        let path: string;
        let qs: IDataObject = {};
        let body: IDataObject | undefined;

        if (resource === CUSTOM) {
          method = this.getNodeParameter('customMethod', i) as IHttpRequestOptions['method'];
          path = String(this.getNodeParameter('customPath', i)).trim();
          qs = parseJson(this, this.getNodeParameter('customQuery', i, '{}'), 'Parâmetros de consulta', i);
          if (method !== 'GET' && method !== 'DELETE') {
            body = parseJson(this, this.getNodeParameter('customBody', i, '{}'), 'Corpo', i);
          }
        } else {
          const operation = this.getNodeParameter('operation', i) as string;
          const def = OPERATIONS.find((o) => o.resource === resource && o.value === operation);
          if (!def) {
            throw new NodeOperationError(this.getNode(), `Operação desconhecida: ${operation}`, {
              itemIndex: i,
            });
          }
          method = def.method;
          path = def.path;
          for (const param of def.pathParams) {
            const value = String(this.getNodeParameter(`p_${param}`, i)).trim();
            path = path.replace(`:${param}`, encodeURIComponent(value));
          }
          if (def.query) {
            const q = this.getNodeParameter('query', i, {}) as {
              items?: Array<{ name: string; value: string }>;
            };
            for (const it of q.items ?? []) if (it.name) qs[it.name] = it.value;
          }
          if (def.body) {
            body = parseJson(this, this.getNodeParameter('body', i, '{}'), 'Corpo', i);
          }
        }

        const normalized = path === '/' || path === '' ? '' : path.startsWith('/') ? path : `/${path}`;
        const requestOptions: IHttpRequestOptions = {
          method,
          url: `${baseUrl}/accounts/${encodeURIComponent(accountId)}${normalized}`,
          qs,
          json: true,
          // CSV e áudio não são JSON: devolve o corpo como veio.
          returnFullResponse: false,
        };
        if (body !== undefined) requestOptions.body = body;

        const response = await this.helpers.httpRequestWithAuthentication.call(
          this,
          'utalksApi',
          requestOptions,
        );

        const split = options.splitArray !== false;
        if (Array.isArray(response) && split) {
          for (const el of response) {
            out.push({ json: asObject(el), pairedItem: { item: i } });
          }
        } else {
          out.push({ json: asObject(response), pairedItem: { item: i } });
        }
      } catch (error) {
        if (this.continueOnFail()) {
          out.push({
            json: { error: (error as Error).message },
            pairedItem: { item: i },
          });
          continue;
        }
        if (error instanceof NodeOperationError) throw error;
        throw new NodeApiError(this.getNode(), error as never, { itemIndex: i });
      }
    }
    return [out];
  }
}

function asObject(value: unknown): IDataObject {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as IDataObject;
  }
  return { data: value as IDataObject[keyof IDataObject] };
}

function parseJson(
  ctx: IExecuteFunctions,
  raw: unknown,
  label: string,
  itemIndex: number,
): IDataObject {
  if (raw === undefined || raw === null || raw === '') return {};
  if (typeof raw === 'object') return raw as IDataObject;
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    return (parsed ?? {}) as IDataObject;
  } catch {
    throw new NodeOperationError(ctx.getNode(), `${label}: JSON inválido`, { itemIndex });
  }
}
