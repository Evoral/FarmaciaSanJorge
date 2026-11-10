"use client";

/** "Editar contacto" of a pharmacy (openspec/changes/plataforma-superadmin P12). Same fields as the alta's Contacto. */
import { SimpleForm } from "@/shared/ui/simple-form";
import { ContactoCampos, type ContactoValores } from "./contacto-campos";
import { editarContactoFarmaciaAction } from "./actions";

export function ContactoForm({ id, valores }: { id: string; valores: ContactoValores }) {
  return (
    <SimpleForm className="@container" action={editarContactoFarmaciaAction} submitLabel="Guardar contacto">
      <input type="hidden" name="id" value={id} />
      <ContactoCampos idPrefix="contacto" valores={valores} />
    </SimpleForm>
  );
}
