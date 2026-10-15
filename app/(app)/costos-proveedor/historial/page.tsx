/**
 * `/costos-proveedor/historial?droga=&proveedor=` -- every version of the costo de proveedor of
 * one (droga, proveedor) pair, newest first (docs/specs/costos-proveedor.md, "Interface" 4):
 * precio informado, costo por unidad base, fecha del precio, origen (lista or manual), motivo,
 * who loaded it, its vigencia and its state (Vigente / Reemplazado / Dado de baja, with the
 * baja's motivo). Nothing here is ever edited: a change is a new version (R2).
 *
 * `searchParams` is untrusted and ONLY ever reads `droga` and `proveedor`: opaque uuids, anything
 * else (or a pair that is not the tenant's) is a 404. Access is the layout's
 * `stock.valorizado.ver` guard; the "Editar" shortcut needs `costos.proveedor.gestionar`.
 */
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleDollarSign, Pencil } from "lucide-react";
import { getHistorialCosto } from "@/modules/costos-proveedor/application/get-historial-costo";
import { ESTADO_VERSION_LABELS, etiquetaPrecio } from "@/modules/costos-proveedor/domain/presentacion";
import type { EstadoVersionCosto } from "@/modules/costos-proveedor/domain/presentacion";
import { formatFechaHora, formatFechaIso } from "@/shared/format/fecha";
import { formatearCostoUnitario } from "@/shared/format/monto";
import { EmptyState } from "@/shared/ui/empty-state";
import { PageHeader } from "@/shared/ui/page-header";
import { ToneBadge, type BadgeTone } from "@/shared/ui/status-badge";
import { uuid } from "@/shared/validation";

interface HistorialCostoPageProps {
  searchParams: Promise<{ droga?: string | string[]; proveedor?: string | string[] }>;
}

const TONO_ESTADO: Readonly<Record<EstadoVersionCosto, BadgeTone>> = { VIGENTE: "success", REEMPLAZADO: "neutral", BAJA: "danger" };

function primerValor(valor: string | string[] | undefined): string | undefined {
  return Array.isArray(valor) ? valor[0] : valor;
}

export default async function HistorialCostoPage({ searchParams }: HistorialCostoPageProps) {
  const query = await searchParams;
  const drogaId = primerValor(query.droga);
  const proveedorId = primerValor(query.proveedor);
  // Same rule as the use case's own input (zod uuid): anything else is a 404, never a ValidationError.
  if (!drogaId || !proveedorId || !uuid.safeParse(drogaId).success || !uuid.safeParse(proveedorId).success) notFound();

  const historial = await getHistorialCosto({ drogaId, proveedorId });
  if (!historial) notFound();

  const { droga, proveedor, versiones, vigenteId, zonaHoraria, puedeGestionar } = historial;
  const par = new URLSearchParams({ droga: droga.id, proveedor: proveedor.id }).toString();

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Inicio", href: "/" }, { label: "Costos de proveedores", href: "/costos-proveedor" }, { label: "Historial" }]}
        title={droga.nombre}
        description={
          <>
            Historial del costo de proveedor · {proveedor.razonSocial}
            {proveedor.deBaja ? (
              <>
                {" "}
                <ToneBadge tone="neutral" title="El proveedor está dado de baja: sus costos no se usan para cotizar.">
                  Proveedor de baja
                </ToneBadge>
              </>
            ) : null}
          </>
        }
        actions={
          puedeGestionar && !proveedor.deBaja ? (
            <Link href={`/costos-proveedor/nuevo?${par}`} className="btn btn-primary">
              <Pencil className="size-4" aria-hidden />
              {vigenteId ? "Cambiar el precio" : "Cargar un precio"}
            </Link>
          ) : null
        }
      />

      <div className="list-region">
        <div className="list-panel">
          {versiones.length === 0 ? (
            <EmptyState
              icon={<CircleDollarSign className="size-5" />}
              title="Este proveedor nunca cotizó esta droga"
              description="Todavía no hay ninguna versión de su costo."
              action={
                <Link href="/costos-proveedor" className="btn btn-secondary">
                  Volver a los costos
                </Link>
              }
            />
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th scope="col" className="px-3 py-2 text-right">
                      Precio informado
                    </th>
                    <th scope="col" className="hidden px-3 py-2 text-right md:table-cell">
                      Costo por {droga.unidadBaseSimbolo || "unidad base"}
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Fecha del precio
                    </th>
                    <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                      Origen
                    </th>
                    <th scope="col" className="hidden px-3 py-2 md:table-cell">
                      Motivo
                    </th>
                    <th scope="col" className="hidden px-3 py-2 lg:table-cell">
                      Cargado por
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Vigente desde
                    </th>
                    <th scope="col" className="hidden px-3 py-2 sm:table-cell">
                      Vigente hasta
                    </th>
                    <th scope="col" className="px-3 py-2">
                      Estado
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {versiones.map((version) => (
                    <tr key={version.id}>
                      <td className="whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums">{etiquetaPrecio(version.precioInformado, version.unidadPrecioSimbolo)}</td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums md:table-cell">
                        $ {formatearCostoUnitario(version.costoUnitario)} / {droga.unidadBaseSimbolo}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">{formatFechaIso(version.fechaPrecio)}</td>
                      <td className="hidden px-3 py-2.5 lg:table-cell">
                        {version.listaNombreArchivo ? <span className="break-all">{version.listaNombreArchivo}</span> : <span className="text-zinc-500">Manual</span>}
                        {version.descripcionProveedor ? <span className="block text-xs text-zinc-500">{version.descripcionProveedor}</span> : null}
                      </td>
                      <td className="hidden px-3 py-2.5 md:table-cell">
                        {version.motivo ?? <span className="text-zinc-400">—</span>}
                        {version.estado === "BAJA" ? <span className="block text-xs text-zinc-600">Baja: {version.bajaMotivo ?? "sin motivo registrado"}</span> : null}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 lg:table-cell">
                        {version.creadoPorNombre} {version.creadoPorApellido}
                      </td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 sm:table-cell">{formatFechaHora(version.vigenteDesde, zonaHoraria)}</td>
                      <td className="hidden whitespace-nowrap px-3 py-2.5 sm:table-cell">
                        {version.vigenteHasta ? formatFechaHora(version.vigenteHasta, zonaHoraria) : <span className="text-zinc-400">—</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        <ToneBadge tone={TONO_ESTADO[version.estado]}>{ESTADO_VERSION_LABELS[version.estado]}</ToneBadge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
