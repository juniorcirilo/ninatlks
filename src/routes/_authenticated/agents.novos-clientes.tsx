import { createFileRoute } from "@tanstack/react-router";
import { NovosClientesPage } from "./novos-clientes";

export const Route = createFileRoute("/_authenticated/agents/novos-clientes")({
  head: () => ({
    meta: [{ title: "Novos Clientes — Larissa — Utalks" }],
  }),
  component: NovosClientesPage,
});
