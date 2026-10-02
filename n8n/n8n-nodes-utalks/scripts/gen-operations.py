#!/usr/bin/env python3
"""Gera nodes/Utalks/operations.ts a partir de scripts/routes.txt.

routes.txt vem dos controllers do servidor (uma rota por linha:
`METHOD /accounts/:accountId/... [P] handler arquivo.controller.ts`).
Rode de novo quando o servidor ganhar rotas: python3 scripts/gen-operations.py
"""
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREFIX = "/accounts/:accountId"

# (prefixo do caminho depois de /accounts/:accountId) -> recurso. O primeiro que casar vence.
RESOURCE_BY_PREFIX = [
    ("/contact-lists", "contactList"),
    ("/contacts", "contact"),
    ("/calls", "call"),
    ("/voice/calls", "call"),
    ("/campaigns", "campaign"),
    ("/retention-rules", "campaign"),
    ("/companies", "company"),
    ("/dnc", "compliance"),
    ("/compliance-policy", "compliance"),
    ("/dashboards", "dashboard"),
    ("/elevenlabs", "elevenlabs"),
    ("/evolution", "whatsapp"),
    ("/google-calendar", "googleCalendar"),
    ("/agent-sources", "agentSource"),
    ("/integrations-status", "account"),
    ("/meetings", "meeting"),
    ("/availability", "meeting"),
    ("/doctors", "professional"),
    ("/messages", "message"),
    ("/conversations", "conversation"),
    ("/notifications", "notification"),
    ("/personas", "agent"),
    ("/persona-deployments", "agent"),
    ("/agent-llm-provider", "agent"),
    ("/pipeline", "pipeline"),
    ("/cadences", "cadence"),
    ("/twilio", "telephony"),
    ("/phone-numbers", "telephony"),
    ("/voice-clone", "telephony"),
    ("/webhook-endpoints", "webhook"),
    ("/webhook-deliveries", "webhook"),
    ("/dialing-settings", "account"),
    ("/my-availability", "account"),
    ("/inboxes", "account"),
]

RESOURCE_LABEL = {
    "account": "Conta",
    "agent": "Agente (persona)",
    "agentSource": "Fonte de dados do agente",
    "call": "Ligação",
    "cadence": "Cadência",
    "campaign": "Campanha",
    "company": "Empresa",
    "compliance": "Compliance (DNC)",
    "contact": "Contato",
    "contactList": "Lista de contatos",
    "conversation": "Conversa",
    "dashboard": "Dashboard",
    "elevenlabs": "ElevenLabs",
    "googleCalendar": "Google Calendar",
    "meeting": "Reunião",
    "message": "Mensagem",
    "notification": "Notificação",
    "pipeline": "Pipeline",
    "professional": "Profissional (agenda)",
    "telephony": "Telefonia",
    "webhook": "Webhook de saída",
    "whatsapp": "WhatsApp (Evolution)",
}

# Fora do node: administração de segurança, fluxo de OAuth/UI e rotas que
# devolvem segredos. O servidor também recusa a chave do node em /auth,
# /secrets, /api-keys, /members e /invites.
EXCLUDE = re.compile(
    r"^/(secrets|api-keys|members|invites|onboarding|attachments|webhook-secret"
    r"|google-calendar/connect|agent-sources/n8n)(/|$)"
)

