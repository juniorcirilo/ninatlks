// Dashboard de uso e consumo do Agente de IA: chamadas, tokens, custo,
// latência, fallbacks e consultas ao banco. Gráfico em SVG simples (barras
// finas, grade discreta, tooltip por barra) com visão em tabela.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, Loader2, Table2, BarChart3 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchAiUsage } from "@/lib/ai-agent";
import { errMsg } from "./shared";

const num = (v: string | number | null | undefined) => Number(v ?? 0) || 0;
const compact = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const int = new Intl.NumberFormat("pt-BR");
const usd = (v: number) =>
  v === 0
    ? "US$ 0,00"
    : v < 0.01
      ? `US$ ${v.toFixed(4).replace(".", ",")}`
      : `US$ ${v.toFixed(2).replace(".", ",")}`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
const secs = (ms: number) => (ms ? `${(ms / 1000).toFixed(1).replace(".", ",")} s` : "—");

const KIND_LABEL: Record<string, string> = {
  reply: "Resposta no chat",
  skill_gen: "Geração de skill",
  test: "Teste",
};

function Tile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

type DayPoint = { day: string; ok: number; fail: number; tokens: number };

/** Preenche os dias sem uso para o eixo ficar contínuo. */
function continuousDays(
  days: number,
  rows: { day: string; calls: string; ok_calls: string; tokens: string }[],
): DayPoint[] {
  const map = new Map(rows.map((r) => [r.day, r]));
  const out: DayPoint[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    const key = d.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
    const r = map.get(key);
    const calls = num(r?.calls);
    const ok = num(r?.ok_calls);
    out.push({ day: key, ok, fail: Math.max(0, calls - ok), tokens: num(r?.tokens) });
  }
  return out;
}

function CallsChart({ points }: { points: DayPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 720;
  const H = 200;
  const padL = 36;
  const padB = 22;
  const padT = 8;
  const max = Math.max(1, ...points.map((p) => p.ok + p.fail));
  // eixo em passos "redondos"
  const step = max <= 4 ? 1 : Math.ceil(max / 4);
  const top = step * Math.ceil(max / step);
  const innerW = W - padL;
  const slot = innerW / points.length;
  const barW = Math.max(2, Math.min(14, slot * 0.6));
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const ticks = Array.from({ length: Math.floor(top / step) + 1 }, (_, i) => i * step);
  const fmtDay = (d: string) => d.slice(8, 10) + "/" + d.slice(5, 7);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Chamadas por dia">
        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={padL}
              x2={W}
              y1={y(t)}
              y2={y(t)}
              stroke="currentColor"
              strokeOpacity={t === 0 ? 0.35 : 0.12}
            />
            <text
              x={padL - 6}
              y={y(t) + 3}
              textAnchor="end"
              fontSize="10"
              className="fill-muted-foreground"
            >
              {t}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = padL + slot * i + (slot - barW) / 2;
          const total = p.ok + p.fail;
          const hOk = y(0) - y(p.ok);
          const hFail = y(0) - y(total) - hOk;
          return (
            <g key={p.day} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              {/* alvo de hover maior que a barra */}
              <rect
                x={padL + slot * i}
                y={padT}
                width={slot}
                height={H - padT - padB}
                fill="transparent"
              />
              {p.ok > 0 && (
                <rect
                  x={x}
                  y={y(p.ok)}
                  width={barW}
                  height={hOk}
                  rx={Math.min(3, barW / 2)}
                  fill="hsl(var(--primary))"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
              {p.fail > 0 && (
                <rect
                  x={x}
                  y={y(total)}
                  width={barW}
                  height={Math.max(2, hFail) - 1}
                  rx={Math.min(3, barW / 2)}
                  fill="hsl(var(--destructive))"
                  opacity={hover === null || hover === i ? 1 : 0.45}
                />
              )}
            </g>
          );
        })}
        {[0, Math.floor((points.length - 1) / 2), points.length - 1].map((i) => (
          <text
            key={i}
            x={padL + slot * i + slot / 2}
            y={H - 6}
            textAnchor={i === 0 ? "start" : i === points.length - 1 ? "end" : "middle"}
            fontSize="10"
            className="fill-muted-foreground"
          >
            {fmtDay(points[i].day)}
          </text>
        ))}
      </svg>
      {hover !== null && (
        <div
          className="pointer-events-none absolute top-0 rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
          style={{
            left: `${Math.min(80, Math.max(0, ((padL + slot * hover) / W) * 100))}%`,
          }}
        >
          <div className="font-medium">{fmtDay(points[hover].day)}</div>
          <div>Sucesso: {points[hover].ok}</div>
          <div>Falhas: {points[hover].fail}</div>
          <div>Tokens: {int.format(points[hover].tokens)}</div>
        </div>
      )}
    </div>
  );
}

