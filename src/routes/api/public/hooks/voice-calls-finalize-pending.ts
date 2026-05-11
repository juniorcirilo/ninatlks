// Cron-triggered endpoint: pega chamadas EL que ficaram travadas em
// queued/ringing/in_progress há mais de 90s e dispara voice-call-finalize
// pra cada uma. Isso garante que mesmo se o webhook EL não chegar, o
// transcript + áudio + classificação acontecem.

import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

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
        const { data: pending, error } = await supabaseAdmin
          .from("voice_calls")
          .select("id, account_id")
          .not("source_id", "is", null)
          .or(
            `and(status.in.(queued,ringing,in_progress),started_at.lt.${cutoff}),and(status.eq.completed,ended_at.is.null),and(status.eq.completed,transcript.is.null)`,
          )
          .order("started_at", { ascending: true })
          .limit(50);

        if (error) {
          console.error("[finalize-pending] query failed", error);
          return new Response(
            JSON.stringify({ error: error.message }),
            { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
          );
        }

        const results: Array<{ id: string; ok: boolean; reason?: string }> = [];

        // Roda em sequência (curto número, evita martelar EL)
        for (const c of pending ?? []) {
          try {
            const { data, error: invErr } = await supabaseAdmin.functions.invoke(
              "voice-call-finalize",
              { body: { voice_call_id: c.id } },
            );
            if (invErr) {
              results.push({ id: c.id, ok: false, reason: invErr.message });
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
          const { data: candidates } = await supabaseAdmin
            .from("voice_calls")
            .select("id, conversation_id, metadata, transcript, conversations:conversation_id(contact:contact_id(id, name))")
            .eq("status", "completed")
            .not("transcript", "is", null)
            .not("outcome_classified_at", "is", null)
            .limit(50);

          for (const c of (candidates ?? []) as any[]) {
            const contact = c.conversations?.contact;
            if (!contact?.id) continue;
            if (typeof contact.name === "string" && contact.name.trim()) continue;
            if (c.metadata?.name_reclassified_at) continue;

            try {
              await supabaseAdmin.functions.invoke("lead-classify-from-call", {
                body: { voice_call_id: c.id },
              });
              await supabaseAdmin
                .from("voice_calls")
                .update({
                  metadata: { ...(c.metadata ?? {}), name_reclassified_at: new Date().toISOString() },
                })
                .eq("id", c.id);
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
