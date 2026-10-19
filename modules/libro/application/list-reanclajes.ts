/** `listReanclajes` -- the re-anchors already registered, shown on `/libro/integridad` as the permanent record. */
import { z } from "zod";
import { defineQuery } from "@/shared/usecase";
import { listReanclajes as listReanclajesRepo, type ReanclajeRow } from "../infrastructure/reanclaje-repository";

export type ReanclajeItem = ReanclajeRow;

export const listReanclajesQuery = defineQuery({
  name: "libro.integridad.reanclajes",
  permiso: "libro.ver",
  input: z.object({}),
  handler: async ({ tx, session }): Promise<ReanclajeItem[]> => listReanclajesRepo(tx, session.tenantId),
});

export async function listReanclajes(): Promise<ReanclajeItem[]> {
  return listReanclajesQuery.execute({});
}
