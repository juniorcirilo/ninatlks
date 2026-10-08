// Geração de skills pelo IA Agent: o agente analisa a descrição do agente
// (nome + "o que faz") e devolve nome, quando-usar e instruções em Markdown.

export interface GeneratedSkill {
  name: string;
  description: string;
  body: string;
}

export interface SkillAuthorContext {
  /** o agente pode consultar bancos de dados do cliente (somente leitura) */
  hasDbTools?: boolean;
  /** tamanho de resposta configurado para o agente ("curta"|"media"|"longa") */
  replyLength?: string;
}

/**
 * Monta o prompt de geração já descrevendo COMO o agente realmente opera no
 * utalks (texto curto de WhatsApp, sem código, skill global sempre aplicada,
 * ferramentas de banco quando houver) — para a skill gerada combinar com o
 * comportamento de verdade, não com um atendimento genérico qualquer.
 */
export function buildSkillAuthorPrompt(
  name: string,
  description: string,
  ctx: SkillAuthorContext = {},
): string {
  return [
    'Você é um especialista em escrever SKILLS de atendimento para o IA Agent deste sistema.',
    'Analise o agente descrito abaixo e crie UMA skill que ensine um agente de atendimento a fazer exatamente o que ele se propõe.',
    '',
    `## Agente\nNome: ${name.trim()}\nO que faz: ${description.trim()}`,
    '',
    '## Como este agente realmente atende (a skill deve combinar com isso)',
    '- O canal é WhatsApp: mensagens de texto curtas, uma de cada vez, nunca várias perguntas seguidas.',
    `- O tamanho de resposta configurado é "${ctx.replyLength ?? 'curta'}" — a skill não deve pedir respostas mais longas que isso.`,
    '- Há uma regra fixa do sistema, sempre aplicada, que proíbe qualquer menção, geração ou explicação de código, comandos, SQL, scripts ou qualquer coisa técnica ao cliente — a skill deve ser compatível com essa regra, nunca contradizê-la.',
    ctx.hasDbTools
      ? '- Este agente TEM ferramentas de consulta a banco de dados (somente leitura, já filtradas pelo cliente da conversa). Se o atendimento descrito envolve buscar um dado do cliente (ex.: saldo, pedido, cadastro), oriente o agente a usar essas ferramentas e traduzir o resultado em linguagem simples — nunca mostrar a consulta nem termos técnicos ao cliente.'
      : '- Este agente NÃO tem ferramentas de banco de dados. Se o atendimento depender de um dado que o agente não tem, oriente a perguntar ao cliente ou passar para um humano — nunca inventar o dado.',
    '',
    '## O que a skill deve ter',
    '- name: nome curto da skill (até 60 caracteres), em português.',
    '- description: UMA frase dizendo QUANDO usar a skill (o agente decide pelo texto dela).',
    '- body: instruções em Markdown, em português, objetivas, com as seções: **Objetivo**, **Quando atuar**, **Como atender** (passos numerados), **Perguntas úteis**, **Tom de voz**, **Quando passar para um humano**, **Exemplos curtos** (2 trocas de mensagem, no formato de mensagem de WhatsApp).',
    '',
    '## Regras',
    '- Não invente dados da empresa (preços, prazos, políticas); se faltar informação, oriente a perguntar ao cliente ou passar para um humano.',
    '- A skill NÃO pode orientar nada relacionado a código, scripts, comandos, arquivos ou ferramentas técnicas — nem mesmo "para resolver isso, rode tal consulta".',
    '- Escreva em texto de atendimento (WhatsApp): frases curtas, sem jargão.',
    '- body com no máximo 3000 caracteres.',
    '',
    'Responda APENAS com um objeto JSON válido, sem texto antes ou depois e sem cercas de código, neste formato:',
    '{"name": "...", "description": "...", "body": "..."}',
  ].join('\n');
}

/** Extrai o primeiro objeto JSON da resposta (tolera cercas ``` e texto em volta). */
export function parseGeneratedSkill(text: string): GeneratedSkill {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start)
    throw new Error('o IA Agent não devolveu um JSON de skill');
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    throw new Error('JSON de skill inválido');
  }
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  const description =
    typeof raw.description === 'string' ? raw.description.trim() : '';
  const body = typeof raw.body === 'string' ? raw.body.trim() : '';
  if (!name || !description || !body)
    throw new Error('a skill gerada veio incompleta (name/description/body)');
  return {
    name: name.slice(0, 120),
    description: description.slice(0, 500),
    body: body.slice(0, 20000),
  };
}
