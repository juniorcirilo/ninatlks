import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  IDataObject,
  IHookFunctions,
  IHttpRequestOptions,
  INodeType,
  INodeTypeDescription,
  IWebhookFunctions,
  IWebhookResponseData,
} from 'n8n-workflow';
import { NodeOperationError } from 'n8n-workflow';

/** Mesmos eventos de WEBHOOK_EVENTS no servidor (webhook-endpoints.service.ts). */
const EVENTS = [
  { name: 'Ligação finalizada', value: 'call.finished' },
  { name: 'Ligação transferida', value: 'call.transferred' },
  { name: 'Reunião agendada', value: 'meeting.scheduled' },
  { name: 'Reunião reagendada', value: 'meeting.rescheduled' },
  { name: 'Campanha finalizada', value: 'campaign.finished' },
  { name: 'Desfecho do contato alterado', value: 'contact.disposition_changed' },
];

/** Replay: o servidor assina "<timestamp>.<corpo>"; recusa o que for mais velho que isso. */
const MAX_SKEW_SECONDS = 5 * 60;

interface EndpointRow {
  id: string;
  url: string;
  secret: string;
  events: string[];
  active: boolean;
  agent_id: string | null;
}

async function api(
  ctx: IHookFunctions,
  method: IHttpRequestOptions['method'],
  path: string,
  body?: IDataObject,
): Promise<unknown> {
  const creds = await ctx.getCredentials('utalksApi');
  const baseUrl = String(creds.baseUrl ?? '').replace(/\/+$/, '');
  const accountId = encodeURIComponent(String(creds.accountId ?? '').trim());
  const options: IHttpRequestOptions = {
    method,
    url: `${baseUrl}/accounts/${accountId}${path}`,
    json: true,
  };
  if (body) options.body = body;
  return ctx.helpers.httpRequestWithAuthentication.call(ctx, 'utalksApi', options);
}

/** Teste (manual) e produção têm URLs diferentes: cada um guarda o seu destino. */
function slot(ctx: IHookFunctions): 'test' | 'production' {
  return ctx.getMode() === 'manual' ? 'test' : 'production';
}

