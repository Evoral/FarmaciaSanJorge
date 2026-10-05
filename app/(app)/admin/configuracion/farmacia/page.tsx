/**
 * `/admin/configuracion/farmacia` (FASE 3 point 3.10a): tenant institutional data. The 4
 * editable fields are shown in an edit form (enabled only for
 * `config.editar`); the 4 non-editable fields are shown read-only with a
 * short explanation each, per the task instruction. Layout: the form in the
 * main column, the read-only data in the aside. The "Configuración" tabs sit
 * under the header.
 */
import { Lock } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getDatosTenant } from "@/modules/farmacia/application/get-datos-tenant";
import { EditarDatosTenantForm } from "@/modules/farmacia/ui/editar-datos-tenant-form";
import { PageHeader } from "@/shared/ui/page-header";
import { configuracionSections } from "../../../nav-sections";
import { SectionTabs } from "../../../section-tabs";

function DatoFijo({ etiqueta, valor, motivo }: { etiqueta: string; valor: string; motivo?: string }) {
  return (
    <div className="flex flex-col gap-1 border-b border-zinc-100 pb-3 last:border-0 last:pb-0">
      <dt className="text-xs text-zinc-500">{etiqueta}</dt>
      <dd className="text-sm font-medium text-zinc-900">{valor}</dd>
      {motivo ? <p className="text-xs leading-snug text-zinc-500">{motivo}</p> : null}
    </div>
  );
}

export default async function FarmaciaPage() {
  const session = await requireSession();
  const tenant = await getDatosTenant();

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Configuración" }, { label: "Farmacia" }]}
        title="Datos de la farmacia"
        description="Datos institucionales de la farmacia. Los campos que no se pueden editar desde acá se explican al costado, con el motivo."
      />

      <SectionTabs ariaLabel="Secciones de configuración" links={configuracionSections(session)} />

      <div className="split-layout">
        <section className="panel min-w-0" aria-labelledby="editables-heading">
          <div className="panel-header">
            <h2 id="editables-heading">Datos editables</h2>
          </div>
          <div className="panel-body">
            <EditarDatosTenantForm tenant={tenant} disabled={!can(session, "config.editar")} />
          </div>
        </section>

        <aside className="split-aside" aria-label="Datos no editables">
          <section className="panel" aria-labelledby="no-editables-heading">
            <div className="panel-header flex items-center gap-2">
              <Lock className="size-3.5 text-zinc-400" aria-hidden />
              <h2 id="no-editables-heading">Datos no editables</h2>
            </div>
            <dl className="panel-body flex flex-col gap-3">
              <DatoFijo etiqueta="CUIT" valor={tenant.cuit} motivo="Identificador legal de la farmacia: no se modifica desde esta pantalla." />
              <DatoFijo
                etiqueta="Zona horaria"
                valor={tenant.zonaHoraria}
                motivo="Cambiarla desplazaría silenciosamente el límite de la jornada legal de toda fecha futura y rompería la cronología de los cierres ya firmados: no se modifica desde esta pantalla."
              />
              <DatoFijo
                etiqueta="Activación del contralor"
                valor={tenant.fechaActivacionContralor ? new Date(tenant.fechaActivacionContralor).toLocaleString("es-AR") : "No activado"}
                motivo="Es un flujo separado que requiere registrar saldos de apertura: no se activa desde esta pantalla."
              />
              {tenant.fechaBaja ? <DatoFijo etiqueta="Fecha de baja" valor={new Date(tenant.fechaBaja).toLocaleString("es-AR")} /> : null}
            </dl>
          </section>
        </aside>
      </div>
    </>
  );
}
