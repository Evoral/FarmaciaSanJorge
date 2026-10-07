/**
 * The edit form's starting state (`RecetaForm`'s `inicial`) from a receta's detail. Shared by /recetas/[id]/editar and
 * the /preparaciones toma workspace, which embeds the same form.
 */
import type { RecetaDetalle } from "../application/get-receta";
import type { RecetaFormInicial } from "./receta-form";

export function inicialDesdeReceta(receta: RecetaDetalle): RecetaFormInicial {
  return {
    pacienteId: receta.pacienteId,
    pacienteLabel: `${receta.pacienteNombre} ${receta.pacienteApellido}`,
    medicoId: receta.medicoId,
    medicoLabel: `${receta.medicoApellido}, ${receta.medicoNombre}`,
    fechaPrescripcion: receta.fechaPrescripcion.toISOString().slice(0, 10),
    origen: receta.origen,
    diagnosticoCodigo: receta.diagnosticoCodigo ?? "",
    diagnosticoDescripcion: receta.diagnosticoDescripcion ?? "",
    domicilioPaciente: receta.domicilioPaciente ?? "",
    items: receta.items.map((item) => ({
      id: item.id,
      descripcion: item.descripcion ?? "",
      formaFarmaceutica: item.formaFarmaceutica,
      cantidadUnidades: String(item.cantidadUnidades),
      fraccionDosisPorUnidad: item.fraccionDosisPorUnidad,
      cantidadTotal: item.cantidadTotal ?? "",
      unidadTotalId: item.unidadTotalId ?? "",
      observaciones: item.observaciones ?? "",
      posologia: item.posologia ?? "",
      duracionTratamientoDias: item.duracionTratamientoDias !== null ? String(item.duracionTratamientoDias) : "",
      componentes: item.componentes.map((c) => ({
        id: c.id,
        drogaId: c.drogaId,
        drogaNombre: c.drogaNombre,
        drogaAliasId: c.drogaAliasId,
        sinonimo: c.sinonimo,
        cantidad: c.cantidad ?? "",
        unidadMedidaId: c.unidadMedidaId,
        modoExpresion: c.modoExpresion,
      })),
    })),
  };
}
