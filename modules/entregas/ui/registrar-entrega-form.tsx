"use client";

/**
 * Entrega registration form (11.1/11.2): modalidad radio (RETIRO_PRESENCIAL
 * / ENVIO), shown as two selectable cards. No receta física checkbox: the
 * attribute was removed (client decision 2026-10-01, migration 0051). See
 * shared/ui/motivo-form.tsx for the same `shared/ui/simple-form.tsx`-wrapping
 * shape.
 */
import { useState } from "react";
import { Store, TriangleAlert, Truck } from "lucide-react";
import { SimpleForm } from "@/shared/ui/simple-form";
import type { EntregaActionState } from "./action-state";

export interface RegistrarEntregaFormProps {
  action: (prevState: EntregaActionState, formData: FormData) => Promise<EntregaActionState>;
  recetaId: string;
  /** Migration 0071: the receta is already paid (the checkbox starts checked and cannot lower it -- that is done from the receta's detail). */
  pagada: boolean;
  /** Runs after a successful registration (the pop-up closes itself). */
  onSuccess?: () => void;
}

export function RegistrarEntregaForm({ action, recetaId, pagada, onSuccess }: RegistrarEntregaFormProps) {
  const [modalidad, setModalidad] = useState<"RETIRO_PRESENCIAL" | "ENVIO">("RETIRO_PRESENCIAL");
  const [pagarAhora, setPagarAhora] = useState(false);

  return (
    <SimpleForm action={action} submitLabel="Registrar entrega" pendingLabel="Registrando…" onSuccess={onSuccess}>
      <input type="hidden" name="recetaId" value={recetaId} />
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-xs font-medium text-zinc-600">Modalidad</legend>
        <label className="choice-row">
          <input type="radio" name="modalidad" value="RETIRO_PRESENCIAL" checked={modalidad === "RETIRO_PRESENCIAL"} onChange={() => setModalidad("RETIRO_PRESENCIAL")} />
          <Store className="size-4 flex-none text-zinc-500" aria-hidden />
          <span className="min-w-0">
            <span className="block font-medium text-zinc-900">Retiro presencial</span>
            <span className="block text-xs text-zinc-500">El paciente la retira en el mostrador.</span>
          </span>
        </label>
        <label className="choice-row">
          <input type="radio" name="modalidad" value="ENVIO" checked={modalidad === "ENVIO"} onChange={() => setModalidad("ENVIO")} />
          <Truck className="size-4 flex-none text-zinc-500" aria-hidden />
          <span className="min-w-0">
            <span className="block font-medium text-zinc-900">Envío</span>
            <span className="block text-xs text-zinc-500">Queda pendiente hasta confirmar la firma recibida.</span>
          </span>
        </label>
      </fieldset>

      {pagada ? (
        <label className="flex items-center gap-2 text-sm font-medium text-zinc-900">
          <input type="checkbox" checked disabled />
          Pagada
        </label>
      ) : (
        <div className="flex flex-col gap-2">
          <div role="note" className="alert alert-warn">
            <TriangleAlert aria-hidden />
            <p>
              <strong className="font-semibold">Receta impaga.</strong> Podés entregarla igual; tildá &quot;Pagada&quot; si el pago se registra ahora.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm font-medium text-zinc-900">
            <input type="checkbox" name="pagada" checked={pagarAhora} onChange={(e) => setPagarAhora(e.target.checked)} />
            Pagada
          </label>
        </div>
      )}

      {modalidad === "ENVIO" ? (
        <p className="text-[0.8125rem] leading-relaxed text-zinc-600">
          La receta pasa a &quot;Enviada, pendiente de firma&quot; hasta confirmar que el repartidor trajo la constancia firmada por el paciente.
        </p>
      ) : null}
    </SimpleForm>
  );
}
