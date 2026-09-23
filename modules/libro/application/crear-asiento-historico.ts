/**
 * `crearAsientoHistorico` -- FASE 9, M12 point 9.5 (DP-17: digitalización de
 * asientos del libro físico). Gated on `libro.historico.digitalizar`
 * (DT only -- migration 0002's seed). Outside the correlativo/hash
 * chain/cierres/stock entirely (migration 0014's header) -- a plain INSERT,
 * no repository pre-checks needed beyond what the DB's NOT NULL/FK
 * constraints already enforce.
 *
 * D5 (user decision, 2026-09-23): migration 0035 added
 * `asiento_historico_fisico_unico` (`UNIQUE (tenant_id, tipo_libro,
 * numero_asiento_fisico)`) -- a physical folio can be digitized only once.
 * `mapDbError` collapses EVERY Prisma P2002 into one generic English
 * `ConflictError`, so this handler checks for that specific Prisma error
 * code itself (before it reaches `mapDbError`) to surface a clear Spanish
 * message instead.
 *
 * FIX 3 (jd-fix-agent, 2026-09-23): `numeroAsientoFisico` is canonicalized
 * (trimmed, leading zeros stripped for purely-numeric values -- see
 * `../domain/numero-asiento-fisico.ts`) BEFORE it ever reaches the
 * repository, so "7"/"07"/" 7" are stored as the SAME value and the
 * UNIQUE constraint above actually catches them. Migration 0035's CHECK
 * constraint re-validates the canonical shape in the DB, independent of
 * this app-level transform.
 */
import { z } from "zod";
import { Prisma } from "@/generated/prisma/client";
import { defineCommand, TipoAccion } from "@/shared/usecase";
import { DomainError } from "@/shared/errors";
import { nonEmptyString } from "@/shared/validation";
import { TIPO_LIBRO_HISTORICO } from "../domain/filtros";
import { canonicalizarNumeroAsientoFisico } from "../domain/numero-asiento-fisico";
import { insertAsientoHistorico } from "../infrastructure/historico-repository";

const fechaIso = z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Debe tener el formato AAAA-MM-DD.");

const crearAsientoHistoricoInput = z.object({
  tipoLibro: z.enum(TIPO_LIBRO_HISTORICO),
  numeroAsientoFisico: nonEmptyString.transform(canonicalizarNumeroAsientoFisico),
  fechaAsiento: fechaIso,
  pacienteTexto: z.string().trim().optional(),
  medicoTexto: z.string().trim().optional(),
  formulaTexto: nonEmptyString,
  observaciones: z.string().trim().optional(),
});

export type CrearAsientoHistoricoInput = z.infer<typeof crearAsientoHistoricoInput>;

export const crearAsientoHistoricoCommand = defineCommand({
  name: "libro.historico.crear",
  permiso: "libro.historico.digitalizar",
  input: crearAsientoHistoricoInput,
  audit: { entidad: "asiento_historico", accion: TipoAccion.CREAR },
  handler: async ({ tx, session, input }) => {
    let asiento: { id: string };
    try {
      asiento = await insertAsientoHistorico(tx, {
        tenantId: session.tenantId,
        tipoLibro: input.tipoLibro,
        numeroAsientoFisico: input.numeroAsientoFisico,
        fechaAsiento: input.fechaAsiento,
        pacienteTexto: input.pacienteTexto,
        medicoTexto: input.medicoTexto,
        formulaTexto: input.formulaTexto,
        observaciones: input.observaciones,
        digitalizadoPorId: session.usuario.id,
      });
    } catch (e) {
      // D5 (migration 0035): asiento_historico_fisico_unico.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
        throw new DomainError(
          `Ya existe un asiento histórico digitalizado para el libro ${input.tipoLibro}, folio Nº ${input.numeroAsientoFisico}.`,
        );
      }
      throw e;
    }

    return {
      output: { id: asiento.id },
      audit: { entidadId: asiento.id, valorNuevo: { tipoLibro: input.tipoLibro, numeroAsientoFisico: input.numeroAsientoFisico, fechaAsiento: input.fechaAsiento } },
    };
  },
});

export async function crearAsientoHistorico(input: CrearAsientoHistoricoInput): Promise<{ id: string }> {
  return crearAsientoHistoricoCommand.execute(input);
}
