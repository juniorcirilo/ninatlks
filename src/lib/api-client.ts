/**
 * Fetch wrapper for the new NestJS backend — replaces `supabase.from(...)`/
 * `supabase.functions.invoke(...)` domain by domain (see supabase-migration
 * plan, Fase 4). Auth is a session cookie (httpOnly, set by the API on
 * login/register/invite-accept), so every call sends `credentials:
 * "include"` instead of an Authorization header.
 */

/**
 * No servidor (SSR / server functions), chamar o domínio público faz o
 * container tentar se alcançar por fora — hairpin NAT que trava (visto em
 * produção: `fetch failed`/timeout no middleware de sessão). Web e API rodam
 * juntos no mesmo container (ver docker-compose.yml), então o servidor fala
 * direto com `localhost`; só o navegador precisa do domínio público, porque
 * ele está fora do container.
 */
const API_URL =
  typeof window === "undefined"
    ? `http://localhost:${process.env.API_PORT ?? 3001}`
    : import.meta.env.VITE_API_URL ?? "http://localhost:3001";

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // Server-side calls (e.g. from createServerFn middleware) run in Node, where
  // `credentials: "include"` is a no-op — there is no browser cookie jar to pull
  // from. Callers running in that context must pass the incoming request's
  // Cookie header explicitly via init.headers.
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      // FormData: o navegador define o Content-Type (com boundary).
      ...(init?.body && !(init.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (res.status === 204) return undefined as T;

  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json().catch(() => null) : await res.text();

  if (!res.ok) {
    const message =
      (isJson && body && typeof body === "object" && "message" in body
        ? String((body as { message: unknown }).message)
        : null) ?? res.statusText;
    throw new ApiError(res.status, message, body);
  }

  return body as T;
}

export const apiClient = {
  get: <T>(path: string, headers?: HeadersInit) => request<T>(path, headers ? { headers } : undefined),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: "POST",
      body: data instanceof FormData ? data : data !== undefined ? JSON.stringify(data) : undefined,
    }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: "PATCH",
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: "PUT",
      body: data !== undefined ? JSON.stringify(data) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
