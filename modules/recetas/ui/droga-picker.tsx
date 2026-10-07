"use client";

/**
 * Droga autocomplete for a componente row (6.1: "the droga picker inside the
 * item form is a query declared under recetas.crear ... and must exclude
 * drugs given de baja" -- modules/recetas/application/list-drogas-para-receta.ts,
 * through `buscarDrogasParaRecetaAction`). Picking a droga also hands its
 * unidad base to the row, as before.
 */
import { useCallback, useRef } from "react";
import { buscarDrogasParaRecetaAction } from "./actions";
import { Combobox } from "@/shared/ui/combobox";
import type { DrogaOpcion } from "@/modules/recetas/application/list-drogas-para-receta";

export interface DrogaPickerProps {
  /** Accessible name, e.g. "Componente 2: droga". */
  label: string;
  selectedId: string;
  selectedLabel: string;
  onSelect: (id: string, nombre: string, unidadBaseId: string, unidadBaseSimbolo: string) => void;
  disabled?: boolean;
}

export function DrogaPicker({ label, selectedId, selectedLabel, onSelect, disabled }: DrogaPickerProps) {
  // The last results, to recover the picked droga's unidad base.
  const resultados = useRef(new Map<string, DrogaOpcion>());

  const search = useCallback(async (q: string) => {
    const formData = new FormData();
    formData.set("q", q);
    const result = await buscarDrogasParaRecetaAction({ status: "idle", items: [] }, formData);
    if (result.status === "error") throw new Error(result.message ?? "No se pudo buscar drogas.");
    resultados.current = new Map(result.items.map((d) => [d.id, d]));
    // The canonical name is what gets picked; a synonym match only adds a quiet hint (docs/specs/sinonimos-droga.md).
    return result.items.map((d) => ({ value: d.id, label: d.nombre, description: d.unidadBaseSimbolo, sinonimo: d.sinonimo }));
  }, []);

  return (
    <Combobox
      label={label}
      visibleLabel="Droga"
      placeholder="Buscar droga"
      size="sm"
      search={search}
      value={selectedId ? { value: selectedId, label: selectedLabel } : null}
      onChange={(option) => {
        if (!option) {
          onSelect("", "", "", "");
          return;
        }
        const droga = resultados.current.get(option.value);
        if (droga) onSelect(droga.id, droga.nombre, droga.unidadBaseId, droga.unidadBaseSimbolo);
      }}
      disabled={disabled}
    />
  );
}
