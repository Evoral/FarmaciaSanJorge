/**
 * When the QR panel may take the focus back once a reading finishes. After a
 * success it always does (the next scan replaces the text). After an error it
 * does only if nothing else has claimed the focus meanwhile: the body or no
 * element (a disabled button drops it there), or an element inside the panel.
 * A field outside the panel (the manual receta form the user moved on to) keeps
 * it, so a late error never yanks the cursor away. Pure, so it is testable
 * without a DOM.
 */
export function debeRecuperarFoco({
  status,
  activo,
  cuerpo,
  panel,
}: {
  status: "error" | "success";
  activo: unknown;
  cuerpo: unknown;
  panel: { contains(nodo: never): boolean } | null;
}): boolean {
  if (status === "success") return true;
  if (activo === null || activo === undefined || activo === cuerpo) return true;
  return panel?.contains(activo as never) ?? false;
}
