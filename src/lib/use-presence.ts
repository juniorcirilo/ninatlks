import { useCallback, useEffect, useRef, useState } from "react";
import { subscribePresence } from "@/lib/realtime-client";

export type ContactPresence = {
  state: "composing" | "recording" | "online" | "offline";
  /** epoch (ms) do último acesso, quando o contato o expõe */
  lastSeen?: number;
};

const key = (phone: string | null | undefined) => (phone ?? "").replace(/\D/g, "").slice(-8);
const TYPING_TTL_MS = 7_000;

/**
 * Presença dos contatos em tempo real, indexada pelos 8 últimos dígitos
 * (tolera DDI e o 9º dígito). "Digitando/gravando" expira sozinho (o
 * WhatsApp nem sempre manda o "paused") e volta ao estado online.
 */
export function usePresenceMap(): (phone: string | null | undefined) => ContactPresence | null {
  const [map, setMap] = useState<Record<string, ContactPresence>>({});
  const timers = useRef<Record<string, number>>({});

  useEffect(() => {
    const pending = timers.current;
    const off = subscribePresence((e) => {
      const k = key(e.jid);
      if (k.length < 8) return;
      window.clearTimeout(pending[k]);
      const lastSeen = e.lastSeen ? e.lastSeen * (e.lastSeen < 1e12 ? 1000 : 1) : undefined;
      setMap((m) => {
        const prev = m[k];
        let next: ContactPresence;
        switch (e.presence) {
          case "composing":
          case "recording":
            next = { state: e.presence, lastSeen: prev?.lastSeen };
            break;
          case "available":
          case "paused":
            next = { state: "online", lastSeen };
            break;
          default:
            next = { state: "offline", lastSeen: lastSeen ?? prev?.lastSeen };
        }
        return { ...m, [k]: next };
      });
      if (e.presence === "composing" || e.presence === "recording") {
        pending[k] = window.setTimeout(
          () => setMap((m) => ({ ...m, [k]: { state: "online" } })),
          TYPING_TTL_MS,
        );
      }
    });
    return () => {
      off();
      Object.values(pending).forEach((t) => window.clearTimeout(t));
    };
  }, []);

  return useCallback((phone) => map[key(phone)] ?? null, [map]);
}

export function presenceLabel(p: ContactPresence | null): string | null {
  if (!p) return null;
  if (p.state === "composing") return "digitando…";
  if (p.state === "recording") return "gravando áudio…";
  if (p.state === "online") return "online";
  if (!p.lastSeen) return "offline";
  const d = new Date(p.lastSeen);
  const hm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString()
    ? `visto por último hoje às ${hm}`
    : `visto por último ${d.toLocaleDateString("pt-BR")} às ${hm}`;
}
