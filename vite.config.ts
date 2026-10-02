// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - tanstackStart, viteReact, tailwindcss, tsConfigPaths, cloudflare (build-only),
//     componentTagger (dev-only), VITE_* env injection, @ path alias, React/TanStack dedupe,
//     error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... } }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

export default defineConfig({
  server: {
    port: 8080,
    allowedHosts: ["utalks.ubva.com.br", "192.168.3.103:30004", "localhost:30004"],
    fs: {
      deny: [".env", ".env.*", "*.{crt,pem}", "**/.git/**", "**/Dockerfile"],
    },
  },
}); 