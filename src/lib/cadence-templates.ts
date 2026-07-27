import type { CadenceStep, CadenceTriggerEvent } from "@/lib/cadences";

export type CadenceTemplate = {
  id: string;
  name: string;
  description: string;
  trigger_event: CadenceTriggerEvent;
  steps: CadenceStep[];
  /** Frase curta pra exibir no card. */
  hint: string;
};

export const CADENCE_TEMPLATES: CadenceTemplate[] = [
  {
    id: "reengage-cold",
    name: "Reengajar lead frio",
    description:
      "Lead foi qualificado mas sumiu. Nina liga em 2 dias, depois mais 5 dias se não responder.",
    trigger_event: "stage_change",
    hint: "Lead que entrou em 'Qualificado' e não avançou — Nina puxa de volta.",
    steps: [
      { offset_hours: 48, channel: "voice" },
      { offset_hours: 168, channel: "voice" }, // +5 dias após o primeiro
    ],
  },
  {
    id: "rescue-noshow",
    name: "Resgatar no-show",
    description:
      "Lead não apareceu na reunião. Nina liga em 30min, e depois no dia seguinte de manhã.",
    trigger_event: "no_show",
    hint: "Reuniões que viraram no-show — recupera antes que esfrie.",
    steps: [
      { offset_hours: 0.5, channel: "voice" },
      { offset_hours: 18, channel: "voice" },
    ],
  },
  {
    id: "post-meeting",
    name: "Pós-reunião sem fechamento",
    description:
      "Reunião realizada mas sem decisão. Nina faz check-in em 3 dias e depois em 7.",
    trigger_event: "meeting_attended",
    hint: "Mantém o lead aquecido enquanto o time comercial segue o processo.",
    steps: [
      { offset_hours: 72, channel: "voice" },
      { offset_hours: 168, channel: "voice" },
    ],
  },
];