# Rótulo em português por handler. Genéricos (listar/obter/criar...) ganham o
# final do caminho quando o recurso tem mais de um (ex.: regras de retenção).
HANDLER_LABEL = {
    "list": "Listar", "get": "Obter", "getOne": "Obter", "detail": "Obter",
    "create": "Criar", "update": "Atualizar", "remove": "Excluir",
    "delete": "Excluir", "put": "Salvar", "set": "Salvar", "save": "Salvar",
    "send": "Enviar", "start": "Iniciar", "add": "Adicionar", "upsert": "Criar ou atualizar",
    "getDialing": "Obter configuração de discagem", "putDialing": "Salvar configuração de discagem",
    "getMyAvailability": "Obter minha disponibilidade", "setMyAvailability": "Salvar minha disponibilidade",
    "listInboxes": "Listar caixas de entrada", "check": "Verificar integrações",
    "listModels": "Listar modelos de LLM", "testConnection": "Testar provedor de LLM",
    "getAvailability": "Obter disponibilidade", "setAvailability": "Salvar disponibilidade",
    "enroll": "Inscrever contato", "batches": "Listar lotes de inscrição",
    "batchPreview": "Pré-visualizar lote", "approveBatch": "Aprovar lote",
    "rejectBatch": "Rejeitar lote", "personas": "Listar agentes disponíveis",
    "phoneNumbers": "Listar números disponíveis", "contactLists": "Listar listas de contatos",
    "contacts": "Listar contatos da campanha", "exportCsv": "Exportar CSV",
    "updateStatus": "Alterar status", "retryFailed": "Tentar novamente (falhas)",
    "cancelCalls": "Cancelar ligações em andamento",
    "listClients": "Listar clientes", "listContacts": "Listar contatos",
    "link": "Vincular contato", "linkImport": "Vincular contatos (importação)",
    "deleteAll": "Excluir todas", "candidates": "Listar candidatos",
    "updateOps": "Atualizar dados operacionais", "importCsv": "Importar CSV",
    "bulkAssignOwner": "Em massa: atribuir responsável",
    "bulkSetLifecycle": "Em massa: definir ciclo de vida",
    "bulkSetOperationalStatus": "Em massa: definir status operacional",
    "bulkAddTag": "Em massa: adicionar tag", "bulkRoundRobin": "Em massa: distribuir (round-robin)",
    "bulkAddToCampaign": "Em massa: adicionar à campanha",
    "tagSuggestions": "Sugestões de tags", "productivity": "Produtividade",
    "getVariables": "Obter variáveis", "setVariables": "Salvar variáveis",
    "timeline": "Linha do tempo", "editableCampaigns": "Campanhas editáveis",
    "addMembers": "Adicionar membros", "listMembers": "Listar membros",
    "listDocuments": "Listar documentos",
    "sdrSnapshot": "Painel SDR", "missionControlSnapshot": "Mission control",
    "agentAnalyticsResult": "Analytics do agente",
    "updateSettings": "Atualizar ajustes da voz", "preview": "Prévia de voz",
    "syncAgent": "Sincronizar agente com ElevenLabs", "getAgentInfo": "Obter agente na ElevenLabs",
    "addKnowledgeBase": "Adicionar base de conhecimento", "callAudio": "Obter áudio da ligação",
    "test": "Testar conexão", "provision": "Provisionar canal", "qrcode": "Obter QR code",
    "status": "Ver status", "lgpdDelete": "Excluir dados (LGPD)", "merge": "Mesclar contatos",
    "disconnect": "Desconectar", "run": "Executar agora", "failures": "Listar falhas",
    "resolveFailure": "Resolver falha", "reschedule": "Reagendar", "cancel": "Cancelar",
    "setOutcome": "Registrar resultado", "messages": "Listar mensagens",
    "unreadCount": "Contar não lidas", "markRead": "Marcar como lida",
    "markAllRead": "Marcar todas como lidas", "findActiveForInbox": "Obter ativo da caixa de entrada",
    "deploy": "Publicar em caixa de entrada", "listDeployments": "Listar publicações",
    "distill": "Destilar conhecimento", "suggestReply": "Sugerir resposta",
    "generatePrompt": "Gerar prompt", "move": "Mover lead de etapa",
    "owned": "Listar números da conta", "search": "Buscar números", "buy": "Comprar número",
    "import": "Importar número", "activateElevenLabs": "Ativar na ElevenLabs",
    "clone": "Clonar voz", "placeCall": "Fazer ligação", "generateSummary": "Gerar resumo",
    "retryTranscription": "Refazer transcrição", "cancelCall": "Cancelar ligação",
    "reclassify": "Reclassificar", "rotateSecret": "Rotacionar segredo",
    "get_account": "Obter conta",
}
GENERIC = {"list", "get", "getOne", "detail", "create", "update", "remove", "delete",
           "put", "set", "save", "send", "start", "add", "upsert"}


