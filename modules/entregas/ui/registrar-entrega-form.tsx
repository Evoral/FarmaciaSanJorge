"use client";

/**
 * Entrega registration form (11.1/11.2): modalidad radio (RETIRO_PRESENCIAL
 * / ENVIO), shown as two selectable cards, and the "Pagada" switch -- required
 * for RETIRO_PRESENCIAL (the receta becomes ENTREGADA, docs/specs/pago-receta.md
 * P4); an ENVIO may leave unpaid. No receta física checkbox: the
 * attribute was removed (client decision 2026-10-01, migration 0051). See
 * shared/ui/motivo-form.tsx for the same `shared/ui/simple-form.tsx`-wrapping
 * shape.
 */
import { useState } from "react";
import { Store, TriangleAlert, Truck } from "lucide-react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { PagoSwitch } from "@/modules/recetas/ui/pago-switch";
import type { EntregaActionState } from "./action-state";

export interface RegistrarEntregaFormProps {
  action: (prevState: EntregaActionState, formData: FormData) => Promise<EntregaActionState>;
  recetaId: string;
  /** The receta is already paid: the switch shows on and locked (the entrega never lowers the payment). */
  pagada: boolean;
  /** Runs after a successful registration (the pop-up closes itself). */
  onSuccess?: () => void;
}

export function RegistrarEntregaForm({ action, recetaId, pagada, onSuccess }: RegistrarEntregaFormProps) {
  const [modalidad, setModalidad] = useState<"RETIRO_PRESENCIAL" | "ENVIO">("RETIRO_PRESENCIAL");
  const [pagarAhora, setPagarAhora] = useState(false);
  const faltaPago = modalidad === "RETIRO_PRESENCIAL" && !pagada && !pagarAhora;

  return (
    <SimpleForm
      action={action}
      submitLabel="Registrar entrega"
      pendingLabel="Registrando…"
      onSuccess={onSuccess}
      submitDisabled={faltaPago}
      submitDisabledReason="Para el retiro presencial, marcá la receta como pagada."
    >
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
            <span className="block text-xs text-zinc-500">Queda pendiente hasta confirmar su retorno.</span>
          </span>
        </label>
      </fieldset>

      {pagada ? (
        <PagoSwitch pago={{ pagada: true, onChange: () => {}, disabled: true }} className="" />
      ) : (
        <div className="flex flex-col gap-2">
          <div role="note" className="alert alert-warn">
            <TriangleAlert aria-hidden />
            <p>
              <strong className="font-semibold">Receta impaga.</strong>{" "}
              {modalidad === "RETIRO_PRESENCIAL"
                ? "Para entregarla tiene que quedar pagada."
                : "Podés enviarla impaga: el pago se pide al confirmar el retorno."}
            </p>
          </div>
          <PagoSwitch pago={{ pagada: pagarAhora, onChange: setPagarAhora, disabled: false, name: "pagada" }} className="" />
        </div>
      )}

      {modalidad === "ENVIO" ? (
        <p className="text-[0.8125rem] leading-relaxed text-zinc-600">
          La receta pasa a &quot;Enviada, esperando retorno&quot; hasta que confirmes que el envío volvió.
        </p>
      ) : null}
    </SimpleForm>
  );
}
