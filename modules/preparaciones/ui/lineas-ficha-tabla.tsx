/**
 * The líneas de pesaje of a ficha técnica as the toma workspace
 * (/preparaciones/recetas/[recetaId]) shows them: Droga / Teórica /
 * Exceso % / A pesar, and under each línea the partidas it would be
 * weighed from with their purity. Stock disponible is shown at a glance
 * (whole numbers in the largest practical unit, `formatStockEntero`); the
 * quantities to weigh stay exact. Presentational only (no hooks), so the
 * page renders it for a saved ficha and ./fichas-borrador.tsx for the live
 * preview of an unsaved ítem -- both read the same `LineaDeFichaToma`.
 */
import { Fragment } from "react";
import { Decimal } from "@/shared/decimal";
import { cantidadesFichaTecnica, formatNumero, formatStockEntero } from "@/shared/format/cantidad";
import { ToneBadge } from "@/shared/ui/status-badge";
import type { LineaDeFichaToma, PartidaParaPesar } from "../application/get-toma-receta";

/**
 * The "Exceso %" column only when a línea applied one (`exceso_pesada_porcentaje` > 0 in Parámetros when its ficha
 * was generated): unused, it is noise.
 */
export function conExceso(lineas: readonly { excesoAplicado: string }[]): boolean {
  return lineas.some((l) => {
    try {
      return new Decimal(l.excesoAplicado).greaterThan(0);
    } catch {
      return false;
    }
  });
}

export function LineasFichaTabla({ lineas }: { lineas: readonly LineaDeFichaToma[] }) {
  const exceso = conExceso(lineas);
  const columnas = exceso ? 4 : 3;
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
            {exceso ? (
              <th scope="col" className="px-3 py-2 text-right">
                Exceso %
              </th>
            ) : null}
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
                    <CantidadFicha valor={linea.cantidadTeorica} simbolo={linea.unidadSimbolo} />
                  ) : (
                    <Vacio />
                  )}
                </td>
                {exceso ? <td className="whitespace-nowrap px-3 py-2 text-right font-mono tabular-nums">{linea.excesoAplicado}</td> : null}
                <td className="px-3 py-2 text-right font-mono font-semibold text-zinc-900 tabular-nums">
                  {linea.esEnraseManual ? (
                    <span className="inline-block max-w-[12rem] font-sans font-normal text-zinc-500">Enrase manual (se registra al confirmar)</span>
                  ) : linea.cantidadAPesar ? (
                    <span className="whitespace-nowrap">
                      <CantidadFicha valor={linea.cantidadAPesar} simbolo={linea.unidadSimbolo} classNameSimbolo="font-normal text-zinc-500" />
                    </span>
                  ) : (
                    <Vacio />
                  )}
                </td>
              </tr>
              {linea.partidas ? <FilasPartidas linea={linea} columnas={columnas} /> : null}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The partidas the confirmation would draw this línea from (same candidates
 * and order), as rows right below it. With no declared purity, one compact
 * line of lotes; otherwise one row per partida -- lote, stock and purity --
 * with what to weigh from it (cantidadAPesar (active) x 100 / pureza) in the
 * "A pesar" column, with its g / mg equivalence like the línea's. A partida
 * por vencer carries a compact warning; a vencida one (blocked until the DT
 * acts, openspec/specs/reanalisis-partida/spec.md) is listed apart, saying why it is
 * not available.
 */
