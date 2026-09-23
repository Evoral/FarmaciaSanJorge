/**
 * `getUsuario` (M03, FASE 3 point 3.7): detail view. Returns `null` for a
 * nonexistent usuario or the (hidden) technical user -- the UI/route
 * renders a not-found page either way, never distinguishing them (that
 * distinction would itself leak the technical user's existence).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { uuid } from "@/shared/validation";
import { getUsuarioDetalle } from "../infrastructure/usuario-repository";
import type { UsuarioDetalle } from "../infrastructure/usuario-repository";

const getUsuarioInput = z.object({ id: uuid });

export const getUsuarioQuery = defineQuery({
  name: "usuarios.ver",
  permiso: "usuarios.ver",
  input: getUsuarioInput,
  handler: async ({ tx, session, input }) => getUsuarioDetalle(tx, session.tenantId, input.id),
});

export async function getUsuario(id: string): Promise<UsuarioDetalle | null> {
  return getUsuarioQuery.execute({ id });
}
