import { Link, useRouter } from "@tanstack/react-router";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  error: unknown;
  reset?: () => void;
};

export function RouteErrorBoundary({ error, reset }: Props) {
  const router = useRouter();
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Erro inesperado";

  const handleRetry = () => {
    if (reset) reset();
    router.invalidate();
  };

  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <div className="rounded-full bg-red-500/10 p-3">
        <AlertTriangle className="h-6 w-6 text-red-400" />
      </div>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Algo deu errado nesta tela</h2>
        <p className="max-w-md text-sm text-muted-foreground">
          {message}. Você pode tentar novamente ou voltar ao painel.
        </p>
      </div>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={handleRetry} className="gap-1.5">
          <RefreshCw className="h-3.5 w-3.5" /> Tentar novamente
        </Button>
        <Button asChild size="sm" variant="ghost">
          <Link to="/">Voltar ao painel</Link>
        </Button>
      </div>
      {import.meta.env.DEV && error instanceof Error && error.stack && (
        <pre className="mt-6 max-w-xl overflow-x-auto rounded-md bg-white/[0.03] p-3 text-left text-[10px] text-muted-foreground">
          {error.stack}
        </pre>
      )}
    </div>
  );
}
