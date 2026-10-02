import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { apiClient } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-context";
import { LoginSignupForm, type AuthMode } from "@/components/auth/LoginSignupForm";
import { acceptInviteByToken, getInvitePreview, type InvitePreview } from "@/lib/team";

const searchSchema = z.object({
  invite: z.string().optional(),
});

export const Route = createFileRoute("/auth")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Entrar — Nina Talks" },
      {
        name: "description",
        content: "Acesse o painel do agente de SDR por voz.",
      },
    ],
  }),
  component: AuthPage,
});

const emailSchema = z.string().trim().email({ message: "E-mail inválido" }).max(255);
const passwordSchema = z
  .string()
  .min(8, { message: "A senha precisa ter no mínimo 8 caracteres" })
  .max(72, { message: "Senha muito longa" });
const nameSchema = z
  .string()
  .trim()
  .min(2, { message: "Informe seu nome" })
  .max(80, { message: "Nome muito longo" });

function AuthPage() {
  const { session, loading: authLoading, refresh } = useAuth();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const inviteToken = search.invite ?? null;

  // signupOpen=true → ainda não existe admin, 1º signup permitido.
  // Quando false e sem invite → só login.
  const [signupOpen, setSignupOpen] = useState<boolean>(false);
  const [signupOpenLoaded, setSignupOpenLoaded] = useState(false);

  const [mode, setMode] = useState<AuthMode>(inviteToken ? "signup" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [invitePreview, setInvitePreview] = useState<InvitePreview | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Lê o toggle de registro. Se a row não existe, default = habilitado.
  useEffect(() => {
    let cancelled = false;
    apiClient
      .get<{ registrationEnabled: boolean }>("/system-settings")
      .then((data) => {
        if (cancelled) return;
        setSignupOpen(data.registrationEnabled);
        setSignupOpenLoaded(true);
      })
      .catch(() => {
        if (cancelled) return;
        // Em caso de falha de leitura, mantém permissivo.
        setSignupOpen(true);
        setSignupOpenLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Se signup não é mais permitido (e não há invite), força a aba de login.
  useEffect(() => {
    if (signupOpenLoaded && !signupOpen && !inviteToken && mode === "signup") {
      setMode("login");
    }
  }, [signupOpenLoaded, signupOpen, inviteToken, mode]);

  // Carrega preview do convite (nome do workspace, role) sem precisar logar.
  useEffect(() => {
    if (!inviteToken) {
      setInvitePreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    getInvitePreview(inviteToken)
      .then((p) => {
        if (cancelled) return;
        if (!p) {
          setError("Este convite não existe, foi revogado ou expirou.");
        }
        setInvitePreview(p);
      })
      .catch(() => {
        if (!cancelled) setError("Não foi possível validar o convite.");
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  // Se já está logado:
  //  - sem invite → manda para /
  //  - com invite válido (workspace DIFERENTE) → aceita e manda para /
  useEffect(() => {
    if (authLoading || !session) return;
    if (inviteToken && invitePreview) {
      acceptInviteByToken(inviteToken)
        .then(() => navigate({ to: "/", replace: true }))
        .catch((err: Error) => {
          setError(err.message);
        });
      return;
    }
    navigate({ to: "/", replace: true });
  }, [session, authLoading, navigate, inviteToken, invitePreview]);

  const reset = () => {
    setError(null);
    setInfo(null);
  };

  const handleToggle = (next: AuthMode) => {
    reset();
    setMode(next);
  };

  const handleSubmit = async () => {
    reset();
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      setError(emailResult.error.issues[0]?.message ?? "E-mail inválido");
      return;
    }
    const passwordResult = passwordSchema.safeParse(password);
    if (!passwordResult.success) {
      setError(passwordResult.error.issues[0]?.message ?? "Senha inválida");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "signup") {
        const nameResult = nameSchema.safeParse(name);
        if (!nameResult.success) {
          setError(nameResult.error.issues[0]?.message ?? "Nome inválido");
          return;
        }
        if (inviteToken) {
          await apiClient.post("/auth/invites/accept", {
            token: inviteToken,
            name: nameResult.data,
            password: passwordResult.data,
          });
        } else {
          await apiClient.post("/auth/register", {
            email: emailResult.data,
            name: nameResult.data,
            password: passwordResult.data,
          });
        }
        await refresh();
      } else {
        await apiClient.post("/auth/login", {
          email: emailResult.data,
          password: passwordResult.data,
        });
        await refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? traduzirErro(err.message) : "Algo deu errado.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleMagicLink = () => {
    reset();
    setInfo("Login por link mágico ainda não está disponível — use e-mail e senha.");
  };

  const handleForgotPassword = () => {
    reset();
    setInfo("Recuperação de senha ainda não está disponível. Fale com um administrador.");
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
      <div className="pointer-events-none fixed left-0 top-0 z-0 h-[500px] w-[500px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/20 blur-[128px]" />
      <div className="pointer-events-none fixed bottom-0 right-0 z-0 h-[500px] w-[500px] translate-x-1/2 translate-y-1/2 rounded-full bg-accent/10 blur-[128px]" />

      <div className="w-full max-w-[860px]">
        {inviteToken && (
          <div className="mx-auto mb-4 max-w-md rounded-xl border border-cyan-500/40 bg-cyan-500/10 px-4 py-3 text-center text-sm font-medium text-cyan-900 dark:text-cyan-100">
            {previewLoading ? (
              "Validando convite..."
            ) : invitePreview ? (
              <>
                Você foi convidado para o workspace <strong>{invitePreview.account_name}</strong>{" "}
                como <strong>{invitePreview.role}</strong>
                {invitePreview.email_hint && (
                  <span className="mt-1 block text-xs text-cyan-700 dark:text-cyan-200/80">
                    Convite enviado para {invitePreview.email_hint}
                  </span>
                )}
              </>
            ) : (
              "Convite inválido ou expirado."
            )}
          </div>
        )}

        <LoginSignupForm
          mode={mode}
          onToggle={handleToggle}
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          name={name}
          setName={setName}
          error={error}
          info={info}
          submitting={submitting}
          inviteToken={inviteToken ?? undefined}
          signupAllowed={signupOpen}
          onSubmit={handleSubmit}
          onMagicLink={handleMagicLink}
          onForgotPassword={handleForgotPassword}
        />
      </div>
    </div>
  );
}

function traduzirErro(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid credentials")) return "E-mail ou senha incorretos.";
  if (m.includes("already exists")) return "Este e-mail já está cadastrado. Faça login.";
  if (m.includes("rate limit"))
    return "Muitas tentativas. Aguarde alguns segundos e tente novamente.";
  if (m.includes("cadastros desativados"))
    return "Este app é privado. Solicite um convite ao administrador.";
  if (m.includes("email")) return "E-mail inválido.";
  return message;
}
