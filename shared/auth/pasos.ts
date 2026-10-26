/**
 * Pending steps a session must complete before using the app
 * (openspec/specs/contrasena-temporal/spec.md). Pure and dependency-free so that
 * `shared/errors` can import the type without creating a cycle.
 */
export type PasoPendiente = "cambiar-password" | "configurar-pin";

/** The page where a pending step is completed. */
export function rutaDelPaso(paso: PasoPendiente): "/cambiar-password" | "/configurar-pin" {
  return paso === "cambiar-password" ? "/cambiar-password" : "/configurar-pin";
}
