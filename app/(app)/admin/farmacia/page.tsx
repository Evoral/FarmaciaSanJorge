/**
 * `/admin/farmacia` (FASE 3 point 3.10a): tenant institutional data. The 4
 * editable fields are shown in an edit form (enabled only for
 * `config.editar`); the 4 non-editable fields are shown read-only with a
 * short explanation each, per the task instruction.
 */
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getDatosTenant } from "@/modules/farmacia/application/get-datos-tenant";
import { EditarDatosTenantForm } from "@/modules/farmacia/ui/editar-datos-tenant-form";

export default async function FarmaciaPage() {
  const session = await requireSession();
  const tenant = await getDatosTenant();

  return (
    <div>
      <h1 className="mb-1 text-2xl font-semibold">Datos de la farmacia</h1>
      <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
        Datos institucionales del tenant. Los campos que no se pueden editar desde acá se explican debajo, con el motivo.
      </p>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-medium">Datos editables</h2>
        <EditarDatosTenantForm tenant={tenant} disabled={!can(session, "config.editar")} />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Datos no editables</h2>
        <dl className="flex max-w-md flex-col gap-4 text-sm">
          <div>
            <dt className="font-medium">CUIT</dt>
            <dd className="mb-1">{tenant.cuit}</dd>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Identificador legal de la farmacia -- no se modifica desde esta pantalla.
            </p>
          </div>

          <div>
            <dt className="font-medium">Zona horaria</dt>
            <dd className="mb-1">{tenant.zonaHoraria}</dd>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Cambiarla desplazaría silenciosamente el límite de la jornada legal de toda fecha futura y rompería la
              cronología de los cierres ya firmados -- no se modifica desde esta pantalla.
            </p>
          </div>

          <div>
            <dt className="font-medium">Activación del contralor</dt>
            <dd className="mb-1">
              {tenant.fechaActivacionContralor ? new Date(tenant.fechaActivacionContralor).toLocaleString("es-AR") : "No activado"}
            </dd>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              Es un flujo separado que requiere registrar saldos de apertura -- no se activa desde esta pantalla.
            </p>
          </div>

          {tenant.fechaBaja ? (
            <div>
              <dt className="font-medium">Fecha de baja</dt>
              <dd>{new Date(tenant.fechaBaja).toLocaleString("es-AR")}</dd>
            </div>
          ) : null}
        </dl>
      </section>
    </div>
  );
}
