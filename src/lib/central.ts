import { apiClient } from "@/lib/api-client";
import { listTeamMembers } from "@/lib/team";

export type LifecycleStage = "lead" | "prospect" | "customer" | "inactive" | "delinquent";
export type OperationalStatus =
  | "new"
  | "sdr"
  | "qualifying"
  | "negotiating"
  | "closed_won"
  | "closed_lost"
  | "collections"
  | "post_sale"
  | "retention"
  | "no_response"
  | "do_not_contact";

export const LIFECYCLE_LABEL: Record<LifecycleStage, string> = {
  lead: "Lead",
  prospect: "Prospect",
  customer: "Cliente",
  inactive: "Inativo",
  delinquent: "Inadimplente",
};

export const OPERATIONAL_LABEL: Record<OperationalStatus, string> = {
  new: "Novo",
  sdr: "SDR",
  qualifying: "Qualificando",
  negotiating: "Negociação",
  closed_won: "Ganho",
  closed_lost: "Perdido",
  collections: "Cobrança",
  post_sale: "Pós-venda",
  retention: "Retenção",
  no_response: "Sem retorno",
  do_not_contact: "Não contatar",
};

export const OPERATIONAL_TONE: Record<OperationalStatus, string> = {
  new: "bg-slate-500/10 text-slate-300 ring-slate-500/20",
  sdr: "bg-violet-500/10 text-violet-300 ring-violet-500/30",
  qualifying: "bg-sky-500/10 text-sky-300 ring-sky-500/30",
  negotiating: "bg-amber-500/10 text-amber-300 ring-amber-500/30",
  closed_won: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/30",
  closed_lost: "bg-rose-500/10 text-rose-300 ring-rose-500/30",
  collections: "bg-orange-500/10 text-orange-300 ring-orange-500/30",
  post_sale: "bg-teal-500/10 text-teal-300 ring-teal-500/30",
  retention: "bg-fuchsia-500/10 text-fuchsia-300 ring-fuchsia-500/30",
  no_response: "bg-zinc-500/10 text-zinc-300 ring-zinc-500/30",
  do_not_contact: "bg-red-500/10 text-red-300 ring-red-500/30",
};

export type CentralContact = {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  identifier: string | null;
  score: number;
  lifecycle_stage: LifecycleStage;
  operational_status: OperationalStatus;
  last_sentiment: string | null;
  last_activity_at: string | null;
  last_call_at: string | null;
  last_whatsapp_at: string | null;
  owner_user_id: string | null;
  briefing: any;
};

export type QuickFilter =
  | "all"
  | "new"
  | "lead"
  | "sdr"
  | "qualifying"
  | "negotiating"
  | "collections"
  | "post_sale"
  | "retention"
  | "hot"
  | "no_response"
  | "inactive"
  | "delinquent"
  | "closed_lost"
  | "do_not_contact"
  | "customers";

export const QUICK_FILTERS: { id: QuickFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "new", label: "Novos" },
  { id: "lead", label: "Leads" },
  { id: "hot", label: "🔥 Leads quentes" },
  { id: "sdr", label: "SDR" },
  { id: "qualifying", label: "Qualificando" },
  { id: "negotiating", label: "Negociação" },
  { id: "customers", label: "Clientes" },
  { id: "post_sale", label: "Pós-venda" },
  { id: "retention", label: "Retenção" },
  { id: "collections", label: "Cobrança" },
  { id: "delinquent", label: "Inadimplentes" },
  { id: "no_response", label: "Sem retorno" },
  { id: "closed_lost", label: "Perdidos" },
  { id: "do_not_contact", label: "Não contatar" },
  { id: "inactive", label: "Inativos" },
];

export async function fetchCentralContacts(accountId: string): Promise<CentralContact[]> {
  return apiClient.get<CentralContact[]>(`/accounts/${accountId}/contacts`);
}

export function applyQuickFilter(rows: CentralContact[], q: QuickFilter): CentralContact[] {
  switch (q) {
    case "all":
      return rows;
    case "hot":
      return rows.filter((r) => (r.score ?? 0) >= 75);
    case "new":
    case "sdr":
    case "qualifying":
    case "negotiating":
    case "collections":
    case "post_sale":
    case "retention":
    case "no_response":
    case "closed_lost":
    case "do_not_contact":
      return rows.filter((r) => r.operational_status === q);
    case "lead":
      return rows.filter((r) => r.lifecycle_stage === "lead");
    case "customers":
      return rows.filter((r) => r.lifecycle_stage === "customer");
    case "inactive":
      return rows.filter((r) => r.lifecycle_stage === "inactive");
    case "delinquent":
      return rows.filter((r) => r.lifecycle_stage === "delinquent");
  }
}

export async function updateContactOps(
  accountId: string,
  id: string,
  patch: Partial<Pick<CentralContact, "lifecycle_stage" | "operational_status" | "owner_user_id">>,
) {
  await apiClient.patch(`/accounts/${accountId}/contacts/${id}`, {
    ...(patch.lifecycle_stage !== undefined ? { lifecycleStage: patch.lifecycle_stage } : {}),
    ...(patch.operational_status !== undefined
      ? { operationalStatus: patch.operational_status }
      : {}),
    ...(patch.owner_user_id !== undefined ? { ownerUserId: patch.owner_user_id } : {}),
  });
}

