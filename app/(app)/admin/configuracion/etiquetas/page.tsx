/**
 * `/admin/configuracion/etiquetas`: the sheet the etiquetas are printed on (size +
 * margin, edited in an inline panel `?hoja=1`) and the label sizes (name + width x
 * height in mm) the farmacia prints on it, with how many of each fit per sheet
 * (docs/specs/hoja-etiquetas.md). The administrator keeps both; when printing, the
 * user picks one of the ACTIVE sizes that fit, and a cell on the sheet, in the print
 * dialog (Preparaciones). A new size is created in an inline panel (`?nueva=1`);
 * each row opens its detail for edit / baja / reactivar.
 */
import Link from "next/link";
import { ChevronRight, Pencil, Plus, Ruler, X } from "lucide-react";
import { requireSession } from "@/shared/auth/session";
import { can } from "@/shared/auth/authorize";
import { getEtiquetaHoja } from "@/modules/etiqueta-tamanos/application/get-etiqueta-hoja";
import { listEtiquetaTamanos } from "@/modules/etiqueta-tamanos/application/list-etiqueta-tamanos";
import { entraEnHoja, formatearCapacidad, formatearHoja, grillaHoja } from "@/modules/etiqueta-tamanos/domain/etiqueta-hoja";
import { formatearMedidas } from "@/modules/etiqueta-tamanos/domain/etiqueta-tamano";
import { EtiquetaHojaForm } from "@/modules/etiqueta-tamanos/ui/etiqueta-hoja-form";
import { EtiquetaTamanoForm } from "@/modules/etiqueta-tamanos/ui/etiqueta-tamano-form";
import { EmptyState } from "@/shared/ui/empty-state";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge } from "@/shared/ui/status-badge";
import { configuracionSections } from "../../../nav-sections";
import { SectionTabs } from "../../../section-tabs";

const LISTA_HREF = "/admin/configuracion/etiquetas";

interface EtiquetasPageProps {
  searchParams: Promise<{ nueva?: string; hoja?: string }>;
}

export default async function EtiquetasPage({ searchParams }: EtiquetasPageProps) {
  const session = await requireSession();
  const params = await searchParams;
  const [tamanos, hoja] = await Promise.all([listEtiquetaTamanos(), getEtiquetaHoja()]);
  const puedeEditar = can(session, "config.editar");

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Configuración" }, { label: "Tamaños de etiqueta" }]}
        title="Tamaños de etiqueta"
        description="La hoja en la que se imprimen las etiquetas y los tamaños de etiqueta que entran en ella. Al imprimir se elige uno de los tamaños activos y el lugar de la hoja donde queda."
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

      <section className="panel mb-6 max-w-3xl" aria-labelledby="hoja-heading">
        <div className="panel-header flex items-center justify-between gap-3">
          <h2 id="hoja-heading">Hoja de impresión</h2>
          {puedeEditar && !params.hoja ? (
            <Link href={`${LISTA_HREF}?hoja=1`} className="btn btn-secondary btn-sm">
              <Pencil className="size-3.5" aria-hidden />
              Editar hoja
            </Link>
          ) : null}
          {puedeEditar && params.hoja ? (
            <Link href={LISTA_HREF} className="btn btn-ghost btn-sm btn-icon" aria-label="Cerrar la edición de la hoja">
              <X className="size-4" aria-hidden />
            </Link>
          ) : null}
        </div>
        <div className="panel-body flex flex-col gap-3">
          <p className="font-mono tabular-nums text-zinc-800">{formatearHoja(hoja)}</p>
          <p className="text-sm text-zinc-600">El PDF de cada etiqueta es esta hoja entera, con la etiqueta en el lugar que se elige al imprimir. Se imprime siempre en tamaño real (100 %).</p>
          {puedeEditar && params.hoja ? <EtiquetaHojaForm hoja={hoja} disabled={!puedeEditar} volverA={LISTA_HREF} /> : null}
        </div>
      </section>

      {puedeEditar && params.nueva ? (
        <section className="panel mb-6 max-w-3xl" aria-labelledby="nuevo-tamano-heading">
          <div className="panel-header flex items-center justify-between gap-3">
            <h2 id="nuevo-tamano-heading">Nuevo tamaño</h2>
            <Link href={LISTA_HREF} className="btn btn-ghost btn-sm btn-icon" aria-label="Cerrar el alta de tamaño">
              <X className="size-4" aria-hidden />
            </Link>
          </div>
          <div className="panel-body">
            <EtiquetaTamanoForm mode="crear" hoja={hoja} disabled={!puedeEditar} volverA={LISTA_HREF} />
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
                    Por hoja
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
                    <td className="px-3 py-2.5 font-mono tabular-nums text-zinc-700">
                      {entraEnHoja(hoja, tamano) ? (
                        formatearCapacidad(grillaHoja(hoja, tamano))
                      ) : (
                        <ToneBadge tone="warn" title="No se ofrece al imprimir hasta que se edite para que entre en la hoja, o se dé de baja.">
                          No entra en la hoja
                        </ToneBadge>
                      )}
                    </td>
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
