/**
 * `/admin/configuracion/etiquetas`: the page sizes (name + width x height in mm)
 * the farmacia prints its etiquetas on. The administrator keeps this list; when
 * printing, the user picks one of the ACTIVE sizes in the "Seleccionar tamaño"
 * dialog (Preparaciones). A new size is created in an inline panel
 * (`?nueva=1`); each row opens its detail for edit / baja / reactivar.
 */
import Link from "next/link";
import { ChevronRight, Plus, Ruler, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { listEtiquetaTamanos } from "@/modules/etiqueta-tamanos/application/list-etiqueta-tamanos";
import { formatearMedidas } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { EtiquetaTamanoForm } from "@/modules/etiqueta-tamanos/ui/etiqueta-tamano-form";
import { EmptyState } from "@/shared/ui/empty-state";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";
import { configuracionSections } from "../../../nav-sections";
import { SectionTabs } from "../../../section-tabs";

const LISTA_HREF = "/admin/configuracion/etiquetas";

interface EtiquetasPageProps {
  searchParams: Promise<{ nueva?: string }>;
}

export default async function EtiquetasPage({ searchParams }: EtiquetasPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const tamanos = await listEtiquetaTamanos();
  const puedeEditar = can(session, "config.editar");

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Configuración" }, { label: "Tamaños de etiqueta" }]}
        title="Tamaños de etiqueta"
        description="Los tamaños de papel en los que se imprimen las etiquetas. Al imprimir se elige uno de los tamaños activos; el diseño se escala proporcionalmente al tamaño elegido."
        actions={
          puedeEditar ? (
            <Link href={`${LISTA_HREF}?nueva=1`} className="btn btn-primary">
              <Plus className="size-4" aria-hidden />
              Nuevo tamaño
            </Link>
          ) : null
        }
      />

      <SectionTabs ariaLabel="Secciones de configuración" links={configuracionSections(session)} />

      {puedeEditar && params.nueva ? (
        <section className="panel mb-6 max-w-3xl" aria-labelledby="nuevo-tamano-heading">
          <div className="panel-header flex items-center justify-between gap-3">
            <h2 id="nuevo-tamano-heading">Nuevo tamaño</h2>
            <Link href={LISTA_HREF} className="btn btn-ghost btn-sm btn-icon" aria-label="Cerrar el alta de tamaño">
              <X className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="panel-body">
            <EtiquetaTamanoForm mode="crear" disabled={!puedeEditar} volverA={LISTA_HREF} />
          </div>
        </section>
      ) : null}

      <div className="list-panel">
        {tamanos.length === 0 ? (
          <EmptyState
            icon={<Ruler className="size-5" />}
            title="Todavía no hay tamaños de etiqueta"
            description="Sin al menos un tamaño activo no se pueden imprimir etiquetas."
            action={
              puedeEditar ? (
                <Link href={`${LISTA_HREF}?nueva=1`} className="btn btn-primary">
                  <Plus className="size-4" aria-hidden />
                  Nuevo tamaño
                </Link>
              ) : null
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2">
                    Nombre
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Medidas
                  </th>
                  <th scope="col" className="px-3 py-2">
                    Estado
                  </th>
                  <th scope="col" className="px-3 py-2">
                    <span className="sr-only">Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {tamanos.map((tamano) => (
                  <tr key={tamano.id}>
                    <td className="px-3 py-2.5">
                      <Link href={`${LISTA_HREF}/${tamano.id}`} className="font-medium text-zinc-900 underline-offset-2 hover:underline">
                        {tamano.nombre}
                      </Link>
                    </td>
                    <td className="px-3 py-2.5 font-mono tabular-nums text-zinc-700">{formatearMedidas(tamano)}</td>
                    <td className="px-3 py-2.5">
                      <ToneBadge tone={tamano.activo ? "success" : "neutral"}>{tamano.activo ? "Activo" : "Baja"}</ToneBadge>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <Link href={`${LISTA_HREF}/${tamano.id}`} aria-label={`Ver ${tamano.nombre}`} className="btn btn-ghost btn-sm btn-icon">
                        <ChevronRight className="size-4" aria-hidden />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
