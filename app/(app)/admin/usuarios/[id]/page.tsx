/**
 * `/admin/usuarios/[id]` (M03, FASE 3 points 3.3-3.7). Tabs are plain
 * `?tab=` navigation (server-rendered, no client JS required to switch --
 * accessibility/simplicity priority for this internal tool), not a
 * client-side tab widget.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getUsuario } from "@/modules/usuarios/application/get-usuario";
import { listUsuarioAuditoria } from "@/modules/usuarios/application/list-usuario-auditoria";
import { EditarDatosForm } from "@/modules/usuarios/ui/editar-datos-form";
import { RolesForm } from "@/modules/usuarios/ui/roles-form";
import { EstadoAcciones } from "@/modules/usuarios/ui/estado-acciones";
import { RestablecerCredencial } from "@/modules/usuarios/ui/restablecer-credencial";

const ESTADO_LABELS: Record<string, string> = {
  PENDIENTE_ACTIVACION: "Pendiente de activación",
  ACTIVO: "Activo",
  SUSPENDIDO: "Suspendido",
  BAJA: "Baja",
};

const TABS = [
  { key: "datos", label: "Datos" },
  { key: "roles", label: "Roles" },
  { key: "historial", label: "Historial" },
] as const;

interface UsuarioDetallePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

export default async function UsuarioDetallePage({ params, searchParams }: UsuarioDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = TABS.some((t) => t.key === rawTab) ? (rawTab as (typeof TABS)[number]["key"]) : "datos";

  const usuario = await getUsuario(id);
  if (!usuario) notFound();

  const esUnoMismo = usuario.id === session.usuario.id;

  return (
    <div>
      <div className="mb-2">
        <Link href="/admin/usuarios" className="text-sm underline">
          ← Volver al listado
        </Link>
      </div>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">
            {usuario.apellido}, {usuario.nombre}
          </h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            {usuario.email} · {ESTADO_LABELS[usuario.estado] ?? usuario.estado}
          </p>
        </div>
      </div>

      <nav aria-label="Secciones del usuario" className="mb-6 flex gap-4 border-b border-zinc-200 dark:border-zinc-800">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/admin/usuarios/${id}?tab=${t.key}`}
            aria-current={tab === t.key ? "page" : undefined}
            className={`border-b-2 px-1 pb-2 text-sm ${tab === t.key ? "border-zinc-900 font-medium dark:border-zinc-100" : "border-transparent text-zinc-500"}`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "datos" ? (
        <div className="flex flex-col gap-8">
          <section>
            <h2 className="mb-3 text-lg font-medium">Datos personales</h2>
            <EditarDatosForm usuario={usuario} disabled={!can(session, "usuarios.editar")} />
          </section>

          <section>
            <h2 className="mb-3 text-lg font-medium">Estado</h2>
            {esUnoMismo ? (
              <p className="text-sm text-zinc-600 dark:text-zinc-400">No podés suspender, dar de baja ni restablecer tu propia cuenta.</p>
            ) : (
              <EstadoAcciones
                usuarioId={usuario.id}
                estado={usuario.estado}
                puedeSuspender={can(session, "usuarios.suspender")}
                puedeReactivar={can(session, "usuarios.reactivar")}
                puedeDarDeBaja={can(session, "usuarios.baja")}
              />
            )}
          </section>

          {can(session, "usuarios.credencial.restablecer") && !esUnoMismo && usuario.estado !== "BAJA" ? (
            <section>
              <h2 className="mb-3 text-lg font-medium">Credencial</h2>
              <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
                Emite una credencial nueva de 72 horas, revoca la anterior y las sesiones abiertas, y vuelve a &quot;Pendiente de
                activación&quot;.
              </p>
              <RestablecerCredencial usuarioId={usuario.id} />
            </section>
          ) : null}
        </div>
      ) : null}

      {tab === "roles" ? (
        <section>
          <h2 className="mb-3 text-lg font-medium">Roles</h2>
          <RolesForm usuarioId={usuario.id} rolesActuales={usuario.roles} disabled={!can(session, "usuarios.roles.modificar")} />
        </section>
      ) : null}

      {tab === "historial" ? (
        can(session, "usuarios.auditoria.ver") ? (
          <HistorialAuditoria usuarioId={usuario.id} />
        ) : (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No tenés permiso para ver la auditoría de usuarios.</p>
        )
      ) : null}
    </div>
  );
}

async function HistorialAuditoria({ usuarioId }: { usuarioId: string }) {
  const result = await listUsuarioAuditoria({ usuarioId, page: 1, pageSize: 50 });

  if (result.items.length === 0) {
    return <p className="text-sm text-zinc-600 dark:text-zinc-400">Sin registros de auditoría todavía.</p>;
  }

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
            <th scope="col" className="px-3 py-2 font-medium">Acción</th>
            <th scope="col" className="px-3 py-2 font-medium">Autor</th>
            <th scope="col" className="px-3 py-2 font-medium">Motivo</th>
          </tr>
        </thead>
        <tbody>
          {result.items.map((row) => (
            <tr key={row.id} className="border-b border-zinc-100 align-top last:border-0 dark:border-zinc-900">
              <td className="px-3 py-2 whitespace-nowrap">{new Date(row.ocurridoEn).toLocaleString("es-AR")}</td>
              <td className="px-3 py-2">{row.accion}</td>
              <td className="px-3 py-2">
                {row.usuario.apellido}, {row.usuario.nombre}
              </td>
              <td className="px-3 py-2">{row.motivo ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

