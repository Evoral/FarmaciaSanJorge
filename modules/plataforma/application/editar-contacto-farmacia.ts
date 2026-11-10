/**
 * Edit the pharmacy's contacto (openspec/changes/plataforma-superadmin P12). Only the contacto: the tenant's own datos
 * belong to its Administrador (Configuración › Farmacia), which is why this edit offers less than the alta.
 */
import { z } from "zod";
import { email, textoOpcional, uuid } from "@/shared/validation";
import { definePlataforma } from "./define-plataforma";
import { CONTACTO_NOMBRE_MAX, TELEFONO_MAX } from "../domain/farmacia";
import { editarContactoFarmacia as editarContactoDb } from "../infrastructure/plataforma-repository";

/** Shared with the alta, which offers the same contacto fields. An empty email means "no email". */
export const contactoInput = {
  contactoNombre: textoOpcional(CONTACTO_NOMBRE_MAX),
  contactoEmail: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), email.nullish()).transform((v) => v ?? null),
  contactoTelefono: textoOpcional(TELEFONO_MAX),
};

export const editarContactoFarmaciaCommand = definePlataforma({
  name: "plataforma.farmacias.contacto",
  input: z.object({ id: uuid, ...contactoInput }),
  handler: ({ tx, actor, input, meta }) =>
    editarContactoDb(tx, actor.tokenHash, input.id, { nombre: input.contactoNombre, email: input.contactoEmail, telefono: input.contactoTelefono }, meta),
});

export function editarContactoFarmacia(raw: Record<string, unknown>) {
  return editarContactoFarmaciaCommand.execute(raw);
}
