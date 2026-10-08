import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { callChatCompletion } from '../../common/llm/providers';
import {
  LlmNotConfiguredError,
  resolveLlmConfig,
  secretsBundle,
} from '../../common/llm/resolve-llm-config';
import { AI_AGENT_SECRET_PROVIDER } from '../../common/llm/ai-agent-runtime';
import type { DraftTemplate } from './dto/send-message.dto';

const SCHEMAS: Record<string, string> = {
  buttons:
    '{"title": "até 60 caracteres", "description": "texto até 600 caracteres", "footer": "opcional, até 60", "buttons": [{"text": "até 25", "value": "url, telefone ou código quando o botão for de ação"}]}',
  list: '{"title": "até 60", "description": "até 600", "footer": "opcional", "buttonText": "até 20, ex.: Ver opções", "rows": [{"title": "até 24", "description": "até 72, opcional"}]}',
  image_buttons:
    '{"title": "até 60", "description": "legenda até 600", "footer": "opcional", "buttons": [{"text": "até 25", "value": "..."}]}',
  video_buttons:
    '{"title": "até 60", "description": "legenda até 600", "footer": "opcional", "buttons": [{"text": "até 25", "value": "..."}]}',
  pix: '{"title": "ex.: Pagamento via PIX", "description": "mensagem curta pedindo o pagamento, até 400", "footer": "opcional", "beneficiary": "nome do recebedor, só se citado", "amount": "valor como 150,00, só se citado", "key": "chave PIX, só se citada"}',
  link_image_buttons:
    '{"title": "até 60", "description": "legenda até 500", "footer": "opcional", "link": "URL completa, só se citada", "buttons": [{"text": "até 25", "value": "..."}]}',
};

const FIELDS = (f: string) =>
  `{"title": "até 60", "description": "até 500, sem repetir os campos abaixo", "footer": "opcional", "fields": ${f}, "buttons": [{"text": "até 25", "value": "..."}]}`;

Object.assign(SCHEMAS, {
  coupon: FIELDS('{"code": "código do cupom, só se citado", "validity": "ex.: até 31/10, opcional"}'),
  promo: FIELDS('{"priceFrom": "preço antigo, só se citado", "priceTo": "preço promocional, só se citado", "validity": "opcional"}'),
  launch: FIELDS('{}'),
  event: FIELDS('{"date": "data e hora, só se citadas", "place": "local, só se citado"}'),
  booking: FIELDS('{"date": "data e hora, só se citadas", "place": "local, opcional"}'),
  nps: '{"title": "até 60", "description": "pergunta curta, até 300", "footer": "opcional", "buttonText": "até 20, ex.: Avaliar", "rows": [{"title": "até 24, ex.: ⭐⭐⭐⭐⭐ Excelente", "description": "opcional"}]}',
  review: FIELDS('{}'),
  cart: FIELDS('{}'),
});

const HINTS: Record<DraftTemplate, string> = {
  buttons: 'mensagem com botões',
  list: 'mensagem de lista de opções (2 a 6 itens)',
  image_buttons: 'mensagem com imagem e botões (a imagem será anexada depois)',
  video_buttons: 'mensagem com vídeo e botões (o vídeo será anexado depois)',
  pix: 'cobrança por PIX (a chave será copiável por um botão)',
  link_image_buttons:
    'mensagem com imagem, um link e botões (a imagem será anexada depois)',
  coupon: 'marketing: cupom de desconto (um botão "Copiar cupom" é adicionado sozinho; use botões extras só se pedido, ex.: link da loja)',
  promo: 'marketing: promoção/oferta com preço de e por (imagem opcional)',
  launch: 'marketing: lançamento de produto ou serviço, com chamada para ação',
  event: 'marketing: convite para evento com confirmação de presença',
  booking: 'confirmação ou lembrete de agendamento (confirmar, remarcar, cancelar)',
  nps: 'pesquisa de satisfação em lista com notas de 1 a 5 (do pior ao melhor, com estrelas)',
  review: 'pedido de avaliação (ex.: Google) com botão de link',
  cart: 'recuperação de carrinho abandonado, tom leve, sem pressão',
};

