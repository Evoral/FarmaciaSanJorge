/**
 * Query use case for help chat (CA1, CA3, CA4, CA7, CA8, CA9, CA10, CA11, CA12).
 *
 * Runs entirely in `prepare` outside any database transaction:
 * - Filters guide entries to those permitted for `session.permisos`.
 * - If no entries are permitted, returns `fuera_de_opciones` immediately without calling the model.
 * - Queries the model with `permitirDetalle: true`.
 * - If the model indicates `necesitaDetalle` for an entry outside focus, issues a single follow-up query.
 * - Resolves the raw model output into a validated answer with routes sourced from the guide.
 * - Catches provider errors (`ErrorProveedorAyuda`) and invalid outputs, mapping them to `error`
 *   with `MENSAJE_AYUDA_NO_DISPONIBLE` without throwing.
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import {
  LIMITES_AYUDA,
  armarContexto,
} from "../domain/armar-contexto";
import { filtrarGuia } from "../domain/filtrar-guia";
import { GUIA_AYUDA } from "../domain/guia-entradas";
import {
  CARTEL_FUERA_DE_OPCIONES,
  MENSAJE_AYUDA_NO_DISPONIBLE,
  resolverRespuesta,
  requiereSegundaConsulta,
  type EntradaRespondida,
} from "../domain/resolver-respuesta";
import {
  consultarModeloAyuda,
  ErrorProveedorAyuda,
} from "../infrastructure/gemini.server";

const mensajeHistorialInput = z.object({
  rol: z.enum(["usuario", "asistente"]),
  contenido: z.string().max(LIMITES_AYUDA.caracteresMensaje),
});

export const consultarAyudaInput = z.object({
  pregunta: z.string().trim().min(1).max(LIMITES_AYUDA.pregunta),
  historial: z
    .array(mensajeHistorialInput)
    .max(LIMITES_AYUDA.mensajesHistorial)
    .optional()
    .default([]),
  foco: z.string().trim().max(LIMITES_AYUDA.foco).nullish(),
  conversacionId: z.string().uuid(),
});

export type ConsultarAyudaInput = z.infer<typeof consultarAyudaInput>;

export type ResultadoConsultaAyuda =
  | {
      readonly tipo: "respondida";
      readonly respuesta: string;
      readonly entrada: EntradaRespondida;
    }
  | {
      readonly tipo: "fuera_de_opciones";
      readonly respuesta: typeof CARTEL_FUERA_DE_OPCIONES;
    }
  | {
      readonly tipo: "error";
      readonly respuesta: typeof MENSAJE_AYUDA_NO_DISPONIBLE;
    };

export const consultarAyudaQuery = defineQuery({
  name: "ayuda.consultar",
  permiso: "ayuda.consultar",
  input: consultarAyudaInput,
  prepare: async ({ session, input }): Promise<ResultadoConsultaAyuda> => {
    const permitidas = filtrarGuia(GUIA_AYUDA, session.permisos);

    if (permitidas.length === 0) {
      return {
        tipo: "fuera_de_opciones",
        respuesta: CARTEL_FUERA_DE_OPCIONES,
      };
    }

    const idsPermitidos = permitidas.map((e) => e.id);
    const contexto = armarContexto({
      permitidas,
      foco: input.foco,
      historial: input.historial,
      pregunta: input.pregunta,
    });

    try {
      let salida = await consultarModeloAyuda({
        contexto,
        idsPermitidos,
        permitirDetalle: true,
      });

      if (requiereSegundaConsulta(salida, input.foco, permitidas)) {
        const contextoSegunda = armarContexto({
          permitidas,
          foco: salida.entradaId,
          historial: input.historial,
          pregunta: input.pregunta,
        });
        salida = await consultarModeloAyuda({
          contexto: contextoSegunda,
          idsPermitidos,
          permitirDetalle: false,
        });
      }

      const resuelta = resolverRespuesta(salida, permitidas);
      if (resuelta.tipo === "invalida") {
        return {
          tipo: "error",
          respuesta: MENSAJE_AYUDA_NO_DISPONIBLE,
        };
      }
      return resuelta;
    } catch (error) {
      if (error instanceof ErrorProveedorAyuda) {
        return {
          tipo: "error",
          respuesta: MENSAJE_AYUDA_NO_DISPONIBLE,
        };
      }
      throw error;
    }
  },
  handler: async ({ prepared }): Promise<ResultadoConsultaAyuda> => {
    return prepared;
  },
});

export async function consultarAyuda(
  input: ConsultarAyudaInput
): Promise<ResultadoConsultaAyuda> {
  return consultarAyudaQuery.execute(input);
}
