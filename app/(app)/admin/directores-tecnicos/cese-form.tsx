"use client";

/**
 * Inline "reveal on click" cese form for a row on `/admin/directores-tecnicos`
 * (M04, FASE 3 point 3.9) -- same reveal pattern as
 * `modules/usuarios/ui/estado-acciones.tsx`'s `MotivoForm`, but with the two
 * fields a cese needs (`vigenteHasta` + `motivoCese`) instead of just a
 * motivo. Cese is DEFINITIVE (INV-DT-003): once submitted there is no undo,
 * which the confirm-shaped copy below says explicitly.
 */
import { useId, useState } from "react";
import { cesarDesignacionAction } from "./actions";
import { ReauthAwareForm } from "@/modules/directores-tecnicos/ui/reauth-aware-form";

export interface CeseFormProps {
  designacionId: string;
}

export function CeseForm({ designacionId }: CeseFormProps) {
  const [open, setOpen] = useState(false);
  const vigenteHastaId = useId();
  const motivoId = useId();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded border border-red-300 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:text-red-400"
      >
        Registrar cese
      </button>
    );
  }

  return (
    <div className="w-64 rounded border border-zinc-300 p-3 dark:border-zinc-700">
      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">Definitivo: una vez registrado, el cese no se puede modificar ni deshacer.</p>
      <ReauthAwareForm action={cesarDesignacionAction} submitLabel="Registrar cese" pendingLabel="Registrando…" onSuccess={() => setOpen(false)}>
        <input type="hidden" name="designacionId" value={designacionId} />
        <div className="mb-2 flex flex-col gap-1">
          <label htmlFor={vigenteHastaId} className="text-sm font-medium">
            Vigente hasta
          </label>
          <input
            id={vigenteHastaId}
            name="vigenteHasta"
            type="date"
            required
            className="rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
        <label htmlFor={motivoId} className="text-sm font-medium">
          Motivo del cese
        </label>
        <textarea id={motivoId} name="motivoCese" required rows={2} className="mt-1 w-full rounded border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
      </ReauthAwareForm>
      <button type="button" onClick={() => setOpen(false)} className="mt-2 text-sm underline">
        Cancelar
      </button>
    </div>
  );
}
