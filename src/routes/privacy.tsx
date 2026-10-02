import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Nina Talks" },
      {
        name: "description",
        content:
          "Como o Nina Talks coleta, processa e protege dados pessoais de leads atendidos pelo agente de SDR por voz.",
      },
    ],
  }),
  component: PrivacyPage,
});

function PrivacyPage() {
  return (
    <LegalLayout title="Política de Privacidade" updatedAt="2026-04-27">
      <p>
        O Nina Talks é uma plataforma de SDR (Sales Development Representative)
        por voz com IA. Atende ligações inbound de leads, qualifica a
        oportunidade, agenda reuniões com a equipe comercial da empresa cliente
        e dispara follow-ups por voz e mensagem. Esta política descreve quais
        dados pessoais tratamos, para quais finalidades, com quem
        compartilhamos e quais são os direitos do titular, em conformidade com
        a Lei Geral de Proteção de Dados (Lei nº 13.709/2018).
      </p>

      <H2>1. Dados que tratamos</H2>
      <p>
        <strong>Do titular lead:</strong> nome, telefone, e-mail, empresa e
        cargo (quando informados pelo próprio lead durante a conversa),
        gravações das chamadas, transcrição, sentimento agregado, classificação
        de fit/qualificação gerada pela IA, briefing entregue ao atendente
        humano, agendamentos e participações em reuniões.
      </p>
      <p>
        <strong>De usuários operadores:</strong> nome, e-mail, papel de acesso.
      </p>

      <H2>2. Base legal</H2>
      <ul>
        <li>
          <strong>Consentimento</strong> (art. 7º, I, LGPD): o lead inicia o
          contato e, ao continuar a ligação após o aviso de gravação, autoriza
          o tratamento dos dados conversacionais.
        </li>
        <li>
          <strong>Legítimo interesse</strong> (art. 7º, IX): qualificação do
          lead, geração de briefing e follow-ups operacionais relacionados a
          uma reunião agendada.
        </li>
        <li>
          <strong>Cumprimento de obrigação legal</strong> (art. 7º, II):
          retenção mínima de registros de comunicação e consentimento de
          gravação.
        </li>
      </ul>

      <H2>3. Finalidades</H2>
      <ul>
        <li>
          Atender ligações inbound com agente de IA, qualificar a oportunidade
          e agendar reunião com humano da equipe comercial.
        </li>
        <li>
          Disparar lembrete de reunião 15 minutos antes do horário agendado.
        </li>
        <li>
          Em caso de no-show, ligar para entender o motivo e remarcar.
        </li>
        <li>
          Enviar follow-ups configurados pela empresa cliente por voz, e-mail
          ou WhatsApp.
        </li>
        <li>
          Registrar e auditar o histórico de tentativas de contato e
          resultados.
        </li>
      </ul>

      <H2>4. Gravação de chamadas</H2>
      <p>
        Toda ligação efetuada pelo Nina Talks inicia com aviso verbal de que
        pode ser gravada. A gravação e sua transcrição são utilizadas para
        análise de sentimento, qualificação automática do lead, geração do
        briefing entregue ao atendente humano, treinamento do agente e
        resolução de disputas. Gravações são retidas pelo prazo configurado
        pela empresa cliente (padrão: 90 dias) e excluídas automaticamente
        após esse período.
      </p>

      <H2>5. Direito de oposição (DNC)</H2>
      <p>
        A qualquer momento o titular pode solicitar a remoção do seu número da
        lista de contato dizendo frases como &ldquo;não me ligue mais&rdquo;,
        &ldquo;remova meu número&rdquo; ou &ldquo;tira da lista&rdquo;. Ao
        detectar o pedido, a plataforma inclui automaticamente o número na
        DNC (Do Not Call) da empresa cliente e cancela todas as tentativas
        pendentes. O bloqueio é imediato e permanente até revogação expressa
        do próprio titular.
      </p>

      <H2>6. Janela legal de contato</H2>
      <p>
        O Nina Talks respeita, por padrão, janela de contato aceita no mercado
        brasileiro: segunda a sexta das 8h às 20h e sábado das 8h às 14h, não
        ligando em domingos nem feriados nacionais. Os disparos outbound
        (lembretes T-15 min, retry de no-show, follow-ups) também respeitam a
        janela. Ligações inbound são atendidas a qualquer momento.
      </p>

      <H2>7. Compartilhamento</H2>
      <p>
        Os dados pessoais podem ser compartilhados com os seguintes
        operadores:
      </p>
      <ul>
        <li>
          <strong>Provedores de voz:</strong> Twilio (telefonia) e ElevenLabs
          (síntese de voz + agente conversacional).
        </li>
        <li>
          <strong>Provedor de WhatsApp:</strong> Evolution API (instância da
          empresa cliente).
        </li>
        <li>
          <strong>Provedor de e-mail:</strong> Resend (envio de mensagens
          transacionais).
        </li>
        <li>
          <strong>Infra:</strong> Supabase (banco de dados) e Cloudflare
          (borda).
        </li>
      </ul>

      <H2>8. Direitos do titular</H2>
      <p>
        O titular pode solicitar confirmação, acesso, correção, portabilidade,
        eliminação e informação sobre compartilhamento dos seus dados,
        entrando em contato pelo e-mail informado pela empresa cliente ou por
        nossa página de{" "}
        <Link to="/data-deletion" className="underline">
          exclusão de dados
        </Link>
        .
      </p>

      <H2>9. Segurança</H2>
      <p>
        Aplicamos controles de segurança alinhados a boas práticas:
        criptografia em trânsito (TLS) e em repouso, isolamento por RLS no
        banco de dados, acesso mediante autenticação e registro de auditoria.
      </p>

      <H2>10. Contato do encarregado</H2>
      <p>
        Para dúvidas sobre esta política ou exercício de direitos, o
        encarregado pode ser contatado pelo e-mail cadastrado pela empresa
        cliente em Configurações → Geral → E-mail de suporte.
      </p>
    </LegalLayout>
  );
}

export function LegalLayout({
  title,
  updatedAt,
  children,
}: {
  title: string;
  updatedAt: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-gray-200 dark:border-slate-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
          <Link to="/" className="text-sm font-semibold tracking-tight">
            Nina Talks
          </Link>
          <div className="flex gap-4 text-xs text-muted-foreground">
            <Link to="/privacy" className="hover:text-foreground">
              Privacidade
            </Link>
            <Link to="/terms" className="hover:text-foreground">
              Termos
            </Link>
            <Link to="/data-deletion" className="hover:text-foreground">
              Exclusão de dados
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-2 text-xs text-muted-foreground">
          Última atualização: {new Date(updatedAt).toLocaleDateString("pt-BR")}
        </p>
        <div className="prose prose-invert mt-8 max-w-none space-y-4 text-sm leading-relaxed text-foreground/90">
          {children}
        </div>
      </main>

      <footer className="border-t border-gray-200 dark:border-slate-800">
        <div className="mx-auto max-w-3xl px-6 py-6 text-center text-xs text-muted-foreground">
          © {new Date().getFullYear()} Nina Talks — Agente de SDR por voz
        </div>
      </footer>
    </div>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 text-lg font-semibold text-foreground">{children}</h2>
  );
}
