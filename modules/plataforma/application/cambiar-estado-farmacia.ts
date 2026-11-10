/** Suspend (motivo required) or reactivate a pharmacy (openspec/specs/plataforma/spec.md P11). */
import { z } from "zod";
import { uuid } from "@/shared/validation";
import { definePlataforma } from "./define-plataforma";
import { MOTIVO_MAX } from "../domain/farmacia";
import { cambiarEstadoFarmacia as cambiarEstadoFarmaciaDb } from "../infrastructure/plataforma-repository";

const input = z
  .object({
    id: uuid,
    estado: z.enum(["ACTIVO", "SUSPENDIDO"]),
    motivo: z
      .string()
      .trim()
      .max(MOTIVO_MAX)
      .nullish()
      .transform((v) => v || null),
  })
  .refine((v) => v.estado !== "SUSPENDIDO" || v.motivo !== null, { message: "Indicá el motivo de la suspensión.", path: ["motivo"] });

export const cambiarEstadoFarmaciaCommand = definePlataforma({
  name: "plataforma.farmacias.estado",
  input,
  handler: ({ tx, actor, input, meta }) => cambiarEstadoFarmaciaDb(tx, actor.tokenHash, input.id, input.estado, input.motivo, meta),
});

export function cambiarEstadoFarmacia(raw: { id: string; estado: string; motivo?: string | null }) {
  return cambiarEstadoFarmaciaCommand.execute(raw);
}
