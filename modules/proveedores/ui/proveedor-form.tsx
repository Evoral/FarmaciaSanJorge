"use client";

/** Crear/editar proveedor form (FASE 4 point 4.3). */
import { crearProveedorAction, editarProveedorAction } from "./actions";
import { SimpleForm } from "./simple-form";
import { formatCuit } from "@/modules/proveedores/domain/proveedor";

export interface ProveedorFormProps {
  mode: "crear" | "editar";
  proveedor?: {
    id: string;
    razonSocial: string;
    cuit: string;
  };
  disabled: boolean;
}

export function ProveedorForm({ mode, proveedor, disabled }: ProveedorFormProps) {
  const action = mode === "crear" ? crearProveedorAction : editarProveedorAction;

  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <SimpleForm action={action} submitLabel={mode === "crear" ? "Crear proveedor" : "Guardar cambios"} className="flex max-w-md flex-col gap-3">
        {mode === "editar" && proveedor ? (
          <>
            <input type="hidden" name="id" value={proveedor.id} />
            <input type="hidden" name="versionRazonSocial" value={proveedor.razonSocial} />
            <input type="hidden" name="versionCuit" value={proveedor.cuit} />
          </>
        ) : null}

        <div className="flex flex-col gap-1">
          <label htmlFor="razonSocial" className="text-sm font-medium">
            Razón social
          </label>
          <input id="razonSocial" name="razonSocial" defaultValue={proveedor?.razonSocial ?? ""} required disabled={disabled} className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900" />
        </div>

        <div className="flex flex-col gap-1">
          <label htmlFor="cuit" className="text-sm font-medium">
            CUIT
          </label>
          <input
            id="cuit"
            name="cuit"
            defaultValue={proveedor ? formatCuit(proveedor.cuit) : ""}
            required
            disabled={disabled}
            placeholder="20-12345678-6"
            className="rounded border border-zinc-300 px-3 py-2 text-sm disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900"
          />
        </div>
      </SimpleForm>
    </div>
  );
}
