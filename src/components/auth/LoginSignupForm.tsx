import { ArrowRight, Loader2, Lock, Mail, User, UserPlus } from "lucide-react";
import { UtalksLogo } from "@/components/brand/UtalksLogo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type AuthMode = "login" | "signup";

export type LoginSignupFormProps = {
  mode: AuthMode;
  onToggle: (mode: AuthMode) => void;
  email: string;
  setEmail: (v: string) => void;
  password: string;
  setPassword: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  error: string | null;
  info: string | null;
  submitting: boolean;
  inviteToken?: string;
  /** True quando ainda não existe nenhum admin (1º signup permitido). */
  signupAllowed: boolean;
  onSubmit: () => void;
  onMagicLink: () => void;
  onForgotPassword: () => void;
};

/**
 * Auth card simplificado: um único painel com tabs no topo (Entrar / Criar conta).
 * Sem animações desencontradas — o estado visível sempre bate com o `mode`,
 * evitando o bug onde o título dizia "Entrar" mas a validação de signup rodava.
 */
export function LoginSignupForm(props: LoginSignupFormProps) {
  const {
    mode,
    onToggle,
    email,
    setEmail,
    password,
    setPassword,
    name,
    setName,
    error,
    info,
    submitting,
    inviteToken,
    signupAllowed,
    onSubmit,
    onMagicLink,
    onForgotPassword,
  } = props;

  // "Criar conta" só aparece quando faz sentido: há convite OU ainda não existe admin.
  const canSignup = Boolean(inviteToken) || signupAllowed;
  const isSignup = canSignup && mode === "signup";

  const title = isSignup
    ? inviteToken
      ? "Aceitar convite"
      : "Crie sua conta"
    : "Bem-vindo de volta";

  const subtitle = isSignup
    ? inviteToken
      ? "Crie uma conta com o e-mail que recebeu o convite"
      : "Você será o primeiro administrador desta plataforma"
    : "Entre para acessar sua plataforma";

  return (
    <div className="relative z-10 mx-auto w-full max-w-md">
      <div className="mb-8 text-center">
        <div className="mb-4 inline-flex items-center justify-center">
          <UtalksLogo size="xl" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        <p className="mt-2 text-muted-foreground">{subtitle}</p>
      </div>

      <div className="rounded-2xl border border-border bg-card p-8 shadow-xl">
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
        >
          {inviteToken && <InviteBanner />}

          {isSignup && (
            <Field label="Nome" icon={User}>
              <Input
                type="text"
                className="pl-10"
                placeholder="Como quer ser chamado"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
              />
            </Field>
          )}

          <Field label="Email" icon={Mail}>
            <Input
              type="email"
              className="pl-10"
              placeholder="seu@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
            />
          </Field>

          <Field label="Senha" icon={Lock}>
            <Input
              type="password"
              className="pl-10"
              placeholder={isSignup ? "Mínimo 8 caracteres" : "••••••••"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isSignup ? "new-password" : "current-password"}
            />
          </Field>

          {!isSignup && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={onForgotPassword}
                className="text-sm text-primary hover:underline"
              >
                Esqueci a senha
              </button>
              <button
                type="button"
                onClick={onMagicLink}
                disabled={submitting}
                className="text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Entrar com link mágico
              </button>
            </div>
          )}

          {error && <Alert tone="error">{error}</Alert>}
          {info && <Alert tone="info">{info}</Alert>}

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isSignup ? (
              <UserPlus className="h-4 w-4" />
            ) : (
              <ArrowRight className="h-4 w-4" />
            )}
            {isSignup ? (inviteToken ? "Aceitar convite e entrar" : "Criar minha conta") : "Entrar"}
          </Button>
        </form>

        <div className="mt-6 border-t border-border pt-6 text-center text-sm text-muted-foreground">
          {canSignup ? (
            <>
              {isSignup ? "Já tem uma conta?" : "Não tem uma conta?"}
              <button
                type="button"
                onClick={() => onToggle(isSignup ? "login" : "signup")}
                className="ml-1 font-medium text-primary transition-colors hover:text-primary/80"
              >
                {isSignup ? "Entrar" : inviteToken ? "Aceitar convite" : "Criar conta"}
              </button>
            </>
          ) : (
            "Os cadastros são feitos por convite. Peça um link ao administrador."
          )}
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-muted-foreground">
        Ao continuar, você concorda com nossos Termos de Uso e Política de Privacidade.
      </p>
    </div>
  );
}

/* ─── building blocks ─── */

function Field({
  label,
  icon: Icon,
  children,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label className="text-foreground">{label}</Label>
      <div className="relative">
        <Icon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        {children}
      </div>
    </div>
  );
}

function Alert({ children, tone }: { children: React.ReactNode; tone: "error" | "info" }) {
  return (
    <div
      className={
        tone === "error"
          ? "rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-destructive dark:text-red-300"
          : "rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-800 dark:text-cyan-200"
      }
    >
      {children}
    </div>
  );
}

function InviteBanner() {
  return (
    <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-800 dark:text-cyan-200">
      Você foi convidado para um workspace. Crie sua conta para aceitar.
    </div>
  );
}
