/**
 * One partida (= one ingreso from the proveedor) of the Trayectoria as a row
 * of the partidas table. Two server components feed
 * `shared/ui/fila-desplegable.tsx` (the only client piece, which just holds
 * the open/closed state): `TrayectoriaPartidaCeldas` renders the summary cells
 * (droga, lote, ingreso, cantidad inicial -> disponible, vencimiento, derived
 * estado and, with `acceso.costos`, the costo unitario) and
 * `TrayectoriaPartidaDetalle` renders the expanded body (the latest movements
 * and the optional blocks).
 *
 * The summary cells carry no links on purpose (the whole row toggles on
 * click); the links live in the detail.
 *
 * Optional blocks follow `acceso` (docs/specs/trayectoria-proveedor.md,
 * "Permissions"): a block the session cannot see is omitted, and a link to a
 * detail page is rendered only when the session holds that page's permiso.
 * NEVER a link towards receta / paciente: a preparación is shown with its own
 * id, estado and dates only.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { MOTIVO_AJUSTE_LABELS } from "@/modules/stock/domain/partida";
import { formatCantidad, formatCantidadesFila } from "@/shared/format/cantidad";
import type { CatalogoUnidades } from "@/shared/format/cantidad";
import { formatFecha, formatFechaHora } from "@/shared/format/fecha";
import { formatearCostoUnitario } from "@/shared/format/monto";
import { TIPO_MOVIMIENTO_LABELS, etiquetaDe } from "@/shared/labels/enum-labels";
import { Cantidad } from "@/shared/ui/cantidad";
import { StatusBadge } from "@/shared/ui/status-badge";
import type {
  AccesoTrayectoriaProveedor,
  ContralorTrayectoria,
  CorreccionesTrayectoria,
  ListaAcotada,
  MovimientoTrayectoria,
  PartidaTrayectoria,
  PreparacionTrayectoria,
} from "../domain/trayectoria";

interface PartidaFilaProps {
  partida: PartidaTrayectoria;
  acceso: AccesoTrayectoriaProveedor;
  zonaHoraria: string;
  catalogo: CatalogoUnidades;
}

/** Accessible name of a partida row (completes the toggle button's label). */
export function etiquetaPartida(partida: PartidaTrayectoria): string {
  return `Partida lote ${partida.lote} de ${partida.drogaNombre}`;
}

/** Total column count of the partidas table: toggle + 6 fixed columns + costo (only with `acceso.costos`). */
export function columnasTablaPartidas(acceso: AccesoTrayectoriaProveedor): number {
  return acceso.costos ? 8 : 7;
}

/** Cantidad inicial and disponible side by side: one unit for both. */
function cantidadesPartida(partida: PartidaTrayectoria, catalogo: CatalogoUnidades) {
  const unidad = { id: partida.unidadBaseId, simbolo: partida.unidadBaseSimbolo };
  const [inicial, disponible] = formatCantidadesFila([partida.cantidadInicial, partida.cantidadDisponible], unidad, catalogo);
  return { inicial: inicial!, disponible: disponible! };
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{etiqueta}</dt>
      <dd className="mt-0.5 text-sm text-zinc-900">{children}</dd>
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-[0.8125rem] font-semibold text-zinc-900">{titulo}</h3>
      {children}
    </section>
  );
}

