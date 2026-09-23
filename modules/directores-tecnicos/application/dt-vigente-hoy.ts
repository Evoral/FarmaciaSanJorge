/**
 * `dtVigenteHoy` (M04, FASE 3 point 3.9). Read-only: who is the vigente
 * TITULAR (and the vigente SUPLENTE list) as of today, for the "/admin/
 * directores-tecnicos" banner. Same permiso-reuse rationale as
 * `list-designaciones.ts` (no dedicated `dt.ver` in the plan's matrix).
 */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { dtVigenteHoy as dtVigenteHoyRepo } from "../infrastructure/designacion-repository";
import type { DtVigenteHoyResult } from "../infrastructure/designacion-repository";

const dtVigenteHoyInput = z.object({});

export const dtVigenteHoyQuery = defineQuery({
  name: "dt.vigenteHoy",
  permiso: "dt.designar",
  input: dtVigenteHoyInput,
  handler: async ({ tx, session }) => dtVigenteHoyRepo(tx, session.tenantId),
});

export async function dtVigenteHoy(): Promise<DtVigenteHoyResult> {
  return dtVigenteHoyQuery.execute({});
}
