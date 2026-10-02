// Colunas visíveis + filtro de status + busca, salvos por usuário no perfil
// (profiles.ui_settings). Extraído de /orcamentos pra ser reaproveitado por
// qualquer tela de lista parecida (ex.: /cobrancas).

import { useCallback, useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { getUiSetting, saveUiSetting } from "@/lib/user-prefs.functions";

export type TablePrefs = { columns: string[]; statusFilter: string[]; search: string };

export function useTablePrefs(key: string, defaultColumns: string[]) {
  const fnGet = useServerFn(getUiSetting);
  const fnSave = useServerFn(saveUiSetting);
  const [prefs, setPrefs] = useState<TablePrefs>({
    columns: defaultColumns,
    statusFilter: [],
    search: "",
  });
  const loadedRef = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fnGet({ data: { key } })
      .then((r) => {
        const v = r?.value as Partial<TablePrefs> | null;
        if (v && typeof v === "object") {
          setPrefs({
            columns: Array.isArray(v.columns) && v.columns.length > 0 ? v.columns : defaultColumns,
            statusFilter: Array.isArray(v.statusFilter) ? v.statusFilter : [],
            search: typeof v.search === "string" ? v.search : "",
          });
        }
      })
      .catch(() => {})
      .finally(() => {
        loadedRef.current = true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (patch: Partial<TablePrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        if (loadedRef.current) {
          if (saveTimer.current) clearTimeout(saveTimer.current);
          saveTimer.current = setTimeout(() => {
            fnSave({ data: { key, value: next } }).catch(() => {});
          }, 500);
        }
        return next;
      });
    },
    [fnSave, key],
  );

  return { prefs, update };
}

export function ColumnsFilterPopover({
  columns,
  visible,
  onToggle,
  statuses,
  statusFilter,
  onToggleStatus,
  statusLabel,
}: {
  columns: Array<{ key: string; label: string }>;
  visible: string[];
  onToggle: (key: string) => void;
  statuses: string[];
  statusFilter: string[];
  onToggleStatus: (status: string) => void;
  /** Rótulo amigável por valor de status; sem entrada, usa o valor cru. */
  statusLabel?: Record<string, string>;
}) {
  const activeFilters = statusFilter.length;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filtros
          {activeFilters > 0 && (
            <Badge variant="secondary" className="ml-0.5 h-4 px-1 text-[10px]">
              {activeFilters}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-4">
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Colunas visíveis
          </div>
          <div className="space-y-1.5">
            {columns.map((c) => (
              <label key={c.key} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={visible.includes(c.key)}
                  onCheckedChange={() => onToggle(c.key)}
                />
                {c.label}
              </label>
            ))}
          </div>
        </div>
        {statuses.length > 0 && (
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Status
            </div>
            <div className="space-y-1.5">
              {statuses.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <Checkbox
                    checked={statusFilter.includes(s)}
                    onCheckedChange={() => onToggleStatus(s)}
                  />
                  {statusLabel?.[s] ?? s}
                </label>
              ))}
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

/**
 * Paginação client-side de uma lista já filtrada. Extraído de /central (a
 * primeira tela a ter paginação de verdade) pra ser reaproveitado por
 * qualquer tela de lista parecida (/novos-clientes, /orcamentos,
 * /cobrancas, /empresas).
 *
 * Some acionar `setPage(1)` num `useEffect` com as dependências de filtro
 * do caller — este hook não sabe quando o conjunto filtrado mudou por causa
 * de busca/filtro (só do próprio itemCount), então cabe a quem chama voltar
 * pra página 1 quando o filtro muda.
 */
export function usePagination(itemCount: number, defaultPageSize = 50) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const pageCount = Math.max(1, Math.ceil(itemCount / pageSize));
  // Clampa depois de uma exclusão/filtro reduzir o total: sem isso a página
  // ficava vazia em vez de voltar pra última válida.
  const currentPage = Math.min(page, pageCount);
  const start = (currentPage - 1) * pageSize;
  const end = Math.min(currentPage * pageSize, itemCount);

  return { page: currentPage, setPage, pageSize, setPageSize, pageCount, start, end };
}

export function paginate<T>(items: T[], start: number, pageSize: number): T[] {
  return items.slice(start, start + pageSize);
}

export function TablePagination({
  itemCount,
  totalCount,
  itemLabel,
  page,
  pageCount,
  onPageChange,
  pageSize,
  onPageSizeChange,
  start,
  end,
}: {
  itemCount: number;
  /** Total sem filtro — mostra "(de N no total)" quando difere de itemCount. */
  totalCount?: number;
  /** Plural do item, ex.: "contatos", "orçamentos". */
  itemLabel: string;
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  pageSize: number;
  onPageSizeChange: (pageSize: number) => void;
  start: number;
  end: number;
}) {
  if (itemCount === 0) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">
        {start + 1}–{end} de {itemCount} {itemLabel}
        {totalCount !== undefined && totalCount !== itemCount ? ` (de ${totalCount} no total)` : ""}
      </p>
      <div className="flex items-center gap-3">
        <Select value={String(pageSize)} onValueChange={(v) => onPageSizeChange(Number(v))}>
          <SelectTrigger className="h-8 w-[110px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PAGE_SIZE_OPTIONS.map((n) => (
              <SelectItem key={n} value={String(n)}>
                {n} / página
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page <= 1}
            onClick={() => onPageChange(Math.max(1, page - 1))}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <span className="min-w-[88px] text-center text-xs text-muted-foreground">
            Página {page} de {pageCount}
          </span>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            disabled={page >= pageCount}
            onClick={() => onPageChange(Math.min(pageCount, page + 1))}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
