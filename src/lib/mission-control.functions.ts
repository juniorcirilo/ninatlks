// Mission Control — cockpit executivo em tempo real.
// Agrega o estado vivo da operação omnichannel + Funcionários IA:
//  - conversas abertas / pendentes / snoozed
//  - volume de mensagens, handoffs e reuniões na última hora
//  - top conversas "quentes" (mais mensagens nas últimas 2h)
//  - stream recente de handoffs (quem passou pra quem, e por quê)
//  - escala humana on-duty (agentes que enviaram mensagem nas últimas 15 min)

import { apiClient } from "@/lib/api-client";

export interface MissionLiveKpis {
  open_conversations: number;
  pending_conversations: number;
  snoozed_conversations: number;
  unassigned_open: number;
  messages_last_hour: number;
  inbound_last_hour: number;
  outbound_last_hour: number;
  handoffs_last_hour: number;
  meetings_last_hour: number;
  agents_on_duty: number;
  avg_first_reply_min: number | null;
}

export interface HotConversation {
  conversation_id: string;
  display_id: number;
  status: number;
  priority: number;
  message_count_2h: number;
  last_activity_at: string;
  contact_name: string | null;
  inbox_name: string | null;
  assignee_id: string | null;
}

export interface HandoffEvent {
  id: string;
  created_at: string;
  reason: string;
  from_name: string | null;
  to_name: string | null;
  to_kind: "persona" | "human";
  conversation_id: string;
}

export interface PersonaPulse {
  persona_id: string;
  name: string;
  kind: string;
  status: string;
  messages_last_hour: number;
  handoffs_last_hour: number;
}

export interface MissionControlSnapshot {
  generated_at: string;
  kpis: MissionLiveKpis;
  hot_conversations: HotConversation[];
  recent_handoffs: HandoffEvent[];
  persona_pulse: PersonaPulse[];
}

export async function getMissionControlSnapshot(
  accountId: string,
): Promise<MissionControlSnapshot> {
  return apiClient.get<MissionControlSnapshot>(`/accounts/${accountId}/dashboards/mission-control`);
}
