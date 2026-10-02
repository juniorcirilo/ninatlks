import { createFileRoute } from "@tanstack/react-router";
import { OrcamentosPage } from "./orcamentos";

export const Route = createFileRoute("/_authenticated/agents/orcamentos")({
  head: () => ({
    meta: [{ title: "Orçamentos — Bruno — Nina Talks" }],
  }),
  component: OrcamentosPage,
});
