/**
 * One partida (= one ingreso from the proveedor) of the Trayectoria as a
 * collapsible card (native `<details>`/`<summary>`: no client JS, keyboard and
 * screen-reader friendly, closed by default). The summary shows the key facts
 * (droga, lote, fecha de ingreso, cantidad inicial -> disponible, vencimiento
 * + derived estado, costo unitario); the body holds the latest movements and
 * the optional blocks. Server component.
 *
 * The summary carries no links on purpose (interactive content inside
 * `<summary>` is an accessibility anti-pattern); the links live in the body.
 *
 * Optional blocks follow `acceso` (docs/specs/trayectoria-proveedor.md,
 * "Permissions"): a block the session cannot see is omitted, and a link to a
 * detail page is rendered only when the session holds that page's permiso.
 * NEVER a link towards receta / paciente: a preparación is shown with its own
 * id, estado and dates only.
 */
import type { ReactNode } from "react";
import Link from "next/link";
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
  CorreccionCostoTrayectoria,
  ListaAcotada,
  MovimientoTrayectoria,
  PartidaTrayectoria,
  PreparacionTrayectoria,
} from "../domain/trayectoria";

interface PartidaCardProps {
  partida: PartidaTrayectoria;
  acceso: AccesoTrayectoriaProveedor;
  zonaHoraria: string;
  catalogo: CatalogoUnidades;
}

function Dato({ etiqueta, children }: { etiqueta: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-zinc-500">{etiqueta}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="mb-4">
      <h3 className="mb-2 text-sm font-semibold">{titulo}</h3>
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
              <th scope="col" className="px-3 py-2 font-medium">Motivo</th>
              <th scope="col" className="px-3 py-2 font-medium">Observación</th>
              <th scope="col" className="px-3 py-2 font-medium">Registrado por</th>
              <th scope="col" className="px-3 py-2 font-medium">Autorizado por</th>
            </tr>
          </thead>
          <tbody>
            {movimientos.items.map((m) => (
              <tr key={m.id} className="align-top">
                <td className="px-3 py-2 whitespace-nowrap">{formatFechaHora(m.registradoEn, zonaHoraria)}</td>
                <td className="px-3 py-2">{etiquetaDe(TIPO_MOVIMIENTO_LABELS, m.tipo)}</td>
                <td className="px-3 py-2">
                  <Cantidad valor={formatCantidad(m.cantidad, unidad, catalogo)} />
                </td>
                <td className="px-3 py-2">{m.motivoAjuste ? etiquetaDe(MOTIVO_AJUSTE_LABELS, m.motivoAjuste) : "—"}</td>
                <td className="px-3 py-2">{m.observacion ?? "—"}</td>
                <td className="px-3 py-2">{m.registradoPor}</td>
                <td className="px-3 py-2">{m.autorizadoPor ?? "—"}</td>
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

function ListaCorrecciones({ correcciones, zonaHoraria, conCostos }: { correcciones: CorreccionCostoTrayectoria[]; zonaHoraria: string; conCostos: boolean }) {
  if (correcciones.length === 0) return <p className="text-sm text-zinc-500">Sin correcciones de costo.</p>;
  return (
    <ul className="flex flex-col gap-2">
      {correcciones.map((c) => (
        <li key={c.id} className="flex flex-col gap-0.5 text-sm">
          <span>
            {conCostos ? (
              <>
                $ {c.costoAnterior !== null ? formatearCostoUnitario(c.costoAnterior) : "—"} → $ {c.costoNuevo !== null ? formatearCostoUnitario(c.costoNuevo) : "—"}
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
  );
}

export function TrayectoriaPartidaCard({ partida, acceso, zonaHoraria, catalogo }: PartidaCardProps) {
  const unidad = { id: partida.unidadBaseId, simbolo: partida.unidadBaseSimbolo };
  // Cantidad inicial and disponible side by side: one unit for both.
  const [inicial, disponible] = formatCantidadesFila([partida.cantidadInicial, partida.cantidadDisponible], unidad, catalogo);

  return (
    <details className="card group" aria-labelledby={`partida-${partida.id}`}>
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4 [&::-webkit-details-marker]:hidden">
        <span aria-hidden="true" className="mt-0.5 text-zinc-400 transition-transform group-open:rotate-90">
          ▸
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span id={`partida-${partida.id}`} className="text-base font-semibold">
              {partida.drogaNombre}
            </span>
            <span className="text-sm text-zinc-500">Lote {partida.lote}</span>
            <span className="text-sm text-zinc-500">Ingreso {formatFecha(partida.fechaIngreso, zonaHoraria)}</span>
            <StatusBadge estado={partida.estado} />
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-1 text-sm">
            <span>
              <Cantidad valor={inicial!} /> → <Cantidad valor={disponible!} />
            </span>
            <span className="text-zinc-500">Vence {formatFecha(partida.fechaVencimiento)}</span>
            {partida.costoUnitario !== null ? <span className="text-zinc-500">$ {formatearCostoUnitario(partida.costoUnitario)} c/u</span> : null}
          </span>
        </span>
      </summary>

      <div className="border-t border-zinc-200 p-4 dark:border-zinc-800">
        {acceso.linkPartida ? (
          <p className="mb-3 text-sm">
            <Link href={`/stock/partidas/${partida.id}`} className="underline underline-offset-2">
              Ver partida en stock
            </Link>
          </p>
        ) : null}

        <dl className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Dato etiqueta="Cantidad inicial">
            <Cantidad valor={inicial!} />
          </Dato>
          <Dato etiqueta="Saldo disponible">
            <Cantidad valor={disponible!} />
          </Dato>
          <Dato etiqueta="Vencimiento">{formatFecha(partida.fechaVencimiento)}</Dato>
          <Dato etiqueta="Apertura">{partida.fechaApertura ? formatFecha(partida.fechaApertura, zonaHoraria) : "Cerrada"}</Dato>
        </dl>

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
            <ListaCorrecciones correcciones={partida.correcciones} zonaHoraria={zonaHoraria} conCostos={acceso.costos} />
          </Bloque>
        ) : null}
      </div>
    </details>
  );
}
