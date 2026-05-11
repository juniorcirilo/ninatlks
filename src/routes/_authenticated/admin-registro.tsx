import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, ShieldAlert } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin-registro")({
  head: () => ({
    meta: [{ title: "Registro de usuários — Nina Talks" }],
  }),
  component: AdminRegistroPage,
});

function AdminRegistroPage() {
  const [registrationEnabled, setRegistrationEnabled] = useState(true);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await (supabase as any)
        .from("system_settings")
        .select("id, registration_enabled")
        .limit(1)
        .maybeSingle();
      if (data) {
        setSettingsId(data.id);
        setRegistrationEnabled(Boolean(data.registration_enabled));
      } else {
        // Row inexistente = habilitado por padrão.
        setRegistrationEnabled(true);
      }
      setLoading(false);
    })();
  }, []);

  const handleToggle = async (checked: boolean) => {
    setUpdating(true);
    try {
      if (settingsId) {
        const { error } = await (supabase as any)
          .from("system_settings")
          .update({ registration_enabled: checked })
          .eq("id", settingsId);
        if (error) throw error;
      } else {
        const { data, error } = await (supabase as any)
          .from("system_settings")
          .insert({ registration_enabled: checked })
          .select("id")
          .single();
        if (error) throw error;
        if (data) setSettingsId(data.id);
      }
      setRegistrationEnabled(checked);
      toast.success(checked ? "Registro habilitado" : "Registro desabilitado");
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Erro ao atualizar configuração",
      );
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full flex-1 items-center justify-center p-8">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 md:p-8">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex items-center gap-3">
          <ShieldAlert className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">
            Registro de usuários
          </h1>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
          <h2 className="mb-4 text-lg font-semibold text-foreground">
            Configurações do sistema
          </h2>

          <div className="flex items-center justify-between gap-6">
            <div className="space-y-1">
              <Label className="font-medium text-foreground">
                Permitir novos registros
              </Label>
              <p className="text-sm text-muted-foreground">
                Quando desativado, a opção de criar conta não aparecerá na tela de
                login. Convites continuam funcionando normalmente.
              </p>
            </div>
            <Switch
              checked={registrationEnabled}
              onCheckedChange={handleToggle}
              disabled={updating}
            />
          </div>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Padrão: se nenhuma configuração existir, o registro fica habilitado.
        </p>
      </div>
    </div>
  );
}