export interface InteractiveDraft {
  title: string;
  description: string;
  footer?: string;
  buttonText?: string;
  buttons?: { text: string; value?: string }[];
  rows?: { title: string; description?: string }[];
  beneficiary?: string;
  amount?: string;
  key?: string;
  link?: string;
  fields?: Record<string, string>;
}

const cut = (v: unknown, n: number): string =>
  typeof v === 'string' ? v.trim().slice(0, n) : '';

@Injectable()
export class InteractiveDraftService {
  constructor(private readonly dataSource: DataSource) {}

  async draft(
    accountId: string,
    template: DraftTemplate,
    prompt: string,
    buttonMode: 'reply' | 'action' = 'reply',
  ): Promise<InteractiveDraft> {
    const modeRule =
      template === 'list' || template === 'nps' || template === 'pix'
        ? ''
        : buttonMode === 'reply'
          ? 'Os botões são de RESPOSTA RÁPIDA: só "text", sem "value". Máximo 3.'
          : 'Os botões são de AÇÃO: "value" é obrigatório e deve ser uma URL https, um telefone só com dígitos (com DDI) ou um código a copiar, conforme o texto do botão. Máximo 3.';
    const system = [
      'Você escreve mensagens de WhatsApp para atendimento comercial em português do Brasil.',
      `Tipo: ${HINTS[template]}. ${modeRule}`,
      'Responda SOMENTE com um objeto JSON válido, sem markdown, neste formato (omita campos opcionais sem conteúdo):',
      SCHEMAS[template],
      'Tom cordial e direto. Nunca invente dados pessoais, chaves PIX, valores ou links que o usuário não informou.',
    ].join('\n');

    const raw = await this.complete(accountId, system, prompt);
    const m = /\{[\s\S]*\}/.exec(raw);
    if (!m) throw new BadRequestException('A IA não retornou um rascunho válido.');
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(m[0]) as Record<string, unknown>;
    } catch {
      throw new BadRequestException('A IA não retornou um rascunho válido.');
    }
    const arr = (v: unknown): Record<string, unknown>[] =>
      Array.isArray(v) ? (v as Record<string, unknown>[]) : [];
    return {
      title: cut(j.title, 60),
      description: cut(j.description, 1024),
      footer: cut(j.footer, 60) || undefined,
      buttonText: cut(j.buttonText, 20) || undefined,
      buttons: arr(j.buttons)
        .slice(0, 3)
        .map((b) => ({ text: cut(b.text, 25), value: cut(b.value, 500) })),
      rows: arr(j.rows)
        .slice(0, 10)
        .map((r) => ({ title: cut(r.title, 24), description: cut(r.description, 72) })),
      beneficiary: cut(j.beneficiary, 60) || undefined,
      amount: cut(j.amount, 20) || undefined,
      key: cut(j.key, 140) || undefined,
      link: cut(j.link, 500) || undefined,
      fields: Object.fromEntries(
        Object.entries(
          j.fields && typeof j.fields === 'object' ? (j.fields as object) : {},
        )
          .filter(([k, v]) => /^[a-zA-Z]{2,20}$/.test(k) && typeof v === 'string')
          .map(([k, v]) => [k, cut(v, 200)]),
      ),
    };
  }

  private async complete(
    accountId: string,
    system: string,
    user: string,
  ): Promise<string> {
    const messages = [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ];
    try {
      const own = await secretsBundle(
        this.dataSource,
        accountId,
        AI_AGENT_SECRET_PROVIDER,
      );
      if (own.base_url && own.model_id) {
        return await callChatCompletion({
          provider: 'lovable',
          baseUrl: own.base_url.replace(/\/+$/, ''),
          apiKey: own.api_key ?? '',
          model: own.model_id,
          temperature: 0.7,
          maxTokens: 900,
          messages,
        });
      }
    } catch {
      /* cai para o provedor padrão */
    }
    try {
      const cfg = await resolveLlmConfig(this.dataSource, accountId);
      return await callChatCompletion({
        provider: cfg.provider,
        baseUrl: cfg.baseUrl,
        apiKey: cfg.apiKey,
        model: cfg.model,
        temperature: 0.7,
        maxTokens: 900,
        messages,
      });
    } catch (err) {
      if (err instanceof LlmNotConfiguredError)
        throw new BadRequestException(err.message);
      throw new BadRequestException(
        `Falha ao gerar com a IA: ${(err as Error).message}`,
      );
    }
  }
}
