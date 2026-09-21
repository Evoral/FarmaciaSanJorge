/**
 * Per-file setup for the `db` vitest project.
 *
 * Its only job is closing the connections cached in tests/db/helpers.ts
 * (see the comment there for why they are cached) once a test file is
 * done, so a full run does not leave sockets open against the Supabase
 * pooler.
 */
import { afterAll } from "vitest";
import { closeTestConnections } from "./helpers";

afterAll(async () => {
  await closeTestConnections();
});