export type ListLite = { id: string; name: string; member_count: number };

export async function fetchLists(accountId: string): Promise<ListLite[]> {
  const lists = await apiClient.get<{ id: string; name: string; memberCount: number }[]>(
    `/accounts/${accountId}/contact-lists`,
  );
  return lists.map((l) => ({ id: l.id, name: l.name, member_count: l.memberCount }));
}

export async function addContactsToList(listId: string, accountId: string, contactIds: string[]) {
  if (!contactIds.length) return { inserted: 0 };
  return apiClient.post<{ inserted: number }>(
    `/accounts/${accountId}/contact-lists/${listId}/members`,
    { contactIds },
  );
}

export async function createListFromContacts(
  accountId: string,
  name: string,
  contactIds: string[],
): Promise<string> {
  return apiClient.post<string>(`/accounts/${accountId}/contact-lists`, { name, contactIds });
}

// Simple CSV parser (handles quotes, commas, semicolons)
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const lines = text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l) => l.trim().length > 0);
  if (!lines.length) return { headers: [], rows: [] };
  const delim = lines[0].includes(";") && !lines[0].includes(",") ? ";" : ",";
  const parse = (line: string) => {
    const out: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') inQ = false;
        else cur += ch;
      } else {
        if (ch === '"') inQ = true;
        else if (ch === delim) {
          out.push(cur);
          cur = "";
        } else cur += ch;
      }
    }
    out.push(cur);
    return out.map((c) => c.trim());
  };
  const headers = parse(lines[0]).map((h) => h.toLowerCase());
  const rows = lines.slice(1).map(parse);
  return { headers, rows };
}

export type ContactColumnMap = { iName: number; iPhone: number; iEmail: number };

