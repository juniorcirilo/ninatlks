// Plain-text instructions for each provider the admin might need to set up.
// Used by the IntegrationsTab settings page (the onboarding wizard now embeds
// these instructions inline via ProviderKeyStep).
//
// Keys são salvas no workspace (Vault da conta) via setAccountSecretsBulk —
// não em variáveis de ambiente do projeto.

export type ProviderKey =
  | "elevenlabs"
  | "twilio"
  | "evolution"
  | "deepgram";

export interface ProviderGuide {
  label: string;
  what: string;          // one-liner: what is this provider for?
  secrets: { name: string; description: string }[];
  steps: string[];       // ordered "how to get the key" instructions
  dashboardUrl?: string; // direct link to provider's API/keys page
  docsUrl?: string;      // optional further reading
}

export const PROVIDER_GUIDES: Record<ProviderKey, ProviderGuide> = {
  elevenlabs: {
    label: "ElevenLabs",
    what: "Voz IA realista para ligações e mensagens em áudio.",
    secrets: [
      { name: "api_key", description: "API key da sua conta ElevenLabs (xi_...)" },
    ],
    steps: [
      "Acesse https://elevenlabs.io/app/settings/api-keys e faça login.",
      "Clique em 'Create API Key' e copie o valor (xi_...).",
      "Cole na tela de configuração do workspace.",
      "Clique em 'Salvar e testar'.",
    ],
    dashboardUrl: "https://elevenlabs.io/app/settings/api-keys",
    docsUrl: "https://elevenlabs.io/docs/api-reference/authentication",
  },
  twilio: {
    label: "Twilio",
    what: "Telefonia: discagem, recebimento de chamadas e SMS.",
    secrets: [
      { name: "account_sid", description: "SID da sua conta Twilio (AC...)" },
      { name: "auth_token", description: "Auth Token da conta" },
    ],
    steps: [
      "Acesse https://console.twilio.com e faça login.",
      "Na home do console, copie o Account SID (AC...) e o Auth Token.",
      "Cole os dois na tela de configuração do workspace.",
      "Carregue saldo na conta (mínimo USD 5 recomendado).",
      "Clique em 'Salvar e testar'.",
    ],
    dashboardUrl: "https://console.twilio.com",
    docsUrl: "https://www.twilio.com/docs/iam/access-tokens",
  },
  evolution: {
    label: "Evolution API (WhatsApp Web)",
    what: "Conexão WhatsApp via QR Code (não-oficial). Configurada por canal.",
    secrets: [], // Per-account — lives on the channel row, not in env
    steps: [
      "Tenha um servidor Evolution rodando (URL e API key globais).",
      "Vá em Canais → Adicionar WhatsApp → escolha 'WhatsApp via QR'.",
      "Informe a URL do servidor e a global API key (AUTHENTICATION_API_KEY).",
      "Escaneie o QR code que aparecer com o WhatsApp do celular.",
    ],
  },
  deepgram: {
    label: "Deepgram",
    what: "Transcrição de áudio (voz → texto) para mensagens recebidas.",
    secrets: [
      { name: "api_key", description: "API key da Deepgram" },
    ],
    steps: [
      "Acesse https://console.deepgram.com.",
      "Crie um projeto se ainda não tiver.",
      "Em 'API Keys', gere uma chave nova.",
      "Cole na tela de configuração do workspace e clique 'Salvar e testar'.",
    ],
    dashboardUrl: "https://console.deepgram.com",
  },
};

/** Maps the keys returned by `integrations-status` into a guide. */
export function guideForKey(key: string): ProviderGuide | null {
  if (key in PROVIDER_GUIDES) return PROVIDER_GUIDES[key as ProviderKey];
  return null;
}