function TablaMovimientos({
  movimientos,
  partida,
  acceso,
  zonaHoraria,
  catalogo,
}: {
  movimientos: ListaAcotada<MovimientoTrayectoria>;
  partida: PartidaTrayectoria;
  acceso: AccesoTrayectoriaProveedor;
  zonaHoraria: string;
  catalogo: CatalogoUnidades;
}) {
  const unidad = { id: partida.unidadBaseId, simbolo: partida.unidadBaseSimbolo };
  if (movimientos.items.length === 0) return <p className="text-sm text-zinc-500">Sin movimientos registrados.</p>;
  return (
    <>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">Fecha</th>
              <th scope="col" className="px-3 py-2 font-medium">Tipo</th>
              <th scope="col" className="px-3 py-2 font-medium">Cantidad</th>
              <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">Motivo</th>
              <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">Observación</th>
              <th scope="col" className="hidden px-3 py-2 font-medium sm:table-cell">Registrado por</th>
              <th scope="col" className="hidden px-3 py-2 font-medium lg:table-cell">Autorizado por</th>
            </tr>
          </thead>
          <tbody>
            {movimientos.items.map((m) => (
              <tr key={m.id} className="align-top">
                <td className="whitespace-nowrap px-3 py-2 font-mono tabular-nums">{formatFechaHora(m.registradoEn, zonaHoraria)}</td>
                <td className="px-3 py-2">{etiquetaDe(TIPO_MOVIMIENTO_LABELS, m.tipo)}</td>
                <td className="px-3 py-2">
                  <Cantidad valor={formatCantidad(m.cantidad, unidad, catalogo)} />
                </td>
                <td className="hidden px-3 py-2 md:table-cell">{m.motivoAjuste ? etiquetaDe(MOTIVO_AJUSTE_LABELS, m.motivoAjuste) : "—"}</td>
                <td className="hidden px-3 py-2 lg:table-cell">{m.observacion ?? "—"}</td>
                <td className="hidden px-3 py-2 sm:table-cell">{m.registradoPor}</td>
                <td className="hidden px-3 py-2 lg:table-cell">{m.autorizadoPor ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {movimientos.hayMas ? (
        <p className="mt-2 text-xs text-zinc-500">
          Mostrando los últimos {movimientos.items.length} de {movimientos.total} movimientos.
          {acceso.linkPartida ? (
            <>
              {" "}
              <Link href={`/stock/partidas/${partida.id}`} className="underline underline-offset-2">
                Ver el kardex completo
              </Link>
              .
            </>
          ) : null}
        </p>
      ) : null}
    </>
  );
}

function ListaPreparaciones({ preparaciones, zonaHoraria }: { preparaciones: ListaAcotada<PreparacionTrayectoria>; zonaHoraria: string }) {
  if (preparaciones.items.length === 0) return <p className="text-sm text-zinc-500">Ninguna preparación consumió esta partida.</p>;
  return (
    <>
      <ul className="flex flex-col gap-2">
        {preparaciones.items.map((p) => (
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
          </li>
        ))}
      </ul>
      {preparaciones.hayMas ? (
        <p className="mt-2 text-xs text-zinc-500">
          Mostrando las últimas {preparaciones.items.length} de {preparaciones.total} preparaciones.
        </p>
      ) : null}
    </>
  );
}

function DatosContralor({ contralor }: { contralor: ContralorTrayectoria }) {
  return (
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <Dato etiqueta="Vale de adquisición">{contralor.numeroValeAdquisicion ?? "—"}</Dato>
      <Dato etiqueta="Asiento de contralor">{contralor.numeroAsiento ? `Nº ${contralor.numeroAsiento}` : "Sin asiento"}</Dato>
    </dl>
  );
}

function ListaCorrecciones({
  correcciones,
  zonaHoraria,
  conCostos,
  unidadSimbolo,
}: {
  correcciones: CorreccionesTrayectoria;
  zonaHoraria: string;
  conCostos: boolean;
  unidadSimbolo: string;
}) {
  if (correcciones.items.length === 0) return <p className="text-sm text-zinc-500">Sin correcciones de costo.</p>;
  return (
    <>
      <ul className="flex flex-col gap-2">
        {correcciones.items.map((c) => (
          <li key={c.id} className="flex flex-col gap-0.5 text-sm">
            <span>
              {conCostos ? (
                <>
                  $ {c.costoAnterior !== null ? formatearCostoUnitario(c.costoAnterior) : "—"} / {unidadSimbolo} → $ {c.costoNuevo !== null ? formatearCostoUnitario(c.costoNuevo) : "—"} / {unidadSimbolo}
                </>
              ) : (
                "Costo unitario corregido"
              )}
            </span>
            <span className="text-xs text-zinc-500">
              {c.quien} · {formatFechaHora(c.cuando, zonaHoraria)}
              {c.motivo ? ` · Motivo: ${c.motivo}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {correcciones.hayMas ? (
        <p className="mt-2 text-xs text-zinc-500">Hay más correcciones de costo anteriores: se muestran las últimas {correcciones.items.length}. El resto está en la auditoría.</p>
      ) : null}
    </>
  );
}

/** The summary `<td>`s of a partida row, in the table's column order (after the toggle cell). */
export function TrayectoriaPartidaCeldas({ partida, acceso, zonaHoraria, catalogo }: PartidaFilaProps) {
  const { inicial, disponible } = cantidadesPartida(partida, catalogo);

  return (
    <>
      <td className="px-3 py-2.5">
        <span className="font-medium text-zinc-900">{partida.drogaNombre}</span>
        <span className="block font-mono text-xs text-zinc-500 sm:hidden">Lote {partida.lote}</span>
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 font-mono sm:table-cell">{partida.lote}</td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 font-mono tabular-nums lg:table-cell">{formatFecha(partida.fechaIngreso, zonaHoraria)}</td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums md:table-cell">
        <span className="text-zinc-500">
          <Cantidad valor={inicial} />
        </span>{" "}
        <span aria-hidden className="text-zinc-400">
          →
        </span>
        <span className="sr-only">, disponible</span> <Cantidad valor={disponible} />
      </td>
      <td className="hidden whitespace-nowrap px-3 py-2.5 font-mono tabular-nums sm:table-cell">{partida.fechaVencimiento ? formatFecha(partida.fechaVencimiento) : "No vence"}</td>
      <td className="px-3 py-2.5">
        <StatusBadge estado={partida.estado} />
      </td>
      {acceso.costos ? (
        <td className="hidden whitespace-nowrap px-3 py-2.5 text-right font-mono tabular-nums lg:table-cell">
          {partida.costoUnitario !== null ? (
            `$ ${formatearCostoUnitario(partida.costoUnitario)} / ${partida.unidadBaseSimbolo}`
          ) : (
            <span className="text-zinc-400">-</span>
          )}
        </td>
      ) : null}
    </>
  );
}

/** The expanded body of a partida row. */
export function TrayectoriaPartidaDetalle({ partida, acceso, zonaHoraria, catalogo }: PartidaFilaProps) {
  const { inicial, disponible } = cantidadesPartida(partida, catalogo);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <dl className="grid flex-1 grid-cols-2 gap-3 lg:grid-cols-4">
          <Dato etiqueta="Cantidad inicial">
            <Cantidad valor={inicial} />
          </Dato>
          <Dato etiqueta="Saldo disponible">
            <Cantidad valor={disponible} />
          </Dato>
          <Dato etiqueta="Vencimiento">{partida.fechaVencimiento ? formatFecha(partida.fechaVencimiento) : "No vence"}</Dato>
          <Dato etiqueta="Apertura">{partida.fechaApertura ? formatFecha(partida.fechaApertura, zonaHoraria) : "Cerrada"}</Dato>
        </dl>
        {acceso.linkPartida ? (
          <Link href={`/stock/partidas/${partida.id}`} className="btn btn-secondary btn-sm">
            Ver partida en stock
            <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        ) : null}
      </div>

      <Bloque titulo="Movimientos">
        <TablaMovimientos movimientos={partida.movimientos} partida={partida} acceso={acceso} zonaHoraria={zonaHoraria} catalogo={catalogo} />
      </Bloque>

      {partida.preparaciones ? (
        <Bloque titulo="Preparaciones que la consumieron">
          <ListaPreparaciones preparaciones={partida.preparaciones} zonaHoraria={zonaHoraria} />
        </Bloque>
      ) : null}

      {partida.contralor ? (
        <Bloque titulo="Contralor">
          <DatosContralor contralor={partida.contralor} />
        </Bloque>
      ) : null}

      {partida.correcciones ? (
        <Bloque titulo="Correcciones de costo">
          <ListaCorrecciones correcciones={partida.correcciones} zonaHoraria={zonaHoraria} conCostos={acceso.costos} unidadSimbolo={partida.unidadBaseSimbolo} />
        </Bloque>
      ) : null}
    </div>
  );
}
