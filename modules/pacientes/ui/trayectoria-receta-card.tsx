/**
 * One receta of the Trayectoria as a card: header, the 5-step journey, a
 * per-item table (items, presupuesto, preparación, libro) and the receta-level
 * facts (entrega, receta física, archivo, presupuesto total). Server component.
 *
 * Optional blocks and links follow `acceso` (docs/specs/trayectoria-paciente.md,
 * "Visibility per role"): a block the session cannot see is omitted, and a
 * link to a detail page is rendered only when the session holds that page's
 * permiso. HEALTH-ADJACENT DATA (DP-24): the hrefs carry only opaque ids.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { ESTADO_LOTE_ARCHIVO_LABELS } from "@/modules/archivo/domain/lote-archivo";
import { FORMA_FARMACEUTICA_LABELS, ORIGEN_RECETA_LABELS } from "@/shared/labels/enum-labels";
import { formatFecha, formatFechaHora } from "@/shared/format/fecha";
import { StatusBadge } from "@/shared/ui/status-badge";
import { MODALIDAD_ENTREGA_LABELS, formatearMonto } from "../domain/trayectoria";
import type { AccesoTrayectoria, ItemTrayectoria, PresupuestoTrayectoria, RecetaTrayectoria } from "../domain/trayectoria";
import { TrayectoriaPasos } from "./trayectoria-pasos";

interface RecetaCardProps {
  receta: RecetaTrayectoria;
  acceso: AccesoTrayectoria;
  zonaHoraria: string;
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{etiqueta}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function AvisosCotizacion({ esParcial, esIncompleta }: { esParcial: boolean; esIncompleta: boolean }) {
  if (!esParcial && !esIncompleta) return null;
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1">
      {esParcial ? (
        <span className="badge bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300" title="Algún componente se completa durante la preparación.">
          Parcial
        </span>
      ) : null}
      {esIncompleta ? (
        <span className="badge bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-300" title="Stock insuficiente al momento de cotizar.">
          Incompleta
        </span>
      ) : null}
    </span>
  );
}

function CeldaPresupuesto({ item }: { item: ItemTrayectoria }) {
  if (!item.cotizacion) return <span className="text-zinc-500">Sin cotización</span>;
  return (
    <span className="whitespace-nowrap">
      $ {formatearMonto(item.cotizacion.precioFinal)}
      <AvisosCotizacion esParcial={item.cotizacion.esParcial} esIncompleta={item.cotizacion.esIncompleta} />
    </span>
  );
}

function CeldaPreparacion({ item, zonaHoraria }: { item: ItemTrayectoria; zonaHoraria: string }) {
  if (item.preparaciones.length === 0) return <span className="text-zinc-500">Sin preparar</span>;
  return (
    <ul className="flex flex-col gap-1.5">
      {item.preparaciones.map((p) => (
        <li key={p.id} className="flex flex-col gap-0.5">
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge estado={p.estado} />
            <Link href={`/preparaciones/${p.id}`} className="text-xs underline-offset-2 hover:underline">
              Ver preparación
            </Link>
          </span>
          <span className="text-xs text-zinc-500">
            Iniciada {formatFechaHora(p.iniciadaEn, zonaHoraria)}
            {p.confirmadaEn ? ` · Confirmada ${formatFechaHora(p.confirmadaEn, zonaHoraria)}` : ""}
            {p.descartadaEn ? ` · Descartada ${formatFechaHora(p.descartadaEn, zonaHoraria)}` : ""}
          </span>
          {p.motivoDescarte ? <span className="text-xs text-zinc-500">Motivo de descarte: {p.motivoDescarte}</span> : null}
        </li>
      ))}
    </ul>
  );
}

function CeldaLibro({ item }: { item: ItemTrayectoria }) {
  const asiento = item.asiento;
  if (!asiento) return <span className="text-zinc-500">Sin asiento</span>;
  return (
    <span className="flex flex-col gap-0.5">
      <span className="flex flex-wrap items-center gap-2">
        <Link href={`/libro/${asiento.id}`} className="font-medium underline-offset-2 hover:underline">
          Asiento Nº {asiento.numeroCorrelativo}
        </Link>
        <StatusBadge estado={asiento.estadoVisual} />
      </span>
      <span className="text-xs text-zinc-500">
        {formatFecha(asiento.fechaAsiento)}
        {asiento.estadoVisual === "SIN_EFECTO" ? ` · ${asiento.etiquetaEstado}` : ""}
      </span>
    </span>
  );
}

function TablaItems({ items, acceso, zonaHoraria }: { items: ItemTrayectoria[]; acceso: AccesoTrayectoria; zonaHoraria: string }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">
              Ítem
            </th>
            {acceso.presupuesto ? (
              <th scope="col" className="px-3 py-2 font-medium">
                Presupuesto
              </th>
            ) : null}
            {acceso.preparacion ? (
              <th scope="col" className="px-3 py-2 font-medium">
                Preparación
              </th>
            ) : null}
            {acceso.libro ? (
              <th scope="col" className="px-3 py-2 font-medium">
                Libro
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="align-top">
              <td className="px-3 py-2">
                <span className="font-medium">
                  {FORMA_FARMACEUTICA_LABELS[item.formaFarmaceutica]} ×{item.cantidadUnidades}
                </span>
                {item.descripcion ? <span className="block text-xs text-zinc-500">{item.descripcion}</span> : null}
                {item.drogas.length > 0 ? <span className="block text-xs text-zinc-500">{item.drogas.join(", ")}</span> : null}
              </td>
              {acceso.presupuesto ? (
                <td className="px-3 py-2">
                  <CeldaPresupuesto item={item} />
                </td>
              ) : null}
              {acceso.preparacion ? (
                <td className="px-3 py-2">
                  <CeldaPreparacion item={item} zonaHoraria={zonaHoraria} />
                </td>
              ) : null}
              {acceso.libro ? (
                <td className="px-3 py-2">
                  <CeldaLibro item={item} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TextoPresupuestoTotal({ presupuesto }: { presupuesto: PresupuestoTrayectoria | null }) {
  if (!presupuesto) return <span className="text-zinc-500">Sin cotización</span>;
  return (
    <span>
      $ {formatearMonto(presupuesto.total)}
      <AvisosCotizacion esParcial={presupuesto.esParcial} esIncompleta={presupuesto.esIncompleta} />
      {presupuesto.itemsSinCotizar > 0 ? (
        <span className="block text-xs text-zinc-500">
          {presupuesto.itemsSinCotizar} ítem{presupuesto.itemsSinCotizar === 1 ? "" : "s"} sin cotizar: el total es parcial.
        </span>
      ) : null}
    </span>
  );
}

export function TrayectoriaRecetaCard({ receta, acceso, zonaHoraria }: RecetaCardProps) {
  const titulo = `Receta Nº ${receta.numeroInterno}`;
  const { entrega, lote } = receta;

  return (
    <article className="card p-4" aria-labelledby={`receta-${receta.id}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`receta-${receta.id}`} className="text-base font-semibold">
            {acceso.linkReceta ? (
              <Link href={`/recetas/${receta.id}`} className="underline-offset-2 hover:underline">
                {titulo}
              </Link>
            ) : (
              titulo
            )}
          </h3>
          <StatusBadge estado={receta.estado} />
        </div>
        <p className="text-sm text-zinc-500">Ingreso: {formatFecha(receta.fechaIngreso, zonaHoraria)}</p>
      </div>

      <dl className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Dato etiqueta="Fecha de prescripción">{formatFecha(receta.fechaPrescripcion)}</Dato>
        <Dato etiqueta="Médico">{receta.medico}</Dato>
        <Dato etiqueta="Origen">{ORIGEN_RECETA_LABELS[receta.origen]}</Dato>
      </dl>

      <div className="mb-4">
        <TrayectoriaPasos pasos={receta.pasos} />
      </div>

      {receta.estado === "ANULADA" ? (
        <p className="mb-4 text-sm text-red-700 dark:text-red-300">Motivo de anulación: {receta.motivoAnulacion ?? "—"}</p>
      ) : null}

      <div className="mb-4">
        <TablaItems items={receta.items} acceso={acceso} zonaHoraria={zonaHoraria} />
      </div>

      <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {acceso.presupuesto ? (
          <Dato etiqueta="Presupuesto vigente">
            <TextoPresupuestoTotal presupuesto={receta.presupuesto} />
          </Dato>
        ) : null}
        <Dato etiqueta="Entrega">
          {entrega ? (
            <span className="flex flex-col gap-0.5">
              <span>
                {acceso.linkEntrega ? (
                  <Link href={`/entregas/${receta.id}`} className="underline-offset-2 hover:underline">
                    {MODALIDAD_ENTREGA_LABELS[entrega.modalidad]}
                  </Link>
                ) : (
                  MODALIDAD_ENTREGA_LABELS[entrega.modalidad]
                )}{" "}
                · {formatFechaHora(entrega.entregadaEn, zonaHoraria)}
              </span>
              <span className="text-xs text-zinc-500">
                {entrega.firmaRecibida
                  ? `Firma recibida${entrega.firmaRecibidaEn ? ` el ${formatFecha(entrega.firmaRecibidaEn, zonaHoraria)}` : ""}`
                  : "Firma pendiente"}
              </span>
            </span>
          ) : (
            <span className="text-zinc-500">Sin entrega registrada</span>
          )}
        </Dato>
        {acceso.archivo ? (
          <Dato etiqueta="Archivo">
            {lote ? (
              <span className="flex flex-wrap items-center gap-2">
                <Link href={`/archivo/${lote.id}`} className="underline-offset-2 hover:underline">
                  Lote Nº {lote.numero}
                </Link>
                <span className="text-xs text-zinc-500">{ESTADO_LOTE_ARCHIVO_LABELS[lote.estado]}</span>
              </span>
            ) : (
              <span className="text-zinc-500">Sin archivar</span>
            )}
          </Dato>
        ) : null}
      </dl>
    </article>
  );
}
