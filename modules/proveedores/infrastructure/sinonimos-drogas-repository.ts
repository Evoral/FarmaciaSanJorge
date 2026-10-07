/**
 * Vigente synonyms of the tenant's drogas (docs/specs/sinonimos-droga.md),
 * for the client-filtered droga pickers of the Comparador de costos and the
 * proveedor Trayectoria: typing a synonym finds the droga. A separate read
 * (not folded into `readDrogasConPartidas` / `readDrogasDisponibles`) so
 * those queries keep their exact shape; the rule itself lives in
 * `shared/db/busqueda-droga.ts`.
 */
import type { Prisma } from "@/generated/prisma/client";
import { listSinonimosVigentes } from "@/shared/db/busqueda-droga";

/** droga id -> its vigente synonyms (as typed, alphabetical). */
export async function readSinonimosDrogas(tx: Prisma.TransactionClient, tenantId: string): Promise<Record<string, string[]>> {
  return Object.fromEntries(await listSinonimosVigentes(tx, tenantId));
}
