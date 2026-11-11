/** The pharmacy's contacto fields, shared by the alta and the "Editar contacto" form (one set, P10 / P12). */
import { CONTACTO_NOMBRE_MAX, TELEFONO_MAX } from "../domain/farmacia";

export interface ContactoValores {
  contactoNombre: string | null;
  contactoEmail: string | null;
  contactoTelefono: string | null;
}

export function ContactoCampos({ valores, idPrefix }: { valores?: ContactoValores; idPrefix: string }) {
  return (
    <div className="grid gap-4 @lg:grid-cols-3">
      <div className="field">
        <label htmlFor={`${idPrefix}-contactoNombre`} className="field-label">
          Nombre de contacto
        </label>
        <input id={`${idPrefix}-contactoNombre`} name="contactoNombre" defaultValue={valores?.contactoNombre ?? ""} maxLength={CONTACTO_NOMBRE_MAX} autoComplete="off" className="input" />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-contactoEmail`} className="field-label">
          Email de contacto
        </label>
        <input id={`${idPrefix}-contactoEmail`} name="contactoEmail" type="email" defaultValue={valores?.contactoEmail ?? ""} autoComplete="off" className="input" />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-contactoTelefono`} className="field-label">
          Teléfono de contacto
        </label>
        <input id={`${idPrefix}-contactoTelefono`} name="contactoTelefono" type="tel" defaultValue={valores?.contactoTelefono ?? ""} maxLength={TELEFONO_MAX} autoComplete="off" className="input" />
      </div>
    </div>
  );
}
