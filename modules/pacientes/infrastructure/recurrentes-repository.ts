/**
 * Prisma-backed read for the "Pacientes recurrentes" view
 * (docs/specs/pacientes-recurrentes.md). HEALTH-ADJACENT DATA (DP-24, Ley
 * 25.326) -- runs inside an ALREADY OPEN tenant transaction (RLS-scoped),
 * filters by `tenantId` explicitly in every `where` as well (nested relations
 * included), and NEVER passes a paciente field to a logger.
 *
 * ONE batched read (no N+1): every item de receta of the last
 * `VENTANA_MESES` months, with its componentes (droga nombre, cantidad,
 * unidad, modo), its receta (id, fechaIngreso, estado) and its paciente
 * (id, nombre, apellido, telefono, aceptaRecordatoriosWhatsapp, fechaBaja).
 * ANULADA recetas, pacientes dados de baja and recetas outside the window are
 * filtered IN THE QUERY, so they are never loaded. The tenant row is read
 * for the time zone and the farmacia's display name.
 *
 * EXPLICIT `select` EVERYWHERE (never `include`, never a bare `findMany`):
 * `prisma/schema.prisma` still declares `fsj.receta.receta_fisica_recibida*`,
 * columns another migration already dropped from the shared database. A
 * query that selects every receta column (a bare `findMany`/`findUnique`, an
 * `include`, a nested `include`) fails at runtime with "column does not
 * exist". The `where` filters below only reference columns that exist.
 * See docs/specs/trayectoria-paciente.md and trayectoria-repository.ts.
 */
import type { Prisma } from "@/generated/prisma/client";
import { inicioVentanaRecurrentes } from "../domain/recurrentes";
import type { ItemRecurrenteCrudo, RecurrentesCrudos } from "../domain/recurrentes";

/** Columns of the tenant row this view needs: the time zone and the farmacia's name. */
const SELECT_TENANT = { zonaHoraria: true, nombreFantasia: true, razonSocial: true } as const;

const SELECT_ITEM = {
  id: true,
  descripcion: true,
  formaFarmaceutica: true,
  duracionTratamientoDias: true,
  componentes: {
    orderBy: { orden: "asc" },
    select: {
      drogaId: true,
      cantidad: true,
      unidadMedidaId: true,
      modoExpresion: true,
      droga: { select: { nombre: true } },
      unidadMedida: { select: { simbolo: true } },
    },
  },
  receta: {
    select: {
      id: true,
      fechaIngreso: true,
      estado: true,
      paciente: {
        select: { id: true, nombre: true, apellido: true, telefono: true, aceptaRecordatoriosWhatsapp: true, fechaBaja: true },
      },
    },
  },
} as const satisfies Prisma.ItemRecetaSelect;

/**
 * The raw material of the Recurrentes view for `ahora`: the last 12 months of
 * items of vigente pacientes' non-ANULADA recetas, plus the tenant's time zone
 * and farmacia name. Ordered by item id only to make the read deterministic.
 */
export async function getRecurrentesCrudos(tx: Prisma.TransactionClient, tenantId: string, ahora: Date): Promise<RecurrentesCrudos> {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: SELECT_TENANT });
  const desde = inicioVentanaRecurrentes(ahora, tenant.zonaHoraria);

  const rows = await tx.itemReceta.findMany({
    where: {
      tenantId,
      receta: {
        is: {
          tenantId,
          estado: { not: "ANULADA" },
          fechaIngreso: { gte: desde },
          paciente: { is: { tenantId, fechaBaja: null } },
        },
      },
    },
    orderBy: { id: "asc" },
    select: SELECT_ITEM,
  });

  const items: ItemRecurrenteCrudo[] = rows.map((r) => ({
    id: r.id,
    descripcion: r.descripcion,
    formaFarmaceutica: r.formaFarmaceutica,
    duracionTratamientoDias: r.duracionTratamientoDias,
    componentes: r.componentes.map((c) => ({
      drogaId: c.drogaId,
      drogaNombre: c.droga.nombre,
      cantidad: c.cantidad === null ? null : c.cantidad.toString(),
      unidadMedidaId: c.unidadMedidaId,
      unidadSimbolo: c.unidadMedida.simbolo,
      modoExpresion: c.modoExpresion,
    })),
    receta: { id: r.receta.id, fechaIngreso: r.receta.fechaIngreso, estado: r.receta.estado },
    paciente: r.receta.paciente,
  }));

  return { zonaHoraria: tenant.zonaHoraria, farmaciaNombre: tenant.nombreFantasia?.trim() || tenant.razonSocial, items };
}
