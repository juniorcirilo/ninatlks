import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  CheckCircle2,
  ExternalLink,
  Loader2,
  Phone,
  PhoneCall,
  RefreshCw,
  Settings2,
  AlertTriangle,
} from "lucide-react";
import { Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAccount } from "@/lib/account-context";
import {
  fetchOwnedTwilioNumbers,
  importTwilioNumber,
  type OwnedTwilioNumber,
} from "@/lib/twilio";

function isTwilioConfigError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("twilio") &&
    (m.includes("credenc") ||
      m.includes("credential") ||
      m.includes("config") ||
      m.includes("not configured") ||
      m.includes("missing"))
  );
}

export function PrimeiroNumeroStep({ accountId }: { accountId: string }) {
  const { role } = useAccount();
  const isAdmin = role === "admin";
  const qc = useQueryClient();

  const importedQuery = useQuery({
    queryKey: ["onboarding-phone-count", accountId],
    queryFn: async () => {
      const { count } = await (supabase as any)
        .from("phone_numbers")
        .select("id", { count: "exact", head: true })
        .eq("account_id", accountId);
      return count ?? 0;
    },
    enabled: !!accountId,
  });

  const ownedQuery = useQuery<OwnedTwilioNumber[]>({
    queryKey: ["onboarding-twilio-owned", accountId],
    queryFn: () => fetchOwnedTwilioNumbers(accountId),
    enabled: !!accountId && isAdmin,
    retry: false,
    staleTime: 30_000,
  });

  const [importingNumber, setImportingNumber] = useState<string | null>(null);
  const importMut = useMutation({
    mutationFn: (phoneNumber: string) =>
      importTwilioNumber({
        accountId,
        phoneNumber,
        inboundBehavior: "ai_answer",
      }),
    onMutate: (phoneNumber) => setImportingNumber(phoneNumber),
    onSuccess: (_data, phoneNumber) => {
      toast.success(`Número ${phoneNumber} importado`);
      qc.invalidateQueries({ queryKey: ["onboarding-phone-count", accountId] });
      qc.invalidateQueries({ queryKey: ["onboarding-twilio-owned", accountId] });
      qc.invalidateQueries({ queryKey: ["phone-numbers", accountId] });
    },
    onError: (e: Error) => toast.error(e.message ?? "Falha ao importar"),
    onSettled: () => setImportingNumber(null),
  });

  const importedCount = importedQuery.data ?? 0;
  const owned = ownedQuery.data ?? [];
  const ownedError = ownedQuery.error as Error | undefined;
  const twilioMissing = ownedError ? isTwilioConfigError(ownedError.message) : false;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Primeiro número de telefone</h2>
        <p className="text-sm text-muted-foreground">
          Pra a IA ligar e atender chamadas, você precisa de pelo menos um número
          Twilio. Buscamos automaticamente os números já existentes na sua conta —
          basta importar com 1 clique. Esse passo é opcional.
        </p>
      </div>

      {/* Estado: já tem número importado */}
      {importedCount > 0 && (
        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
          <div className="flex items-center gap-2 font-medium text-emerald-700 dark:text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
            {importedCount} número{importedCount > 1 ? "s" : ""} já cadastrado
            {importedCount > 1 ? "s" : ""}
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Você pode adicionar mais ou ajustar persona/inbox em{" "}
            <code>/phone-numbers</code>.
          </p>
        </div>
      )}

      {/* Loading */}
      {importedCount === 0 && (importedQuery.isLoading || ownedQuery.isLoading) && (
        <div className="flex items-center justify-center rounded-md border border-border bg-muted/30 py-8">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">
            Buscando números na sua conta Twilio…
          </span>
        </div>
      )}

      {/* Twilio não configurado */}
      {importedCount === 0 && !ownedQuery.isLoading && twilioMissing && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/[0.08] p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">
                Twilio ainda não conectado
              </p>
              <p className="mt-0.5 text-[12px] text-amber-800/90 dark:text-amber-200/80">
                Configure o Account SID e o Auth Token da Twilio em Configurações
                → Integrações pra eu poder listar e importar seus números
                automaticamente.
              </p>
              <Button asChild size="sm" variant="outline" className="mt-3">
                <Link to="/settings">
                  <Settings2 className="h-3.5 w-3.5" />
                  Abrir integrações
                </Link>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Erro genérico (não é falta de credencial) */}
      {importedCount === 0 && !ownedQuery.isLoading && ownedError && !twilioMissing && (
        <div className="rounded-md border border-destructive/40 bg-destructive/[0.06] p-4">
          <p className="text-sm font-medium text-destructive">
            Falha ao buscar números no Twilio
          </p>
          <p className="mt-0.5 text-[12px] text-muted-foreground">
            {ownedError.message}
          </p>
          <Button
            size="sm"
            variant="outline"
            className="mt-3"
            onClick={() => ownedQuery.refetch()}
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Tentar novamente
          </Button>
        </div>
      )}

      {/* Tem números na Twilio */}
      {importedCount === 0 &&
        !ownedQuery.isLoading &&
        !ownedError &&
        owned.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">
                Encontrados {owned.length} número{owned.length > 1 ? "s" : ""} na
                sua conta Twilio
              </p>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => ownedQuery.refetch()}
                disabled={ownedQuery.isFetching}
              >
                <RefreshCw
                  className={`h-3.5 w-3.5 ${ownedQuery.isFetching ? "animate-spin" : ""}`}
                />
                Atualizar
              </Button>
            </div>

            <div className="space-y-2">
              {owned.map((n) => {
                const busy = importingNumber === n.phone_number;
                return (
                  <div
                    key={n.sid}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-card/50 p-3"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                        <PhoneCall className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-mono text-sm font-semibold">
                            {n.phone_number}
                          </p>
                          {n.capabilities?.voice && (
                            <Badge variant="outline" className="text-[10px]">
                              Voz
                            </Badge>
                          )}
                          {n.capabilities?.sms && (
                            <Badge variant="outline" className="text-[10px]">
                              SMS
                            </Badge>
                          )}
                        </div>
                        {n.friendly_name && (
                          <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                            {n.friendly_name}
                          </p>
                        )}
                      </div>
                    </div>

                    {n.already_imported ? (
                      <Badge
                        variant="outline"
                        className="shrink-0 border-emerald-500/40 text-emerald-700 dark:text-emerald-300"
                      >
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Importado
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        onClick={() => importMut.mutate(n.phone_number)}
                        disabled={busy || importMut.isPending}
                      >
                        {busy ? (
                          <>
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Importando…
                          </>
                        ) : (
                          "Importar"
                        )}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

      {/* Twilio OK mas sem números */}
      {importedCount === 0 &&
        !ownedQuery.isLoading &&
        !ownedError &&
        owned.length === 0 && (
          <div className="rounded-md border border-border bg-muted/40 p-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Phone className="h-5 w-5" />
              </div>
              <div>
                <h4 className="text-sm font-semibold">
                  Sua conta Twilio ainda não tem números
                </h4>
                <p className="mt-0.5 text-[12px] text-muted-foreground">
                  Compre ou porte um número direto na página de telefonia — leva
                  menos de 1 minuto.
                </p>
              </div>
            </div>
            <Button asChild className="mt-3 w-full" variant="outline">
              <Link to="/phone-numbers">
                Abrir página de números
                <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        )}

      {/* Footer link sempre visível */}
      {importedCount === 0 && (
        <p className="text-[11px] text-muted-foreground">
          Precisa de configuração avançada (persona, inbox, comportamento de
          inbound)?{" "}
          <Link to="/phone-numbers" className="text-primary hover:underline">
            Abrir página completa de telefonia →
          </Link>
        </p>
      )}
    </div>
  );
}
