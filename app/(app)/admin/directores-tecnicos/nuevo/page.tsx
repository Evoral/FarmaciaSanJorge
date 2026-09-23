/**
 * `/admin/directores-tecnicos/nuevo` (M04, FASE 3 point 3.9). Server
 * component: fetches the usuario picker's eligible options --
 * `listUsuariosElegiblesDt()` already restricts these to `estado: "ACTIVO"`,
 * role `DIRECTOR_TECNICO`, and never the tenant's own technical user (see
 * `modules/directores-tecnicos/infrastructure/designacion-repository.ts`'s
 * `listUsuariosElegibles`) -- and hands them to the client form.
 *
 * The empty list message links to `/admin/usuarios` for exactly the same
 * reason `EditarDatosTenantForm`'s disabled state is explained on
 * `/admin/farmacia`: the operator needs to know WHY the form is
 * unavailable and what to do about it, not just see an empty select.
 */
import Link from "next/link";
import { listUsuariosElegiblesDt } from "@/modules/directores-tecnicos/application/list-usuarios-elegibles";
import { NuevaDesignacionForm } from "./nueva-designacion-form";

export default async function NuevaDesignacionPage() {
  const usuarios = await listUsuariosElegiblesDt();

  return (
    <div className="mx-auto max-w-lg">
      <h1 className="mb-6 text-xl font-semibold">Nueva designación</h1>

      {usuarios.length === 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          No hay usuarios ACTIVOS con el rol Director Técnico disponibles para designar. Asigná primero el rol desde{" "}
          <Link href="/admin/usuarios" className="underline">
            Usuarios
          </Link>
          .
        </p>
      ) : (
        <NuevaDesignacionForm usuarios={usuarios} />
      )}

      <p className="mt-6">
        <Link href="/admin/directores-tecnicos" className="text-sm underline">
          Volver al listado
        </Link>
      </p>
    </div>
  );
}
