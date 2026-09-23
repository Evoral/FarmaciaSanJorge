"use server";

/**
 * Server Actions for `/recetas` (FASE 6, points 6.1/6.3/6.4/6.5). Paciente
 * and médico search/quick-create REUSE modules/pacientes' and
 * modules/medicos' own application-layer use cases directly (`listPacientes`/
 * `crearPaciente`, `listMedicos`/`crearMedico`) -- not their `ui/actions.ts`
 * (which don't return the created id, needed here to auto-select the new
 * paciente/médico in the receta form) and not their `infrastructure/`
 * (forbidden by eslint's appBoundaryPatterns even for modules/**\/*.ts, and
 * architecturally wrong -- every module's application layer is the only
 * legitimate cross-module entry point).
 */
import { revalidatePath } from "next/cache";
import { crearReceta } from "@/modules/recetas/application/crear-receta";
import { editarReceta } from "@/modules/recetas/application/editar-receta";
import { registrarRecepcionFisica } from "@/modules/recetas/application/registrar-recepcion-fisica";
import { anularReceta } from "@/modules/recetas/application/anular-receta";
import { listDrogasParaReceta } from "@/modules/recetas/application/list-drogas-para-receta";
import type { DrogaOpcion } from "@/modules/recetas/application/list-drogas-para-receta";
import { listPacientes } from "@/modules/pacientes/application/list-pacientes";
import { crearPaciente } from "@/modules/pacientes/application/crear-paciente";
import { listMedicos } from "@/modules/medicos/application/list-medicos";
import { crearMedico } from "@/modules/medicos/application/crear-medico";
import { AppError } from "@/shared/errors";
import type { RecetaActionState, BuscarPersonaState, CrearPersonaRapidaState } from "./action-state";

function fromError(error: unknown, fallback: string): RecetaActionState {
  if (error instanceof AppError) return { status: "error", message: error.message };
  return { status: "error", message: fallback };
}

// ============================================================================
// 6.1 / 6.3: alta y edición
// ============================================================================

export async function crearRecetaAction(_prevState: RecetaActionState, formData: FormData): Promise<RecetaActionState> {
  try {
    const items = JSON.parse(String(formData.get("itemsJson") ?? "[]"));
    const nueva = await crearReceta({
      pacienteId: String(formData.get("pacienteId") ?? ""),
      medicoId: String(formData.get("medicoId") ?? ""),
      fechaPrescripcion: String(formData.get("fechaPrescripcion") ?? ""),
      origen: String(formData.get("origen") ?? "PRESENCIAL") as "PRESENCIAL" | "DIGITAL_PDF" | "DIGITAL_FOTO",
      recetaFisicaRecibida: formData.get("recetaFisicaRecibida") === "on",
      items,
    });
    revalidatePath("/recetas");
    return { status: "success", message: "Receta creada.", id: nueva.id, numeroInterno: nueva.numeroInterno };
  } catch (error) {
    return fromError(error, "No se pudo crear la receta.");
  }
}

export async function editarRecetaAction(_prevState: RecetaActionState, formData: FormData): Promise<RecetaActionState> {
  try {
    const items = JSON.parse(String(formData.get("itemsJson") ?? "[]"));
    const itemsVersion = JSON.parse(String(formData.get("itemsVersionJson") ?? "[]"));
    const id = String(formData.get("id") ?? "");
    await editarReceta({
      id,
      pacienteId: String(formData.get("pacienteId") ?? ""),
      medicoId: String(formData.get("medicoId") ?? ""),
      fechaPrescripcion: String(formData.get("fechaPrescripcion") ?? ""),
      origen: String(formData.get("origen") ?? "PRESENCIAL") as "PRESENCIAL" | "DIGITAL_PDF" | "DIGITAL_FOTO",
      items,
      itemsVersion,
      version: {
        pacienteId: String(formData.get("versionPacienteId") ?? ""),
        medicoId: String(formData.get("versionMedicoId") ?? ""),
        fechaPrescripcion: String(formData.get("versionFechaPrescripcion") ?? ""),
        origen: String(formData.get("versionOrigen") ?? "PRESENCIAL") as "PRESENCIAL" | "DIGITAL_PDF" | "DIGITAL_FOTO",
      },
    });
    revalidatePath("/recetas");
    revalidatePath(`/recetas/${id}`);
    return { status: "success", message: "Receta actualizada.", id };
  } catch (error) {
    return fromError(error, "No se pudieron guardar los cambios.");
  }
}

