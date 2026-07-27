import { User, Lock, Mail, Loader2, Sparkles, UserPlus } from "lucide-react";
import { cn } from "@/lib/utils";
import { NinaTalksLogo } from "@/components/brand/NinaTalksLogo";

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

  // A aba "Criar conta" só aparece quando faz sentido:
  // - há um token de convite (qualquer pessoa convidada), OU
  // - ainda não existe admin (primeiro signup da plataforma).
  const canSignup = Boolean(inviteToken) || signupAllowed;
  const isSignup = canSignup && mode === "signup";

  const title = isSignup
    ? inviteToken
      ? "Aceitar convite"
      : "Criar conta de administrador"
    : "Entrar";

  const subtitle = isSignup
    ? inviteToken
      ? "Crie uma conta com o e-mail que recebeu o convite"
      : "Você será o primeiro administrador desta plataforma"
    : "Acesse o painel Nina Talks";

  return (
    <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-white/[0.06] bg-card shadow-2xl">
      {/* Header com gradiente */}
      <div className="bg-gradient-to-r from-violet-600 to-fuchsia-600 px-6 py-6 text-center text-white">
        <NinaTalksLogo size="sm" className="mx-auto" />
        <div className="mt-2 text-[10px] uppercase tracking-widest text-white/80">
          Nina Talks · Agente de SDR por voz
        </div>
      </div>

      {/* Tabs Entrar / Criar conta — só mostra "Criar conta" quando aplicável */}
      {canSignup ? (
        <div className="grid grid-cols-2 border-b border-white/[0.06]">
          <button
            type="button"
            onClick={() => onToggle("login")}
            className={cn(
              "h-12 text-sm font-semibold transition-colors",
              !isSignup
                ? "border-b-2 border-violet-500 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            Entrar
          </button>
          <button
            type="button"
            onClick={() => onToggle("signup")}
            className={cn(
              "h-12 text-sm font-semibold transition-colors",
              isSignup
                ? "border-b-2 border-violet-500 text-foreground"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {inviteToken ? "Aceitar convite" : "Criar conta"}
          </button>
        </div>
      ) : null}

      {/* Formulário */}
      <div className="px-8 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>

        <div className="mt-6 space-y-4">
          {inviteToken && <InviteBanner />}

          {isSignup && (
            <Input
              icon={User}
              type="text"
              placeholder="Como quer ser chamado"
              value={name}
              onChange={setName}
              autoComplete="name"
            />
          )}

          <Input
            icon={Mail}
            type="email"
            placeholder="seu@email.com"
            value={email}
            onChange={setEmail}
            autoComplete="email"
          />

          <Input
            icon={Lock}
            type="password"
            placeholder={isSignup ? "Mínimo 8 caracteres" : "Sua senha"}
            value={password}
            onChange={setPassword}
            autoComplete={isSignup ? "new-password" : "current-password"}
          />

          {!isSignup && (
            <div className="-mt-2 text-right">
              <button
                type="button"
                onClick={onForgotPassword}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Esqueci minha senha
              </button>
            </div>
          )}

          {error && <Alert tone="error">{error}</Alert>}
          {info && <Alert tone="info">{info}</Alert>}

          <PrimaryButton onClick={onSubmit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isSignup ? (
              <UserPlus className="h-4 w-4" />
            ) : (
              <Sparkles className="h-4 w-4" />
            )}
            {isSignup
              ? inviteToken
                ? "Aceitar convite e entrar"
                : "Criar minha conta"
              : "Entrar"}
          </PrimaryButton>

          {!isSignup && (
            <>
              <Separator>ou</Separator>
              <button
                type="button"
                onClick={onMagicLink}
                disabled={submitting}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.02] text-sm font-medium text-foreground transition-colors hover:bg-white/[0.05] disabled:opacity-50"
              >
                <Mail className="h-4 w-4" />
                Entrar com link mágico
              </button>
            </>
          )}

          {canSignup ? (
            <div className="pt-2 text-center text-xs text-muted-foreground">
              {isSignup ? "Já tem conta?" : "Ainda não tem conta?"}{" "}
              <button
                type="button"
                onClick={() => onToggle(isSignup ? "login" : "signup")}
                className="font-semibold text-violet-500 hover:underline"
              >
                {isSignup ? "Entrar" : inviteToken ? "Aceitar convite" : "Criar agora"}
              </button>
            </div>
          ) : (
            <div className="pt-2 text-center text-xs text-muted-foreground">
              Os cadastros são feitos por convite. Peça um link ao administrador.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── building blocks ─── */

function Input({
  icon: Icon,
  type,
  placeholder,
  value,
  onChange,
  autoComplete,
}: {
  icon: React.ComponentType<{ className?: string }>;
  type: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete?: string;
}) {
  return (
    <div className="relative">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className="h-12 w-full rounded-lg border border-white/[0.08] bg-white/[0.03] pl-4 pr-11 text-sm font-medium text-foreground placeholder:text-muted-foreground focus-visible:border-primary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
      />
      <Icon className="pointer-events-none absolute right-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-fuchsia-600 text-sm font-semibold text-white shadow-lg shadow-violet-600/30 transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Separator({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
      <div className="h-px flex-1 bg-white/[0.06]" />
      {children}
      <div className="h-px flex-1 bg-white/[0.06]" />
    </div>
  );
}

function Alert({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "error" | "info";
}) {
  return (
    <div
      className={cn(
        "rounded-lg border px-3 py-2 text-xs font-medium",
        tone === "error"
          ? "border-red-500/40 bg-red-500/10 text-red-700 dark:text-red-300"
          : "border-violet-500/40 bg-violet-500/10 text-violet-800 dark:text-violet-200",
      )}
    >
      {children}
    </div>
  );
}

function InviteBanner() {
  return (
    <div className="rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs font-medium text-violet-800 dark:text-violet-200">
      Você foi convidado para um workspace. Crie sua conta para aceitar.
    </div>
  );
}
