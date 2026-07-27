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
