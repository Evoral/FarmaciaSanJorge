"use client";

/**
 * "Filtrar por droga" control of the proveedor Trayectoria partidas table (docs/specs/trayectoria-proveedor.md, "Filtro
 * por droga"). An AUTOCOMPLETE over the proveedor's drogas that are NOT selected yet (typing narrows them; picking one
 * adds it), plus one chip per selected droga (its × drops that droga). Same URL contract as before: repeated
 * `?droga=a&droga=b`, `page` dropped on every change. The options and the selection come from the use case (already
 * restricted to the proveedor's own drogas, split by the page with the domain helpers), never from the raw URL.
 */
import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { Combobox, filtrarOpciones } from "@/shared/ui/combobox";
import type { DrogaOpcion } from "../domain/trayectoria";

export interface TrayectoriaFiltroDrogasProps {
  /** The proveedor's drogas currently filtered (`drogasSeleccionadas`). */
  elegidas: readonly DrogaOpcion[];
  /** The proveedor's drogas not filtered yet (`drogasRestantes`), sorted by name. */
  restantes: readonly DrogaOpcion[];
  /** The trayectoria's URL without query string. */
  baseHref: string;
  /** droga id -> vigente synonyms: typing one also finds the droga (docs/specs/sinonimos-droga.md). */
  sinonimos?: Readonly<Record<string, readonly string[]>>;
}

function hrefConDrogas(baseHref: string, ids: readonly string[]): string {
  const qs = new URLSearchParams();
  for (const id of ids) qs.append("droga", id);
  const query = qs.toString();
  return query ? `${baseHref}?${query}` : baseHref;
}

export function TrayectoriaFiltroDrogas({ elegidas, restantes, baseHref, sinonimos }: TrayectoriaFiltroDrogasProps) {
  const router = useRouter();
  const seleccionadas = elegidas.map((d) => d.id);
  const search = useMemo(() => filtrarOpciones(restantes.map((d) => ({ value: d.id, label: d.nombre, sinonimos: sinonimos?.[d.id] }))), [restantes, sinonimos]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {restantes.length > 0 ? (
        <div className="w-full min-w-0 sm:w-72">
          <Combobox
            id="trayectoria-droga"
            label="Filtrar por droga"
            hideLabel
            size="sm"
            placeholder={elegidas.length > 0 ? "Agregar otra droga…" : "Filtrar por droga…"}
            search={search}
            value={null}
            onChange={(option) => {
              if (option) router.push(hrefConDrogas(baseHref, [...seleccionadas, option.value]), { scroll: false });
            }}
          />
        </div>
      ) : null}

      {elegidas.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Drogas seleccionadas">
          {elegidas.map((droga) => (
            <span key={droga.id} className="chip">
              <strong>{droga.nombre}</strong>
              <Link
                href={hrefConDrogas(
                  baseHref,
                  seleccionadas.filter((id) => id !== droga.id),
                )}
                scroll={false}
                className="chip-remove"
                aria-label={`Quitar filtro ${droga.nombre}`}
              >
                <X className="size-3" aria-hidden />
              </Link>
            </span>
          ))}
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
