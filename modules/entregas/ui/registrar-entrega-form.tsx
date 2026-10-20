"use client";

/**
 * Entrega registration form (11.1/11.2): modalidad radio (RETIRO_PRESENCIAL
 * / ENVIO), shown as two selectable cards, and the "Pagada" switch -- required
 * for RETIRO_PRESENCIAL (the receta becomes ENTREGADA, docs/specs/pago-receta.md
 * P4); an ENVIO may leave unpaid. No receta física checkbox: the
 * attribute was removed (client decision 2026-10-01, migration 0051). See
 * shared/ui/motivo-form.tsx for the same `shared/ui/simple-form.tsx`-wrapping
 * shape.
 *
 * Envío (docs/specs/envios-repartidores.md): choosing it shows the receta's domicilio (read-only) and a required
 * "Repartidor" autocomplete over the ACTIVE repartidores. Without a domicilio the option is disabled (E4); with no
 * active repartidor the form says so and, for whoever manages the catalog, links to it. The picked repartidor is
 * submitted as `repartidorId` only while "Envío" is chosen (a retiro presencial never carries one, E2).
 */
import { useState } from "react";
import Link from "next/link";
import { Store, TriangleAlert, Truck } from "lucide-react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { Combobox, type ComboboxOption } from "@/shared/ui/combobox";
import { PagoSwitch } from "@/modules/recetas/ui/pago-switch";
import { buscarRepartidoresParaCombobox } from "@/modules/repartidores/ui/repartidor-search";
import type { EntregaActionState } from "./action-state";

/** Active repartidores only: an inactive one is never offered for a new envío (E3). */
const buscarRepartidoresActivos = buscarRepartidoresParaCombobox(true);

export interface RegistrarEntregaFormProps {
  action: (prevState: EntregaActionState, formData: FormData) => Promise<EntregaActionState>;
  recetaId: string;
  /** The receta is already paid: the switch shows on and locked (the entrega never lowers the payment). */
  pagada: boolean;
  /** `receta.domicilio_paciente`; blank or null means the receta cannot be sent (E4). */
  domicilioPaciente: string | null;
  /** The tenant has at least one active repartidor to pick. */
  hayRepartidoresActivos: boolean;
  /** `repartidores.gestionar`: the "No hay repartidores" notice links to the catalog only for who can open it. */
  puedeGestionarRepartidores: boolean;
  /** Runs after a successful registration (the pop-up closes itself). */
  onSuccess?: () => void;
}

export function RegistrarEntregaForm({
  action,
  recetaId,
  pagada,
  domicilioPaciente,
  hayRepartidoresActivos,
  puedeGestionarRepartidores,
  onSuccess,
}: RegistrarEntregaFormProps) {
  const [modalidad, setModalidad] = useState<"RETIRO_PRESENCIAL" | "ENVIO">("RETIRO_PRESENCIAL");
  const [pagarAhora, setPagarAhora] = useState(false);
  const [repartidor, setRepartidor] = useState<ComboboxOption | null>(null);
  const domicilio = domicilioPaciente?.trim() ?? "";
  const puedeEnviar = domicilio.length > 0;
  const faltaPago = modalidad === "RETIRO_PRESENCIAL" && !pagada && !pagarAhora;
  const faltaRepartidor = modalidad === "ENVIO" && !repartidor;

  return (
    <SimpleForm
      action={action}
      submitLabel="Registrar entrega"
      pendingLabel="Registrando…"
      onSuccess={onSuccess}
      submitDisabled={faltaPago || faltaRepartidor}
      submitDisabledReason={faltaPago ? "Para el retiro presencial, marcá la receta como pagada." : "Elija el repartidor que lleva el envío."}
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
        <label className={puedeEnviar ? "choice-row" : "choice-row cursor-not-allowed opacity-60"}>
          <input type="radio" name="modalidad" value="ENVIO" checked={modalidad === "ENVIO"} disabled={!puedeEnviar} onChange={() => setModalidad("ENVIO")} />
          <Truck className="size-4 flex-none text-zinc-500" aria-hidden />
          <span className="min-w-0">
            <span className="block font-medium text-zinc-900">Envío</span>
            <span className="block text-xs text-zinc-500">Queda pendiente hasta confirmar su retorno.</span>
          </span>
        </label>
        {puedeEnviar ? null : (
          <div role="note" className="alert alert-warn">
            <TriangleAlert aria-hidden />
            <p>
              <strong className="font-semibold">La receta no tiene domicilio.</strong> No se puede registrar un envío: solo retiro presencial.
            </p>
          </div>
        )}
      </fieldset>

      {modalidad === "ENVIO" ? (
        <div className="flex flex-col gap-3">
          <div className="field">
            <span className="field-label">Domicilio de entrega</span>
            <p className="text-sm text-zinc-900">{domicilio}</p>
          </div>
          {hayRepartidoresActivos ? (
            <Combobox
              label="Repartidor"
              placeholder="Buscar repartidor por nombre o teléfono"
              name="repartidorId"
              search={buscarRepartidoresActivos}
              value={repartidor}
              onChange={setRepartidor}
            />
          ) : (
            <div role="note" className="alert alert-warn">
              <TriangleAlert aria-hidden />
              <p>
                <strong className="font-semibold">No hay repartidores cargados.</strong>{" "}
                {puedeGestionarRepartidores ? (
                  <>
                    Cargue uno en{" "}
                    <Link href="/catalogos/repartidores" className="font-medium text-primary underline">
                      Catálogos → Repartidores
                    </Link>
                    .
                  </>
                ) : (
                  "Pida a un administrador que cargue uno."
                )}
              </p>
            </div>
          )}
        </div>
      ) : null}

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
