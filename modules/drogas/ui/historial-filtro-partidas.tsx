"use client";

/**
 * "Filtrar por partida" control of the droga Historial table (docs/specs/historial-droga.md,
 * "Filtro por partida"). An AUTOCOMPLETE over the droga's partidas that have at
 * least one consumption and are NOT selected yet (typing narrows them; picking
 * one adds it), plus one chip per selected partida (its × drops that partida,
 * accessible name "Quitar filtro <etiqueta>"). Same URL contract as the proveedor's
 * "Filtrar por droga": repeated `?partida=a&partida=b`, `page` dropped on every
 * change (the URL is rebuilt with `hrefHistorialDroga` WITHOUT a page). The options and
 * the selection come from the use case (already restricted to the droga's own
 * partidas, split by the page with the domain helpers), never from the raw URL.
 * A NEW component on purpose: modules do not import each other's UI.
 */
import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Combobox, filtrarOpciones } from "@/shared/ui/combobox";
import { etiquetaPartidaOpcion, hrefHistorialDroga } from "../domain/historial";
import type { PartidaOpcion } from "../domain/historial";

export interface HistorialFiltroPartidasProps {
  /** The droga's partidas currently filtered (`partidasSeleccionadas`). */
  elegidas: readonly PartidaOpcion[];
  /** The droga's partidas not filtered yet (`partidasRestantes`), newest ingreso first. */
  restantes: readonly PartidaOpcion[];
  /** The historial's URL without query string. */
  baseHref: string;
}

export function HistorialFiltroPartidas({ elegidas, restantes, baseHref }: HistorialFiltroPartidasProps) {
  const router = useRouter();
  const seleccionadas = elegidas.map((p) => p.id);
  const search = useMemo(() => filtrarOpciones(restantes.map((p) => ({ value: p.id, label: etiquetaPartidaOpcion(p) }))), [restantes]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {restantes.length > 0 ? (
        <div className="w-full min-w-0 sm:w-80">
          <Combobox
            id="historial-partida"
            label="Filtrar por partida"
            hideLabel
            size="sm"
            placeholder={elegidas.length > 0 ? "Agregar otra partida…" : "Filtrar por partida…"}
            search={search}
            value={null}
            onChange={(option) => {
              if (option) router.push(hrefHistorialDroga(baseHref, [...seleccionadas, option.value]), { scroll: false });
            }}
          />
        </div>
      ) : null}

      {elegidas.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Partidas seleccionadas">
          {elegidas.map((partida) => {
            const etiqueta = etiquetaPartidaOpcion(partida);
            return (
              <span key={partida.id} className="chip">
                <strong>{etiqueta}</strong>
                <Link
                  href={hrefHistorialDroga(
                    baseHref,
                    seleccionadas.filter((id) => id !== partida.id),
                  )}
                  scroll={false}
                  className="chip-remove"
                  aria-label={`Quitar filtro ${etiqueta}`}
                >
                  <X className="size-3" aria-hidden />
                </Link>
              </span>
            );
          })}
          {elegidas.length > 1 ? (
            <Link href={baseHref} scroll={false} className="btn btn-ghost btn-sm">
              Limpiar
            </Link>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
