"use client";

/** `/admin/accesos/usuarios/[id]` "Datos" tab form (M03, FASE 3 point 3.3). Carries the loaded snapshot as hidden `version*` fields for optimistic concurrency -- see editarUsuario's doc comment. The page provides the surrounding panel. */
import { editarUsuarioAction } from "./actions";
import { ReauthAwareForm } from "@/modules/auth/ui/reauth-aware-form";

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
    <ReauthAwareForm action={editarUsuarioAction} submitLabel="Guardar cambios" pendingLabel="Guardando…">
      <input type="hidden" name="id" value={usuario.id} />
      <input type="hidden" name="versionNombre" value={usuario.nombre} />
      <input type="hidden" name="versionApellido" value={usuario.apellido} />
      <input type="hidden" name="versionEmail" value={usuario.email} />
      <input type="hidden" name="versionDni" value={usuario.dni} />
      <input type="hidden" name="versionNumeroMatricula" value={usuario.numeroMatricula ?? ""} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="field">
          <label htmlFor="edit-nombre" className="field-label">
            Nombre
          </label>
          <input id="edit-nombre" name="nombre" defaultValue={usuario.nombre} required disabled={disabled} className="input" />
        </div>
        <div className="field">
          <label htmlFor="edit-apellido" className="field-label">
            Apellido
          </label>
          <input id="edit-apellido" name="apellido" defaultValue={usuario.apellido} required disabled={disabled} className="input" />
        </div>
        <div className="field sm:col-span-2">
          <label htmlFor="edit-email" className="field-label">
            Email
          </label>
          <input id="edit-email" name="email" type="email" defaultValue={usuario.email} required disabled={disabled} className="input" />
        </div>
        <div className="field">
          <label htmlFor="edit-dni" className="field-label">
            DNI
          </label>
          <input id="edit-dni" name="dni" defaultValue={usuario.dni} required disabled={disabled} className="input font-mono" />
        </div>
        <div className="field">
          <label htmlFor="edit-matricula" className="field-label">
            Matrícula <span className="font-normal text-zinc-500">(opcional)</span>
          </label>
          <input id="edit-matricula" name="numeroMatricula" defaultValue={usuario.numeroMatricula ?? ""} disabled={disabled} className="input font-mono" />
        </div>
      </div>
    </ReauthAwareForm>
  );
}
