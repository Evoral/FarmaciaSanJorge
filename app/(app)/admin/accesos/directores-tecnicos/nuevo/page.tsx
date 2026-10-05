/**
 * `/admin/accesos/directores-tecnicos/nuevo` (M04, FASE 3 point 3.9). Server
 * component: fetches the usuario picker's eligible options --
 * `listUsuariosElegiblesDt()` already restricts these to `estado: "ACTIVO"`,
 * role `DIRECTOR_TECNICO`, and never the tenant's own technical user (see
 * `modules/directores-tecnicos/infrastructure/designacion-repository.ts`'s
 * `listUsuariosElegibles`) -- and hands them to the client form.
 *
 * The empty list message links to `/admin/accesos/usuarios` for exactly the same
 * reason `EditarDatosTenantForm`'s disabled state is explained on
 * `/admin/configuracion/farmacia`: the operator needs to know WHY the form is
 * unavailable and what to do about it, not just see an empty select.
 */
import Link from "next/link";
import { UserX } from "lucide-react";
import { listUsuariosElegiblesDt } from "@/modules/directores-tecnicos/application/list-usuarios-elegibles";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { NuevaDesignacionForm } from "./nueva-designacion-form";

export default async function NuevaDesignacionPage() {
  const usuarios = await listUsuariosElegiblesDt();

  return (
    <div className="max-w-3xl">
      <PageHeader
        breadcrumbs={[
          { label: "Inicio", href: "/" },
          { label: "Usuarios y accesos" },
          { label: "Directores técnicos", href: "/admin/accesos/directores-tecnicos" },
          { label: "Nueva designación" },
        ]}
        title="Nueva designación"
        description="Designá a un Director Técnico titular o suplente desde una fecha."
      />

      <section className="panel" aria-label="Datos de la designación">
        {usuarios.length === 0 ? (
          <EmptyState
            icon={<UserX className="size-5" />}
            title="No hay usuarios para designar"
            description="No hay usuarios ACTIVOS con el rol Director Técnico disponibles. Asigná primero el rol desde Usuarios."
            action={
              <Link href="/admin/accesos/usuarios" className="btn btn-secondary">
                Ir a Usuarios
              </Link>
            }
          />
        ) : (
          <div className="panel-body">
            <NuevaDesignacionForm usuarios={usuarios} />
          </div>
        )}
      </section>
    </div>
  );
}
