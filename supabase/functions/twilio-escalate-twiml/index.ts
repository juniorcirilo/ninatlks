// TwiML served to Twilio after voice-escalate redirects the call.
// ?mode=transfer&to=+15551234567 → <Dial> that number
// ?mode=voicemail                → <Say><Record>

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
};

function xml(body: string) {
  return new Response(body, {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "text/xml; charset=utf-8" },
  });
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

Deno.serve((req) => {
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") ?? "voicemail";

  if (mode === "transfer") {
    const to = url.searchParams.get("to") ?? "";
    if (!to) {
      return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR">Desculpe, nao consegui transferir. Deixe seu recado apos o sinal.</Say>
  <Record maxLength="120" playBeep="true"/>
  <Hangup/>
</Response>`);
    }
    return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR">Transferindo sua ligação para um atendente.</Say>
  <Dial timeout="30" answerOnBridge="true">${escapeXml(to)}</Dial>
  <Say language="pt-BR">Nao foi possivel completar a transferencia. Deixe uma mensagem.</Say>
  <Record maxLength="120" playBeep="true"/>
  <Hangup/>
</Response>`);
  }

  // voicemail
  return xml(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say language="pt-BR">Deixe seu recado apos o sinal. Retornamos o contato em breve.</Say>
  <Record maxLength="120" playBeep="true"/>
  <Hangup/>
</Response>`);
});
