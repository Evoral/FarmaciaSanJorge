"use server";

/** Server Action for `/admin/accesos/directores-tecnicos/nuevo` (M04, FASE 3 point 3.9). */
import { designarDirectorTecnico } from "@/modules/directores-tecnicos/application/designar-director-tecnico";
import { StepUpRequiredError } from "@/shared/errors";
import { actionError } from "@/shared/ui/action-error";
import { CARACTERES_DESIGNACION } from "@/modules/directores-tecnicos/domain/designacion";

export interface DesignarDirectorTecnicoFormState {
  status: "idle" | "error" | "reauth-required" | "success";
  message: string | null;
  /** Error only: the form fields the error is about (see `shared/ui/action-error.ts`). */
  fields?: string[];
  designacionId?: string;
}

export async function designarDirectorTecnicoAction(
  _prevState: DesignarDirectorTecnicoFormState,
  formData: FormData,
): Promise<DesignarDirectorTecnicoFormState> {
  // Passed through RAW (review finding N2): an unknown/tampered value must
  // fail zod's z.enum(CARACTERES_DESIGNACION) as a validation error, not be
  // silently coerced into "TITULAR" -- that coercion used to let a crafted
  // request register a TITULAR designation (locking the tenant's TITULAR
  // slot via the non-overlap constraint) while the user believed they were
  // submitting something else entirely.
  const caracterRaw = String(formData.get("caracter") ?? "");

  try {
    const result = await designarDirectorTecnico({
      usuarioId: String(formData.get("usuarioId") ?? ""),
      // The cast is just to satisfy TypeScript at this untyped FormData
      // boundary -- designarDirectorTecnicoInput's z.enum(CARACTERES_DESIGNACION)
      // is the real, server-side validation.
      caracter: caracterRaw as (typeof CARACTERES_DESIGNACION)[number],
      matricula: String(formData.get("matricula") ?? ""),
      expedienteDesignacion: String(formData.get("expedienteDesignacion") ?? "").trim() || undefined,
      vigenteDesde: String(formData.get("vigenteDesde") ?? ""),
    });
    return { status: "success", message: null, designacionId: result.designacionId };
  } catch (error) {
    if (error instanceof StepUpRequiredError) {
      return { status: "reauth-required", message: null };
    }
    return actionError(error, "No se pudo registrar la designación.");
  }
}
