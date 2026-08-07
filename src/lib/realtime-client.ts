import { useEffect, useRef } from "react";
import { io, type Socket } from "socket.io-client";

/**
 * Replaces supabase.channel()/postgres_changes. The server drives room
 * membership entirely from the session cookie (account/user rooms), so
 * consumers here just get an `app_change` event stream — never a full row
 * (pg_notify caps at 8000 bytes) — and are expected to treat it as a
 * cache-invalidation signal (refetch via the existing REST endpoints), not
 * a source of truth for the changed data itself.
 */

export type AppChangeEvent = {
  table: string;
  op: "INSERT" | "UPDATE" | "DELETE";
  id: string;
  accountId: string | null;
  userId?: string;
  conversationId?: string;
};

const WS_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

let socket: Socket | null = null;

function getSocket(): Socket {
  if (!socket) {
    socket = io(WS_URL, { withCredentials: true });
  }
  return socket;
}

/**
 * Subscribe to changes on `table`. `cb` fires for every `app_change` event
 * on that table — the caller is responsible for filtering further (e.g. by
 * id) if needed, since the payload is intentionally minimal.
 */
export function subscribeTable(table: string, cb: (event: AppChangeEvent) => void): () => void {
  const s = getSocket();
  const handler = (event: AppChangeEvent) => {
    if (event.table === table) cb(event);
  };
  s.on("app_change", handler);
  return () => {
    s.off("app_change", handler);
  };
}

/** Tabelas que hoje disparam NOTIFY app_changes (ver triggers no banco). */
export const REALTIME_TABLES = [
  "agent_handoffs",
  "contacts",
  "conversations",
  "messages",
  "notifications",
  "scheduled_meetings",
  "voice_calls",
  "voice_campaign_contacts",
  "voice_campaigns",
] as const;

export type RealtimeTable = (typeof REALTIME_TABLES)[number];

/**
 * Reconsulta `onChange` quando qualquer uma das `tables` muda nesta conta.
 *
 * O callback fica numa ref pra que um `onChange` recriado a cada render (o
 * caso comum: uma função inline) não derrube e refaça as inscrições no socket
 * a cada ciclo. O efeito só depende de accountId e da identidade das tabelas.
 *
 * Um refetch por evento é aceitável porque o payload não carrega a linha —
 * só id/op/accountId — então filtrar mais fino aqui não evitaria a ida ao
 * servidor. Telas com lista muito grande devem passar `debounceMs`.
 */
export function useRealtimeRefresh(
  tables: readonly RealtimeTable[],
  accountId: string | null | undefined,
  onChange: () => void,
  options: { debounceMs?: number } = {},
): void {
  const cb = useRef(onChange);
  cb.current = onChange;
  const { debounceMs = 250 } = options;
  const key = tables.join(",");

  useEffect(() => {
    if (!accountId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const fire = () => {
      if (debounceMs <= 0) return cb.current();
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => cb.current(), debounceMs);
    };
    const unsubs = key.split(",").map((table) =>
      subscribeTable(table, (e) => {
        // Eventos chegam pela sala da conta, mas o filtro protege contra
        // recycling de socket quando o usuário troca de conta sem reload.
        if (e.accountId === accountId) fire();
      }),
    );
    return () => {
      if (timer) clearTimeout(timer);
      for (const unsub of unsubs) unsub();
    };
  }, [accountId, key, debounceMs]);
}
