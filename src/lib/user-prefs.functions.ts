// Preferências de UI por usuário (colunas visíveis, filtros salvos, etc.),
// persistidas em `profiles.ui_settings` (jsonb) — um bucket por `key`.
// Existe desde a migration inicial mas nunca tinha sido consumido; é o lugar
// certo pra "salvar no perfil do usuário" em vez de localStorage (sobrevive
// à troca de navegador/dispositivo).

import { createServerFn } from "@tanstack/react-start";
import { requireSessionAuth } from "@/lib/session-middleware";
import { z } from "zod";
import { getOne, query } from "@/lib/db";

export const getUiSetting = createServerFn({ method: "GET" })
  .middleware([requireSessionAuth])
  .inputValidator((d) => z.object({ key: z.string().min(1).max(100) }).parse(d))
  .handler(async ({ data, context }) => {
    const row = await getOne<{ value: unknown }>(
      `SELECT ui_settings -> $2 AS value FROM public.profiles WHERE id = $1`,
      [context.userId, data.key],
    );
    return { value: row?.value ?? null };
  });

/** userId vem do contexto de sessão (nunca do client) — ninguém sobrescreve
 * a preferência de outra pessoa passando um id diferente. */
export const saveUiSetting = createServerFn({ method: "POST" })
  .middleware([requireSessionAuth])
  .inputValidator((d) =>
    z.object({ key: z.string().min(1).max(100), value: z.unknown() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    await query(
      `UPDATE public.profiles
          SET ui_settings = jsonb_set(coalesce(ui_settings, '{}'::jsonb), ARRAY[$2]::text[], $3::jsonb, true)
        WHERE id = $1`,
      [context.userId, data.key, JSON.stringify(data.value ?? {})],
    );
    return { ok: true };
  });
