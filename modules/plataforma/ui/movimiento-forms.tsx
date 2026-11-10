"use client";

/**
 * Cuenta corriente forms of a pharmacy (openspec/changes/plataforma-superadmin P13-P15): register a cargo, register a
 * pago, anular a movimiento. Each keeps what was typed on an error and marks the field (SimpleForm).
 */
import { useState } from "react";
import { SimpleForm } from "@/shared/ui/simple-form";
import { NumeroInput } from "@/shared/ui/numero-input";
import { DateInput } from "@/shared/ui/date-input";
import { CollapsibleActionCard, MotivoField } from "@/shared/ui/motivo-form";
import { CONCEPTO_MAX, MEDIOS_PAGO, MEDIO_PAGO_LABEL, NOTA_MAX } from "../domain/farmacia";
import { anularMovimientoAction, registrarCargoAction, registrarPagoAction } from "./actions";

export function CargoForm({ tenantId, periodoActual }: { tenantId: string; periodoActual: string }) {
  return (
    <SimpleForm className="@container" action={registrarCargoAction} submitLabel="Registrar cargo">
      <input type="hidden" name="tenantId" value={tenantId} />
      <div className="grid gap-4 @lg:grid-cols-2">
        <div className="field">
          <label htmlFor="cargo-periodo" className="field-label">
            Período
          </label>
          <input id="cargo-periodo" name="periodo" type="month" required defaultValue={periodoActual} className="input" />
        </div>
        <div className="field">
          <label htmlFor="cargo-monto" className="field-label">
            Monto ($)
          </label>
          <NumeroInput id="cargo-monto" name="monto" required className="input tabular-nums" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="cargo-concepto" className="field-label">
          Concepto
        </label>
        <input id="cargo-concepto" name="concepto" required maxLength={CONCEPTO_MAX} defaultValue="Abono mensual" autoComplete="off" className="input" />
      </div>
    </SimpleForm>
  );
}

export function PagoForm({ tenantId, hoy }: { tenantId: string; hoy: string }) {
  // One envioId per form instance: kept across error retries, renewed after a success (alta-receta-idempotente R1).
  const [envioId, setEnvioId] = useState(() => crypto.randomUUID());
  return (
    <SimpleForm className="@container" action={registrarPagoAction} submitLabel="Registrar pago" onSuccess={() => setEnvioId(crypto.randomUUID())}>
      <input type="hidden" name="tenantId" value={tenantId} />
      <input type="hidden" name="envioId" value={envioId} />
      <div className="grid gap-4 @lg:grid-cols-3">
        <div className="field">
          <label htmlFor="pago-fecha" className="field-label">
            Fecha
          </label>
          <DateInput id="pago-fecha" name="fecha" required defaultValue={hoy} max={hoy} />
        </div>
        <div className="field">
          <label htmlFor="pago-monto" className="field-label">
            Monto ($)
          </label>
          <NumeroInput id="pago-monto" name="monto" required className="input tabular-nums" />
        </div>
        <div className="field">
          <label htmlFor="pago-medio" className="field-label">
            Medio
          </label>
          <select id="pago-medio" name="medio" required defaultValue="TRANSFERENCIA" className="input">
            {MEDIOS_PAGO.map((medio) => (
              <option key={medio} value={medio}>
                {MEDIO_PAGO_LABEL[medio]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="pago-nota" className="field-label">
          Nota <span className="font-normal text-zinc-500">(opcional)</span>
        </label>
        <input id="pago-nota" name="nota" maxLength={NOTA_MAX} autoComplete="off" className="input" />
      </div>
    </SimpleForm>
  );
}

export function AnularMovimiento({ tipo, id }: { tipo: "CARGO" | "PAGO"; id: string }) {
  const etiqueta = tipo === "PAGO" ? "Anular pago" : "Anular cargo";
  return (
    <CollapsibleActionCard label="Anular" variant="secondary" className="w-72" helpText="No se borra: queda tachado, con quién lo anuló, cuándo y el motivo, y deja de contar en el saldo.">
      {({ close, cancelButton }) => (
        <SimpleForm action={anularMovimientoAction} submitLabel={etiqueta} pendingLabel="Anulando…" submitVariant="danger" onSuccess={close} extraActions={cancelButton}>
          <input type="hidden" name="tipo" value={tipo} />
          <input type="hidden" name="id" value={id} />
          <MotivoField />
        </SimpleForm>
      )}
    </CollapsibleActionCard>
  );
}
