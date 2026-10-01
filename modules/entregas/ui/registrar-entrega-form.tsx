"use client";

/**
 * Entrega registration form (11.1/11.2): modalidad radio (RETIRO_PRESENCIAL
 * / ENVIO). No receta física checkbox: the attribute was removed (client
 * decision 2026-10-01, migration 0051). See shared/ui/motivo-form.tsx for the
 * same `shared/ui/simple-form.tsx`-wrapping shape.
 */
import { useState } from "react";
import { SimpleForm } from "@/shared/ui/simple-form";
import type { EntregaActionState } from "./action-state";

export interface RegistrarEntregaFormProps {
  action: (prevState: EntregaActionState, formData: FormData) => Promise<EntregaActionState>;
  recetaId: string;
}

export function RegistrarEntregaForm({ action, recetaId }: RegistrarEntregaFormProps) {
  const [modalidad, setModalidad] = useState<"RETIRO_PRESENCIAL" | "ENVIO">("RETIRO_PRESENCIAL");

  return (
    <SimpleForm action={action} submitLabel="Registrar entrega" pendingLabel="Registrando…">
      <input type="hidden" name="recetaId" value={recetaId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Modalidad</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name="modalidad"
            value="RETIRO_PRESENCIAL"
            checked={modalidad === "RETIRO_PRESENCIAL"}
            onChange={() => setModalidad("RETIRO_PRESENCIAL")}
          />
          Retiro presencial
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="radio" name="modalidad" value="ENVIO" checked={modalidad === "ENVIO"} onChange={() => setModalidad("ENVIO")} />
          Envío
        </label>
      </fieldset>

      {modalidad === "ENVIO" ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          El envío queda pendiente de firma: la receta pasa a &quot;Enviada, pendiente de firma&quot; hasta confirmar que el
          repartidor trajo la constancia firmada por el paciente.
        </p>
      ) : null}
    </SimpleForm>
  );
}
