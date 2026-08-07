import { createFileRoute } from '@tanstack/react-router'
// Cron-triggered endpoint: pega chamadas EL que ficaram travadas em
// queued/ringing/in_progress há mais de 90s e dispara voice-call-finalize
// pra cada uma. Isso garante que mesmo se o webhook EL não chegar, o
// transcript + áudio + classificação acontecem.

import { supabaseAdmin } from "@/lib/db";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export const Route = createFileRoute("/api/public/hooks/voice-calls-finalize-pending")({
  server: {
    handlers: {
      OPTIONS: async () =>
        new Response(null, { status: 204, headers: corsHeaders }),

      POST: async () => {
        const cutoff = new Date(Date.now() - 90 * 1000).toISOString();

        // Pega:
        // 1. Chamadas travadas em queued/ringing/in_progress > 90s
        // 2. Chamadas 'completed' órfãs (sem ended_at OU sem transcript)
        const pendingResult = await supabaseAdmin.query(
          `SELECT id, account_id FROM voice_calls
           WHERE source_id IS NOT NULL
           AND (
             (status IN ('queued','ringing','in_progress') AND started_at < $1)
             OR (status = 'completed' AND ended_at IS NULL)
             OR (status = 'completed' AND transcript IS NULL)
           )
           ORDER BY started_at ASC
           LIMIT 50`,
          [cutoff]
        );

        const pending = pendingResult.data;

        const results: Array<{ id: string; ok: boolean; reason?: string }> = [];

        // Roda em sequência (curto número, evita martelar EL)
        for (const c of pending) {
          try {
            const { data, error: invErr } = await supabaseAdmin.functions.invoke(
              "voice-call-finalize",
              { body: { voice_call_id: c.id } },
            );
            if (invErr) {
              results.push({ id: c.id, ok: false, reason: invErr });
            } else {
              results.push({ id: c.id, ok: true, reason: (data as any)?.skipped ? "skipped" : "finalized" });
            }
          } catch (err) {
            results.push({ id: c.id, ok: false, reason: String(err) });
          }
        }

        // 3. Re-classificar calls cujo contato vinculado segue SEM nome.
        // Roda lead-classify-from-call de novo (idempotente: heurístico/LLM
        // melhores podem extrair nome agora). Limita a 1× por call via
        // metadata.name_reclassified_at.
        const reclassResults: Array<{ id: string; ok: boolean; reason?: string }> = [];
        try {
          const candidates = await supabaseAdmin.query(
            `SELECT vc.id, vc.conversation_id, vc.metadata, vc.transcript, c.id as contact_id, c.name as contact_name
             FROM voice_calls vc
             LEFT JOIN conversations conv ON conv.id = vc.conversation_id
             LEFT JOIN contacts c ON c.id = conv.contact_id
             WHERE vc.status = 'completed'
             AND vc.transcript IS NOT NULL
             AND vc.outcome_classified_at IS NOT NULL
             LIMIT 50`
          );

          for (const c of candidates.data) {
            if (!c.contact_id) continue;
            if (typeof c.contact_name === "string" && c.contact_name.trim()) continue;
            if (c.metadata?.name_reclassified_at) continue;

            try {
              await supabaseAdmin.functions.invoke("lead-classify-from-call", {
                body: { voice_call_id: c.id },
              });
              await supabaseAdmin.from("voice_calls").update({
                metadata: { ...(c.metadata ?? {}), name_reclassified_at: new Date().toISOString() },
              }).eq("id", c.id);
              reclassResults.push({ id: c.id, ok: true });
            } catch (err) {
              reclassResults.push({ id: c.id, ok: false, reason: String(err) });
            }
          }
        } catch (err) {
          console.warn("[finalize-pending] name reclass pass failed:", err);
        }

        console.log(
          `[finalize-pending] processed=${results.length} reclass=${reclassResults.length}`,
        );

        return new Response(
          JSON.stringify({
            ok: true,
            processed: results.length,
            results,
            name_reclass: reclassResults,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      },
    },
  },
});
