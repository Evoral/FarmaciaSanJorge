import "server-only";
import { ayudaConfigurada as ayudaConfiguradaInfra } from "../infrastructure/gemini.server";

/**
 * Server check for help chat availability (CA1).
 *
 * Re-exports ayudaConfigurada from the infrastructure layer so that `app/**`
 * reaches it through the application layer per AGENTS.md conventions.
 */
export function ayudaConfigurada(): boolean {
  return ayudaConfiguradaInfra();
}
