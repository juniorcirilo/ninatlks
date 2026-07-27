import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Mail, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { LegalLayout } from "./privacy";
import { apiClient } from "@/lib/api-client";
import { toast } from "sonner";

export const Route = createFileRoute("/data-deletion")({
  head: () => ({
    meta: [
      { title: "Exclusão de dados — Nina Talks" },
      {
        name: "description",
        content:
          "Solicite a exclusão dos seus dados pessoais da plataforma Nina Talks conforme LGPD/GDPR.",
      },
    ],
  }),
  component: DataDeletionPage,
});

type FormState = "idle" | "submitting" | "done" | "error";

function DataDeletionPage() {
  const [email, setEmail] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [reason, setReason] = useState("");
  const [state, setState] = useState<FormState>("idle");
  const [confirmationId, setConfirmationId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setState("submitting");
    setErrorMsg(null);
    try {
      const data = await apiClient.post<{ ok: boolean; confirmation_id: string }>(
        "/webhooks/meta/data-deletion",
        { email, identifier, reason },
      );
      if (!data?.ok) throw new Error("Resposta inválida");
      setConfirmationId(data.confirmation_id);
      setState("done");
    } catch (err: any) {
      setErrorMsg(err?.body?.message ?? err?.message ?? "Não conseguimos enviar sua solicitação.");
      setState("error");
    }
  }

  return (
    <LegalLayout title="Exclusão de dados" updatedAt="2026-04-20">
      <p>
        Você tem direito de solicitar a exclusão dos dados pessoais que o Nina Talks
        processa sobre você, conforme a Lei Geral de Proteção de Dados (LGPD) e
        o GDPR. Use o formulário abaixo ou envie e-mail para{" "}
        <a href="mailto:privacy@ninatalks.viverdeia.ai" className="text-primary underline">
          privacy@ninatalks.viverdeia.ai
        </a>.
      </p>

      <H2>O que acontece quando você solicita</H2>
      <ul>
        <li>
          Abrimos uma solicitação de exclusão identificada por um código de
          confirmação. Guarde esse código.
        </li>
        <li>
          Em até <strong>15 dias úteis</strong>, confirmamos sua identidade e
          processamos a exclusão dos dados vinculados ao e-mail ou identificador
          informado (@ do Instagram, número de telefone, etc.).
        </li>
        <li>
          Mensagens de conversas que envolvem você são anonimizadas no painel
          dos clientes Nina Talks — o conteúdo textual permanece por obrigação legal
          de guarda, mas sem vincular a você como pessoa.
        </li>
        <li>
          Confirmação final é enviada pelo e-mail informado.
        </li>
      </ul>

      <H2>Dados que podemos precisar manter</H2>
      <p>
        Alguns dados não podem ser excluídos imediatamente por obrigação legal
        (fiscais, segurança contra fraudes, cumprimento de decisão judicial).
        Nesses casos, mantemos pelo prazo mínimo exigido e excluímos após.
      </p>

      <H2>Formulário de solicitação</H2>

      {state === "done" ? (
        <div className="mt-6 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-4">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-300" />
            <div>
              <p className="font-medium text-emerald-200">
                Solicitação recebida
              </p>
              <p className="mt-1 text-sm text-emerald-200/80">
                Seu código de confirmação é{" "}
                <code className="rounded bg-black/40 px-1.5 py-0.5 font-mono">
                  {confirmationId}
                </code>
                . Guarde-o. Em até 15 dias úteis processaremos sua solicitação e
                confirmaremos por e-mail.
              </p>
            </div>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="mt-6 space-y-4">
          <Field
            label="Seu e-mail"
            required
            hint="Vamos usar este e-mail pra confirmar sua identidade."
          >
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="voce@email.com"
              required
              className={inputCls}
            />
          </Field>

          <Field
            label="Identificador adicional (opcional)"
            hint="Ex.: @seu_instagram, +5511999999999 ou e-mail secundário que conversou com alguma empresa usando Nina Talks."
          >
            <input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="@usuario ou +5511..."
              className={inputCls}
            />
          </Field>

          <Field
            label="Motivo (opcional)"
            hint="Não exigimos justificativa, mas nos ajuda a melhorar."
          >
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Ex.: não uso mais, preocupação com privacidade, etc."
              className={`${inputCls} h-auto py-3`}
            />
          </Field>

          {errorMsg && (
            <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={state === "submitting" || !email}
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-500 to-fuchsia-500 text-sm font-semibold text-white shadow-lg transition-opacity hover:opacity-95 disabled:opacity-60"
          >
            {state === "submitting" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Mail className="h-4 w-4" />
            )}
            Enviar solicitação
          </button>

          <p className="text-[11px] text-muted-foreground">
            Ao enviar, você autoriza o Nina Talks a processar esta solicitação
            conforme nossa{" "}
            <a href="/privacy" className="underline">Política de Privacidade</a>.
          </p>
        </form>
      )}
    </LegalLayout>
  );
}

const inputCls =
  "h-11 w-full rounded-md border border-white/[0.08] bg-white/[0.02] px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30";

function Field({
  label,
  required,
  hint,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-center gap-1 text-xs font-medium text-muted-foreground">
        {label}
        {required && <span className="text-rose-400">*</span>}
      </span>
      {children}
      {hint && <span className="block text-[10px] text-muted-foreground">{hint}</span>}
    </label>
  );
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="mt-8 text-lg font-semibold text-foreground">{children}</h2>
  );
}
