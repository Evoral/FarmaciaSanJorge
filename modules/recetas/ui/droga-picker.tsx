"use client";

/**
 * Droga autocomplete for a componente row (6.1: "the droga picker inside the
 * item form is a query declared under recetas.crear ... and must exclude
 * drugs given de baja" -- modules/recetas/application/list-drogas-para-receta.ts,
 * through `buscarDrogasParaRecetaAction`). Picking a droga also hands its
 * unidad base to the row, as before.
 *
 * Picked through a synonym, the row keeps that synonym too (`drogaAliasId`,
 * stored on the componente -- migration 0069) and the field shows it, with
 * the canonical name as a quiet hint (docs/specs/sinonimos-droga.md,
 * "Nombre elegido al cargar").
 */
import { useCallback, useRef } from "react";
import { buscarDrogasParaRecetaAction } from "./actions";
import { Combobox } from "@/shared/ui/combobox";
import type { DrogaOpcion } from "@/modules/recetas/application/list-drogas-para-receta";

/** What a pick hands to the componente row (`null` = cleared). */
export interface DrogaElegida {
  drogaId: string;
  /** Canonical name. */
  nombre: string;
  unidadBaseId: string;
  unidadBaseSimbolo: string;
  /** The synonym the droga was picked by, or `null` when picked by its name. */
  drogaAliasId: string | null;
  sinonimo: string | null;
}

export interface DrogaPickerProps {
  /** Accessible name, e.g. "Componente 2: droga". */
  label: string;
  selectedId: string;
  /** Canonical name of the selected droga. */
  selectedLabel: string;
  /** The synonym the selected droga was picked by (shown as the field's text). */
  selectedSinonimo?: string | null;
  onSelect: (droga: DrogaElegida | null) => void;
  disabled?: boolean;
}

export function DrogaPicker({ label, selectedId, selectedLabel, selectedSinonimo, onSelect, disabled }: DrogaPickerProps) {
  // The last results, to recover the picked droga's unidad base and synonym id.
  const resultados = useRef(new Map<string, DrogaOpcion>());

  const search = useCallback(async (q: string) => {
    const formData = new FormData();
    formData.set("q", q);
    const result = await buscarDrogasParaRecetaAction({ status: "idle", items: [] }, formData);
    if (result.status === "error") throw new Error(result.message ?? "No se pudo buscar drogas.");
    resultados.current = new Map(result.items.map((d) => [d.id, d]));
    // The canonical name is the option's label; a synonym match adds a quiet hint (docs/specs/sinonimos-droga.md).
    return result.items.map((d) => ({ value: d.id, label: d.nombre, description: d.unidadBaseSimbolo, sinonimo: d.sinonimo }));
  }, []);

  return (
    <Combobox
      label={label}
      visibleLabel="Droga"
      placeholder="Buscar droga"
      size="sm"
      search={search}
      value={selectedId ? { value: selectedId, label: selectedLabel, sinonimo: selectedSinonimo ?? null } : null}
      onChange={(option) => {
        if (!option) {
          onSelect(null);
          return;
        }
        const droga = resultados.current.get(option.value);
        if (!droga) return;
        const porSinonimo = Boolean(option.sinonimo && droga.sinonimoId);
        onSelect({
          drogaId: droga.id,
          nombre: droga.nombre,
          unidadBaseId: droga.unidadBaseId,
          unidadBaseSimbolo: droga.unidadBaseSimbolo,
          drogaAliasId: porSinonimo ? droga.sinonimoId : null,
          sinonimo: porSinonimo ? droga.sinonimo : null,
        });
      }}
      disabled={disabled}
    />
  );
}
