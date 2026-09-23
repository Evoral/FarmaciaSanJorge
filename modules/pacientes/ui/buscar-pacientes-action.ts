"use server";

/**
 * Search Server Action for `/catalogos/pacientes` (FASE 4 point 4.5,
 * DP-24). Deliberately SEPARATE from `page.tsx`'s GET `searchParams` (which
 * only ever reads the non-identifying `estado`/`page`/`nuevo` params -- see
 * that file's doc comment) -- the search term itself (apellido or DNI, both
 * identifying for a paciente) is submitted here as a POST'd `FormData`
 * field and NEVER touches the URL/query string, per the task's binding
 * rule: "never put patient data in URLs or query strings". The client
 * component `pacientes-buscador.tsx` calls this via `useActionState`,
 * which posts through a Server Action's own RPC endpoint, not a `<form
 * method="get">` navigation.
 */
import { listPacientes } from "@/modules/pacientes/application/list-pacientes";
import { AppError } from "@/shared/errors";
import type { ListPacientesResult } from "@/modules/pacientes/application/list-pacientes";

/** Derived from the application layer's own result shape (never `infrastructure/` directly -- ui/** may only reach into a module's application/ layer, per eslint.config.mjs's appBoundaryPatterns, which also covers modules/**\/*.ts). Exported as a type-only export so this stays valid under this file's `"use server"` directive (which only permits async function value exports). */
export type PacienteListItem = ListPacientesResult["items"][number];

const PAGE_SIZE = 20;

export type BuscarPacientesState =
  | { status: "idle"; items: PacienteListItem[]; total: number }
  | { status: "error"; message: string; items: PacienteListItem[]; total: number }
  | { status: "success"; items: PacienteListItem[]; total: number };

export async function buscarPacientesAction(prevState: BuscarPacientesState, formData: FormData): Promise<BuscarPacientesState> {
  const q = String(formData.get("q") ?? "").trim();
  const estado = String(formData.get("estado") ?? "");
  const soloVigentes = estado === "baja" ? false : estado === "vigente" ? true : undefined;

  try {
    const result = await listPacientes({ search: q.length > 0 ? q : undefined, soloVigentes, page: 1, pageSize: PAGE_SIZE });
    return { status: "success", items: result.items, total: result.total };
  } catch (error) {
    const message = error instanceof AppError ? error.message : "No se pudo buscar pacientes.";
    return { status: "error", message, items: prevState.items, total: prevState.total };
  }
}
