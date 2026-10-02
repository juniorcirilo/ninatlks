import { createFileRoute } from "@tanstack/react-router";
import { CobrancasPage } from "./cobrancas";

export const Route = createFileRoute("/_authenticated/agents/cobrancas")({
  head: () => ({
    meta: [{ title: "Cobranças — Diego — Nina Talks" }],
  }),
  component: CobrancasPage,
});
