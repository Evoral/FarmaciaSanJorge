"use server";

/**
 * Server Actions for chat-ayuda (CA9, CA11, CA13, CA14).
 *
 * Placed in `modules/ayuda/ui/actions.ts` per repo convention:
 * the 22 existing modules keep their actions in `modules/<m>/ui/actions.ts`,
 * and the chat UI in `modules/ayuda/ui/` must not import from `app/`.
 *
 * Exports ONLY these two actions:
 * - `consultarAyudaAction`
 * - `calificarRespuestaAyudaAction`
 */
import { getLogger } from "@/shared/logging/logger";
import { actionError, type ActionErrorState } from "@/shared/ui/action-error";
import {
  consultarAyuda,
  type ConsultarAyudaInput,
  type ResultadoConsultaAyuda,
} from "../application/consultar-ayuda";
import { registrarConsultaAyuda } from "../application/registrar-consulta-ayuda";
import {
  calificarRespuestaAyuda,
  type CalificarRespuestaAyudaInput,
} from "../application/calificar-respuesta-ayuda";
import type { EntradaRespondida } from "../domain/resolver-respuesta";

export type ConsultarAyudaResultado = {
  tipo: "respondida" | "fuera_de_opciones" | "error";
  respuesta: string;
  entrada?: EntradaRespondida;
  consultaId?: string;
};

export type ConsultarAyudaActionState =
  | ConsultarAyudaResultado
  | ActionErrorState;

export type CalificarRespuestaAyudaActionState =
  | { status: "success" }
  | ActionErrorState;

export async function consultarAyudaAction(
  input: ConsultarAyudaInput
): Promise<ConsultarAyudaActionState> {
  let resultadoConsulta: ResultadoConsultaAyuda;
  try {
    resultadoConsulta = await consultarAyuda(input);
  } catch (error) {
    return actionError(error, "No se pudo consultar la ayuda.");
  }

  let consultaId: string | undefined;
  try {
    const respuestaParaRegistrar =
      resultadoConsulta.tipo === "error"
        ? null
        : resultadoConsulta.respuesta;

    const entradaIdParaRegistrar =
      resultadoConsulta.tipo === "respondida"
        ? resultadoConsulta.entrada.id
        : null;

    const registro = await registrarConsultaAyuda({
      conversacionId: input.conversacionId,
      pregunta: input.pregunta,
      respuesta: respuestaParaRegistrar,
      entradaId: entradaIdParaRegistrar,
      resultado: resultadoConsulta.tipo,
    });
    consultaId = registro.consultaId;
  } catch (regError) {
    getLogger().error(
      { err: regError },
      "Error al registrar la consulta de ayuda"
    );
  }

  return {
    tipo: resultadoConsulta.tipo,
    respuesta: resultadoConsulta.respuesta,
    ...(resultadoConsulta.tipo === "respondida"
      ? { entrada: resultadoConsulta.entrada }
      : {}),
    ...(consultaId ? { consultaId } : {}),
  };
}

export async function calificarRespuestaAyudaAction(
  input: CalificarRespuestaAyudaInput
): Promise<CalificarRespuestaAyudaActionState> {
  try {
    await calificarRespuestaAyuda(input);
    return { status: "success" };
  } catch (error) {
    return actionError(error, "No se pudo registrar la calificación.");
  }
}
