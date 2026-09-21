/**
 * `logout` (M02, FASE 2 point 2.2). Unlike `login`/`activarCuenta`, a
 * logout ALWAYS has an existing session by definition (there is nothing to
 * log out of otherwise) -- so, unlike those two, this goes through the
 * normal `defineCommand` pipeline like any other authenticated use case.
 * `auth.logout` is granted to every role (plan §7 matrix).
 *
 * Only revokes the DB session row; clearing the cookie is the Server
 * Action's job afterwards (same split as `login`/`createSession` not
 * writing the cookie themselves -- see those files).
 */
import { z } from "zod";
import { defineCommand } from "@/shared/usecase";
import { revokeSesion } from "../infrastructure/session-repository";

export const logoutCommand = defineCommand({
  name: "auth.logout",
  permiso: "auth.logout",
  input: z.object({}),
  // Session revocation is not itself a distinct M02-audited event (plan
  // §14 lists activation, lockout, and credential reset -- not routine
  // logout); the session row's own `revocada_en` timestamp is its trail.
  audit: { skip: true, reason: "Routine session revocation is not an M02-audited event (plan §14); revocada_en is its own record." },
  handler: async ({ tx, session }) => {
    await revokeSesion(tx, session.sesionId, new Date());
    return { output: null };
  },
});

export async function logout(): Promise<void> {
  await logoutCommand.execute({});
}
