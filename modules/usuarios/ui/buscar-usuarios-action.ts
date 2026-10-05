"use server";

/** Read-only suggestions for the `/admin/accesos/usuarios` search: a thin wrapper over `listUsuarios` (same `usuarios.listar` permiso, same nombre/apellido/email/DNI search). */
import { listUsuarios } from "@/modules/usuarios/application/list-usuarios";
import { ESTADO_USUARIO_LABELS } from "@/shared/labels/enum-labels";
import type { SugerenciaNavegable } from "@/shared/ui/buscador-navegable";

export async function buscarUsuariosAction(busqueda: string): Promise<SugerenciaNavegable[]> {
  const search = String(busqueda ?? "").trim().slice(0, 100);
  const result = await listUsuarios({ search: search || undefined, page: 1, pageSize: 10 });
  return result.items.map((usuario) => ({
    id: usuario.id,
    label: `${usuario.apellido}, ${usuario.nombre}`,
    description: usuario.estado === "ACTIVO" ? usuario.email : `${usuario.email} · ${ESTADO_USUARIO_LABELS[usuario.estado]}`,
  }));
}