export class UtalksTrigger implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'utalks Trigger',
    name: 'utalksTrigger',
    icon: 'file:utalks.svg',
    group: ['trigger'],
    version: 1,
    subtitle: '={{($parameter["events"] ?? []).join(", ") || "todos os eventos"}}',
    description: 'Dispara o workflow quando acontece um evento no utalks',
    defaults: { name: 'utalks Trigger' },
    inputs: [],
    outputs: ['main'],
    credentials: [{ name: 'utalksApi', required: true }],
    webhooks: [
      {
        name: 'default',
        httpMethod: 'POST',
        responseMode: 'onReceived',
        path: 'webhook',
      },
    ],
    properties: [
      {
        displayName: 'Eventos',
        name: 'events',
        type: 'multiOptions',
        options: EVENTS,
        default: ['call.finished'],
        description:
          'Selecione um ou mais eventos. Vazio recebe todos. O destino é criado no utalks ao ativar o workflow e removido ao desativar.',
      },
      {
        displayName: 'Opções',
        name: 'options',
        type: 'collection',
        placeholder: 'Adicionar opção',
        default: {},
        options: [
          {
            displayName: 'Somente deste agente (ID da persona)',
            name: 'agentId',
            type: 'string',
            default: '',
            description:
              'Vazio recebe os eventos de todos os agentes. Preenchido, só os do agente informado.',
          },
          {
            displayName: 'Verificar assinatura',
            name: 'verifySignature',
            type: 'boolean',
            default: true,
            description:
              'Confere X-Nina-Signature e rejeita o que não vier do utalks. Mantenha ligado.',
          },
        ],
      },
    ],
  };

  webhookMethods = {
    default: {
      async checkExists(this: IHookFunctions): Promise<boolean> {
        const data = this.getWorkflowStaticData('node');
        const id = data[slot(this)] as string | undefined;
        if (!id) return false;
        const list = (await api(this, 'GET', '/webhook-endpoints')) as EndpointRow[];
        const found = list.find((e) => e.id === id);
        if (!found) {
          delete data[slot(this)];
          delete data[`${slot(this)}Secret`];
          return false;
        }
        // Eventos ou URL mudaram desde a última ativação: alinha o destino.
        const events = this.getNodeParameter('events', []) as string[];
        const url = this.getNodeWebhookUrl('default') as string;
        const same =
          found.url === url &&
          found.active &&
          [...found.events].sort().join() === [...events].sort().join();
        if (!same) {
          await api(this, 'PATCH', `/webhook-endpoints/${id}`, { url, events, active: true });
        }
        data[`${slot(this)}Secret`] = found.secret;
        return true;
      },

      async create(this: IHookFunctions): Promise<boolean> {
        const events = this.getNodeParameter('events', []) as string[];
        const options = this.getNodeParameter('options', {}) as IDataObject;
        const url = this.getNodeWebhookUrl('default') as string;
        const wf = this.getWorkflow();
        const body: IDataObject = {
          name: `n8n: ${wf.name ?? wf.id ?? 'workflow'} (${slot(this)})`.slice(0, 80),
          url,
          method: 'POST',
          events,
          active: true,
        };
        if (options.agentId) body.agent_id = String(options.agentId);

        const created = (await api(this, 'POST', '/webhook-endpoints', body)) as EndpointRow;
        if (!created?.id || !created.secret) {
          throw new NodeOperationError(
            this.getNode(),
            'O utalks não devolveu o destino de webhook criado',
          );
        }
        const data = this.getWorkflowStaticData('node');
        data[slot(this)] = created.id;
        data[`${slot(this)}Secret`] = created.secret;
        return true;
      },

      async delete(this: IHookFunctions): Promise<boolean> {
        const data = this.getWorkflowStaticData('node');
        const id = data[slot(this)] as string | undefined;
        if (id) {
          try {
            await api(this, 'DELETE', `/webhook-endpoints/${id}`);
          } catch {
            // já removido no utalks: nada a desfazer
          }
        }
        delete data[slot(this)];
        delete data[`${slot(this)}Secret`];
        return true;
      },
    },
  };

  async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
    const req = this.getRequestObject();
    const res = this.getResponseObject();
    const options = this.getNodeParameter('options', {}) as IDataObject;
    const verify = options.verifySignature !== false;

    if (verify) {
      const data = this.getWorkflowStaticData('node');
      const secret = (data[this.getMode() === 'manual' ? 'testSecret' : 'productionSecret'] ??
        '') as string;
      const header = String(req.headers['x-nina-signature'] ?? '');
      const timestamp = String(req.headers['x-nina-timestamp'] ?? '');
      const raw = (req as unknown as { rawBody?: Buffer }).rawBody;
      const payload = raw ? raw.toString('utf8') : JSON.stringify(req.body);

      const age = Math.abs(Date.now() / 1000 - Number(timestamp));
      const expected = `sha256=${createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex')}`;
      const a = Buffer.from(header);
      const b = Buffer.from(expected);
      const valid =
        secret !== '' &&
        Number.isFinite(age) &&
        age <= MAX_SKEW_SECONDS &&
        a.length === b.length &&
        timingSafeEqual(a, b);

      if (!valid) {
        res.status(401).json({ ok: false, error: 'assinatura inválida' });
        return { noWebhookResponse: true };
      }
    }

    const body = (req.body ?? {}) as IDataObject;
    return {
      workflowData: [
        [
          {
            json: {
              event: String(req.headers['x-nina-event'] ?? body.event ?? ''),
              deliveryId: String(req.headers['x-nina-delivery'] ?? ''),
              ...body,
            },
          },
        ],
      ],
    };
  }
}
