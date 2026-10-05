/**
 * Text of the QR panel's persistent live region (`role="status"`): kept in a
 * pure module so it is testable without a DOM. The region is always rendered
 * and only its text changes, which is what makes screen readers announce it.
 * An error is announced by its own `role="alert"`, so the status stays empty then.
 */
export const MENSAJE_ANUNCIO_LEYENDO = "Leyendo…";
export const MENSAJE_ANUNCIO_LEIDA = "Receta leída. Revisá la vista previa.";

export function textoAnuncioLectura({ isPending, status, importando }: { isPending: boolean; status: "idle" | "error" | "success"; importando: boolean }): string {
  if (isPending) return MENSAJE_ANUNCIO_LEYENDO;
  return status === "success" && importando ? MENSAJE_ANUNCIO_LEIDA : "";
}
