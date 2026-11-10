"use client";

/**
 * Suspend (motivo required) or reactivate a pharmacy (openspec/specs/plataforma/spec.md P11). A dada-de-baja
 * pharmacy gets neither (the page does not render this component for it).
 */
import { SimpleForm } from "@/shared/ui/simple-form";
import { CollapsibleActionCard, MotivoField } from "@/shared/ui/motivo-form";
import type { EstadoFarmacia } from "../domain/farmacia";
import { cambiarEstadoFarmaciaAction } from "./actions";

export function EstadoFarmaciaAcciones({ id, estado }: { id: string; estado: EstadoFarmacia }) {
  if (estado === "SUSPENDIDO") {
    return (
      <SimpleForm action={cambiarEstadoFarmaciaAction} submitLabel="Reactivar" pendingLabel="Reactivando…">
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="estado" value="ACTIVO" />
      </SimpleForm>
    );
  }

  return (
    <CollapsibleActionCard
      label="Suspender"
      variant="danger"
      helpText="Sus usuarios no van a poder iniciar sesión y las sesiones abiertas se cortan. Sus datos no cambian y se puede reactivar cuando quieras."
    >
      {({ close, cancelButton }) => (
        <SimpleForm action={cambiarEstadoFarmaciaAction} submitLabel="Suspender" pendingLabel="Suspendiendo…" submitVariant="danger" onSuccess={close} extraActions={cancelButton}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="estado" value="SUSPENDIDO" />
          <MotivoField />
        </SimpleForm>
      )}
    </CollapsibleActionCard>
  );
}
