/**
 * `buscarRepartidores`: the source of every repartidor autocomplete (the envío in the entregas modal, the "Exportar
 * envíos" dialog, openspec/specs/envios-repartidores/spec.md "Permisos"). Allowed with `entregas.registrar` OR
 * `repartidores.gestionar`.
 *
 * `defineQuery` takes exactly ONE permiso, so the "either" is two registered queries over the same handler (each one
 * runs its own `authorize()` in the pipeline) and `buscarRepartidores` picks the one the session can run. A session
 * holding neither is rejected by the pipeline with the usual `AuthorizationError` (and its `ACCESO_DENEGADO` audit).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import type { QueryHandlerArgs } from "@/shared/usecase";
import { can } from "@/shared/auth/authorize";
import { requireSession } from "@/shared/auth/session";
import type { RepartidorOpcion } from "../domain/repartidor";
import { buscarRepartidores as buscarRepartidoresRepo } from "../infrastructure/repartidor-repository";

/** Most rows an autocomplete asks for. */
export const BUSCAR_REPARTIDORES_LIMIT = 20;

/** Exported for tests/unit/repartidores-validacion.test.ts. `soloActivos` defaults to `true`: only a caller that must see inactive ones (a hoja de envíos of a repartidor already deactivated) opts out. */
export const buscarRepartidoresInput = z
  .object({
    texto: z.string().trim().max(100).default(""),
    soloActivos: z.boolean().default(true),
  })
  .strict();

export type BuscarRepartidoresInput = z.input<typeof buscarRepartidoresInput>;

type Parsed = z.output<typeof buscarRepartidoresInput>;

async function handler({ tx, session, input }: QueryHandlerArgs<Parsed>): Promise<RepartidorOpcion[]> {
  return buscarRepartidoresRepo(tx, { tenantId: session.tenantId, texto: input.texto, soloActivos: input.soloActivos, limit: BUSCAR_REPARTIDORES_LIMIT });
}

/** Through `entregas.registrar`: whoever registers envíos or exports the hoja. */
export const buscarRepartidoresQuery = defineQuery({
  name: "repartidores.buscar",
  permiso: "entregas.registrar",
  input: buscarRepartidoresInput,
  handler,
});

/** Through `repartidores.gestionar`: the catalog administrator (ADMINISTRADOR holds no operativo permiso such as `entregas.registrar`). */
export const buscarRepartidoresGestionQuery = defineQuery({
  name: "repartidores.buscarGestion",
  permiso: "repartidores.gestionar",
  input: buscarRepartidoresInput,
  handler,
});

export async function buscarRepartidores(input: BuscarRepartidoresInput): Promise<RepartidorOpcion[]> {
  const session = await requireSession();
  // Neither permiso: the first query runs and its pipeline rejects the session.
  const query = !can(session, "entregas.registrar") && can(session, "repartidores.gestionar") ? buscarRepartidoresGestionQuery : buscarRepartidoresQuery;
  return query.execute(input);
}
