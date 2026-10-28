/**
 * Google Gemini model infrastructure for chat-ayuda (CA1, CA4, CA5, CA8, CA11).
 *
 * Pinned SDK: @google/genai@2.10.0.
 * Server-only: this is the ONLY runtime module allowed to read GEMINI_API_KEY.
 * Never logs sensitive data (patient data, prescription data, prompts, keys, or answers).
 */
import "server-only";
import {
  ApiError,
  GoogleGenAI,
  ThinkingLevel,
  Type,
  type Schema,
} from "@google/genai";
import { z } from "zod";
import { getEnv } from "@/shared/env";
import { getLogger } from "@/shared/logging/logger";
import type { ContextoAyuda } from "../domain/armar-contexto";
import type { SalidaModelo } from "../domain/resolver-respuesta";

export type TipoErrorProveedorAyuda =
  | "sin_clave"
  | "timeout"
  | "proveedor"
  | "formato";

export class ErrorProveedorAyuda extends Error {
  readonly tipo: TipoErrorProveedorAyuda;
  readonly statusHttp?: number;

  constructor(
    tipo: TipoErrorProveedorAyuda,
    mensaje: string,
    opciones?: { cause?: unknown; statusHttp?: number }
  ) {
    super(mensaje, opciones ? { cause: opciones.cause } : undefined);
    this.name = "ErrorProveedorAyuda";
    this.tipo = tipo;
    this.statusHttp = opciones?.statusHttp;
  }
}

/**
 * Checks whether the Gemini API key is configured.
 * Exported for phase 6 (app shell gating) so the key itself never leaves this file.
 */
export function ayudaConfigurada(): boolean {
  const env = getEnv();
  return (
    typeof env.GEMINI_API_KEY === "string" && env.GEMINI_API_KEY.length > 0
  );
}

let clienteEnCache: { clave: string; cliente: GoogleGenAI } | null = null;

function obtenerCliente(apiKey: string): GoogleGenAI {
  if (clienteEnCache && clienteEnCache.clave === apiKey) {
    return clienteEnCache.cliente;
  }

  const cliente = new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 10_000,
      retryOptions: {
        attempts: 1,
      },
    },
  });

  clienteEnCache = { clave: apiKey, cliente };
  return cliente;
}

function registrarFallo(
  tipo: TipoErrorProveedorAyuda,
  model: string,
  statusHttp?: number
): void {
  getLogger().warn(
    {
      tipo,
      ...(statusHttp !== undefined ? { statusHttp } : {}),
      model,
    },
    "Fallo en consulta al proveedor de ayuda"
  );
}

export type ParametrosConsultaModelo = {
  readonly contexto: ContextoAyuda;
  readonly idsPermitidos: readonly string[];
  readonly permitirDetalle: boolean;
};

/**
 * Queries the Gemini model with structured output, low temperature, and lowest thinking level.
 *
 * Precondition: `idsPermitidos` must not be empty.
 */
export async function consultarModeloAyuda({
  contexto,
  idsPermitidos,
  permitirDetalle,
}: ParametrosConsultaModelo): Promise<SalidaModelo> {
  if (idsPermitidos.length === 0) {
    throw new Error("idsPermitidos no puede estar vacío");
  }

  const env = getEnv();
  const model = env.GEMINI_MODEL;
  const apiKey = env.GEMINI_API_KEY;

  if (!apiKey) {
    registrarFallo("sin_clave", model);
    throw new ErrorProveedorAyuda(
      "sin_clave",
      "GEMINI_API_KEY no está configurada"
    );
  }

  const client = obtenerCliente(apiKey);

  const properties: Record<string, Schema> = {
    respuesta: {
      type: Type.STRING,
      description: "Respuesta clara y concisa en texto plano.",
    },
    entradaId: {
      type: Type.STRING,
      format: "enum",
      enum: [...idsPermitidos],
      nullable: true,
      description: "ID de la entrada de la guía correspondiente, o null.",
    },
  };

  const required = ["respuesta", "entradaId"];

  if (permitirDetalle) {
    properties.necesitaDetalle = {
      type: Type.BOOLEAN,
      description: "Indica si se requiere consultar el detalle de otra entrada.",
    };
    required.push("necesitaDetalle");
  }

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties,
    required,
  };

  const contents = contexto.turnos.map((turno) => ({
    role: turno.rol === "usuario" ? "user" : "model",
    parts: [{ text: turno.contenido }],
  }));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, 10_000);

  let textoRespuesta: string;

  try {
    const response = await client.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: contexto.sistema,
        temperature: 0.2,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
        responseMimeType: "application/json",
        responseSchema,
        abortSignal: controller.signal,
        httpOptions: {
          timeout: 10_000,
          retryOptions: {
            attempts: 1,
          },
        },
      },
    });

    const text = response.text;
    if (typeof text !== "string" || text.trim().length === 0) {
      throw new ErrorProveedorAyuda(
        "formato",
        "El modelo devolvió una respuesta vacía"
      );
    }
    textoRespuesta = text;
  } catch (error) {
    if (error instanceof ErrorProveedorAyuda) {
      registrarFallo(error.tipo, model, error.statusHttp);
      throw error;
    }

    if (
      controller.signal.aborted ||
      (error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError"))
    ) {
      registrarFallo("timeout", model);
      throw new ErrorProveedorAyuda(
        "timeout",
        "La llamada al modelo excedió el tiempo límite de 10 s",
        { cause: error }
      );
    }

    const statusHttp =
      error instanceof ApiError
        ? error.status
        : typeof error === "object" &&
            error !== null &&
            "status" in error &&
            typeof (error as { status: unknown }).status === "number"
          ? (error as { status: number }).status
          : undefined;

    registrarFallo("proveedor", model, statusHttp);
    throw new ErrorProveedorAyuda(
      "proveedor",
      "Error al comunicarse con el proveedor del modelo",
      { cause: error, statusHttp }
    );
  } finally {
    clearTimeout(timeoutId);
  }

  let jsonParseado: unknown;
  try {
    jsonParseado = JSON.parse(textoRespuesta);
  } catch (error) {
    registrarFallo("formato", model);
    throw new ErrorProveedorAyuda(
      "formato",
      "La respuesta del modelo no es un JSON válido",
      { cause: error }
    );
  }

  const baseSchema = z.object({
    respuesta: z.string(),
    entradaId: z
      .string()
      .nullable()
      .refine((id) => id === null || idsPermitidos.includes(id), {
        message: "entradaId debe ser null o uno de los IDs permitidos",
      }),
  });

  const esquemaSalida = permitirDetalle
    ? baseSchema.extend({
        necesitaDetalle: z.boolean(),
      })
    : baseSchema;

  const resultadoZod = esquemaSalida.safeParse(jsonParseado);
  if (!resultadoZod.success) {
    registrarFallo("formato", model);
    throw new ErrorProveedorAyuda(
      "formato",
      "La respuesta del modelo no cumple con el esquema esperado",
      { cause: resultadoZod.error }
    );
  }

  return {
    respuesta: resultadoZod.data.respuesta,
    entradaId: resultadoZod.data.entradaId,
    necesitaDetalle:
      permitirDetalle && "necesitaDetalle" in resultadoZod.data
        ? Boolean(resultadoZod.data.necesitaDetalle)
        : false,
  };
}
