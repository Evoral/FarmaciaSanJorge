"use client";

/** `/admin/usuarios/[id]` "Datos" tab form (M03, FASE 3 point 3.3). Carries the loaded snapshot as hidden `version*` fields for optimistic concurrency -- see editarUsuario's doc comment. */
import { editarUsuarioAction } from "./actions";
import { ReauthAwareForm } from "./reauth-aware-form";

export interface EditarDatosFormProps {
  usuario: {
    id: string;
    nombre: string;
    apellido: string;
    email: string;
    dni: string;
    numeroMatricula: string | null;
  };
  disabled: boolean;
}

export function EditarDatosForm({ usuario, disabled }: EditarDatosFormProps) {
  return (
    <ReauthAwareForm action={editarUsuarioAction} submitLabel="Guardar cambios" pendingLabel="Guardando…" className="flex max-w-md flex-col gap-4">
      <input type="hidden" name="id" value={usuario.id} />
      <input type="hidden" name="versionNombre" value={usuario.nombre} />
      <input type="hidden" name="versionApellido" value={usuario.apellido} />
      <input type="hidden" name="versionEmail" value={usuario.email} />
      <input type="hidden" name="versionDni" value={usuario.dni} />
      <input type="hidden" name="versionNumeroMatricula" value={usuario.numeroMatricula ?? ""} />

      <div className="flex flex-col gap-1">
        <label htmlFor="edit-nombre" className="text-sm font-medium">
          Nombre
        </label>
        <input id="edit-nombre" name="nombre" defaultValue={usuario.nombre} required disabled={disabled} className="input" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="edit-apellido" className="text-sm font-medium">
          Apellido
        </label>
        <input id="edit-apellido" name="apellido" defaultValue={usuario.apellido} required disabled={disabled} className="input" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="edit-email" className="text-sm font-medium">
          Email
        </label>
        <input id="edit-email" name="email" type="email" defaultValue={usuario.email} required disabled={disabled} className="input" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="edit-dni" className="text-sm font-medium">
          DNI
        </label>
        <input id="edit-dni" name="dni" defaultValue={usuario.dni} required disabled={disabled} className="input" />
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="edit-matricula" className="text-sm font-medium">
          Matrícula (opcional)
        </label>
        <input
          id="edit-matricula"
          name="numeroMatricula"
          defaultValue={usuario.numeroMatricula ?? ""}
          disabled={disabled}
          className="input"
        />
      </div>
    </ReauthAwareForm>
  );
}
