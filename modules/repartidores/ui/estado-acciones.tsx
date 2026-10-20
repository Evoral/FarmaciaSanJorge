"use client";

/** Activar / desactivar a repartidor (`/catalogos/repartidores/[id]`): one button, no motivo needed (nothing is deleted). */
import { SimpleForm } from "@/shared/ui/simple-form";
import { cambiarEstadoRepartidorAction } from "./actions";

export interface RepartidorEstadoAccionesProps {
  id: string;
  /** The CURRENT estado: the button flips it. */
  activo: boolean;
}

export function RepartidorEstadoAcciones({ id, activo }: RepartidorEstadoAccionesProps) {
  return (
    <SimpleForm
      action={cambiarEstadoRepartidorAction}
      submitLabel={activo ? "Desactivar" : "Activar"}
      pendingLabel={activo ? "Desactivando…" : "Activando…"}
      submitVariant={activo ? "danger" : undefined}
    >
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="activo" value={activo ? "false" : "true"} />
    </SimpleForm>
  );
}