function FilasPartidas({ linea, columnas }: { linea: LineaDeFichaToma; columnas: number }) {
  const todas = linea.partidas ?? [];
  const partidas = todas.filter((p) => !p.vencida);
  const vencidas = todas.filter((p) => p.vencida);

  if (!partidas.some((p) => p.potenciaDeclarada !== null)) {
    return (
      <tr>
        <td colSpan={columnas} className="px-3 pb-3 pt-0">
          <div className="flex flex-col gap-1.5">
            <LotesDisponibles partidas={partidas} />
            <LotesVencidos vencidas={vencidas} />
          </div>
        </td>
      </tr>
    );
  }

  return (
    <>
      {/* One visual group with the línea: no row borders until its last row. */}
      <tr className="border-b-0">
        <td colSpan={columnas} className="px-3 pb-0.5 pt-0 text-xs text-zinc-500">
          Lotes (a pesar según la pureza de cada partida):
        </td>
      </tr>
      {partidas.map((p, i) => {
        const ultima = i === partidas.length - 1 && vencidas.length === 0;
        const padding = ultima ? "pb-3 pt-0.5" : "py-0.5";
        return (
          <tr key={p.id} className={ultima ? undefined : "border-b-0"}>
            <td colSpan={columnas - 1} className={`pl-6 pr-3 text-xs text-zinc-500 ${padding}`}>
              <LoteConStock partida={p} /> · Pureza{" "}
              {p.potenciaDeclarada !== null ? <span className="font-mono text-zinc-700">{formatNumero(p.potenciaDeclarada)} %</span> : <span className="font-mono text-zinc-400">100 %</span>}
            </td>
            <td className={`whitespace-nowrap px-3 text-right font-mono font-medium text-zinc-900 tabular-nums ${padding}`}>
              <CantidadFicha valor={p.cantidadAPesar} simbolo={linea.unidadSimbolo} classNameSimbolo="font-normal text-zinc-500" />
            </td>
          </tr>
        );
      })}
      {vencidas.length > 0 ? (
        <tr>
          <td colSpan={columnas} className="pb-3 pl-6 pr-3 pt-0.5">
            <LotesVencidos vencidas={vencidas} />
          </td>
        </tr>
      ) : null}
    </>
  );
}

export function LotesVencidos({ vencidas }: { vencidas: readonly PartidaParaPesar[] }) {
  if (vencidas.length === 0) return null;
  return (
    <p className="text-xs text-red-700 dark:text-red-300">
      No disponible{vencidas.length === 1 ? "" : "s"}:{" "}
      {vencidas.map((p, i) => (
        <span key={p.id}>
          {i > 0 ? " · " : null}
          lote <span className="font-mono">{p.lote}</span> ({formatStockEntero(p.cantidadDisponible, p.unidadSimbolo)})
        </span>
      ))}
      . {vencidas[0]!.avisoVencimiento}
    </p>
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

/** "251138 (5 kg disp.)": the same wording with or without a declared purity. */
function LoteConStock({ partida }: { partida: PartidaParaPesar }) {
  return (
    <>
      <span className="font-mono text-zinc-700">{partida.lote}</span> ({formatStockEntero(partida.cantidadDisponible, partida.unidadSimbolo)} disp.)
      <AvisoPorVencer aviso={partida.avisoVencimiento} />
    </>
  );
}

function LotesDisponibles({ partidas }: { partidas: readonly PartidaParaPesar[] }) {
  if (partidas.length === 0) {
    return <p className="text-xs text-zinc-500">Sin partidas disponibles para esta droga.</p>;
  }
  return (
    <p className="text-xs text-zinc-500">
      Lotes:{" "}
      {partidas.map((p, i) => (
        <span key={p.id}>
          {i > 0 ? " · " : null}
          <LoteConStock partida={p} />
        </span>
      ))}
    </p>
  );
}

export function CantidadFicha({
  valor,
  simbolo,
  classNameSimbolo = "text-zinc-500",
}: {
  valor: string;
  simbolo: string;
  classNameSimbolo?: string;
}) {
  const info = cantidadesFichaTecnica(valor, simbolo);
  if (!info) {
    return (
      <>
        {formatNumero(valor)} <span className={classNameSimbolo}>{simbolo}</span>
      </>
    );
  }
  return (
    <>
      {info.principal} <span className={classNameSimbolo}>{info.simboloPrincipal}</span>
      {info.equivalencia ? <span className="block text-xs font-normal text-zinc-500">{info.equivalencia}</span> : null}
    </>
  );
}

/** The same mass in g / mg under the figure, when the línea is weighed by mass. */
export function Equivalencia({ valor, simbolo }: { valor: string; simbolo: string }) {
  const info = cantidadesFichaTecnica(valor, simbolo);
  return info?.equivalencia ? <span className="block text-xs font-normal text-zinc-500">{info.equivalencia}</span> : null;
}

export function Vacio() {
  return (
    <span className="text-zinc-400">
      -<span className="sr-only">Sin dato</span>
    </span>
  );
}
