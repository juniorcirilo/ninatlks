import { createFileRoute } from "@tanstack/react-router";
import { LegalLayout } from "./privacy";

export const Route = createFileRoute("/terms")({
  head: () => ({
    meta: [
      { title: "Termos de Uso — Nina Talks" },
      {
        name: "description",
        content:
          "Termos e condições de uso da plataforma Nina Talks (agente de SDR por voz com IA).",
      },
    ],
  }),
  component: TermsPage,
});

function TermsPage() {
  return (
    <LegalLayout title="Termos de Uso" updatedAt="2026-04-20">
      <p>
        Ao criar uma conta no Nina Talks e usar a plataforma, você concorda com estes
        termos. Leia com atenção. Se discordar de qualquer ponto, não use o
        serviço.
      </p>

      <H2>1. Objeto</H2>
      <p>
        O Nina Talks fornece uma plataforma SaaS de SDR por voz: atende
        ligações inbound, qualifica leads automaticamente, agenda reuniões e
        entrega briefing pra atendentes humanos. Inclui canais complementares
        (WhatsApp, Instagram, Messenger, SMS) e automações de follow-up.
      </p>

      <H2>2. Cadastro e conta</H2>
      <p>
        Você é responsável por manter suas credenciais seguras e por toda
        atividade realizada na sua conta. Notifique imediatamente qualquer
        acesso não autorizado. O primeiro usuário de uma conta vira administrador
        e pode convidar outros membros com papéis de admin ou usuário comum.
      </p>

      <H2>3. Uso permitido</H2>
      <p>
        Você pode usar o Nina Talks para atender clientes que tenham iniciado contato
        ou autorizado receber mensagens suas, respeitando:
      </p>
      <ul>
        <li>Políticas da Meta, Twilio e demais provedores de canais.</li>
        <li>Código de Defesa do Consumidor, LGPD e legislação aplicável.</li>
        <li>Horários permitidos de contato configurados na plataforma.</li>
        <li>
          Direito de descadastramento (STOP em SMS, lista de não-ligar em voz).
        </li>
      </ul>

      <H2>4. Uso proibido</H2>
      <ul>
        <li>Spam, phishing, fraude ou discurso de ódio.</li>
        <li>Contato fora dos horários permitidos por lei.</li>
        <li>Contato com números em listas de não-ligar (DNC).</li>
        <li>
          Uso para atividades ilegais ou práticas abusivas de prospecção
          (chamadas em massa fora de horário permitido, contato com listas
          DNC, etc).
        </li>
        <li>Engenharia reversa, cópia ou revenda do serviço.</li>
      </ul>

      <H2>5. Integrações de terceiros</H2>
      <p>
        Conectar Meta, Twilio, ElevenLabs, Deepgram ou outros provedores
        implica aceitar também os termos desses serviços. O Nina Talks não
        se responsabiliza por indisponibilidades ou mudanças de política
        desses terceiros.
      </p>

      <H2>6. IA e resultados</H2>
      <p>
        Os agentes de IA são ferramentas de apoio. Você é responsável por
        revisar, aprovar e configurar os comportamentos permitidos. A IA pode
        cometer erros; recomendamos supervisão humana para interações
        críticas.
      </p>

      <H2>7. Propriedade intelectual</H2>
      <p>
        Código, design e marca do Nina Talks pertencem aos seus autores. Conteúdo
        gerado na sua conta (conversas, automações, configurações) pertence a
        você e é processado conforme nossa{" "}
        <a href="/privacy" className="text-primary underline">Política de Privacidade</a>.
      </p>

      <H2>8. Disponibilidade</H2>
      <p>
        Nos esforçamos para manter o serviço disponível, mas não garantimos
        100% de uptime. Manutenções programadas serão comunicadas quando
        possível.
      </p>

      <H2>9. Limitação de responsabilidade</H2>
      <p>
        Nenhuma das partes será responsável por danos indiretos, lucros
        cessantes ou perdas decorrentes de caso fortuito, força maior ou falha
        de terceiros. A responsabilidade máxima do Nina Talks limita-se ao valor
        pago nos últimos 12 meses.
      </p>

      <H2>10. Encerramento</H2>
      <p>
        Você pode encerrar sua conta a qualquer momento pelo painel. Podemos
        suspender ou encerrar contas que violem estes termos. Após encerramento,
        dados são anonimizados em 30 dias (ver Privacidade).
      </p>

      <H2>11. Alterações</H2>
      <p>
        Podemos alterar estes termos. Mudanças serão comunicadas por e-mail aos
        administradores com 15 dias de antecedência. O uso continuado após a
        data efetiva implica aceitação.
      </p>

      <H2>12. Lei aplicável</H2>
      <p>
        Regidos pela lei brasileira. Foro da Comarca da sede do fornecedor,
        salvo direito do consumidor aplicável.
      </p>

      <H2>13. Contato</H2>
      <p>
        Dúvidas sobre os termos:{" "}
        <a href="mailto:legal@ninatalks.viverdeia.ai" className="text-primary underline">
          legal@ninatalks.viverdeia.ai
        </a>.
      </p>
    </LegalLayout>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 text-lg font-semibold text-foreground">{children}</h2>
  );
}
