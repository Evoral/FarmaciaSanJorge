"use client";

/**
 * Entrega registration form (11.1/11.2): modalidad radio (RETIRO_PRESENCIAL
 * / ENVIO) + the required "Recibí la receta física original" checkbox,
 * shown ONLY for RETIRO_PRESENCIAL when `recetaFisicaRecibida` is still
 * false (user decision 5). See modules/recetas/ui/motivo-form.tsx for the
 * same "own copy per module" SimpleForm-wrapping shape.
 */
import { useId, useState } from "react";
import { SimpleForm } from "./simple-form";
import type { EntregaActionState } from "./action-state";

export interface RegistrarEntregaFormProps {
  action: (prevState: EntregaActionState, formData: FormData) => Promise<EntregaActionState>;
  recetaId: string;
  recetaFisicaRecibida: boolean;
}

export function RegistrarEntregaForm({ action, recetaId, recetaFisicaRecibida }: RegistrarEntregaFormProps) {
  const [modalidad, setModalidad] = useState<"RETIRO_PRESENCIAL" | "ENVIO">("RETIRO_PRESENCIAL");
  const groupId = useId();

  const requiereCheckbox = modalidad === "RETIRO_PRESENCIAL" && !recetaFisicaRecibida;

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

      {requiereCheckbox ? (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
          <label htmlFor={groupId} className="flex items-start gap-2 text-sm">
            <input id={groupId} type="checkbox" name="confirmaRecepcionFisica" required className="mt-0.5" />
            <span>
              Recibí la receta física original (INV-R07: obligatorio para poder registrar el retiro presencial, ya que todavía no está
              registrada la recepción de la receta física).
            </span>
          </label>
        </div>
      ) : modalidad === "ENVIO" ? (
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          El envío queda pendiente de firma: la receta pasa a &quot;Enviada, pendiente de firma&quot; hasta confirmar que el
          repartidor trajo la constancia firmada junto con la receta física original.
        </p>
      ) : null}
    </SimpleForm>
  );
}
