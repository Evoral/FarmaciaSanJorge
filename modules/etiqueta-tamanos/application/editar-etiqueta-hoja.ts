/**
 * `editarEtiquetaHoja`: changes the sheet (ancho, alto, margen in mm) the etiquetas
 * are printed on (openspec/specs/hoja-etiquetas/spec.md R1, R2, R5, R13). ADMINISTRADOR only
 * (`config.editar`), audited like the sizes (before /
 * after values of the three measures).
 *
 * Two rules beyond the field limits:
 *   - the printable area (sheet minus both margins) must keep the smallest label
 *     size (10 mm) each way: otherwise a field error on `margenMm`;
 *   - no ACTIVE size may stop fitting: a size that fits the current sheet but would
 *     not fit the new one rejects the edit, naming the sizes. A size that ALREADY
 *     does not fit (left as is by migration 0096) does not block the edit, or the
 *     administrator could never fix the sheet that way.
 *
 * The sheet row is locked FOR UPDATE before the active sizes are read; the size
 * commands hold it FOR SHARE while they check their fit, so neither side can slip
 * past the other (see `etiqueta-hoja-repository.ts`). `fsj.etiqueta_hoja` has no
 * surrogate id (its PK is `tenant_id`): the audit row's `entidadId` is the tenant,
 * same as modules/parametros/application/editar-parametro.ts.
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { ValidationError } from "@/shared/errors";
import { HOJA_MM_MAX, HOJA_MM_MIN, MARGEN_MM_MAX, MARGEN_MM_MIN, areaUtilMm, areaUtilSuficiente, entraEnHoja } from "../domain/etiqueta-hoja";
import type { HojaEtiqueta } from "../domain/etiqueta-hoja";
import { TAMANO_MM_MIN, formatearMedidaMm } from "../domain/etiqueta-tamano";
import { getEtiquetaHoja, lockEtiquetaHoja, upsertEtiquetaHoja } from "../infrastructure/etiqueta-hoja-repository";
import { listEtiquetaTamanosActivos } from "../infrastructure/etiqueta-tamano-repository";
import { medidaMmEnRango } from "./medida-mm";

/** Exported for tests/unit/etiqueta-hoja-use-cases.test.ts. */
export const editarEtiquetaHojaInput = z
  .object({
    anchoMm: medidaMmEnRango(HOJA_MM_MIN, HOJA_MM_MAX),
    altoMm: medidaMmEnRango(HOJA_MM_MIN, HOJA_MM_MAX),
    margenMm: medidaMmEnRango(MARGEN_MM_MIN, MARGEN_MM_MAX),
  })
  .strict();

/** PRE-parse shape (raw `FormData` strings): `execute()` still runs the real zod parse. */
export interface EditarEtiquetaHojaInput {
  anchoMm: string;
  altoMm: string;
  margenMm: string;
}

export const AREA_UTIL_MESSAGE = `El margen deja menos de ${TAMANO_MM_MIN} mm útiles en la hoja: achicalo o agrandá la hoja.`;

const CAMPOS: ReadonlyArray<keyof HojaEtiqueta> = ["anchoMm", "altoMm", "margenMm"];

export const editarEtiquetaHojaCommand = defineCommand({
  name: "etiquetaHoja.editar",
  permiso: "config.editar",
  input: editarEtiquetaHojaInput,
  audit: { entidad: "etiqueta_hoja", accion: "MODIFICAR" },
  handler: async ({ tx, session, input }) => {
    if (!areaUtilSuficiente(input)) throw new ValidationError(AREA_UTIL_MESSAGE, { fields: ["margenMm"] });

    await lockEtiquetaHoja(tx, session.tenantId);
    const actual = await getEtiquetaHoja(tx, session.tenantId);

    const activos = await listEtiquetaTamanosActivos(tx, session.tenantId);
    const dejanDeEntrar = activos.filter((tamano) => entraEnHoja(actual, tamano) && !entraEnHoja(input, tamano));
    if (dejanDeEntrar.length > 0) {
      const nombres = dejanDeEntrar.map((tamano) => `"${tamano.nombre}"`).join(", ");
      const maximo = areaUtilMm(input);
      const fields = CAMPOS.filter((campo) => input[campo] !== actual[campo]);
      const mensaje =
        dejanDeEntrar.length === 1
          ? `Con esta hoja no entra el tamaño ${nombres} (el máximo sería ${formatearMedidaMm(maximo.anchoMm)} × ${formatearMedidaMm(maximo.altoMm)} mm). Editalo o dalo de baja antes.`
          : `Con esta hoja no entran los tamaños ${nombres} (el máximo sería ${formatearMedidaMm(maximo.anchoMm)} × ${formatearMedidaMm(maximo.altoMm)} mm). Editalos o dalos de baja antes.`;
      throw new ValidationError(mensaje, { fields });
    }

    await upsertEtiquetaHoja(tx, session.tenantId, input);

    return {
      output: { ...input },
      audit: {
        entidadId: session.tenantId,
        valorAnterior: { anchoMm: actual.anchoMm, altoMm: actual.altoMm, margenMm: actual.margenMm },
        valorNuevo: { anchoMm: input.anchoMm, altoMm: input.altoMm, margenMm: input.margenMm },
      },
    };
  },
});

export async function editarEtiquetaHoja(input: EditarEtiquetaHojaInput): Promise<HojaEtiqueta> {
  return editarEtiquetaHojaCommand.execute(input);
}
