"use client";

/**
 * `/archivo/nuevo` confirm step (FASE 12 point 12.1, user decision 4). The
 * preview (period + ubicación -> eligible recetas) is rendered server-side
 * by the page itself from `searchParams` (dates/ubicación only -- never a
 * patient name -- travel through the URL); this form just re-submits the
 * SAME period/ubicación as a POST so `conformarLote` can recompute the
 * eligible set itself, atomically, inside the same transaction that
 * inserts the lote (see that command's doc comment).
 */
import { conformarLoteAction } from "./actions";
import { SimpleForm } from "./simple-form";

export interface ConformarLoteFormProps {
  periodoDesde: string;
  periodoHasta: string;
  ubicacion: string;
  cantidadElegibles: number;
}

export function ConformarLoteForm({ periodoDesde, periodoHasta, ubicacion, cantidadElegibles }: ConformarLoteFormProps) {
  return (
    <SimpleForm action={conformarLoteAction} submitLabel="Confirmar y conformar lote" pendingLabel="Conformando…" submitDisabled={cantidadElegibles === 0} className="flex max-w-lg flex-col gap-2">
      <input type="hidden" name="periodoDesde" value={periodoDesde} />
      <input type="hidden" name="periodoHasta" value={periodoHasta} />
      <input type="hidden" name="ubicacion" value={ubicacion} />
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Se van a archivar {cantidadElegibles} receta{cantidadElegibles === 1 ? "" : "s"} en <strong>{ubicacion}</strong>.
      </p>
    </SimpleForm>
  );
}
