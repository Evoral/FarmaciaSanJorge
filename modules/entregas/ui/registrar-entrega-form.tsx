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
 * "Repartidor" autocomplete over the ACTIVE repartidores. Without a receta domicilio the form asks for one (`domicilio`, saved on the receta by the use case, E4); with no
 * active repartidor the form says so and, for whoever manages the catalog, links to it. The picked repartidor is
 * submitted as `repartidorId` only while "Envío" is chosen (a retiro presencial never carries one, E2).
 */
import { useId, useState } from "react";
import Link from "next/link";
import { Store, TriangleAlert, Truck } from "lucide-react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { Combobox, type ComboboxOption } from "@/shared/ui/combobox";
import { PagoSwitch } from "@/modules/recetas/ui/pago-switch";
import { MAX_DOMICILIO_PACIENTE } from "@/modules/recetas/domain/receta";
import { buscarRepartidoresParaCombobox } from "@/modules/repartidores/ui/repartidor-search";
import type { EntregaActionState } from "./action-state";

/** Active repartidores only: an inactive one is never offered for a new envío (E3). */
const buscarRepartidoresActivos = buscarRepartidoresParaCombobox(true);

export interface RegistrarEntregaFormProps {
  action: (prevState: EntregaActionState, formData: FormData) => Promise<EntregaActionState>;
  recetaId: string;
  /** The receta is already paid: the switch shows on and locked (the entrega never lowers the payment). */
  pagada: boolean;
  /** `receta.domicilio_paciente`; blank or null means the person registering types the domicilio de entrega (E4). */
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
  // The receta has none: an envío is registered from PREPARADA, where it can no longer be edited, so it is typed here and
  // saved on the receta by the use case (E4). The state survives a server error (useFormSubmit never resets on error).
  const [domicilioEscrito, setDomicilioEscrito] = useState("");
  const domicilioInputId = useId();
  const domicilio = domicilioPaciente?.trim() ?? "";
  const recetaTieneDomicilio = domicilio.length > 0;
  const faltaPago = modalidad === "RETIRO_PRESENCIAL" && !pagada && !pagarAhora;
  const faltaRepartidor = modalidad === "ENVIO" && !repartidor;
  const faltaDomicilio = modalidad === "ENVIO" && !recetaTieneDomicilio && domicilioEscrito.trim().length === 0;
  const motivoSubmitDeshabilitado = faltaPago
    ? "Para el retiro presencial, marcá la receta como pagada."
    : faltaRepartidor
      ? "Elija el repartidor que lleva el envío."
      : "Ingrese el domicilio de entrega.";

  return (
    <SimpleForm
      action={action}
      submitLabel="Registrar entrega"
      pendingLabel="Registrando…"
      onSuccess={onSuccess}
      submitDisabled={faltaPago || faltaRepartidor || faltaDomicilio}
      submitDisabledReason={motivoSubmitDeshabilitado}
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

      {modalidad === "ENVIO" ? (
        <div className="flex flex-col gap-3">
          {recetaTieneDomicilio ? (
            <div className="field">
              <span className="field-label">Domicilio de entrega</span>
              <p className="text-sm text-zinc-900">{domicilio}</p>
            </div>
          ) : (
            <div className="field">
              <label htmlFor={domicilioInputId} className="field-label">
                Domicilio de entrega
              </label>
              <input
                id={domicilioInputId}
                name="domicilio"
                value={domicilioEscrito}
                onChange={(e) => setDomicilioEscrito(e.target.value)}
                required
                maxLength={MAX_DOMICILIO_PACIENTE}
                autoComplete="off"
                placeholder="Calle, número, localidad"
                className="input w-full"
              />
              <p className="mt-1 text-xs text-zinc-500">La receta no tiene domicilio: se guarda en la receta al registrar el envío.</p>
            </div>
          )}
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
