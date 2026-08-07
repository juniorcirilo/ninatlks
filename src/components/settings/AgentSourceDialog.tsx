import { useState } from "react";
import { Check, Copy, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  MAPPABLE_FIELDS,
  createAgentSource,
  deleteAgentSource,
  runAgentSource,
  updateAgentSource,
  type AgentSource,
  type RunResult,
} from "@/lib/agent-sources";
import { CAMPAIGN_KIND_OPTIONS } from "@/lib/operational-lists";
import { variableFieldsForAgent } from "@/lib/webhook-inbound-templates";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Configuração da fonte de dados de um agente: url, token, método e o
 * mapeamento das chaves da resposta do cliente para os nossos campos.
 *
 * O botão Testar salva antes de buscar de propósito — testar uma configuração
 * diferente da que está gravada é o jeito mais rápido de aprovar algo que na
 * próxima execução automática não funciona.
 */
export function AgentSourceDialog({
  accountId,
  agentId,
  agentName,
  source,
  prefillUrl,
  prefillMethod,
  onClose,
  onSaved,
}: {
  accountId: string;
  agentId: string;
  agentName: string;
  source: AgentSource | null;
  /** URL/método já resolvidos pelo n8n (nó criado ou já existente) — só valem quando `source` é null. */
  prefillUrl?: string;
  prefillMethod?: "GET" | "POST";
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(source?.name ?? `Fonte — ${agentName}`);
  const [url, setUrl] = useState(source?.url ?? prefillUrl ?? "");
  const [method, setMethod] = useState<"GET" | "POST">(
    source?.method ?? prefillMethod ?? "POST",
  );
  const [token, setToken] = useState("");
  const [tokenHeader, setTokenHeader] = useState(source?.token_header ?? "Authorization");
  const [tokenPrefix, setTokenPrefix] = useState(source?.token_prefix ?? "Bearer ");
  const [rootPath, setRootPath] = useState(source?.root_path ?? "");
  const [campaignKind, setCampaignKind] = useState(source?.campaign_kind ?? "");
  const [listKey, setListKey] = useState(source?.list_key ?? "");
  const [scheduleMinutes, setScheduleMinutes] = useState(
    source?.schedule_minutes ? String(source.schedule_minutes) : "",
  );
  const [fieldMap, setFieldMap] = useState<Record<string, string>>(
    source?.field_map ?? {},
  );
  // Fonte nova já nasce com as variáveis da operação do agente (cobrança traz
  // parcela, vencimento, saldo devedor…), com a chave da origem igual à nossa.
  // Digitar oito campos à mão para depois descobrir que faltou um é o caminho
  // mais fácil de a agente ligar sem o dado que precisa falar.
  const [variables, setVariables] = useState<Array<{ key: string; from: string }>>(() => {
    const existing = Object.entries(source?.variables_map ?? {}).map(([key, from]) => ({
      key,
      from,
    }));
    if (existing.length > 0) return existing;
    return variableFieldsForAgent({ key: agentId, name: agentName }).map((f) => ({
      key: f.field,
      from: f.field,
    }));
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [generated, setGenerated] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<RunResult | null>(null);
  const busy = saving || testing || removing;
  const savedId = source?.id ?? createdId;

  const canSave = name.trim().length >= 2 && url.trim().length > 0 && !!fieldMap.phone;

  /**
   * UUID v4 em maiúsculas, gerado no navegador (`crypto.randomUUID` usa fonte
   * criptográfica). Serve para quem controla os dois lados: gera aqui e exige o
   * mesmo valor no webhook do n8n/ERP. Quem já tem token do sistema de origem
   * continua colando o dele.
   */
  const generateToken = () => {
    setToken(crypto.randomUUID().toUpperCase());
    setGenerated(true);
    setCopied(false);
  };

  const copyToken = () => {
    void navigator.clipboard.writeText(token).then(() => {
      setCopied(true);
      toast.success("Token copiado");
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const buildInput = () => ({
    agentId,
    name: name.trim(),
    url: url.trim(),
    method,
    ...(token.trim() ? { token: token.trim() } : {}),
    tokenHeader: tokenHeader.trim() || "Authorization",
    tokenPrefix,
    rootPath: rootPath.trim() || undefined,
    fieldMap,
    variablesMap: Object.fromEntries(
      variables.filter((v) => v.key.trim() && v.from.trim()).map((v) => [v.key.trim(), v.from.trim()]),
    ),
    listKey: listKey.trim() || undefined,
    campaignKind: campaignKind || undefined,
    scheduleMinutes: scheduleMinutes ? Number(scheduleMinutes) : undefined,
    active: true,
  });

  /**
   * Salva e devolve o id — testar sem salvar testaria outra configuração.
   *
   * `createdId` existe porque o diálogo continua aberto depois de salvar: sem
   * ele, cada clique em "Salvar e testar" numa fonte nova criava *outra* linha,
   * e como a tela mostrava uma fonte por agente as extras ficavam invisíveis.
   * Depois do primeiro salvamento, todo clique seguinte é atualização.
   */
  const persist = async (): Promise<string> => {
    const input = buildInput();
    const existingId = source?.id ?? createdId;
    if (existingId) {
      await updateAgentSource(accountId, existingId, input);
      return existingId;
    }
    const created = await createAgentSource(accountId, input);
    setCreatedId(created.id);
    return created.id;
  };

  const save = async () => {
    setSaving(true);
    try {
      await persist();
      toast.success("Fonte salva.");
      onSaved();
    } catch (e: any) {
      toast.error(e?.body?.message ?? e?.message ?? "Erro ao salvar a fonte");
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      const id = await persist();
      const run = await runAgentSource(accountId, id);
      setResult(run);
      if (run.ok) {
        toast.success(
          `${run.processed} contato(s) gravados — ${run.created} novo(s), ${run.updated} atualizado(s).`,
        );
      } else {
        toast.error(run.error ?? "A busca falhou");
      }
      onSaved();
    } catch (e: any) {
      toast.error(e?.body?.message ?? e?.message ?? "Erro ao testar a fonte");
    } finally {
      setTesting(false);
    }
  };

  /**
   * Remove a configuração e o token junto (o servidor apaga a entrada do
   * cofre). Contato já importado fica: quem foi trabalhado pela agente não
   * some porque a origem foi desligada.
   */
  const remove = async () => {
    if (!savedId) return;
    if (
      !confirm(
        `Remover a fonte "${name}" de ${agentName}? O token guardado é apagado e a busca automática para. Os contatos já importados continuam na lista.`,
      )
    )
      return;
    setRemoving(true);
    try {
      await deleteAgentSource(accountId, savedId);
      toast.success("Fonte removida.");
      onSaved();
      onClose();
    } catch (e: any) {
      toast.error(e?.body?.message ?? e?.message ?? "Erro ao remover a fonte");
    } finally {
      setRemoving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-white/[0.08] bg-background p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4">
          <h3 className="text-[14px] font-semibold">Fonte de dados — {agentName}</h3>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Nós chamamos esta URL, lemos a resposta e usamos o mapeamento para criar ou
            atualizar os contatos na lista operacional do agente. O telefone é a chave: a
            mesma pessoa nunca entra duas vezes.
          </p>
        </div>

        <div className="space-y-3">
          <Field label="Nome">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputClass}
            />
          </Field>

          <div className="grid grid-cols-[90px_1fr] gap-2">
            <Field label="Método">
              <Select value={method} onValueChange={(v) => setMethod(v as "GET" | "POST")}>
                <SelectTrigger className="h-9 w-full min-w-0 bg-white/[0.02] text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="URL">
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://seu-erp.com/api/clientes"
                className={cn(inputClass, "font-mono")}
                autoComplete="off"
                spellCheck={false}
              />
              {!source && prefillUrl && url === prefillUrl && (
                <p className="mt-1 text-[10px] text-emerald-400">
                  Preenchida automaticamente: nó criado no workflow "Utalks" do seu n8n.
                  Adicione ali os passos que buscam os dados no seu sistema, antes deste
                  webhook.
                </p>
              )}
            </Field>
          </div>

          <div className="grid grid-cols-[1fr_1fr] gap-2">
            <Field label="Header do token">
              <input
                value={tokenHeader}
                onChange={(e) => setTokenHeader(e.target.value)}
                placeholder="Authorization"
                className={cn(inputClass, "font-mono")}
              />
            </Field>
            <Field label="Prefixo">
              <input
                value={tokenPrefix}
                onChange={(e) => setTokenPrefix(e.target.value)}
                placeholder="Bearer "
                className={cn(inputClass, "font-mono")}
              />
            </Field>
          </div>

          <Field label="Token">
            <div className="flex gap-1">
              <input
                // Gerado fica à vista: é a única janela para copiá-lo no n8n,
                // e esconder atrás de bolinhas um valor que acabou de nascer
                // na tela só atrapalha.
                type={generated ? "text" : "password"}
                value={token}
                onChange={(e) => {
                  setToken(e.target.value);
                  setGenerated(false);
                }}
                placeholder={
                  source?.has_token ? "•••••••• (deixe em branco para manter)" : "cole ou gere"
                }
                className={cn(inputClass, generated && "font-mono")}
                autoComplete="off"
                spellCheck={false}
              />
              <button
                type="button"
                onClick={generateToken}
                className="shrink-0 rounded-md border border-white/[0.08] bg-white/[0.04] px-2.5 text-[11px] font-medium hover:bg-white/[0.08]"
              >
                Gerar
              </button>
              {token && (
                <button
                  type="button"
                  onClick={copyToken}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/[0.08] bg-white/[0.02] text-muted-foreground hover:text-foreground"
                  aria-label="Copiar token"
                >
                  {copied ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5" />
                  )}
                </button>
              )}
            </div>
            {generated ? (
              <p className="mt-1 text-[10px] text-amber-300">
                Token gerado. Copie e configure o mesmo valor no seu n8n/ERP — depois de
                salvar ele não volta para esta tela.
              </p>
            ) : (
              <p className="mt-1 text-[10px] text-muted-foreground">
                Guardado no cofre criptografado da conta. Não volta para a tela depois de
                salvo. Para <code className="font-mono">x-api-key</code>, troque o header e
                deixe o prefixo vazio.
              </p>
            )}
          </Field>

          <Field label="Caminho da lista na resposta">
            <input
              value={rootPath}
              onChange={(e) => setRootPath(e.target.value)}
              placeholder="data.items"
              className={cn(inputClass, "font-mono")}
            />
            <p className="mt-1 text-[10px] text-muted-foreground">
              Em branco, aceitamos array na raiz ou embrulhado numa chave só.
            </p>
          </Field>

          <div>
            <p className="mb-1.5 text-[11px] font-medium text-muted-foreground">
              Chaves a obter
            </p>
            <div className="space-y-1.5">
              {MAPPABLE_FIELDS.map((f) => (
                <div key={f.field} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 text-[11px]">
                    {f.label}
                    {f.required && <span className="ml-1 text-rose-300">*</span>}
                    <code className="ml-1 font-mono text-[10px] text-muted-foreground">
                      {f.field}
                    </code>
                  </span>
                  <span className="shrink-0 text-[11px] text-muted-foreground">←</span>
                  <input
                    value={fieldMap[f.field] ?? ""}
                    onChange={(e) =>
                      setFieldMap((m) => ({ ...m, [f.field]: e.target.value }))
                    }
                    placeholder={f.placeholder}
                    className={cn(inputClass, "font-mono")}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </div>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              À direita, a chave como vem na resposta do seu sistema. Aceita caminho
              com ponto (ex.: <code className="font-mono">contato.fone</code>) ou
              expressão JavaScript (ex.: <code className="font-mono">upper(nome)</code>,
              <code className="font-mono">nome.toLowerCase()</code>).
            </p>
          </div>

          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <p className="text-[11px] font-medium text-muted-foreground">
                Variáveis da fala{" "}
                <span className="font-normal text-muted-foreground">(opcional)</span>
              </p>
              <div className="flex items-center gap-1">
                {variables.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setVariables([])}
                    className="rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] hover:bg-white/[0.08]"
                  >
                    Limpar
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setVariables((v) => [...v, { key: "", from: "" }])}
                  className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] hover:bg-white/[0.08]"
                >
                  <Plus className="h-3 w-3" /> Adicionar
                </button>
              </div>
            </div>
            <p className="mb-1.5 text-[10px] text-muted-foreground">
              Sugeridas pela operação do agente. Chave que não existir na resposta é
              simplesmente ignorada — a carga entra do mesmo jeito. Aceita expressão
              JavaScript (ex.: <code className="font-mono">upper(nome)</code>).
            </p>
            <div className="space-y-1.5">
              {variables.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input
                    value={v.key}
                    onChange={(e) =>
                      setVariables((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)),
                      )
                    }
                    placeholder="valor"
                    className={cn(inputClass, "w-32 shrink-0 font-mono")}
                  />
                  <span className="shrink-0 text-[11px] text-muted-foreground">←</span>
                  <input
                    value={v.from}
                    onChange={(e) =>
                      setVariables((prev) =>
                        prev.map((x, j) => (j === i ? { ...x, from: e.target.value } : x)),
                      )
                    }
                    placeholder="valor_aberto"
                    className={cn(inputClass, "font-mono")}
                  />
                  <button
                    type="button"
                    onClick={() => setVariables((prev) => prev.filter((_, j) => j !== i))}
                    className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-300 hover:bg-rose-500/20"
                    aria-label="Remover variável"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              ))}
              {variables.length === 0 && (
                <p className="text-[10px] text-muted-foreground">
                  Nenhuma — a fonte vai gravar só os dados do contato.
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Tipo da lista">
              <Select
                value={campaignKind || "__keep__"}
                onValueChange={(v) => setCampaignKind(v === "__keep__" ? "" : v)}
              >
                <SelectTrigger className="h-9 w-full min-w-0 bg-white/[0.02] text-[12px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__keep__">— manter o atual —</SelectItem>
                  {CAMPAIGN_KIND_OPTIONS.map((k) => (
                    <SelectItem key={k.value} value={k.value}>
                      {k.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Buscar a cada (min)">
              <input
                value={scheduleMinutes}
                onChange={(e) => setScheduleMinutes(e.target.value.replace(/\D/g, ""))}
                placeholder="em branco = só manual"
                className={inputClass}
                inputMode="numeric"
              />
            </Field>
          </div>

          <Field label="Lista de destino (listKey)">
            <input
              value={listKey}
              onChange={(e) => setListKey(e.target.value)}
              placeholder="em branco = lista do agente"
              className={cn(inputClass, "font-mono")}
            />
          </Field>

          {result && (
            <div
              className={cn(
                "rounded-md border p-2 text-[11px]",
                result.ok
                  ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
                  : "border-rose-500/30 bg-rose-500/10 text-rose-200",
              )}
            >
              {result.ok ? (
                <>
                  <p>
                    {result.fetched} linha(s) lidas · {result.created} criado(s) ·{" "}
                    {result.updated} atualizado(s) · {result.skipped} ignorada(s)
                  </p>
                  {!!result.emptyVariables?.length && (
                    <p className="mt-1 text-amber-200">
                      Não vieram em nenhuma linha:{" "}
                      <code className="font-mono">{result.emptyVariables.join(", ")}</code>.
                      São opcionais — a carga entrou mesmo assim —, mas confira se a chave da
                      resposta tem outro nome.
                    </p>
                  )}
                  {result.sample.length > 0 && (
                    <pre className="mt-1 overflow-x-auto rounded bg-black/40 p-2 text-[10px] text-muted-foreground">
                      {JSON.stringify(result.sample, null, 2)}
                    </pre>
                  )}
                </>
              ) : (
                <p>{result.error}</p>
              )}
            </div>
          )}
        </div>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void test()}
              disabled={!canSave || busy}
              className="inline-flex items-center gap-1.5 rounded-md border border-white/[0.08] bg-white/[0.04] px-3 py-1.5 text-[11px] font-medium hover:bg-white/[0.08] disabled:opacity-50"
            >
              {testing && <Loader2 className="h-3 w-3 animate-spin" />}
              {testing ? "Buscando…" : "Salvar e testar"}
            </button>
            {savedId && (
              <button
                type="button"
                onClick={() => void remove()}
                disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-[11px] font-medium text-rose-300 hover:bg-rose-500/20 disabled:opacity-50"
              >
                <Trash2 className="h-3 w-3" />
                {removing ? "Removendo…" : "Remover"}
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="rounded-md border border-white/[0.08] px-3 py-1.5 text-[11px] font-medium hover:bg-white/[0.04] disabled:opacity-50"
            >
              Fechar
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={!canSave || busy}
              className="rounded-md bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputClass =
  "w-full min-w-0 rounded-md border border-white/[0.08] bg-white/[0.02] px-3 py-2 text-[12px] focus:outline-none focus:ring-1 focus:ring-primary/40";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
        {label}
      </label>
      {children}
    </div>
  );
}
