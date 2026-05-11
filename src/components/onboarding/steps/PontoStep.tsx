import { CheckCircle2, Inbox, Sparkles, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";

export function PontoStep({ onClose }: { onClose: () => void }) {
  return (
    <div className="space-y-5">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700">
          <CheckCircle2 className="h-6 w-6" />
        </div>
        <div>
          <h2 className="text-xl font-semibold">Tudo pronto pra começar</h2>
          <p className="text-sm text-muted-foreground">
            Você terminou o setup inicial. Agora é a parte boa: usar.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <Cta
          icon={Upload}
          title="Importar contatos"
          description="Suba um CSV pra começar a disparar campanhas."
          href="/contacts"
        />
        <Cta
          icon={Inbox}
          title="Ver caixa de entrada"
          description="Acompanhe as conversas em tempo real."
          href="/inbox"
        />
      </div>

      <div className="rounded-md border border-violet-500/20 bg-primary/5 p-3 text-[12px] text-muted-foreground">
        <div className="mb-1 flex items-center gap-1.5 font-semibold text-primary/80">
          <Sparkles className="h-3.5 w-3.5" />
          Dica
        </div>
        Você pode reabrir esse setup a qualquer momento pelo widget no canto
        inferior. Ainda faltam passos? Vão aparecer lá com 1 clique pra continuar.
      </div>

      <Button onClick={onClose} className="w-full">
        Fechar e começar a usar
      </Button>
    </div>
  );
}

function Cta({
  icon: Icon,
  title,
  description,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  href: string;
}) {
  return (
    <a
      href={href}
      className="flex flex-col gap-2 rounded-md border border-border bg-muted/40 p-3 transition-colors hover:border-primary/40 hover:bg-primary/5"
    >
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon className="h-4 w-4" />
      </div>
      <div>
        <h4 className="text-sm font-semibold">{title}</h4>
        <p className="mt-0.5 text-[12px] text-muted-foreground">{description}</p>
      </div>
    </a>
  );
}
