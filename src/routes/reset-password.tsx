import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { z } from "zod";
import { Loader2, KeyRound } from "lucide-react";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({
    meta: [
      { title: "Redefinir senha — Utalks" },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
  component: ResetPasswordPage,
});

const passwordSchema = z
  .string()
  .min(8, { message: "Mínimo 8 caracteres" })
  .max(72, { message: "Senha muito longa" });

function ResetPasswordPage() {
  const navigate = useNavigate();
  const { refresh } = useAuth();
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (token) {
      setRecoveryReady(true);
    }
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const result = passwordSchema.safeParse(password);
    if (!result.success) {
      setError(result.error.issues[0]?.message ?? "Senha inválida");
      return;
    }
    if (password !== confirm) {
      setError("As senhas não conferem.");
      return;
    }

    setSubmitting(true);
    try {
      const params = new URLSearchParams(window.location.search);
      const token = params.get("token");
      if (!token) {
        setError("Link de redefinição inválido.");
        return;
      }
      await apiClient.post("/auth/reset-password", { token, password: result.data });
      await refresh();
      navigate({ to: "/", replace: true });
    } catch (err: any) {
      setError(err?.body?.message ?? err?.message ?? "Não foi possível atualizar.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div className="pointer-events-none fixed left-0 top-0 z-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-[128px]" />
      <div className="pointer-events-none fixed bottom-0 right-0 z-0 h-[500px] w-[500px] translate-x-1/2 translate-y-1/2 rounded-full bg-accent/10 blur-[128px]" />
      <div className="relative z-10 w-full max-w-md">
        <div className="rounded-2xl border border-border bg-card p-8 shadow-xl">
          <div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-glow">
            <KeyRound className="h-5 w-5" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">Redefinir sua senha</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Escolha uma nova senha para acessar seu painel.
          </p>

          {!recoveryReady && (
            <div className="mt-5 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              Abra esta página pelo link enviado no seu email.
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Nova senha</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!recoveryReady}
                autoComplete="new-password"
                required
                className="h-10 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
              />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Confirmar senha</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                disabled={!recoveryReady}
                autoComplete="new-password"
                required
                className="h-10 w-full rounded-md border border-input bg-secondary/50 px-3 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
              />
            </label>

            {error && (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !recoveryReady}
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-white shadow-[0_8px_24px_rgba(30,95,116,0.18)] transition-all hover:opacity-95 active:scale-95 disabled:opacity-60"
            >
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Atualizar senha
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
