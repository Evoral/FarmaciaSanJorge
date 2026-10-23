/**
 * `configurarNumeracionLibro` -- the DT sets the first number of a libro (recetario or contralor) from
 * `/libro/numeracion`: 1 to start from scratch, or the next number of the physical book to continue it (migration
 * 0097, INV-L26, docs/specs/libro-recetario-y-contralor.md "Numeración inicial").
 *
 * Allowed until the first signed cierre covering the libro's asientos fixes it. Asientos already registered are
 * renumbered by the difference and their hash chain recomputed in the DB (`fsj.libro_configurar_numeracion`), which
 * is the real backstop for every check below.
 */
import { z } from "zod";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { AUTH_POLICY } from "@/shared/auth/policy";
import { DomainError, InvariantViolationError, mapDbError } from "@/shared/errors";
import { uuid } from "@/shared/validation";
import { etiquetaLibro } from "../domain/integridad";
import { mensajeParaInvarianteNumeracion } from "../domain/mensajes-invariantes";
import { NUMERO_INICIAL_MAXIMO, parseNumeroInicial } from "../domain/numeracion";
import { configurarNumeracionDb, listNumeracionLibros } from "../infrastructure/numeracion-repository";
import { verificarCadenaLibro } from "../infrastructure/asiento-repository";

const configurarNumeracionLibroInput = z.object({
  libroId: uuid,
  numeroInicial: z.string().refine((v) => parseNumeroInicial(v) !== null, `Ingresá un número entero entre 1 y ${NUMERO_INICIAL_MAXIMO.toLocaleString("es-AR")}.`),
});

export interface NumeracionConfigurada {
  libro: string;
  numeroInicial: string;
  numeroInicialAnterior: string;
  asientosRenumerados: number;
}

export const configurarNumeracionLibroCommand = defineCommand({
  name: "libro.numeracion.configurar",
  permiso: "libro.anulacion.autorizar",
  requireRecentReauth: { maxAgeMinutes: AUTH_POLICY.reauthWindowMinutes },
  input: configurarNumeracionLibroInput,
  audit: { entidad: "libro_rubricado", accion: TipoAccion.MODIFICAR },
  handler: async ({ tx, session, input }) => {
    const numeroInicial = (parseNumeroInicial(input.numeroInicial) ?? BigInt(1)).toString();
    const libro = (await listNumeracionLibros(tx, session.tenantId)).find((l) => l.libroId === input.libroId);
    if (!libro) throw new DomainError("El libro no existe o ya está cerrado.");
    if (libro.fijadaEnJornada !== null) throw new DomainError(mensajeParaInvarianteNumeracion("INV-L26"));
    if (libro.contralorManual) {
      throw new DomainError("Los libros contralor se llevan en forma manual: esta farmacia no activó el contralor digital, así que no hay numeración que configurar.");
    }
    if (libro.tieneReanclaje) {
      throw new DomainError("Este libro tiene un reanclaje de la cadena registrado: su numeración ya no se puede cambiar. Contactá a soporte.");
    }
    // Renumbering rehashes the whole chain: on a broken one it would hide the break (the DB refuses it too).
    const quiebre = await verificarCadenaLibro(tx, session.tenantId, input.libroId);
    if (quiebre !== null) {
      throw new DomainError(
        `Se rompió la integridad de ${etiquetaLibro(libro.tipo)} (asiento Nº ${quiebre}): su numeración no se puede cambiar. Revisá la sección Integridad y contactá a soporte.`,
      );
    }
    if (libro.numeroInicial === numeroInicial) {
      throw new DomainError(`${etiquetaLibro(libro.tipo)} ya empieza en el Nº ${numeroInicial}.`, { fields: ["numeroInicial"] });
    }

    try {
      const resultado = await configurarNumeracionDb(tx, { tenantId: session.tenantId, libroId: input.libroId, numeroInicial });
      const output: NumeracionConfigurada = {
        libro: etiquetaLibro(libro.tipo),
        numeroInicial,
        numeroInicialAnterior: resultado.numeroInicialAnterior,
        asientosRenumerados: resultado.asientosRenumerados,
      };
      return {
        output,
        audit: {
          entidadId: input.libroId,
          valorAnterior: { numeroInicial: resultado.numeroInicialAnterior },
          valorNuevo: { libro: libro.tipo, numeroInicial, asientosRenumerados: resultado.asientosRenumerados },
        },
      };
    } catch (e) {
      // Same discipline as firmar-cierre.ts: a race past the pre-checks above (a cierre signed meanwhile) surfaces
      // as INV-L26 from the DB and is mapped here, inside the handler.
      const mapped = mapDbError(e);
      if (mapped instanceof InvariantViolationError) {
        throw new DomainError(mensajeParaInvarianteNumeracion(mapped.invariantCode), { cause: mapped });
      }
      throw mapped;
    }
  },
});

export async function configurarNumeracionLibro(input: z.input<typeof configurarNumeracionLibroInput>): Promise<NumeracionConfigurada> {
  return configurarNumeracionLibroCommand.execute(input);
}
