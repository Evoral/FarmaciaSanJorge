"use client";

/** Crear/editar proveedor form (FASE 4 point 4.3). The page provides the surrounding panel. */
import { crearProveedorAction, editarProveedorAction } from "./actions";
import { SimpleForm } from "@/shared/ui/simple-form";
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
    <SimpleForm action={action} submitLabel={mode === "crear" ? "Crear proveedor" : "Guardar cambios"}>
      {mode === "editar" && proveedor ? (
        <>
          <input type="hidden" name="id" value={proveedor.id} />
          <input type="hidden" name="versionRazonSocial" value={proveedor.razonSocial} />
          <input type="hidden" name="versionCuit" value={proveedor.cuit} />
        </>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <div className="field">
          <label htmlFor="razonSocial" className="field-label">
            Razón social
          </label>
          <input id="razonSocial" name="razonSocial" defaultValue={proveedor?.razonSocial ?? ""} required disabled={disabled} className="input" />
        </div>
        <div className="field">
          <label htmlFor="cuit" className="field-label">
            CUIT
          </label>
          <input
            id="cuit"
            name="cuit"
            defaultValue={proveedor ? formatCuit(proveedor.cuit) : ""}
            required
            disabled={disabled}
            placeholder="20-12345678-6"
            className="input font-mono"
          />
        </div>
      </div>
    </SimpleForm>
  );
}
