/**
 * Resolution of model output against permitted guide entries (CA4b, CA6, CA8, CA11).
 */
import type { EntradaGuia } from "./guia";

export type SalidaModelo = {
  readonly respuesta: string;
  readonly entradaId: string | null;
  readonly necesitaDetalle: boolean;
};

export const CARTEL_FUERA_DE_OPCIONES =
  "No lo encuentro entre tus opciones. Puede que lo haga otro rol: preguntale a tu director técnico o al administrador.";

export const MENSAJE_AYUDA_NO_DISPONIBLE =
  "La ayuda no está disponible en este momento.";

export type EntradaRespondida = {
  readonly id: string;
  readonly titulo: string;
  readonly ruta: string;
};

export type RespuestaResuelta =
  | {
      readonly tipo: "fuera_de_opciones";
      readonly respuesta: typeof CARTEL_FUERA_DE_OPCIONES;
    }
  | {
      readonly tipo: "respondida";
      readonly respuesta: string;
      readonly entrada: EntradaRespondida;
    }
  | {
      readonly tipo: "invalida";
    };

/**
 * Validates and maps raw model output against the permitted guide entries.
 *
 * Rules:
 * - If `entradaId === null`, returns `fuera_de_opciones` with `CARTEL_FUERA_DE_OPCIONES`,
 *   completely ignoring whatever text the model produced (CA4b).
 * - If `entradaId` is present in `permitidas`, returns `respondida` with `titulo` and `ruta`
 *   derived directly from the server guide (never trusting routes from model text, CA6).
 *   If the model's text is blank, falls back to the entry's `pasos`.
 * - If `entradaId` is not in `permitidas`, returns `invalida`. The application layer treats
 *   this as a provider failure (resultado 'error', CA11).
 */
export function resolverRespuesta(
  salida: SalidaModelo,
  permitidas: readonly EntradaGuia[]
): RespuestaResuelta {
  if (salida.entradaId === null) {
    return {
      tipo: "fuera_de_opciones",
      respuesta: CARTEL_FUERA_DE_OPCIONES,
    };
  }

  const entrada = permitidas.find((e) => e.id === salida.entradaId);
  if (!entrada) {
    return { tipo: "invalida" };
  }

  const textoRespuesta = salida.respuesta.trim();
  const respuesta = textoRespuesta.length > 0 ? textoRespuesta : entrada.pasos;

  return {
    tipo: "respondida",
    respuesta,
    entrada: {
      id: entrada.id,
      titulo: entrada.titulo,
      ruta: entrada.ruta,
    },
  };
}

/**
 * Determines whether a second LLM query is required to fetch details for a non-focus entry (CA8).
 *
 * Fail-closed: returns true only when:
 * - `salida.necesitaDetalle` is true, AND
 * - `salida.entradaId` is non-null, AND
 * - `salida.entradaId` is different from `focoId`, AND
 * - `salida.entradaId` belongs to `permitidas`.
 */
export function requiereSegundaConsulta(
  salida: SalidaModelo,
  focoId: string | null | undefined,
  permitidas: readonly EntradaGuia[]
): boolean {
  return (
    salida.necesitaDetalle === true &&
    salida.entradaId !== null &&
    salida.entradaId !== focoId &&
    permitidas.some((entrada) => entrada.id === salida.entradaId)
  );
}
