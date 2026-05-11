import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { LoginSignupForm, type AuthMode } from "@/components/auth/LoginSignupForm";
import {
  acceptInviteByToken,
  getInvitePreview,
  type InvitePreview,
} from "@/lib/team";

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
  const { session, loading: authLoading } = useAuth();
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
    (supabase as any)
      .from("system_settings")
      .select("registration_enabled")
      .limit(1)
      .maybeSingle()
      .then(({ data, error: err }: { data: { registration_enabled: boolean } | null; error: Error | null }) => {
        if (cancelled) return;
        if (err) {
          // Em caso de falha de leitura, mantém permissivo.
          setSignupOpen(true);
        } else {
          setSignupOpen(data ? Boolean(data.registration_enabled) : true);
        }
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
  //  - com invite válido → tenta aceitar e manda para /
  useEffect(() => {
    if (authLoading || !session) return;
    if (inviteToken && invitePreview) {
      acceptInviteByToken(inviteToken)
        .then(() => navigate({ to: "/", replace: true }))
        .catch((err: Error) => {
          // Se já é membro, o RPC retorna o accountId sem erro. Aqui só
          // capturamos token expirado/inválido.
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
        const signUpData: Record<string, string> = { name: nameResult.data };
        if (inviteToken) {
          signUpData.invite_token = inviteToken;
        }
        const { error: err } = await supabase.auth.signUp({
          email: emailResult.data,
          password: passwordResult.data,
          options: {
            emailRedirectTo: `${window.location.origin}/`,
            data: signUpData,
          },
        });
        if (err) throw err;
        setInfo("Confira seu e-mail para confirmar a conta.");
      } else {
        const { error: err } = await supabase.auth.signInWithPassword({
          email: emailResult.data,
          password: passwordResult.data,
        });
        if (err) throw err;
      }
    } catch (err) {
      setError(err instanceof Error ? traduzirErro(err.message) : "Algo deu errado.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleMagicLink = async () => {
    reset();
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      setError("Digite seu e-mail para receber o link mágico.");
      return;
    }
    setSubmitting(true);
    try {
      const { error: err } = await supabase.auth.signInWithOtp({
        email: emailResult.data,
        options: { emailRedirectTo: `${window.location.origin}/` },
      });
      if (err) throw err;
      setInfo("Enviamos um link pro seu e-mail. Confira a caixa de entrada.");
    } catch (err) {
      setError(err instanceof Error ? traduzirErro(err.message) : "Não conseguimos enviar.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    reset();
    const emailResult = emailSchema.safeParse(email);
    if (!emailResult.success) {
      setError("Digite seu e-mail primeiro para recuperar a senha.");
      return;
    }
    setSubmitting(true);
    try {
      const { error: err } = await supabase.auth.resetPasswordForEmail(emailResult.data, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (err) throw err;
      setInfo("Enviamos instruções de recuperação pro seu e-mail.");
    } catch (err) {
      setError(err instanceof Error ? traduzirErro(err.message) : "Não foi possível enviar.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-5">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-violet-600/[0.12] blur-[150px]" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[420px] w-[420px] rounded-full bg-fuchsia-600/[0.10] blur-[150px]" />

      <div className="w-full max-w-[860px]">
        {inviteToken && (
          <div className="mx-auto mb-4 max-w-md rounded-xl border border-violet-500/40 bg-violet-500/10 px-4 py-3 text-center text-sm font-medium text-violet-900 dark:text-violet-100">
            {previewLoading ? (
              "Validando convite..."
            ) : invitePreview ? (
              <>
                Você foi convidado para o workspace{" "}
                <strong>{invitePreview.account_name}</strong> como{" "}
                <strong>{invitePreview.role}</strong>
                {invitePreview.email_hint && (
                  <span className="mt-1 block text-xs text-violet-700 dark:text-violet-200/80">
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
  if (m.includes("invalid login")) return "E-mail ou senha incorretos.";
  if (m.includes("already registered") || m.includes("already exists"))
    return "Este e-mail já está cadastrado. Faça login.";
  if (m.includes("password") && m.includes("pwned"))
    return "Esta senha já vazou em outros sites. Escolha outra.";
  if (m.includes("rate limit"))
    return "Muitas tentativas. Aguarde alguns segundos e tente novamente.";
  if (m.includes("cadastros desativados"))
    return "Este app é privado. Solicite um convite ao administrador.";
  if (m.includes("database error saving new user"))
    return "Este app é privado. Solicite um convite ao administrador.";
  if (m.includes("email")) return "E-mail inválido.";
  return message;
}
