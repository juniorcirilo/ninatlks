import { apiClient } from "@/lib/api-client";

export interface WebhookDelivery {
  id: string;
  account_id: string;
  endpoint: string;
  direction: string;
  http_status: number | null;
  duration_ms: number | null;
  source_ip: string | null;
  signature_valid: boolean | null;
  payload_preview: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

interface WebhookDeliveryApiRow {
  id: string;
  accountId: string;
  endpoint: string;
  direction: string;
  httpStatus: number | null;
  durationMs: number | null;
  sourceIp: string | null;
  signatureValid: boolean | null;
  payloadPreview: string | null;
  error: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

function mapRow(r: WebhookDeliveryApiRow): WebhookDelivery {
  return {
    id: r.id,
    account_id: r.accountId,
    endpoint: r.endpoint,
    direction: r.direction,
    http_status: r.httpStatus,
    duration_ms: r.durationMs,
    source_ip: r.sourceIp,
    signature_valid: r.signatureValid,
    payload_preview: r.payloadPreview,
    error: r.error,
    metadata: r.metadata,
    created_at: r.createdAt,
  };
}

export async function fetchWebhookDeliveries(
  accountId: string,
  opts: { endpoint?: string; limit?: number } = {},
): Promise<WebhookDelivery[]> {
  const params = new URLSearchParams();
  if (opts.endpoint) params.set("endpoint", opts.endpoint);
  if (opts.limit) params.set("limit", String(opts.limit));
  const qs = params.toString();
  const rows = await apiClient.get<WebhookDeliveryApiRow[]>(
    `/accounts/${accountId}/webhook-deliveries${qs ? `?${qs}` : ""}`,
  );
  return rows.map(mapRow);
}