export function UsageDashboard({ accountId }: { accountId: string }) {
  const [days, setDays] = useState(30);
  const [asTable, setAsTable] = useState(false);
  const { data, isLoading, error } = useQuery({
    queryKey: ["ai-agent-usage", accountId, days],
    queryFn: () => fetchAiUsage(accountId, days),
    retry: 1,
  });

  const points = useMemo(
    () => (data && !data.migration_pending ? continuousDays(days, data.by_day) : []),
    [data, days],
  );

  if (isLoading)
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  if (error || !data)
    return (
      <div className="rounded-xl border border-destructive/40 bg-card p-5 text-sm">
        Não foi possível carregar o uso: {errMsg(error, "erro desconhecido")}
      </div>
    );
  if (data.migration_pending)
    return (
      <div className="rounded-xl border border-amber-500/50 bg-card p-4 text-sm">
        <strong>Migrations pendentes no banco.</strong> Rode <code>npm run migration</code> para
        liberar o registro de uso e consumo.
      </div>
    );

  const t = data.totals;
  const calls = num(t.calls);
  const okCalls = num(t.ok_calls);
  const tokensIn = num(t.tokens_in);
  const tokensOut = num(t.tokens_out);
  const tokensReason = num(t.tokens_reasoning);
  const totalTokens = tokensIn + tokensOut + tokensReason;
  const cost = num(t.cost);
  const withFallback = num(t.with_fallback);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Consumo do agente nos últimos {days} dias: respostas no chat, geração de skills e testes.
        </p>
        <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7">Últimos 7 dias</SelectItem>
            <SelectItem value="30">Últimos 30 dias</SelectItem>
            <SelectItem value="90">Últimos 90 dias</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {calls === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Nenhum uso registrado ainda neste período. Assim que o agente responder uma conversa (ou
          você usar o botão Testar), os números aparecem aqui.
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Tile
              label="Chamadas"
              value={int.format(calls)}
              hint={`${pct(okCalls, calls)} com sucesso · ${int.format(num(t.replies))} respostas no chat`}
            />
            <Tile
              label="Tokens"
              value={compact.format(totalTokens)}
              hint={`${compact.format(tokensIn)} entrada · ${compact.format(tokensOut)} saída${
                tokensReason ? ` · ${compact.format(tokensReason)} raciocínio` : ""
              }`}
            />
            <Tile
              label="Custo"
              value={usd(cost)}
              hint={cost === 0 ? "o provedor não informou custo" : "informado pelo provedor"}
            />
            <Tile
              label="Tempo médio de resposta"
              value={secs(num(t.avg_ms))}
              hint="chamadas com sucesso"
            />
            <Tile
              label="Fallbacks acionados"
              value={int.format(withFallback)}
              hint={`${pct(withFallback, calls)} das chamadas precisaram de outro modelo`}
            />
            <Tile
              label="Provedor antigo"
              value={int.format(num(t.legacy_calls))}
              hint="respostas dadas depois que o IA Agent falhou"
            />
            <Tile
              label="Consultas ao banco"
              value={int.format(num(data.db.queries))}
              hint={`${int.format(num(data.db.failed))} com erro`}
            />
          </div>

          <section className="rounded-xl border bg-card p-5">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold">Chamadas por dia</h3>
                <div className="mt-1 flex gap-4 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-primary" /> Sucesso
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-sm bg-destructive" /> Falha
                  </span>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => setAsTable((v) => !v)}>
                {asTable ? (
                  <BarChart3 className="mr-1 h-4 w-4" />
                ) : (
                  <Table2 className="mr-1 h-4 w-4" />
                )}
                {asTable ? "Ver gráfico" : "Ver tabela"}
              </Button>
            </div>
            {asTable ? (
              <div className="max-h-72 overflow-auto">
                <table className="w-full text-sm">
                  <thead className="text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="py-1 pr-4">Dia</th>
                      <th className="py-1 pr-4">Sucesso</th>
                      <th className="py-1 pr-4">Falhas</th>
                      <th className="py-1">Tokens</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...points].reverse().map((p) => (
                      <tr key={p.day} className="border-t">
                        <td className="py-1 pr-4">{p.day.split("-").reverse().join("/")}</td>
                        <td className="py-1 pr-4 tabular-nums">{p.ok}</td>
                        <td className="py-1 pr-4 tabular-nums">{p.fail}</td>
                        <td className="py-1 tabular-nums">{int.format(p.tokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <CallsChart points={points} />
            )}
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-xl border bg-card p-5">
              <h3 className="mb-3 text-base font-semibold">Por modelo</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Modelo</th>
                    <th className="py-1 pr-3">Chamadas</th>
                    <th className="py-1 pr-3">Sucesso</th>
                    <th className="py-1 pr-3">Tokens</th>
                    <th className="py-1">Tempo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_model.map((m) => (
                    <tr key={`${m.provider}-${m.model}`} className="border-t">
                      <td className="max-w-[10rem] truncate py-1 pr-3" title={m.model}>
                        {m.model}
                      </td>
                      <td className="py-1 pr-3 tabular-nums">{int.format(num(m.calls))}</td>
                      <td className="py-1 pr-3 tabular-nums">
                        {pct(num(m.ok_calls), num(m.calls))}
                      </td>
                      <td className="py-1 pr-3 tabular-nums">{compact.format(num(m.tokens))}</td>
                      <td className="py-1 tabular-nums">{secs(num(m.avg_ms))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="rounded-xl border bg-card p-5">
              <h3 className="mb-3 text-base font-semibold">Por agente</h3>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">Agente</th>
                    <th className="py-1 pr-3">Chamadas</th>
                    <th className="py-1 pr-3">Tokens</th>
                    <th className="py-1">Custo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.by_agent.map((a) => (
                    <tr key={a.persona_id ?? "none"} className="border-t">
                      <td className="max-w-[10rem] truncate py-1 pr-3" title={a.name}>
                        {a.name}
                      </td>
                      <td className="py-1 pr-3 tabular-nums">{int.format(num(a.calls))}</td>
                      <td className="py-1 pr-3 tabular-nums">{compact.format(num(a.tokens))}</td>
                      <td className="py-1 tabular-nums">{usd(num(a.cost))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          {data.errors.length > 0 && (
            <section className="rounded-xl border bg-card p-5">
              <h3 className="mb-3 text-base font-semibold">Últimas falhas</h3>
              <ul className="space-y-2">
                {data.errors.map((e, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm">
                    <AlertCircle
                      className="mt-0.5 h-4 w-4 shrink-0 text-destructive"
                      aria-hidden="true"
                    />
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">
                        {new Date(e.created_at).toLocaleString("pt-BR")} ·{" "}
                        {KIND_LABEL[e.kind] ?? e.kind} · {e.model ?? e.provider}
                      </div>
                      <div className="break-words">Falha: {e.error ?? "sem detalhe"}</div>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
