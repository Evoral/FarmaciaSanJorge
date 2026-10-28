/**
 * `/admin/accesos/usuarios/[id]` (M03, FASE 3 points 3.3-3.7). Tabs are plain
 * `?tab=` navigation (server-rendered, no client JS required to switch --
 * accessibility/simplicity priority for this internal tool), not a
 * client-side tab widget. Datos: the personal data form in the main column,
 * estado and credencial in the aside.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { History } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getUsuario } from "@/modules/usuarios/application/get-usuario";
import { listUsuarioAuditoria } from "@/modules/usuarios/application/list-usuario-auditoria";
import { AuditoriaDiff } from "@/modules/auditoria/ui/auditoria-diff";
import { tonoAccion } from "@/modules/auditoria/ui/tono-accion";
import { ACCION_LABELS, describirRegistro, formatearFechaHora } from "@/modules/auditoria/domain/presentacion";
import { EditarDatosForm } from "@/modules/usuarios/ui/editar-datos-form";
import { RolesForm } from "@/modules/usuarios/ui/roles-form";
import { listRolesAsignables } from "@/modules/usuarios/application/list-roles-asignables";
import { EstadoAcciones } from "@/modules/usuarios/ui/estado-acciones";
import { RestablecerCredencial } from "@/modules/usuarios/ui/restablecer-credencial";
import { RestablecerPin } from "@/modules/usuarios/ui/restablecer-pin";
import { PageHeader } from "@/shared/ui/page-header";
import { EmptyState } from "@/shared/ui/empty-state";
import { Pagination } from "@/shared/ui/pagination";
import { StatusBadge, ToneBadge } from "@/shared/ui/status-badge";
import { Toaster, ToastOnMount } from "@/shared/ui/toast";
import { nombreDeUsuario } from "@/shared/format/usuario";

const HISTORIAL_PAGE_SIZE = 20;

const TABS = [
  { key: "datos", label: "Datos" },
  { key: "roles", label: "Roles" },
  { key: "historial", label: "Historial" },
] as const;

interface UsuarioDetallePageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; page?: string; creado?: string }>;
}

export default async function UsuarioDetallePage({ params, searchParams }: UsuarioDetallePageProps) {
  const session = await requireSession();
  const { id } = await params;
  const { tab: rawTab, page: rawPage, creado } = await searchParams;
  const page = Math.max(1, Number.parseInt(rawPage ?? "1", 10) || 1);
  const tab = TABS.some((t) => t.key === rawTab) ? (rawTab as (typeof TABS)[number]["key"]) : "datos";

  const usuario = await getUsuario(id);
  if (!usuario) notFound();

  const esUnoMismo = usuario.id === session.usuario.id;
  const nombre = `${usuario.apellido}, ${usuario.nombre}`;
  const puedeRestablecer = can(session, "usuarios.credencial.restablecer") && !esUnoMismo && usuario.estado !== "BAJA";
  // docs/specs/restablecer-pin.md: cuentas de sector and admin-only usuarios have no PIN.
  const muestraPin = puedeRestablecer && !usuario.esSector && !usuario.soloAdministrador;
  const estadoPin = !usuario.pinConfigurado ? "Sin configurar (se le pedirá al ingresar)" : usuario.pinBloqueado ? "Bloqueado por intentos fallidos" : "Configurado";

  return (
    <>
      <Toaster />
      {creado === "1" ? <ToastOnMount message="Usuario creado. Entregale la contraseña temporal en mano." /> : null}
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Usuarios y accesos" }, { label: "Usuarios", href: "/admin/accesos/usuarios" }, { label: nombre }]}
        title={
          <span className="flex flex-wrap items-center gap-3">
            {nombre}
            <StatusBadge estado={usuario.estado} />
          </span>
        }
        description={usuario.esSector ? `${usuario.email} · Cuenta de sector (sesión compartida: las acciones con PIN quedan a nombre del empleado que lo ingresa)` : usuario.email}
      />

      <nav aria-label="Secciones del usuario" className="tab-nav">
        {TABS.map((t) => (
          <Link key={t.key} href={`/admin/accesos/usuarios/${id}?tab=${t.key}`} aria-current={tab === t.key ? "page" : undefined} className="tab">
            {t.label}
          </Link>
        ))}
      </nav>

      {tab === "datos" ? (
        <div className="split-layout">
          <section aria-labelledby="datos-heading" className="panel min-w-0">
            <div className="panel-header">
              <h2 id="datos-heading">{usuario.esSector ? "Datos del sector" : "Datos personales"}</h2>
            </div>
            <div className="panel-body">
              <EditarDatosForm usuario={usuario} disabled={!can(session, "usuarios.editar")} />
            </div>
          </section>

          <aside className="split-aside flex flex-col gap-4" aria-label="Estado y credencial">
            <section className="panel" aria-labelledby="estado-heading">
              <div className="panel-header">
                <h2 id="estado-heading">Estado</h2>
              </div>
              <div className="panel-body">
                {esUnoMismo ? (
                  <p className="text-[0.8125rem] text-zinc-600">No podés suspender, dar de baja ni restablecer tu propia cuenta.</p>
                ) : (
                  <EstadoAcciones
                    usuarioId={usuario.id}
                    estado={usuario.estado}
                    puedeSuspender={can(session, "usuarios.suspender")}
                    puedeReactivar={can(session, "usuarios.reactivar")}
                    puedeDarDeBaja={can(session, "usuarios.baja")}
                  />
                )}
              </div>
            </section>

            {puedeRestablecer ? (
              <section className="panel" aria-labelledby="credencial-heading">
                <div className="panel-header">
                  <h2 id="credencial-heading">Credencial</h2>
                  <p>
                    {usuario.esSector
                      ? "Cambiá la contraseña de la cuenta de sector (la cuenta no puede cambiarla por sí misma). Cierra las sesiones abiertas."
                      : "Asigná una contraseña temporal nueva. Cierra las sesiones abiertas y la persona tendrá que cambiarla al ingresar; su PIN se conserva."}
                  </p>
                </div>
                <div className="panel-body">
                  <RestablecerCredencial usuarioId={usuario.id} esSector={usuario.esSector} />
                </div>
              </section>
            ) : null}

            {muestraPin ? (
              <section className="panel" aria-labelledby="pin-heading">
                <div className="panel-header">
                  <h2 id="pin-heading">PIN</h2>
                  <p>{estadoPin}</p>
                </div>
                {usuario.pinConfigurado ? (
                  <div className="panel-body">
                    <RestablecerPin usuarioId={usuario.id} />
                  </div>
                ) : null}
              </section>
            ) : null}
          </aside>
        </div>
      ) : null}

      {tab === "roles" ? (
        <section className="panel max-w-3xl" aria-labelledby="roles-heading">
          <div className="panel-header">
            <h2 id="roles-heading">Roles</h2>
            <p>Definen qué puede hacer la persona en el sistema.</p>
          </div>
          <div className="panel-body">
            <RolesForm usuarioId={usuario.id} rolesActuales={usuario.roles} opciones={await listRolesAsignables()} disabled={!can(session, "usuarios.roles.modificar")} />
          </div>
        </section>
      ) : null}

      {tab === "historial" ? (
        can(session, "usuarios.auditoria.ver") ? (
          <HistorialAuditoria usuarioId={usuario.id} page={page} />
        ) : (
          <p className="alert alert-info">No tenés permiso para ver la auditoría de usuarios.</p>
        )
      ) : null}
    </>
  );
}

async function HistorialAuditoria({ usuarioId, page }: { usuarioId: string; page: number }) {
  const result = await listUsuarioAuditoria({ usuarioId, page, pageSize: HISTORIAL_PAGE_SIZE });

  function pageHref(targetPage: number): string {
    const qs = new URLSearchParams({ tab: "historial", page: String(targetPage) });
    return `/admin/accesos/usuarios/${usuarioId}?${qs.toString()}`;
  }

  return (
    <div className="list-panel">
      {result.items.length === 0 ? (
        <EmptyState icon={<History className="size-5" />} title="Sin registros de auditoría todavía" />
      ) : (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col" className="hidden px-3 py-2 md:table-cell">
                  Fecha
                </th>
                <th scope="col" className="px-3 py-2">
                  Qué pasó
                </th>
                <th scope="col" className="hidden px-3 py-2 md:table-cell">
                  Cambios
                </th>
              </tr>
            </thead>
            <tbody>
              {result.items.map((row) => (
                <tr key={row.id} className="align-top">
                  <td className="hidden whitespace-nowrap px-3 py-3 font-mono text-xs tabular-nums text-zinc-600 md:table-cell">{formatearFechaHora(row.ocurridoEn, result.zonaHoraria)}</td>
                  <td className="px-3 py-3 md:min-w-[14rem]">
                    <p className="mb-1 whitespace-nowrap font-mono text-xs tabular-nums text-zinc-600 md:hidden">{formatearFechaHora(row.ocurridoEn, result.zonaHoraria)}</p>
                    <p className="break-words font-medium text-zinc-900">{describirRegistro(nombreDeUsuario(row.usuario), row.accion, "usuario")}</p>
                    <p className="mt-1">
                      <ToneBadge tone={tonoAccion(row.accion)}>{ACCION_LABELS[row.accion] ?? row.accion}</ToneBadge>
                    </p>
                    {row.motivo ? (
                      <p className="mt-1.5 break-words text-[0.8125rem]">
                        <span className="text-zinc-500">Motivo:</span> {row.motivo}
                      </p>
                    ) : null}
                    {/* Phones: the Cambios column is hidden, so the diff goes under the description. */}
                    <div className="mt-3 md:hidden">
                      <AuditoriaDiff entidad="usuario" entidadId={usuarioId} valorAnterior={row.valorAnterior} valorNuevo={row.valorNuevo} zonaHoraria={result.zonaHoraria} />
                    </div>
                  </td>
                  <td className="hidden px-3 py-3 md:table-cell md:min-w-[18rem]">
                    <AuditoriaDiff entidad="usuario" entidadId={usuarioId} valorAnterior={row.valorAnterior} valorNuevo={row.valorNuevo} zonaHoraria={result.zonaHoraria} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination page={page} pageSize={HISTORIAL_PAGE_SIZE} total={result.total} hrefFor={pageHref} label="Paginación del historial del usuario" />
    </div>
  );
}
