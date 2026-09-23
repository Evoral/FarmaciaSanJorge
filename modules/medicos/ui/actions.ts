"use server";

/** Server Actions for `/catalogos/medicos` (FASE 4 point 4.4). */
import { revalidatePath } from "next/cache";
import { crearMedico } from "@/modules/medicos/application/crear-medico";
import { editarMedico } from "@/modules/medicos/application/editar-medico";
import { darDeBajaMedico } from "@/modules/medicos/application/dar-de-baja-medico";
import { reactivarMedico } from "@/modules/medicos/application/reactivar-medico";
import { AppError } from "@/shared/errors";
import type { MedicoActionState } from "./action-state";

function fromError(error: unknown, fallback: string): MedicoActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  return { status: "error", message: fallback };
}

function optional(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (value === null) return undefined;
  const str = String(value);
  return str.length > 0 ? str : undefined;
}

export async function crearMedicoAction(_prevState: MedicoActionState, formData: FormData): Promise<MedicoActionState> {
  try {
    await crearMedico({
      nombre: String(formData.get("nombre") ?? ""),
      apellido: String(formData.get("apellido") ?? ""),
      matricula: String(formData.get("matricula") ?? ""),
      especialidad: optional(formData, "especialidad"),
      telefono: optional(formData, "telefono"),
      direccionRegistrada: optional(formData, "direccionRegistrada"),
    });
    revalidatePath("/catalogos/medicos");
    return { status: "success", message: "Médico creado." };
  } catch (error) {
    return fromError(error, "No se pudo crear el médico.");
  }
}

export async function editarMedicoAction(_prevState: MedicoActionState, formData: FormData): Promise<MedicoActionState> {
  try {
    await editarMedico({
      id: String(formData.get("id") ?? ""),
      nombre: String(formData.get("nombre") ?? ""),
      apellido: String(formData.get("apellido") ?? ""),
      matricula: String(formData.get("matricula") ?? ""),
      especialidad: optional(formData, "especialidad"),
      telefono: optional(formData, "telefono"),
      direccionRegistrada: optional(formData, "direccionRegistrada"),
      version: {
        nombre: String(formData.get("versionNombre") ?? ""),
        apellido: String(formData.get("versionApellido") ?? ""),
        matricula: String(formData.get("versionMatricula") ?? ""),
        especialidad: formData.get("versionEspecialidad") ? String(formData.get("versionEspecialidad")) : null,
        telefono: formData.get("versionTelefono") ? String(formData.get("versionTelefono")) : null,
        direccionRegistrada: formData.get("versionDireccionRegistrada") ? String(formData.get("versionDireccionRegistrada")) : null,
      },
    });
    revalidatePath("/catalogos/medicos");
    return { status: "success", message: "Médico actualizado." };
  } catch (error) {
    return fromError(error, "No se pudieron guardar los cambios.");
  }
}

export async function darDeBajaMedicoAction(_prevState: MedicoActionState, formData: FormData): Promise<MedicoActionState> {
  try {
    await darDeBajaMedico({ id: String(formData.get("id") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    revalidatePath("/catalogos/medicos");
    return { status: "success", message: "Médico dado de baja." };
  } catch (error) {
    return fromError(error, "No se pudo dar de baja al médico.");
  }
}

export async function reactivarMedicoAction(_prevState: MedicoActionState, formData: FormData): Promise<MedicoActionState> {
  try {
    await reactivarMedico({ id: String(formData.get("id") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    revalidatePath("/catalogos/medicos");
    return { status: "success", message: "Médico reactivado." };
  } catch (error) {
    return fromError(error, "No se pudo reactivar al médico.");
  }
}