// ============================================================================
// 6.4: recepción física
// ============================================================================

export async function registrarRecepcionFisicaAction(_prevState: RecetaActionState, formData: FormData): Promise<RecetaActionState> {
  try {
    const id = String(formData.get("id") ?? "");
    await registrarRecepcionFisica({ id });
    revalidatePath("/recetas");
    revalidatePath(`/recetas/${id}`);
    revalidatePath("/recetas/pendientes-fisica");
    return { status: "success", message: "Recepción física registrada.", id };
  } catch (error) {
    return fromError(error, "No se pudo registrar la recepción física.");
  }
}

// ============================================================================
// 6.5: anulación
// ============================================================================

export async function anularRecetaAction(_prevState: RecetaActionState, formData: FormData): Promise<RecetaActionState> {
  try {
    const id = String(formData.get("id") ?? "");
    await anularReceta({ id, motivo: String(formData.get("motivo") ?? "") });
    revalidatePath("/recetas");
    revalidatePath(`/recetas/${id}`);
    return { status: "success", message: "Receta anulada.", id };
  } catch (error) {
    return fromError(error, "No se pudo anular la receta.");
  }
}

// ============================================================================
// Paciente picker (search reuses modules/pacientes/application/list-pacientes,
// same DP-24 discipline: the search term travels only as POST'd FormData,
// never a URL/query string -- see modules/pacientes/ui/buscar-pacientes-action.ts).
// ============================================================================

export async function buscarPacientesParaRecetaAction(prevState: BuscarPersonaState, formData: FormData): Promise<BuscarPersonaState> {
  const q = String(formData.get("q") ?? "").trim();
  try {
    const result = await listPacientes({ search: q.length > 0 ? q : undefined, soloVigentes: true, page: 1, pageSize: 10 });
    return { status: "success", items: result.items.map((p) => ({ id: p.id, nombre: p.nombre, apellido: p.apellido })) };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "No se pudo buscar pacientes.";
    return { status: "error", message, items: prevState.items };
  }
}

export async function crearPacienteRapidoAction(_prevState: CrearPersonaRapidaState, formData: FormData): Promise<CrearPersonaRapidaState> {
  try {
    const nombre = String(formData.get("nombre") ?? "");
    const apellido = String(formData.get("apellido") ?? "");
    const dniRaw = String(formData.get("dni") ?? "").trim();
    const nueva = await crearPaciente({ nombre, apellido, dni: dniRaw.length > 0 ? dniRaw : undefined });
    return { status: "success", persona: { id: nueva.id, nombre, apellido } };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "No se pudo crear el paciente.";
    return { status: "error", message };
  }
}

// ============================================================================
// Médico picker
// ============================================================================

export async function buscarMedicosParaRecetaAction(prevState: BuscarPersonaState, formData: FormData): Promise<BuscarPersonaState> {
  const q = String(formData.get("q") ?? "").trim();
  try {
    const result = await listMedicos({ search: q.length > 0 ? q : undefined, soloVigentes: true, page: 1, pageSize: 10 });
    return { status: "success", items: result.items.map((m) => ({ id: m.id, nombre: m.nombre, apellido: m.apellido })) };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "No se pudo buscar médicos.";
    return { status: "error", message, items: prevState.items };
  }
}

export async function crearMedicoRapidoAction(_prevState: CrearPersonaRapidaState, formData: FormData): Promise<CrearPersonaRapidaState> {
  try {
    const nombre = String(formData.get("nombre") ?? "");
    const apellido = String(formData.get("apellido") ?? "");
    const matricula = String(formData.get("matricula") ?? "");
    const nuevo = await crearMedico({ nombre, apellido, matricula });
    return { status: "success", persona: { id: nuevo.id, nombre, apellido } };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "No se pudo crear el médico.";
    return { status: "error", message };
  }
}

// ============================================================================
// Droga picker (item/componente rows)
// ============================================================================

export interface BuscarDrogasState {
  status: "idle" | "success" | "error";
  items: DrogaOpcion[];
  message?: string;
}

export async function buscarDrogasParaRecetaAction(prevState: BuscarDrogasState, formData: FormData): Promise<BuscarDrogasState> {
  const q = String(formData.get("q") ?? "").trim();
  try {
    const items = await listDrogasParaReceta(q.length > 0 ? q : undefined);
    return { status: "success", items };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "No se pudo buscar drogas.";
    return { status: "error", message, items: prevState.items };
  }
}
