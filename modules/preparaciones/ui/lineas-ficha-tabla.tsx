/**
 * The líneas de pesaje of a ficha técnica as the toma workspace
 * (/preparaciones/recetas/[recetaId]) shows them: Droga / Teórica /
 * Exceso % / A pesar, and under each línea the partidas it would be
 * weighed from with their purity. Presentational only (no hooks), so the
 * page renders it for a saved ficha and ./fichas-borrador.tsx for the live
 * preview of an unsaved ítem -- both read the same `LineaDeFichaToma`.
 */
import { Fragment } from "react";
import { formatNumero } from "@/shared/format/cantidad";
import { ToneBadge } from "@/shared/ui/status-badge";
import type { LineaDeFichaToma, PartidaParaPesar } from "../application/get-toma-receta";

export function LineasFichaTabla({ lineas }: { lineas: readonly LineaDeFichaToma[] }) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <caption className="sr-only">Líneas de pesaje</caption>
        <thead>
          <tr>
            <th scope="col" className="px-3 py-2">
              Droga
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Teórica
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Exceso %
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              A pesar
            </th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((linea) => (
            <Fragment key={linea.orden}>
              <tr>
                <td className="px-3 py-2 font-medium text-zinc-900">{linea.drogaNombre}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">
                  {linea.cantidadTeorica ? (
                    <>
                      {linea.cantidadTeorica} <span className="text-zinc-500">{linea.unidadSimbolo}</span>
                    </>
                  ) : (
                    <Vacio />
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{linea.excesoAplicado}</td>
                <td className="whitespace-nowrap px-3 py-2 text-right font-mono font-semibold text-zinc-900 tabular-nums">
                  {linea.esEnraseManual ? (
                    <span className="font-sans font-normal text-zinc-500">Enrase manual (se registra al confirmar)</span>
                  ) : linea.cantidadAPesar ? (
                    <>
                      {linea.cantidadAPesar} <span className="font-normal text-zinc-500">{linea.unidadSimbolo}</span>
                    </>
                  ) : (
                    <Vacio />
                  )}
                </td>
              </tr>
              {linea.partidas ? (
                <tr>
                  <td colSpan={4} className="px-3 pb-3 pt-0">
                    <PartidasDeLinea linea={linea} />
                  </td>
                </tr>
              ) : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The partidas the confirmation would draw this línea from (same candidates
 * and order). With no declared purity, one compact line of lotes; otherwise
 * what to weigh from each one: cantidadAPesar (active) x 100 / pureza. A
 * partida por vencer carries a compact warning; a vencida one (blocked until
 * the DT acts, docs/specs/reanalisis-partida.md) is listed apart, saying why
 * it is not available.
 */
function PartidasDeLinea({ linea }: { linea: LineaDeFichaToma }) {
  const todas = linea.partidas ?? [];
  const partidas = todas.filter((p) => !p.vencida);
  const vencidas = todas.filter((p) => p.vencida);

  return (
    <div className="flex flex-col gap-1.5">
      <PartidasDisponibles linea={linea} partidas={partidas} />
      {vencidas.length > 0 ? (
        <p className="text-xs text-red-700 dark:text-red-300">
          No disponible{vencidas.length === 1 ? "" : "s"}:{" "}
          {vencidas.map((p, i) => (
            <span key={p.id}>
              {i > 0 ? " · " : null}
              lote <span className="font-mono">{p.lote}</span> ({formatNumero(p.cantidadDisponible)} {p.unidadSimbolo})
            </span>
          ))}
          . {vencidas[0]!.avisoVencimiento}
        </p>
      ) : null}
    </div>
  );
}

function AvisoPorVencer({ aviso }: { aviso: string | null }) {
  return aviso ? (
    <>
      {" "}
      <ToneBadge tone="warn">{aviso}</ToneBadge>
    </>
  ) : null;
}

function PartidasDisponibles({ linea, partidas }: { linea: LineaDeFichaToma; partidas: readonly PartidaParaPesar[] }) {
  if (partidas.length === 0) {
    return <p className="text-xs text-zinc-500">Sin partidas disponibles para esta droga.</p>;
  }

  if (!partidas.some((p) => p.potenciaDeclarada !== null)) {
    return (
      <p className="text-xs text-zinc-500">
        Lotes:{" "}
        {partidas.map((p, i) => (
          <span key={p.id}>
            {i > 0 ? " · " : null}
            <span className="font-mono text-zinc-700">{p.lote}</span> ({formatNumero(p.cantidadDisponible)} {p.unidadSimbolo} disp.)
            <AvisoPorVencer aviso={p.avisoVencimiento} />
          </span>
        ))}
      </p>
    );
  }

  return (
    <div className="rounded-md border border-zinc-100 bg-zinc-50/60 px-3 py-2">
      <p className="mb-1 text-xs text-zinc-500">A pesar según la pureza de cada partida</p>
      <ul className="flex flex-col gap-1 text-xs">
        {partidas.map((p) => (
          <li key={p.id} className="grid grid-cols-2 gap-x-4 gap-y-0.5 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.4fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)]">
            <span className="truncate">
              <span className="text-zinc-500">Lote </span>
              <span className="font-mono font-medium text-zinc-900">{p.lote}</span>
              <AvisoPorVencer aviso={p.avisoVencimiento} />
            </span>
            <span className="truncate text-zinc-600">{p.proveedorNombre}</span>
            <span className="tabular-nums">
              <span className="text-zinc-500">Pureza </span>
              {p.potenciaDeclarada !== null ? <span className="font-mono text-zinc-900">{formatNumero(p.potenciaDeclarada)} %</span> : <span className="font-mono text-zinc-400">100 %</span>}
            </span>
            <span className="tabular-nums">
              <span className="text-zinc-500">Disp. </span>
              <span className="font-mono text-zinc-900">
                {formatNumero(p.cantidadDisponible)} {p.unidadSimbolo}
              </span>
            </span>
            <span className="tabular-nums sm:text-right">
              <span className="text-zinc-500">Pesar </span>
              <span className="font-mono font-semibold text-zinc-900">
                {formatNumero(p.cantidadAPesar)} {linea.unidadSimbolo}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Vacio() {
  return (
    <span className="text-zinc-400">
      -<span className="sr-only">Sin dato</span>
    </span>
  );
}