def humanize(name: str) -> str:
    if name in HANDLER_LABEL:
        return HANDLER_LABEL[name]
    spaced = re.sub(r"(?<!^)(?=[A-Z])", " ", name)
    return spaced[:1].upper() + spaced[1:]


def main() -> None:
    ops = []
    seen = {}
    for raw in (ROOT / "routes.txt").read_text().splitlines():
        m = re.match(r"^(GET|POST|PATCH|PUT|DELETE)\s+(\S+)\s+(P\s+)?(\w+)\s+\S+$", raw.strip())
        if not m:
            continue
        method, path, public, handler = m.group(1), m.group(2), m.group(3), m.group(4)
        if public or not path.startswith(PREFIX):
            continue
        rel = path[len(PREFIX):] or "/"
        if rel == "/":
            resource = "account"
        else:
            if EXCLUDE.match(rel):
                continue
            resource = next((r for p, r in RESOURCE_BY_PREFIX if rel == p or rel.startswith(p + "/")), None)
            if resource is None:
                continue
        # LGPD e merge ficam no contato
        if rel.endswith("/lgpd") or rel == "/contacts/merge":
            resource = "contact"

        params = re.findall(r":(\w+)", rel)
        sub = re.sub(r"/:\w+", "", rel).strip("/")
        verb = humanize(handler)
        # desambigua handlers genéricos usando o final do caminho
        label = verb
        generic = handler in GENERIC
        tail = sub.split("/", 1)[1] if "/" in sub else ""
        if generic and tail:
            label = f"{verb} ({tail.replace('/', ' / ')})"
        elif generic and params and method == "GET" and handler in ("list",):
            label = verb
        value = f"{method.lower()}_{sub.replace('/', '_').replace('-', '_') or 'account'}"
        if params:
            value += "_by_" + "_".join(params)
        value = re.sub(r"\W+", "_", value)
        key = (resource, value)
        if key in seen:
            value += f"_{handler}"
            key = (resource, value)
        seen[key] = True
        ops.append({
            "resource": resource,
            "value": value,
            "name": label,
            "method": method,
            "path": rel,
            "pathParams": params,
            "query": method in ("GET", "DELETE") or method == "POST" and handler in ("exportCsv",),
            "body": method in ("POST", "PATCH", "PUT"),
        })

    # nomes únicos dentro do recurso
    by_res = {}
    for o in ops:
        by_res.setdefault(o["resource"], []).append(o)
    for lst in by_res.values():
        count = {}
        for o in lst:
            count[o["name"]] = count.get(o["name"], 0) + 1
        for o in lst:
            if count[o["name"]] > 1:
                o["name"] = f'{o["name"]} — {o["method"]} {o["path"]}'

    order = list(RESOURCE_LABEL)
    ops.sort(key=lambda o: (order.index(o["resource"]), o["path"], o["method"]))

    out = ["// GERADO por scripts/gen-operations.py — não edite à mão.\n",
           "export interface OperationDef {\n  resource: string;\n  value: string;\n  name: string;\n"
           "  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';\n  /** relativo a /accounts/{accountId}; `:param` vira campo do node */\n  path: string;\n"
           "  pathParams: string[];\n  query: boolean;\n  body: boolean;\n}\n\n",
           "export const RESOURCES: Array<{ name: string; value: string }> = "
           + json.dumps([{"name": RESOURCE_LABEL[r], "value": r} for r in order if r in by_res], ensure_ascii=False, indent=2)
           + ";\n\n",
           "export const OPERATIONS: OperationDef[] = "
           + json.dumps(ops, ensure_ascii=False, indent=2) + ";\n"]
    target = ROOT.parent / "nodes" / "Utalks" / "operations.ts"
    target.write_text("".join(out))
    print(f"{len(ops)} operações em {len(by_res)} recursos -> {target}")
    for r in order:
        if r in by_res:
            print(f"  {RESOURCE_LABEL[r]:28} {len(by_res[r])}")


if __name__ == "__main__":
    main()