export function detectContactColumns(headers: string[]): ContactColumnMap {
  const idx = (names: string[]) => {
    for (const n of names) {
      const i = headers.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  return {
    iName: idx(["nome", "name", "contato"]),
    iPhone: idx(["telefone", "phone", "phone_number", "celular", "whatsapp"]),
    iEmail: idx(["email", "e-mail", "mail"]),
  };
}

export async function importContactsCsv(
  accountId: string,
  text: string,
): Promise<{ created: number; updated: number; skipped: number }> {
  const { headers, rows } = parseCsv(text);
  if (!headers.length) return { created: 0, updated: 0, skipped: 0 };
  const { iName, iPhone, iEmail } = detectContactColumns(headers);
  const payload = rows.map((r) => ({
    name: iName >= 0 ? r[iName] || null : null,
    phoneNumber: iPhone >= 0 ? r[iPhone] || null : null,
    email: iEmail >= 0 ? r[iEmail] || null : null,
  }));
  if (!payload.length) return { created: 0, updated: 0, skipped: 0 };
  return apiClient.post<{ created: number; updated: number; skipped: number }>(
    `/accounts/${accountId}/contacts/import`,
    { rows: payload },
  );
}

// ============ Team / Owner ============
export type TeamLite = { user_id: string; name: string | null; email: string | null };
export async function fetchTeam(accountId: string): Promise<TeamLite[]> {
  const members = await listTeamMembers(accountId);
  return members.map((m) => ({ user_id: m.user_id, name: m.name ?? null, email: m.email ?? null }));
}

export async function bulkAssignOwner(
  accountId: string,
  contactIds: string[],
  ownerUserId: string | null,
) {
  if (!contactIds.length) return;
  await apiClient.post(`/accounts/${accountId}/contacts/bulk/owner`, { contactIds, ownerUserId });
}

export async function bulkSetLifecycle(
  accountId: string,
  contactIds: string[],
  stage: LifecycleStage,
) {
  if (!contactIds.length) return;
  await apiClient.post(`/accounts/${accountId}/contacts/bulk/lifecycle`, { contactIds, stage });
}

export async function bulkSetOperationalStatus(
  accountId: string,
  contactIds: string[],
  status: OperationalStatus,
) {
  if (!contactIds.length) return;
  await apiClient.post(`/accounts/${accountId}/contacts/bulk/operational-status`, {
    contactIds,
    status,
  });
}

// ============ Tags ============
export async function fetchTagSuggestions(accountId: string): Promise<string[]> {
  return apiClient.get<string[]>(`/accounts/${accountId}/contacts/tags/suggestions`);
}

export async function bulkAddTag(accountId: string, contactIds: string[], tag: string) {
  if (!contactIds.length || !tag.trim()) return;
  await apiClient.post(`/accounts/${accountId}/contacts/bulk/tag`, { contactIds, tag: tag.trim() });
}

// ============ Campaigns ============
export type CampaignLite = {
  id: string;
  name: string;
  status: string;
  campaign_kind: string | null;
};
export async function fetchEditableCampaigns(accountId: string): Promise<CampaignLite[]> {
  return apiClient.get<CampaignLite[]>(`/accounts/${accountId}/contacts/editable-campaigns`);
}

export async function bulkAddToCampaign(
  accountId: string,
  campaignId: string,
  contacts: { id: string; phone_number: string | null }[],
): Promise<{ added: number; skipped: number }> {
  return apiClient.post<{ added: number; skipped: number }>(
    `/accounts/${accountId}/contacts/bulk/campaign`,
    {
      campaignId,
      contacts: contacts.map((c) => ({ id: c.id, phoneNumber: c.phone_number })),
    },
  );
}

// ============ Productivity ============
export type OwnerProductivity = {
  user_id: string | null;
  name: string;
  contacts: number;
  hot: number;
  customers: number;
  delinquent: number;
  last7d_calls: number;
  last7d_whatsapp: number;
};

export async function fetchProductivity(accountId: string): Promise<OwnerProductivity[]> {
  return apiClient.get<OwnerProductivity[]>(`/accounts/${accountId}/contacts/productivity`);
}

export async function fetchContactTimeline(contactId: string, accountId: string) {
  return apiClient.get<{ calls: any[]; conversations: any[]; lists: any[] }>(
    `/accounts/${accountId}/contacts/${contactId}/timeline`,
  );
}

export function timeAgoShort(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso).getTime();
  const diff = Date.now() - d;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "agora";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d`;
  return new Date(iso).toLocaleDateString("pt-BR");
}

// ============ Round-robin owner assignment ============
export async function bulkAssignRoundRobin(
  accountId: string,
  contactIds: string[],
  ownerIds: string[],
): Promise<{ assigned: number }> {
  if (!contactIds.length || !ownerIds.length) return { assigned: 0 };
  return apiClient.post<{ assigned: number }>(`/accounts/${accountId}/contacts/bulk/round-robin`, {
    contactIds,
    ownerIds,
  });
}

// ============ Dedupe / Merge suggestions ============
export type DuplicateGroup = {
  key: string;
  kind: "phone" | "email";
  contacts: CentralContact[];
};

export function findDuplicateGroups(rows: CentralContact[]): DuplicateGroup[] {
  const byPhone = new Map<string, CentralContact[]>();
  const byEmail = new Map<string, CentralContact[]>();
  rows.forEach((r) => {
    if (r.phone_number) {
      const k = r.phone_number.replace(/\D/g, "");
      if (k.length >= 8) {
        if (!byPhone.has(k)) byPhone.set(k, []);
        byPhone.get(k)!.push(r);
      }
    }
    if (r.email) {
      const k = r.email.trim().toLowerCase();
      if (k.includes("@")) {
        if (!byEmail.has(k)) byEmail.set(k, []);
        byEmail.get(k)!.push(r);
      }
    }
  });
  const groups: DuplicateGroup[] = [];
  byPhone.forEach((list, key) => {
    if (list.length > 1) groups.push({ key, kind: "phone", contacts: list });
  });
  byEmail.forEach((list, key) => {
    if (list.length > 1) {
      // skip if this email-group is fully contained in an existing phone-group
      const ids = new Set(list.map((c) => c.id));
      const overlap = groups.some(
        (g) => g.contacts.length === list.length && g.contacts.every((c) => ids.has(c.id)),
      );
      if (!overlap) groups.push({ key, kind: "email", contacts: list });
    }
  });
  return groups.sort((a, b) => b.contacts.length - a.contacts.length);
}

export function pickPrimaryContact(list: CentralContact[]): CentralContact {
  // Best primary = highest score, then most recent activity
  return [...list].sort((a, b) => {
    const s = (b.score ?? 0) - (a.score ?? 0);
    if (s !== 0) return s;
    const ta = a.last_activity_at ? new Date(a.last_activity_at).getTime() : 0;
    const tb = b.last_activity_at ? new Date(b.last_activity_at).getTime() : 0;
    return tb - ta;
  })[0];
}

// ============ CSV export ============
export function contactsToCsv(rows: CentralContact[]): string {
  const headers = [
    "nome",
    "telefone",
    "email",
    "score",
    "ciclo_vida",
    "status_operacional",
    "ultima_atividade",
    "ultima_ligacao",
    "ultimo_whatsapp",
    "sentimento",
  ];
  const esc = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.join(",")];
  rows.forEach((r) => {
    lines.push(
      [
        r.name,
        r.phone_number,
        r.email,
        r.score,
        LIFECYCLE_LABEL[r.lifecycle_stage],
        OPERATIONAL_LABEL[r.operational_status],
        r.last_activity_at,
        r.last_call_at,
        r.last_whatsapp_at,
        r.last_sentiment,
      ]
        .map(esc)
        .join(","),
    );
  });
  return lines.join("\n");
}

export async function createManualContact(
  accountId: string,
  input: { name: string; phone_number?: string; email?: string },
): Promise<string> {
  const contact = await apiClient.post<{ id: string }>(`/accounts/${accountId}/contacts`, {
    name: input.name || undefined,
    phoneNumber: input.phone_number || undefined,
    email: input.email || undefined,
  });
  return contact.id;
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
