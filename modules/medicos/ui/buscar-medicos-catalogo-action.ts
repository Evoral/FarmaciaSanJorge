"use server";

/** Read-only suggestions for the `/catalogos/medicos` search: a thin wrapper over `listMedicos` (same `medicos.gestionar` permiso, same apellido/matrícula search). */
import { listMedicos } from "@/modules/medicos/application/list-medicos";
import { formatMatricula } from "@/modules/medicos/domain/medico";
import type { SugerenciaNavegable } from "@/shared/ui/buscador-navegable";

export async function buscarMedicosCatalogoAction(busqueda: string): Promise<SugerenciaNavegable[]> {
  const search = String(busqueda ?? "").trim().slice(0, 100);
  const result = await listMedicos({ search: search || undefined, page: 1, pageSize: 10 });
  return result.items.map((medico) => ({
    id: medico.id,
    label: `${medico.apellido}, ${medico.nombre}${medico.fechaBaja ? " (baja)" : ""}`,
    description: formatMatricula(medico.matriculaJurisdiccion, medico.matricula),
  }));
}
