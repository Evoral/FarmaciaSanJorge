"use server";

/** Server Actions for `/catalogos/pacientes` (FASE 4 point 4.5). HEALTH-ADJACENT DATA (DP-24): none of these ever call a logger with paciente fields. */
import { revalidatePath } from "next/cache";
import { crearPaciente } from "@/modules/pacientes/application/crear-paciente";
import { editarPaciente } from "@/modules/pacientes/application/editar-paciente";
import { darDeBajaPaciente } from "@/modules/pacientes/application/dar-de-baja-paciente";
import { reactivarPaciente } from "@/modules/pacientes/application/reactivar-paciente";
import { AppError } from "@/shared/errors";
import type { PacienteActionState } from "./action-state";

function fromError(error: unknown, fallback: string): PacienteActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  return { status: "error", message: fallback };
}

function optional(formData: FormData, key: string): string | undefined {
  const value = formData.get(key);
  if (value === null) return undefined;
  const str = String(value);
  return str.length > 0 ? str : undefined;
}

function optionalOrNull(formData: FormData, key: string): string | null {
  const value = optional(formData, key);
  return value ?? null;
}

export async function crearPacienteAction(_prevState: PacienteActionState, formData: FormData): Promise<PacienteActionState> {
  try {
    await crearPaciente({
      nombre: String(formData.get("nombre") ?? ""),
      apellido: String(formData.get("apellido") ?? ""),
      cuil: optional(formData, "cuil"),
      dni: optional(formData, "dni"),
      telefono: optional(formData, "telefono"),
      email: optional(formData, "email"),
      fechaNacimiento: optional(formData, "fechaNacimiento"),
      nroCredencial: optional(formData, "nroCredencial"),
      sexo: optional(formData, "sexo"),
    });
    revalidatePath("/catalogos/pacientes");
    return { status: "success", message: "Paciente creado." };
  } catch (error) {
    return fromError(error, "No se pudo crear el paciente.");
  }
}

export async function editarPacienteAction(_prevState: PacienteActionState, formData: FormData): Promise<PacienteActionState> {
  try {
    await editarPaciente({
      id: String(formData.get("id") ?? ""),
      nombre: String(formData.get("nombre") ?? ""),
      apellido: String(formData.get("apellido") ?? ""),
      cuil: optional(formData, "cuil"),
      dni: optional(formData, "dni"),
      telefono: optional(formData, "telefono"),
      email: optional(formData, "email"),
      fechaNacimiento: optional(formData, "fechaNacimiento"),
      nroCredencial: optional(formData, "nroCredencial"),
      sexo: optional(formData, "sexo"),
      version: {
        nombre: String(formData.get("versionNombre") ?? ""),
        apellido: String(formData.get("versionApellido") ?? ""),
        cuil: optionalOrNull(formData, "versionCuil"),
        dni: optionalOrNull(formData, "versionDni"),
        telefono: optionalOrNull(formData, "versionTelefono"),
        email: optionalOrNull(formData, "versionEmail"),
        fechaNacimiento: optionalOrNull(formData, "versionFechaNacimiento"),
        nroCredencial: optionalOrNull(formData, "versionNroCredencial"),
        sexo: optionalOrNull(formData, "versionSexo"),
      },
    });
    revalidatePath("/catalogos/pacientes");
    return { status: "success", message: "Paciente actualizado." };
  } catch (error) {
    return fromError(error, "No se pudieron guardar los cambios.");
  }
}

export async function darDeBajaPacienteAction(_prevState: PacienteActionState, formData: FormData): Promise<PacienteActionState> {
  try {
    await darDeBajaPaciente({ id: String(formData.get("id") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    revalidatePath("/catalogos/pacientes");
    return { status: "success", message: "Paciente dado de baja." };
  } catch (error) {
    return fromError(error, "No se pudo dar de baja al paciente.");
  }
}

export async function reactivarPacienteAction(_prevState: PacienteActionState, formData: FormData): Promise<PacienteActionState> {
  try {
    await reactivarPaciente({ id: String(formData.get("id") ?? ""), motivo: String(formData.get("motivo") ?? "") });
    revalidatePath("/catalogos/pacientes");
    return { status: "success", message: "Paciente reactivado." };
  } catch (error) {
    return fromError(error, "No se pudo reactivar al paciente.");
  }
}
