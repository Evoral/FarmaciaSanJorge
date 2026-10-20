"use client";

/** Crear / editar repartidor: ONE form for the alta and the edición (the page provides the surrounding panel). */
import { useRouter } from "next/navigation";
import { SimpleForm } from "@/shared/ui/simple-form";
import { APELLIDO_MAX_LENGTH, NOMBRE_MAX_LENGTH, TELEFONO_MAX_LENGTH } from "../domain/repartidor";
import { crearRepartidorAction, editarRepartidorAction } from "./actions";

export interface RepartidorFormProps {
  mode: "crear" | "editar";
  repartidor?: { id: string; nombre: string; apellido: string; telefono: string };
  disabled: boolean;
  /** Where to go after a successful create (the list, which closes the "Nuevo repartidor" panel). */
  volverA?: string;
}

export function RepartidorForm({ mode, repartidor, disabled, volverA }: RepartidorFormProps) {
  const router = useRouter();
  const action = mode === "crear" ? crearRepartidorAction : editarRepartidorAction;

  return (
    <SimpleForm
      action={action}
      submitLabel={mode === "crear" ? "Crear repartidor" : "Guardar cambios"}
      submitDisabled={disabled}
      onSuccess={() => {
        if (mode === "crear" && volverA) router.push(volverA);
      }}
    >
      {mode === "editar" && repartidor ? <input type="hidden" name="id" value={repartidor.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="nombre" className="field-label">
            Nombre
          </label>
          <input id="nombre" name="nombre" defaultValue={repartidor?.nombre ?? ""} required disabled={disabled} maxLength={NOMBRE_MAX_LENGTH} autoComplete="off" className="input" />
        </div>
        <div className="field">
          <label htmlFor="apellido" className="field-label">
            Apellido
          </label>
          <input id="apellido" name="apellido" defaultValue={repartidor?.apellido ?? ""} required disabled={disabled} maxLength={APELLIDO_MAX_LENGTH} autoComplete="off" className="input" />
        </div>
      </div>
      <div className="field">
        <label htmlFor="telefono" className="field-label">
          Teléfono
        </label>
        <input id="telefono" name="telefono" type="tel" defaultValue={repartidor?.telefono ?? ""} required disabled={disabled} maxLength={TELEFONO_MAX_LENGTH} autoComplete="off" className="input" />
        <p className="field-help">Se imprime en la hoja de envíos y se muestra al elegir el repartidor de un envío.</p>
      </div>
    </SimpleForm>
  );
}
