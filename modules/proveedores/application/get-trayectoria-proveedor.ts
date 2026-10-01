/**
 * `getTrayectoriaProveedor` (docs/specs/trayectoria-proveedor.md): read-only
 * "everything this proveedor supplied, partida by partida", for
 * `/proveedores/[id]/trayectoria`. Gated on `proveedores.gestionar`; the URL
 * carries only the opaque proveedor id and a plain `?page=` integer.
 *
 * `defineQuery` takes ONE permiso (and a denial writes an ACCESO_DENEGADO
 * audit row), so the optional blocks use `can()` instead of other
 * `defineQuery` use cases: costos (`stock.valorizado.ver`), preparaciones
 * (`preparaciones.iniciar`), contralor (`libro.ver`) and correcciones de costo
 * (`auditoria.ver`) are not even queried when the session lacks them. Reads
 * are not audited (project convention). Returns `null` when the proveedor
 * does not exist in the tenant (the page answers 404).
 *
 * No receta / paciente data is read here, ever (see the repository header).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { can } from "@/shared/auth/authorize";
import type { AuthenticatedSession } from "@/shared/auth/session";
import { uuid } from "@/shared/validation";
import { PAGE_MAX_TRAYECTORIA_PROVEEDOR, PAGE_SIZE_TRAYECTORIA_PROVEEDOR, armarTrayectoriaProveedor } from "../domain/trayectoria";
import type { AccesoTrayectoriaProveedor, TrayectoriaProveedor } from "../domain/trayectoria";
import { getTrayectoriaProveedorCruda } from "../infrastructure/trayectoria-repository";

export type { TrayectoriaProveedor };

const getTrayectoriaProveedorInput = z.object({
  proveedorId: uuid,
  page: z.number().int().min(1).max(PAGE_MAX_TRAYECTORIA_PROVEEDOR).default(1),
});

export type GetTrayectoriaProveedorInput = z.input<typeof getTrayectoriaProveedorInput>;

/** Each flag is the permiso of the block / of the target detail page's own guard. */
export function accesoTrayectoriaProveedor(session: AuthenticatedSession): AccesoTrayectoriaProveedor {
  return {
    costos: can(session, "stock.valorizado.ver"),
    preparaciones: can(session, "preparaciones.iniciar"),
    contralor: can(session, "libro.ver"),
    correcciones: can(session, "auditoria.ver"),
    linkPartida: can(session, "stock.ver"),
  };
}

export const getTrayectoriaProveedorQuery = defineQuery({
  name: "proveedores.trayectoria",
  permiso: "proveedores.gestionar",
  input: getTrayectoriaProveedorInput,
  handler: async ({ tx, session, input }): Promise<TrayectoriaProveedor | null> => {
    const acceso = accesoTrayectoriaProveedor(session);
    const cruda = await getTrayectoriaProveedorCruda(tx, session.tenantId, input.proveedorId, input.page, PAGE_SIZE_TRAYECTORIA_PROVEEDOR, acceso);
    return cruda ? armarTrayectoriaProveedor(cruda, acceso) : null;
  },
});

export async function getTrayectoriaProveedor(input: GetTrayectoriaProveedorInput): Promise<TrayectoriaProveedor | null> {
  return getTrayectoriaProveedorQuery.execute(input);
}
