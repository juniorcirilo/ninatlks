import { Bot, Megaphone, PhoneCall, Sparkles } from "lucide-react";

export function WelcomeStep() {
  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-gradient-primary">
          <Sparkles className="h-6 w-6 text-primary-foreground" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Bem-vindo ao Nina Talks</h2>
          <p className="text-sm text-muted-foreground">
            Agente de SDR por voz — atende inbound, qualifica leads e agenda
            reuniões. Vamos configurar passo a passo.
          </p>
        </div>
      </div>

      <div className="space-y-2.5 text-sm">
        <Item
          icon={Bot}
          title="Agente IA personalizado"
          description="Você cria a persona (prompt + voz) e ela responde sozinha no tom certo."
        />
        <Item
          icon={PhoneCall}
          title="Telefone, WhatsApp, Instagram"
          description="Tudo que o cliente fala (mensagem ou voz) cai numa única caixa de entrada."
        />
        <Item
          icon={Megaphone}
          title="Campanhas em massa"
          description="Mensagens e ligações em lote disparadas pela mesma persona."
        />
      </div>

      <div className="rounded-md border border-primary/20 bg-primary/[0.06] p-3 text-[12px] text-foreground/80">
        <strong className="font-semibold text-primary">O que vamos fazer:</strong>{" "}
        nome da empresa, suas keys da ElevenLabs (voz), Twilio (telefonia),
        Deepgram (transcrição) e Evolution (WhatsApp). Por fim, criar o
        primeiro agente. Pode pular qualquer passo e voltar depois.
      </div>
    </div>
  );
}

function Item({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-md border border-gray-200 dark:border-slate-800 bg-muted/40 p-3">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <h4 className="text-[13px] font-semibold">{title}</h4>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}
