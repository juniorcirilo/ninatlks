import {
  Outlet,
  Link,
  createRootRouteWithContext,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import appCss from "../styles.css?url";
import { AuthProvider } from "@/lib/auth-context";

interface RouterContext {
  queryClient: QueryClient;
}

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-gradient-primary">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Página não encontrada</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          O recurso que você procura não existe ou foi movido.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-gradient-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow-glow transition-opacity hover:opacity-90"
          >
            Voltar para o painel
          </Link>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Nina Talks — Agente de SDR por voz" },
      {
        name: "description",
        content:
          "Nina Talks é o agente de SDR por voz com IA. Atende inbound, qualifica leads em tempo real, agenda reuniões e entrega briefing pro seu time comercial.",
      },
      { name: "author", content: "Nina Talks" },
      { name: "theme-color", content: "#1a1030" },
      { property: "og:title", content: "Nina Talks — Agente de SDR por voz" },
      {
        property: "og:description",
        content:
          "Agente de SDR autônomo com voz neural, qualificação automática e agendamento integrado.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "Nina Talks — Agente de SDR por voz" },
      { name: "description", content: "Nina Talks is an AI-powered SDR voice agent that qualifies inbound leads, schedules meetings, and hands off enriched briefings to human reps." },
      { property: "og:description", content: "Nina Talks is an AI-powered SDR voice agent that qualifies inbound leads, schedules meetings, and hands off enriched briefings to human reps." },
      { name: "twitter:description", content: "Nina Talks is an AI-powered SDR voice agent that qualifies inbound leads, schedules meetings, and hands off enriched briefings to human reps." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/dbbad1b1-4371-4d4f-bac2-5100c7474d25/id-preview-7aabe68b--975b0cb1-8180-4007-a7ad-ebcba2bc4122.lovable.app-1777494093066.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/dbbad1b1-4371-4d4f-bac2-5100c7474d25/id-preview-7aabe68b--975b0cb1-8180-4007-a7ad-ebcba2bc4122.lovable.app-1777494093066.png" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/favicon.ico" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Outlet />
      </AuthProvider>
    </QueryClientProvider>
  );
}

